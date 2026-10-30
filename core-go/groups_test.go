package main

import (
	"path/filepath"
	"testing"
)

func TestGroupModules(t *testing.T) {
	list := []Integration{
		{File: "mqtt-broker", Label: "MqttBroker"},
		{File: "sofar-client", Label: "Sofar"},
		{File: "miele-client", Label: "Miele"},
		{File: "smartthings-client", Label: "SmartThings"},
		{File: "tradfri-client", Label: "Tradfri"},
		{File: "bayrol-client", Label: "Bayrol"},
		{File: "hydrop-client", Label: "hydrop"},
	}
	got := groupModules(list, map[string]any{})
	var ids []string
	for _, it := range got {
		ids = append(ids, it.File)
	}
	if must(ids) != `["mqtt-broker","group-local","group-cloud","smartthings-client"]` {
		t.Fatalf("%v", ids)
	}
	if n := len(got[1].Members); n != 2 || got[2].Members[2].Label != "hydrop" {
		t.Fatalf("members %+v / %+v", got[1].Members, got[2].Members)
	}
	// off, custom, and a group of one isn't formed
	if len(groupModules(list, map[string]any{"modules": map[string]any{"groups": false}})) != len(list) {
		t.Fatal("groups: false")
	}
	c := groupModules(list, map[string]any{"modules": map[string]any{"groups": map[string]any{"x": []any{"Sofar", "smartthings-client"}, "y": []any{"Miele"}}}})
	if len(c) != 6 || c[1].File != "group-x" || len(c[1].Members) != 2 {
		t.Fatalf("custom %+v", c)
	}
}

func TestGroupProcess(t *testing.T) {
	root, _ := filepath.Abs("..")
	store := NewStore("")
	reg := NewRegistry(store, "")
	ps := NewPlatformStatus()
	host := NewModuleHost(root, "node", store, reg, ps, func() (map[string]any, error) { return map[string]any{}, nil }, 512)
	t.Cleanup(host.StopAll)
	a, _ := filepath.Abs("testdata/fake-client.js")
	b, _ := filepath.Abs("testdata/fake-client-b.js")
	broken, _ := filepath.Abs("testdata/broken-client.js")
	g := groupModules([]Integration{{File: a, Label: "Virtual"}, {File: b, Label: "Sofar"}, {File: broken, Label: "Arduino"}}, map[string]any{})
	if len(g) != 1 {
		t.Fatalf("%+v", g)
	}
	m := host.Add(g[0])

	waitFor(t, "both devices", func() bool { return reg.Has("fake/1") && reg.Has("fakeb/1") })
	waitFor(t, "running", func() bool { return m.Info()["state"] == "running" })
	if host.Get(a) != m || host.Get(b) != m || host.Get("group-local") != m {
		t.Fatal("member lookup")
	}
	// writes reach the right client
	if err := reg.SendCommand("fakeb/1", "on", "on"); err != nil {
		t.Fatal(err)
	}
	if err := reg.SendCommand("fake/1", "level", 33.0); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "writes", func() bool { return store.Get("fakeb/1/on") == true && store.Get("fake/1/level") == 33.0 })
	// calls pick their member
	if v, err := m.CallMember(b, "whoami"); err != nil || v != "b" {
		t.Fatalf("whoami: %v %v", v, err)
	}
	if v, err := m.CallMember(a, "getToken"); err != nil || v != "tok-123" {
		t.Fatalf("getToken: %v %v", v, err)
	}
	if _, err := m.CallMember(a, "whoami"); err == nil {
		t.Fatal("whoami isn't fake-client's")
	}
	// the broken member is reported, not fatal
	members := m.Info()["members"].([]map[string]any)
	if len(members) != 3 || members[2]["error"] == nil || members[0]["error"] != nil {
		t.Fatalf("members %v", members)
	}
	// a crash restarts the whole group, both clients come back
	m.kill("test")
	waitFor(t, "restart", func() bool { return m.Info()["state"] == "running" && m.Info()["restarts"] == 1 })
	if err := reg.SendCommand("fakeb/1", "on", "off"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "write after restart", func() bool { return store.Get("fakeb/1/on") == false })
}
