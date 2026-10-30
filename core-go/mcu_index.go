package main

// Microcontroller index — port of src/microcontroller-index-client.js: an
// estimate of embedded MCUs from the devices marked permanent (device edit
// panel → Permanent), each counted as the MCUs typical for its type.
// config.microcontrollerIndex: false to disable, or { pollInterval (s,
// default 60, min 5), name, defaultPerDevice (1), perType {…} }.

import (
	"log"
	"math"
	"time"
)

const mcuKey = "system/microcontrollers"

var mcuDefaultPerType = map[string]float64{
	"shelly": 1, "esphome": 1, "wled": 1, "tuya": 1, "camera": 2, "yale": 2,
	"lock": 2, "hue": 2, "tradfri": 1, "sonos": 3, "router": 3,
}

func startMcuIndex(cfg map[string]any, store *Store, reg *Registry, ps *PlatformStatus) {
	if cfg["microcontrollerIndex"] == false {
		return
	}
	c, _ := cfg["microcontrollerIndex"].(map[string]any)
	perType := map[string]float64{}
	for k, v := range mcuDefaultPerType {
		perType[k] = v
	}
	if pt, ok := c["perType"].(map[string]any); ok {
		for k, v := range pt {
			perType[k] = jsNumber(v)
		}
	}
	def := 1.0
	if n := jsNumber(c["defaultPerDevice"]); c["defaultPerDevice"] != nil && !math.IsNaN(n) && !math.IsInf(n, 0) {
		def = n
	}
	label := any("Microcontroller index")
	if truthy(c["name"]) {
		label = c["name"]
	}
	reg.Register(OM("key", mcuKey, "label", label, "type", "mcu-index", "icon", "🔬", "sensors", []any{
		OM("path", "total", "name", "Microcontrollers", "type", "number", "precision", 0.0),
		OM("path", "devices", "name", "Permanent devices", "type", "number", "precision", 0.0),
		OM("path", "breakdown", "name", "Breakdown", "type", "string"), // { <type>: { devices, mcus } }
	}), nil)

	update := func() {
		byType := NewOMap()
		devices, total := 0.0, 0.0
		for _, d := range reg.Devices() {
			if !truthy(d.Get("permanent")) || d.Get("key") == mcuKey {
				continue
			}
			typ := jsString(d.Get("type"))
			mcus, ok := perType[typ]
			if !ok {
				mcus = def
			}
			name := typ
			if !truthy(d.Get("type")) {
				name = "unknown"
			}
			t, _ := byType.Get(name).(*OMap)
			if t == nil {
				t = OM("devices", 0.0, "mcus", 0.0)
				byType.Set(name, t)
			}
			t.Set("devices", t.Get("devices").(float64)+1)
			t.Set("mcus", t.Get("mcus").(float64)+mcus)
			devices++
			total += mcus
		}
		store.Set(mcuKey+"/total", total)
		store.Set(mcuKey+"/devices", devices)
		b, _ := marshalJS(byType)
		store.Set(mcuKey+"/breakdown", string(b))
		ps.Set("microcontrollerIndex", true)
	}
	// a permanent toggle fires devices-changed; the timer catches new devices
	reg.On(func(event string, _ any) { go update() })
	every := math.Max(jsNumber(orStr(c["pollInterval"], 60.0)), 5)
	if math.IsNaN(every) {
		every = 60
	}
	go func() {
		for range time.Tick(time.Duration(every) * time.Second) {
			update()
		}
	}()
	update()
	log.Printf("[McuIndex] Started — every %ds", int(every))
}
