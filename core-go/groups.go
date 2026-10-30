package main

// Module groups — small integrations share one Node process instead of
// paying ~25–45 MB of Node runtime each (the way they all shared the Node
// core's main process before). A crash restarts the whole group, so what
// stays on its own is what others depend on (the MQTT broker), what is
// heavy (TensorFlow in SmartThings / object detection, AirPlay + ffmpeg in
// Media) and Loxone In.
//
// config.modules.groups: { "<name>": ["<label or src file>", …] } replaces
// the default below; false turns grouping off. A group with fewer than two
// running members isn't formed.

import (
	"strings"
)

var defaultModuleGroups = []struct {
	name    string
	members []string
}{
	{"cloud", []string{"HomeConnect", "Miele", "Bayrol", "Domatiq", "Landroid", "LGThinQ", "Tuya", "Somfy", "OpenWeather", "TauronTariff",
		"Vitodens", "Dyson", "Airly", "tado", "Sensibo", "Homey", "hydrop"}},
	{"local", []string{"Sofar", "Tradfri", "OCPP", "ModbusEmu", "Announce", "Virtual", "SystemMetrics", "Arduino", "LanMonitor", "Recorder", "Waypoints",
		"SolarAccelerator", "Shelly", "ESPHome", "WLED", "Atios SmartCore"}},
}

type moduleGroup struct {
	name    string
	members []string
}

func moduleGroups(cfg map[string]any) []moduleGroup {
	mods := section(cfg, "modules")
	switch g := mods["groups"].(type) {
	case bool:
		if !g {
			return nil
		}
	case map[string]any:
		var out []moduleGroup
		for name, list := range g {
			var members []string
			for _, x := range arr(list) {
				members = append(members, jsString(x))
			}
			out = append(out, moduleGroup{name, members})
		}
		return out
	}
	var out []moduleGroup
	for _, g := range defaultModuleGroups {
		out = append(out, moduleGroup{g.name, g.members})
	}
	return out
}

// groupModules folds the selected integrations into groups; a group takes
// the place of its first member in the start order.
func groupModules(list []Integration, cfg map[string]any) []Integration {
	groups := moduleGroups(cfg)
	groupOf := map[string]int{}
	for gi, g := range groups {
		for _, m := range g.members {
			groupOf[strings.ToLower(m)] = gi
		}
	}
	find := func(it Integration) (int, bool) {
		if gi, ok := groupOf[strings.ToLower(it.Label)]; ok {
			return gi, true
		}
		gi, ok := groupOf[strings.ToLower(it.File)]
		return gi, ok
	}
	members := make([][]Integration, len(groups))
	for _, it := range list {
		if gi, ok := find(it); ok {
			members[gi] = append(members[gi], it)
		}
	}
	var out []Integration
	placed := map[int]bool{}
	for _, it := range list {
		gi, ok := find(it)
		if !ok || len(members[gi]) < 2 {
			out = append(out, it)
			continue
		}
		if placed[gi] {
			continue
		}
		placed[gi] = true
		g := Integration{File: "group-" + groups[gi].name, Label: strings.ToUpper(groups[gi].name[:1]) + groups[gi].name[1:], On: true, Installed: true, Members: members[gi]}
		out = append(out, g)
	}
	return out
}
