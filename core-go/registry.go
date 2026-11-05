package main

// SensorRegistry — Go port of the parts of src/sensor-registry.js the core
// needs: the device catalog, user overrides (persist/device-overrides.json),
// readings, and sendCommand. Descriptors stay generic maps: every
// integration adds its own fields and the dashboard reads them as-is.

import (
	"crypto/rand"
	"encoding/hex"
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

// randSuffix returns n random hex characters (decor item ids, like the JS
// registry's Math.random().toString(36).slice(2, 6)).
func randSuffix(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		return "0000"[:n]
	}
	return hex.EncodeToString(b)[:n]
}

type Device = *OMap

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
	ovFile    string // persist/device-overrides.json — written back by the customize/decor/room writers
	listeners []func(event string, payload any)
	types     *OMap // Victron service type → definition (device-definitions.js)
}

func NewRegistry(store *Store, overridesFile string) *Registry {
	r := &Registry{store: store, devices: map[string]Device{}, writers: map[string]Writer{}, overrides: map[string]any{}, ovFile: overridesFile}
	if b, err := os.ReadFile(overridesFile); err == nil {
		json.Unmarshal(b, &r.overrides)
	}
	return r
}

// saveOverrides persists the overrides map (atomic temp + rename). Caller holds r.mu.
func (r *Registry) saveOverrides() error {
	if r.ovFile == "" {
		return nil
	}
	b, err := json.MarshalIndent(r.overrides, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.ovFile + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.ovFile)
}

// SetDeviceTypes turns on Victron auto-discovery: a store key under a known
// service ("<service>/<instance>/…") registers that device, as
// SensorRegistry._checkTopic does.
func (r *Registry) SetDeviceTypes(types *OMap) {
	r.mu.Lock()
	first := r.types == nil
	r.types = types
	r.mu.Unlock()
	if first {
		r.store.OnChange(func(c Change) { r.checkTopic(c.Key) })
	}
}

func (r *Registry) checkTopic(topic string) {
	service, rest, ok := strings.Cut(topic, "/")
	if !ok {
		return
	}
	r.mu.RLock()
	def, _ := r.types.Get(service).(*OMap)
	r.mu.RUnlock()
	if def == nil {
		return
	}
	instance, _, _ := strings.Cut(rest, "/")
	if instance == "" {
		return
	}
	key := service + "/" + instance
	if r.Has(key) {
		return
	}
	suffix := instance
	if n, err := strconv.Atoi(leadingInt(instance)); err == nil && n == 0 {
		suffix = "" // parseInt(instance, 10) === 0
	}
	d := OM("key", key, "type", service, "instance", instance,
		"label", strings.TrimSpace(jsString(def.Get("label"))+" "+suffix), "icon", def.Get("icon"))
	if c, ok := def.Lookup("color"); ok {
		d.Set("color", c)
	}
	d.Set("sensors", def.Get("sensors"))
	d.Set("homekit", def.Get("homekit"))
	if r.Register(d, nil) {
		log.Printf("[Sensors] Discovered: %v (%s)", d.Get("label"), key)
	}
}

// leadingInt is the prefix parseInt(s, 10) reads ("0abc" → "0").
func leadingInt(s string) string {
	i := 0
	if i < len(s) && (s[i] == '-' || s[i] == '+') {
		i++
	}
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	return s[:i]
}

// On receives 'device-discovered' (Device) and 'devices-changed' (the Device).
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
	o, ok := r.overrides[d.Str("key")].(map[string]any)
	if !ok {
		return
	}
	if v, ok := o["room"].(string); ok && v != "" {
		d.Set("room", v)
	}
	if v, ok := o["icon"].(string); ok && v != "" {
		d.Set("customIcon", v)
	}
	if v, ok := o["label"].(string); ok && v != "" {
		d.Set("_origLabel", d.Get("label"))
		d.Set("label", v)
	}
	if v, ok := o["permanent"].(bool); ok && v {
		d.Set("permanent", true)
	}
	for _, f := range []string{"planX", "planY", "planFloor", "camAngle", "camFov", "camRange"} {
		if v, ok := o[f]; ok && v != nil {
			d.Set(f, v)
		}
	}
}

// Register adds a device (ignored when the key exists, like the JS registry).
func (r *Registry) Register(d Device, w Writer) bool {
	key := d.Str("key")
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
	log.Printf("[Sensors] Registered: %v (%s)", d.Get("label"), key)
	r.emit("device-discovered", d)
	return true
}

// Refresh replaces a device a module re-sent (changed, or after a restart),
// keeping the dashboard's customisations on top.
func (r *Registry) Refresh(d Device, w Writer) {
	key := d.Str("key")
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
	r.emit("devices-changed", d) // payload lets the module host re-mirror the changed descriptor
}

func (r *Registry) Has(key string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.devices[key]
	return ok
}

func sensorsOf(d Device) []*OMap {
	arr, _ := d.Get("sensors").([]any)
	out := make([]*OMap, 0, len(arr))
	for _, s := range arr {
		if m, ok := s.(*OMap); ok {
			out = append(out, m)
		}
	}
	return out
}

// {...device, readings} with readings[path] = {...sensor, value, timestamp}
// — key order as Node builds it.
func (r *Registry) readings(d Device) Device {
	key := d.Str("key")
	readings := NewOMap()
	for _, s := range sensorsOf(d) {
		p := jsString(s.Get("path"))
		full := key + "/" + p
		v := r.store.Get(full)
		if v == nil {
			continue
		}
		rd := s.Clone()
		rd.Set("value", v)
		rd.Set("timestamp", r.store.Timestamp(full))
		readings.Set(p, rd)
	}
	out := d.Clone()
	out.Set("readings", readings)
	return out
}

// Devices — the descriptors in registration order (getDevices()).
func (r *Registry) Devices() []Device {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Device, 0, len(r.order))
	for _, k := range r.order {
		out = append(out, r.devices[k])
	}
	return out
}

// Device is the registered descriptor itself (no readings).
func (r *Registry) Device(key string) Device {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.devices[key]
}

// Writable reports whether a device has a write capability — i.e. a scene
// action targeting it can actually be replayed.
func (r *Registry) Writable(key string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.writers[key] != nil
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

func roundDP(v float64, dp int) float64 {
	p := math.Pow(10, float64(dp))
	return math.Round(v*p) / p
}

// SetOverride mirrors SensorRegistry.setOverride: room / icon / label /
// permanent / plan position / camera FOV on a device, persisted to
// device-overrides.json. Fields absent from body are left unchanged; a field
// present but empty clears it. Returns the updated device.
func (r *Registry) SetOverride(key string, body *OMap) (Device, error) {
	r.mu.Lock()
	d, ok := r.devices[key]
	if !ok {
		r.mu.Unlock()
		return nil, fmt.Errorf("Unknown device: %s", key)
	}
	o := map[string]any{}
	if cur, ok := r.overrides[key].(map[string]any); ok {
		for k, v := range cur {
			o[k] = v
		}
	}
	setStr := func(ovKey, devKey string, raw any, max int, prefixKeep string) {
		t := strings.TrimSpace(jsString(raw))
		v := t
		if prefixKeep != "" && strings.HasPrefix(t, prefixKeep) {
			if len(v) > 24 {
				v = v[:24]
			}
		} else if len(v) > max {
			v = v[:max]
		}
		if v != "" {
			o[ovKey] = v
			d.Set(devKey, v)
		} else {
			delete(o, ovKey)
			d.Delete(devKey)
		}
	}
	if raw, has := body.Lookup("room"); has {
		setStr("room", "room", raw, 40, "")
	}
	if raw, has := body.Lookup("icon"); has {
		setStr("icon", "customIcon", raw, 8, "svg:")
	}
	if raw, has := body.Lookup("label"); has {
		v := strings.TrimSpace(jsString(raw))
		if len(v) > 60 {
			v = v[:60]
		}
		if v != "" {
			if d.Get("_origLabel") == nil {
				d.Set("_origLabel", d.Get("label"))
			}
			o["label"] = v
			d.Set("label", v)
		} else {
			delete(o, "label")
			if orig := d.Get("_origLabel"); orig != nil {
				d.Set("label", orig)
				d.Delete("_origLabel")
			}
		}
	}
	if raw, has := body.Lookup("permanent"); has {
		if raw == true || raw == "true" {
			o["permanent"] = true
			d.Set("permanent", true)
		} else {
			delete(o, "permanent")
			d.Delete("permanent")
		}
	}
	if raw, has := body.Lookup("planFloor"); has {
		v := jsString(raw)
		if v == "cellar" || v == "floor1" || v == "floor2" {
			o["planFloor"] = v
			d.Set("planFloor", v)
		} else {
			delete(o, "planFloor")
			d.Delete("planFloor")
		}
	}
	for _, field := range []string{"planX", "planY"} {
		raw, has := body.Lookup(field)
		if !has {
			continue
		}
		if v := jsNumber(raw); !math.IsNaN(v) {
			cv := roundDP(math.Min(1, math.Max(0, v)), 3)
			o[field] = cv
			d.Set(field, cv)
		} else {
			delete(o, field)
			d.Delete(field)
		}
	}
	for _, c := range []struct {
		field  string
		lo, hi float64
		dp     int
		angle  bool
	}{{"camAngle", 0, 360, 1, true}, {"camFov", 20, 170, 0, false}, {"camRange", 0.4, 15, 2, false}} {
		raw, has := body.Lookup(c.field)
		if !has {
			continue
		}
		v := jsNumber(raw)
		if raw == "" || raw == nil || math.IsNaN(v) {
			delete(o, c.field)
			d.Delete(c.field)
			continue
		}
		var cv float64
		if c.angle {
			cv = roundDP(math.Mod(math.Mod(v, 360)+360, 360), c.dp)
		} else {
			cv = roundDP(math.Min(c.hi, math.Max(c.lo, v)), c.dp)
		}
		o[c.field] = cv
		d.Set(c.field, cv)
	}
	if len(o) > 0 {
		r.overrides[key] = o
	} else {
		delete(r.overrides, key)
	}
	err := r.saveOverrides()
	r.mu.Unlock()
	r.emit("devices-changed", d)
	return d, err
}

// ── Plan decor (furniture placed from the dashboard), under "_decor" ─────────

func (r *Registry) getDecorLocked() map[string]any {
	if m, ok := r.overrides["_decor"].(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func (r *Registry) GetDecor() any {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.getDecorLocked()
}

// saveDecorLocked stores decor back (dropping it entirely when no floor has
// items) and persists. Caller holds r.mu.
func (r *Registry) saveDecorLocked(decor map[string]any) (any, error) {
	any_ := false
	for k, v := range decor {
		if k == "_hidden" {
			continue
		}
		if arr, ok := v.([]any); ok && len(arr) > 0 {
			any_ = true
		}
	}
	if any_ {
		r.overrides["_decor"] = decor
	} else {
		delete(r.overrides, "_decor")
	}
	err := r.saveOverrides()
	return r.getDecorLocked(), err
}

func validFloor(f string) bool { return f == "cellar" || f == "floor1" || f == "floor2" }

func (r *Registry) AddDecor(floor, emoji, image string, x, y float64, hideAuto string) (any, error) {
	if !validFloor(floor) {
		return nil, fmt.Errorf("Bad floor")
	}
	e := strings.TrimSpace(emoji)
	if len(e) > 8 {
		e = e[:8]
	}
	img := strings.TrimSpace(image)
	if len(img) > 400 {
		img = img[:400]
	}
	if img != "" && !(strings.HasPrefix(img, "/") || strings.HasPrefix(img, "http://") || strings.HasPrefix(img, "https://")) {
		return nil, fmt.Errorf("Bad image URL")
	}
	if e == "" && img == "" {
		return nil, fmt.Errorf("Emoji or image required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	decor := cloneDecor(r.getDecorLocked())
	item := map[string]any{
		"id": base36Now() + randSuffix(4),
		"x":  math.Min(1, math.Max(0, x)),
		"y":  math.Min(1, math.Max(0, y)),
	}
	if img != "" {
		item["image"] = img
	} else {
		item["emoji"] = e
	}
	if hideAuto != "" {
		if len(hideAuto) > 120 {
			hideAuto = hideAuto[:120]
		}
		item["autoId"] = hideAuto
	}
	arr, _ := decor[floor].([]any)
	decor[floor] = append(arr, item)
	if hideAuto != "" {
		decor["_hidden"] = addUnique(decor["_hidden"], hideAuto)
	}
	return r.saveDecorLocked(decor)
}

func (r *Registry) HideAutoDecor(autoId string) (any, error) {
	id := strings.TrimSpace(autoId)
	if id == "" {
		return nil, fmt.Errorf("id required")
	}
	if len(id) > 120 {
		id = id[:120]
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	decor := cloneDecor(r.getDecorLocked())
	decor["_hidden"] = addUnique(decor["_hidden"], id)
	return r.saveDecorLocked(decor)
}

func (r *Registry) MoveDecor(id string, x, y float64) (any, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	decor := cloneDecor(r.getDecorLocked())
	for f, v := range decor {
		if f == "_hidden" {
			continue
		}
		arr, _ := v.([]any)
		for _, it := range arr {
			if m, ok := it.(map[string]any); ok && jsString(m["id"]) == id {
				m["x"] = math.Min(1, math.Max(0, x))
				m["y"] = math.Min(1, math.Max(0, y))
			}
		}
	}
	return r.saveDecorLocked(decor)
}

func (r *Registry) RemoveDecor(id string) (any, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	decor := cloneDecor(r.getDecorLocked())
	var removedAuto string
	for f, v := range decor {
		if f == "_hidden" {
			continue
		}
		arr, _ := v.([]any)
		kept := make([]any, 0, len(arr))
		for _, it := range arr {
			m, _ := it.(map[string]any)
			if m != nil && jsString(m["id"]) == id {
				if a := jsString(m["autoId"]); a != "" {
					removedAuto = a
				}
				continue
			}
			kept = append(kept, it)
		}
		decor[f] = kept
	}
	if removedAuto != "" {
		if hid, ok := decor["_hidden"].([]any); ok {
			out := make([]any, 0, len(hid))
			for _, h := range hid {
				if jsString(h) != removedAuto {
					out = append(out, h)
				}
			}
			decor["_hidden"] = out
		}
	}
	return r.saveDecorLocked(decor)
}

// SetRoomIcon mirrors setRoomIcon: room → { icon } under "_rooms".
func (r *Registry) SetRoomIcon(room, icon string) (any, error) {
	name := strings.TrimSpace(room)
	if len(name) > 40 {
		name = name[:40]
	}
	if name == "" {
		return nil, fmt.Errorf("Room name required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	rooms, _ := r.overrides["_rooms"].(map[string]any)
	if rooms == nil {
		rooms = map[string]any{}
	}
	v := strings.TrimSpace(icon)
	if len(v) > 8 {
		v = v[:8]
	}
	if v != "" {
		rooms[name] = map[string]any{"icon": v}
	} else {
		delete(rooms, name)
	}
	if len(rooms) > 0 {
		r.overrides["_rooms"] = rooms
	} else {
		delete(r.overrides, "_rooms")
	}
	err := r.saveOverrides()
	var out any = map[string]any{}
	if m, ok := r.overrides["_rooms"].(map[string]any); ok {
		out = m
	}
	return out, err
}

// cloneDecor shallow-copies the floor map and each floor's slice so edits don't
// mutate the stored arrays until saveDecorLocked commits them.
func cloneDecor(src map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range src {
		if arr, ok := v.([]any); ok {
			cp := make([]any, len(arr))
			copy(cp, arr)
			out[k] = cp
		} else {
			out[k] = v
		}
	}
	return out
}

func addUnique(list any, v string) []any {
	arr, _ := list.([]any)
	for _, x := range arr {
		if jsString(x) == v {
			return arr
		}
	}
	return append(arr, v)
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
	value = clean(value)
	r.mu.RLock()
	d, ok := r.devices[key]
	w := r.writers[key]
	r.mu.RUnlock()
	if !ok || w == nil {
		return errors.New("Device not found or not writable")
	}
	var sensor *OMap
	for _, s := range sensorsOf(d) {
		if s.Get("path") == path {
			sensor = s
		}
	}
	if sensor == nil || sensor.Get("controllable") != true {
		return errors.New("Sensor not controllable")
	}
	capID, cmd := sensor.Get("capabilityId"), sensor.Get("writeCmd")
	var err error
	switch sensor.Get("type") {
	case "range", "color-temp", "text":
		_, err = w([]any{capID, cmd, []any{value}})
	case "color":
		c := normalizeColor(value)
		if c == nil {
			return errors.New("Invalid colour value")
		}
		if lvl, ok := c["level"]; ok {
			for _, s := range sensorsOf(d) {
				if s.Get("path") == "level" && s.Get("controllable") == true {
					wc := s.Get("writeCmd")
					if wc == nil {
						wc = "setLevel"
					}
					w([]any{s.Get("capabilityId"), wc, []any{lvl}}) // colour still applies if this fails
				}
			}
		}
		_, err = w([]any{capID, "setColor", []any{OM("hue", c["hue"], "saturation", c["saturation"])}})
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
			_, err = w([]any{capID, sensor.Get("writeOn")})
		} else {
			_, err = w([]any{capID, sensor.Get("writeOff")})
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
	if m, ok := value.(*OMap); ok {
		h, hok := toNum(m.Get("hue"))
		s, sok := toNum(m.Get("saturation"))
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
