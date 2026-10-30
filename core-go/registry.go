package main

// SensorRegistry — Go port of the parts of src/sensor-registry.js the core
// needs: the device catalog, user overrides (persist/device-overrides.json),
// readings, and sendCommand. Descriptors stay generic maps: every
// integration adds its own fields and the dashboard reads them as-is.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type Device = map[string]any

// Writer runs a device's _writeCapability(capabilityId, command, args) —
// for module devices it forwards to the module process.
type Writer func(args []any) (any, error)

type Registry struct {
	mu        sync.RWMutex
	store     *Store
	devices   map[string]Device
	order     []string
	writers   map[string]Writer
	overrides map[string]any
	listeners []func(event string, payload any)
}

func NewRegistry(store *Store, overridesFile string) *Registry {
	r := &Registry{store: store, devices: map[string]Device{}, writers: map[string]Writer{}, overrides: map[string]any{}}
	if b, err := os.ReadFile(overridesFile); err == nil {
		json.Unmarshal(b, &r.overrides)
	}
	return r
}

// On receives 'device-discovered' (Device) and 'devices-changed' (nil).
func (r *Registry) On(fn func(event string, payload any)) {
	r.mu.Lock()
	r.listeners = append(r.listeners, fn)
	r.mu.Unlock()
}

func (r *Registry) emit(event string, payload any) {
	r.mu.RLock()
	ls := r.listeners
	r.mu.RUnlock()
	for _, fn := range ls {
		fn(event, payload)
	}
}

func (r *Registry) applyOverride(d Device) {
	key, _ := d["key"].(string)
	o, ok := r.overrides[key].(map[string]any)
	if !ok {
		return
	}
	if v, ok := o["room"].(string); ok && v != "" {
		d["room"] = v
	}
	if v, ok := o["icon"].(string); ok && v != "" {
		d["customIcon"] = v
	}
	if v, ok := o["label"].(string); ok && v != "" {
		if _, has := d["_origLabel"]; !has {
			d["_origLabel"] = d["label"]
		}
		d["label"] = v
	}
	if v, ok := o["permanent"].(bool); ok && v {
		d["permanent"] = true
	}
	for _, f := range []string{"planX", "planY", "planFloor", "camAngle", "camFov", "camRange"} {
		if v, ok := o[f]; ok && v != nil {
			d[f] = v
		}
	}
}

// Register adds a device (ignored when the key exists, like the JS registry).
func (r *Registry) Register(d Device, w Writer) bool {
	key, _ := d["key"].(string)
	if key == "" {
		return false
	}
	r.mu.Lock()
	if _, exists := r.devices[key]; exists {
		r.mu.Unlock()
		return false
	}
	r.applyOverride(d)
	r.devices[key] = d
	r.order = append(r.order, key)
	if w != nil {
		r.writers[key] = w
	}
	r.mu.Unlock()
	log.Printf("[Sensors] Registered: %v (%s)", d["label"], key)
	r.emit("device-discovered", d)
	return true
}

// Refresh replaces a device a module re-sent (changed, or after a restart),
// keeping the dashboard's customisations on top.
func (r *Registry) Refresh(d Device, w Writer) {
	key, _ := d["key"].(string)
	r.mu.Lock()
	if _, exists := r.devices[key]; !exists {
		r.mu.Unlock()
		r.Register(d, w)
		return
	}
	r.applyOverride(d)
	r.devices[key] = d
	if w != nil {
		r.writers[key] = w
	}
	r.mu.Unlock()
	r.emit("devices-changed", nil)
}

func (r *Registry) Has(key string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.devices[key]
	return ok
}

func sensorsOf(d Device) []map[string]any {
	arr, _ := d["sensors"].([]any)
	out := make([]map[string]any, 0, len(arr))
	for _, s := range arr {
		if m, ok := s.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func (r *Registry) readings(d Device) Device {
	key, _ := d["key"].(string)
	readings := map[string]any{}
	for _, s := range sensorsOf(d) {
		p, _ := s["path"].(string)
		full := key + "/" + p
		v := r.store.Get(full)
		if v == nil {
			continue
		}
		rd := make(map[string]any, len(s)+2)
		for k, x := range s {
			rd[k] = x
		}
		rd["value"] = v
		rd["timestamp"] = r.store.Timestamp(full)
		readings[p] = rd
	}
	out := make(Device, len(d)+1)
	for k, v := range d {
		out[k] = v
	}
	out["readings"] = readings
	return out
}

func (r *Registry) DeviceReadings(key string) Device {
	r.mu.RLock()
	d, ok := r.devices[key]
	r.mu.RUnlock()
	if !ok {
		return nil
	}
	return r.readings(d)
}

func (r *Registry) AllReadings() []Device {
	r.mu.RLock()
	keys := append([]string(nil), r.order...)
	r.mu.RUnlock()
	out := make([]Device, 0, len(keys))
	for _, k := range keys {
		if d := r.DeviceReadings(k); d != nil {
			out = append(out, d)
		}
	}
	return out
}

func (r *Registry) RoomMeta() any {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if m, ok := r.overrides["_rooms"].(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.devices)
}

func (r *Registry) Keys() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	k := append([]string(nil), r.order...)
	sort.Strings(k)
	return k
}

// SendCommand — same dispatch as SensorRegistry.sendCommand().
func (r *Registry) SendCommand(key, path string, value any) error {
	r.mu.RLock()
	d, ok := r.devices[key]
	w := r.writers[key]
	r.mu.RUnlock()
	if !ok || w == nil {
		return errors.New("Device not found or not writable")
	}
	var sensor map[string]any
	for _, s := range sensorsOf(d) {
		if s["path"] == path {
			sensor = s
		}
	}
	if sensor == nil || sensor["controllable"] != true {
		return errors.New("Sensor not controllable")
	}
	capID, cmd := sensor["capabilityId"], sensor["writeCmd"]
	var err error
	switch sensor["type"] {
	case "range", "color-temp", "text":
		_, err = w([]any{capID, cmd, []any{value}})
	case "color":
		c := normalizeColor(value)
		if c == nil {
			return errors.New("Invalid colour value")
		}
		if lvl, ok := c["level"]; ok {
			for _, s := range sensorsOf(d) {
				if s["path"] == "level" && s["controllable"] == true {
					wc := s["writeCmd"]
					if wc == nil {
						wc = "setLevel"
					}
					w([]any{s["capabilityId"], wc, []any{lvl}}) // colour still applies if this fails
				}
			}
		}
		_, err = w([]any{capID, "setColor", []any{map[string]any{"hue": c["hue"], "saturation": c["saturation"]}}})
	default:
		on := false
		switch v := value.(type) {
		case bool:
			on = v
		case float64:
			on = v == 1
		case string:
			on = v == "on" || v == "1" || v == "true"
		}
		if on {
			_, err = w([]any{capID, sensor["writeOn"]})
		} else {
			_, err = w([]any{capID, sensor["writeOff"]})
		}
	}
	return err
}

// ── Colour value normalisation (dashboard object, or Loxone/VO scalar) ───────

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func rgbToHsv(r, g, b float64) (h, s, v float64) {
	r, g, b = r/255, g/255, b/255
	max, min := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))
	d := max - min
	if d != 0 {
		switch max {
		case r:
			h = math.Mod((g-b)/d, 6)
		case g:
			h = (b-r)/d + 2
		default:
			h = (r-g)/d + 4
		}
		h *= 60
		if h < 0 {
			h += 360
		}
	}
	if max != 0 {
		s = d / max * 100
	}
	return h, s, max * 100
}

func normalizeColor(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		h, hok := toNum(m["hue"])
		s, sok := toNum(m["saturation"])
		if hok && sok {
			return map[string]any{"hue": clamp(h, 0, 100), "saturation": clamp(s, 0, 100)}
		}
		return nil
	}
	str := strings.TrimSpace(fmt.Sprint(value))
	if strings.Contains(str, ",") {
		parts := strings.Split(str, ",")
		nums := make([]float64, len(parts))
		for i, p := range parts {
			n, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
			if err != nil {
				return nil
			}
			nums[i] = n
		}
		switch len(nums) {
		case 2:
			return map[string]any{"hue": clamp(nums[0], 0, 100), "saturation": clamp(nums[1], 0, 100)}
		case 3:
			h, s, v := rgbToHsv(nums[0], nums[1], nums[2])
			return map[string]any{"hue": math.Round(h / 3.6), "saturation": math.Round(s), "level": math.Round(v)}
		}
		return nil
	}
	n, err := strconv.ParseFloat(str, 64)
	if err != nil || n < 0 || n > 100100100 {
		return nil
	}
	rr, gg, bb := math.Mod(n, 1000), math.Mod(math.Floor(n/1000), 1000), math.Floor(n/1000000)
	h, s, v := rgbToHsv(rr/100*255, gg/100*255, bb/100*255)
	return map[string]any{"hue": math.Round(h / 3.6), "saturation": math.Round(s), "level": math.Round(v)}
}

func toNum(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case string:
		n, err := strconv.ParseFloat(x, 64)
		return n, err == nil
	}
	return 0, false
}
