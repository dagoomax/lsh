package main

// Differential tests: each scenario runs through the real Node engine
// (testdata/engine-harness.js) and through the Go engine, and the traces —
// device commands, notifications, store writes, debug taps, registered flow
// devices, saved automations.json, Loxone XML — must match exactly.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type step struct {
	Set      []any  `json:"set,omitempty"`
	Run      string `json:"run,omitempty"`
	Scene    string `json:"scene,omitempty"`
	SaveFlow any    `json:"saveFlow,omitempty"`
	XML      any    `json:"xml,omitempty"`
	Wait     int    `json:"wait,omitempty"`
}

type scenario struct {
	Rules  []any          `json:"rules,omitempty"`
	Scenes []any          `json:"scenes,omitempty"`
	Flows  []any          `json:"flows,omitempty"`
	Steps  []step         `json:"steps"`
	Config map[string]any `json:"config,omitempty"`
}

var (
	nowStampRe = regexp.MustCompile(`,1[78]\d{11}\]$`)
	badRegexRe = regexp.MustCompile(`Bad regex: [^"]*`)
)

// traceKey encodes one event. Two things legitimately differ and are
// normalised: Date.now() payloads, and the regex engine's error wording.
func traceKey(v ...any) string {
	k := traceKeyRaw(v...)
	k = nowStampRe.ReplaceAllString(k, ",<now>]")
	return badRegexRe.ReplaceAllString(k, "Bad regex: <engine message>")
}

func traceKeyRaw(v ...any) string {
	b, err := marshalJS(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func nodeTrace(t *testing.T, sc scenario) (events []string, saves []string) {
	t.Helper()
	f := filepath.Join(t.TempDir(), "scenario.json")
	b, _ := json.Marshal(sc)
	os.WriteFile(f, b, 0o644)
	out, err := exec.Command("node", "testdata/engine-harness.js", f).Output()
	if err != nil {
		t.Fatalf("node harness: %v", err)
	}
	var raw []json.RawMessage
	if err := json.Unmarshal(out, &raw); err != nil {
		t.Fatalf("harness output: %v\n%s", err, out)
	}
	for _, r := range raw {
		v := rawOrdered(r).([]any)
		if v[0] == "save" {
			saves = append(saves, v[1].(string))
			continue
		}
		events = append(events, traceKey(v...))
	}
	sort.Strings(events)
	return events, saves
}

func undefOr(v any) any {
	if v == Undefined {
		return "<undefined>"
	}
	return v
}

func goTrace(t *testing.T, sc scenario) (events []string, saved string) {
	t.Helper()
	dir := t.TempDir()
	file := filepath.Join(dir, "automations.json")
	b, _ := json.Marshal(map[string]any{"rules": orEmptyList(sc.Rules), "scenes": orEmptyList(sc.Scenes), "flows": orEmptyList(sc.Flows)})
	os.WriteFile(file, b, 0o644)

	var mu sync.Mutex
	add := func(v ...any) { mu.Lock(); events = append(events, traceKey(v...)); mu.Unlock() }

	store := NewStore(filepath.Join(dir, "store.json.gz"))
	reg := NewRegistry(store, filepath.Join(dir, "none.json"))
	store.OnChange(func(c Change) {
		if !strings.HasPrefix(c.Key, "in/") {
			add("set", c.Key, c.Value)
		}
	})
	reg.On(func(ev string, p any) {
		if ev == "device-discovered" {
			j, _ := marshalJS(p)
			add("device", string(j))
		}
	})
	cfg := sc.Config
	if cfg == nil {
		cfg = map[string]any{}
	}
	a := NewAutomation(store, reg, cfg, file, dir, func(ev string, d any) {
		m, _ := d.(*OMap)
		switch ev {
		case "flow-debug":
			add("debug", m.Get("label"), m.Get("key"), undefOr(m.Get("payload")))
		case "notification":
			add("notify", m.Get("level"), m.Get("message"), m.Get("source"))
		}
	})
	a.send = func(key, sensor string, value any) error {
		add("cmd", key, sensor, undefOr(value))
		if key == "fail/1" {
			return errors.New("Device not found or not writable")
		}
		return nil
	}
	a.Start()
	defer a.Stop()
	for _, st := range sc.Steps {
		raw, _ := json.Marshal(st)
		s := rawOrdered(raw).(*OMap)
		if set := arr(s.Get("set")); set != nil {
			store.Set(set[0].(string), set[1])
		}
		if id := st.Run; id != "" {
			if _, err := a.RunFlow(id); err != nil {
				add("error", err.Error())
			}
		}
		if id := st.Scene; id != "" {
			if _, err := a.RunScene(id); err != nil {
				add("error", err.Error())
			}
		}
		if f, ok := s.Get("saveFlow").(*OMap); ok {
			if _, err := a.SaveFlow(f); err != nil {
				add("error", err.Error())
			}
		}
		if x, ok := s.Get("xml").(*OMap); ok {
			add("xml", buildInputsXML(x.Get("device").(*OMap), x.Str("host"), x.Str("token")))
		}
		wait := st.Wait
		if wait == 0 {
			wait = 30
		}
		time.Sleep(time.Duration(wait) * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	sort.Strings(events)
	if b, err := os.ReadFile(file); err == nil {
		saved = string(b)
	}
	return events, saved
}

func orEmptyList(v []any) []any {
	if v == nil {
		return []any{}
	}
	return v
}

func compare(t *testing.T, sc scenario) {
	t.Helper()
	want, saves := nodeTrace(t, sc)
	got, saved := goTrace(t, sc)
	if strings.Join(want, "\n") != strings.Join(got, "\n") {
		w, g := map[string]int{}, map[string]int{}
		for _, x := range want {
			w[x]++
		}
		for _, x := range got {
			g[x]++
		}
		var diff []string
		for k, n := range w {
			if g[k] != n {
				diff = append(diff, fmt.Sprintf("node×%d go×%d  %s", n, g[k], k))
			}
		}
		for k, n := range g {
			if _, ok := w[k]; !ok {
				diff = append(diff, fmt.Sprintf("node×0 go×%d  %s", n, k))
			}
		}
		sort.Strings(diff)
		if len(diff) > 40 {
			diff = diff[:40]
		}
		t.Fatalf("traces differ (%d node, %d go events):\n%s", len(want), len(got), strings.Join(diff, "\n"))
	}
	if len(saves) > 0 && saves[len(saves)-1] != saved {
		t.Fatalf("automations.json differs\n--- node ---\n%s\n--- go ---\n%s", saves[len(saves)-1], saved)
	}
	t.Logf("%d events identical", len(want))
}

func node(id, typ string, config map[string]any, wires ...[]string) map[string]any {
	w := []any{}
	for _, p := range wires {
		w = append(w, p)
	}
	return map[string]any{"id": id, "type": typ, "config": config, "wires": w}
}

var payloads = []any{0, 1, -1.5, "1", "01", "1.0", "", " ", "abc", true, false, nil, "true", "0x10", "1e3", "Infinity", []any{}, []any{7}, map[string]any{"a": 1}, 1e21, 0.0000001}

// Every comparison operator × threshold × payload, through condition nodes.
func TestDiffConditionOperators(t *testing.T) {
	var flows []any
	thresholds := []any{0, 1, "1", "", "abc", true, nil, 1000, "16", "0x10"}
	for _, op := range []string{">", "<", ">=", "<=", "==", "!="} {
		for i, cv := range thresholds {
			id := fmt.Sprintf("%s#%d", op, i)
			flows = append(flows, map[string]any{"id": id, "name": id, "enabled": true, "nodes": []any{
				node("t", "trigger", map[string]any{"key": "in/x"}, []string{"c"}),
				node("c", "condition", map[string]any{"op": op, "value": cv}, []string{"yes"}, []string{"no"}),
				node("yes", "debug", map[string]any{"name": id + " yes"}),
				node("no", "debug", map[string]any{"name": id + " no"}),
			}})
		}
	}
	var steps []step
	for _, p := range payloads {
		steps = append(steps, step{Set: []any{"in/x", p}, Wait: 40})
	}
	compare(t, scenario{Flows: flows, Steps: steps})
}

// Edge-triggered trigger nodes and rules, cooldowns, `changes`.
func TestDiffEdgeTriggersAndRules(t *testing.T) {
	sc := scenario{
		Rules: []any{
			map[string]any{"id": "r1", "name": "hot", "enabled": true, "trigger": map[string]any{"key": "in/t", "op": ">", "value": 25},
				"actions": []any{map[string]any{"type": "notify", "level": "warning", "message": "Hot: {value} on {key}"}, map[string]any{"type": "device", "deviceKey": "fan/1", "sensor": "switch", "value": "on"}}},
			map[string]any{"id": "r2", "name": "every", "enabled": true, "trigger": map[string]any{"key": "in/t", "op": "changes"},
				"actions": []any{map[string]any{"type": "scene", "sceneId": "s1"}, map[string]any{"type": "bogus"}}},
			map[string]any{"id": "r3", "name": "off", "enabled": false, "trigger": map[string]any{"key": "in/t", "op": "changes"}, "actions": []any{map[string]any{"type": "notify", "message": "never"}}},
			map[string]any{"id": "r4", "name": "cool", "enabled": true, "cooldownSeconds": 3600, "trigger": map[string]any{"key": "in/t", "op": "<", "value": "20"},
				"actions": []any{map[string]any{"type": "relay", "index": 0, "on": true}, map[string]any{"type": "page", "from": "a", "to": "b"}, map[string]any{"type": "device", "deviceKey": "fail/1", "sensor": "x", "value": 1}}},
		},
		Scenes: []any{map[string]any{"id": "s1", "name": "Scene one", "icon": "🎬", "actions": []any{map[string]any{"type": "notify", "message": "scene {value}/{key}"}}}},
		Flows: []any{map[string]any{"id": "f1", "name": "edge", "nodes": []any{
			node("t", "trigger", map[string]any{"key": "in/t", "op": ">=", "value": "22"}, []string{"d"}),
			node("d", "debug", map[string]any{}),
		}}, map[string]any{"id": "f2", "name": "disabled", "enabled": false, "nodes": []any{
			node("t", "trigger", map[string]any{"key": "in/t"}, []string{"d"}), node("d", "debug", map[string]any{"name": "never"}),
		}}},
	}
	for _, v := range []any{20, 26, 27, 24, 19, 30, 18, "26", 21.9, 22} {
		sc.Steps = append(sc.Steps, step{Set: []any{"in/t", v}, Wait: 40})
	}
	compare(t, sc)
}

// Templates, extract, global, sync, store/loxoneXml devices, sceneGen,
// virtual/device values, http errors, test runs.
func TestDiffNodeTypes(t *testing.T) {
	sc := scenario{
		Config: map[string]any{"server": map[string]any{"port": 3001}},
		Flows: []any{
			map[string]any{"id": "tpl", "name": "Templates ż🙂", "enabled": true, "nodes": []any{
				node("t", "trigger", map[string]any{"key": "in/v"}, []string{"n", "dv", "dt", "ds", "v", "sy", "g", "st1", "st2", "st3", "x1"}),
				node("n", "notify", map[string]any{"message": "v={value} k={key} {value}"}),
				node("dv", "device", map[string]any{"deviceKey": "lamp/1", "sensor": "level", "value": "{value}"}),
				node("dt", "device", map[string]any{"deviceKey": "lamp/1", "sensor": "label", "value": "is {value}!"}),
				node("ds", "device", map[string]any{"deviceKey": "lamp/1", "sensor": "switch", "value": "on"}),
				node("v", "virtual", map[string]any{"deviceKey": "virtual/a", "value": "{value}"}),
				node("sy", "sync", map[string]any{"sensor": "level", "targets": "a/1\r\nb/2, c/3\n\n,fail/1"}),
				node("g", "global", map[string]any{"mode": "set", "name": "last"}, []string{"gg"}),
				node("gg", "global", map[string]any{"name": "last"}, []string{"gd"}),
				node("gd", "debug", map[string]any{"name": "global"}),
				node("st1", "store", map[string]any{"name": "Num ż🙂 widget", "kind": "number", "unit": "W", "min": 0, "max": "500", "icon": "☀️", "color": "orange"}),
				node("st2", "store", map[string]any{"name": "Bool", "kind": "boolean"}),
				node("st3", "store", map[string]any{"name": "Txt", "kind": "text"}),
				node("x1", "extract", map[string]any{"pattern": `(\d+)\.(\d+)`, "flags": "", "group": 2}, []string{"xd"}),
				node("xd", "debug", map[string]any{"name": "extract"}),
			}},
			map[string]any{"id": "gen", "name": "gen", "enabled": true, "nodes": []any{
				node("t", "trigger", map[string]any{"key": "in/g"}, []string{"s1", "s2", "s3", "unset", "lx"}),
				node("s1", "sceneGen", map[string]any{"name": "Gen dev", "actionType": "device", "deviceKey": "lamp/1", "sensor": "level", "value": "{value}"}),
				node("s2", "sceneGen", map[string]any{"name": "Gen relay", "actionType": "relay", "index": "x", "on": 1, "enabled": false}),
				node("s3", "sceneGen", map[string]any{"name": "Gen note", "actionType": "notify", "message": "got {value}", "icon": "✨"}),
				node("unset", "global", map[string]any{"name": "neverSet"}, []string{"ud"}),
				node("ud", "debug", map[string]any{"name": "unset"}),
				node("lx", "loxoneXml", map[string]any{"name": "Gold price", "unit": "zł", "min": 0, "max": 100000}),
			}},
			map[string]any{"id": "err", "name": "errors", "enabled": true, "nodes": []any{
				node("t", "trigger", map[string]any{"key": "in/e"}, []string{"h", "bad", "nn", "rel", "pg", "ex0", "exs"}),
				node("h", "http", map[string]any{"url": "notaurl"}),
				node("bad", "extract", map[string]any{"pattern": "(", "flags": ""}),
				node("nn", "store", map[string]any{}),
				node("rel", "relay", map[string]any{"index": 1, "on": true}),
				node("pg", "page", map[string]any{"from": "a"}),
				node("ex0", "extract", map[string]any{"pattern": "b(c)?", "group": 0}, []string{"exd0"}),
				node("exd0", "debug", map[string]any{"name": "group0"}),
				node("exs", "extract", map[string]any{"pattern": "B(c)?", "flags": "i", "group": "0"}, []string{"exds"}),
				node("exds", "debug", map[string]any{"name": "groupStr0"}),
			}},
			map[string]any{"id": "timer", "name": "timer", "enabled": false, "nodes": []any{
				node("tm", "time", map[string]any{"intervalSeconds": 3600}, []string{"d"}),
				node("d", "debug", map[string]any{"name": "timer"}),
				node("tr", "trigger", map[string]any{"key": "in/run"}, []string{"d"}),
			}},
		},
		Steps: []step{
			{Set: []any{"in/run", 5}},
			{Set: []any{"in/v", 12.5}, Wait: 60},
			{Set: []any{"in/v", "abc 3.14 def"}, Wait: 60},
			{Set: []any{"in/v", true}, Wait: 60},
			{Set: []any{"in/v", nil}, Wait: 60},
			{Set: []any{"in/g", 7}, Wait: 60},
			{Set: []any{"in/g", "1234"}, Wait: 60},
			{Set: []any{"in/e", "abc"}, Wait: 60},
			{Run: "timer", Wait: 60},
			{Run: "nope"},
			{SaveFlow: map[string]any{"id": "new1", "name": "Saved <&> \"q\"", "nodes": nil}},
			{SaveFlow: map[string]any{"id": "new2"}},
			{XML: map[string]any{"host": "10.0.0.2:3000", "token": "t&k", "device": map[string]any{"key": "shelly/x", "label": "Plug <1>",
				"sensors": []any{
					map[string]any{"path": "power", "name": "Power", "type": "range", "unit": "W", "min": 0, "max": 3500},
					map[string]any{"path": "relay", "name": "Relay", "type": "toggle", "controllable": true, "writeOn": "on", "writeOff": "off"},
					map[string]any{"path": "up", "type": "toggle", "controllable": true, "writeOn": "up", "writeOff": "up"},
					map[string]any{"path": "t", "label": "Temp", "type": "number"},
					map[string]any{"path": "b", "type": "boolean"},
					map[string]any{"path": "txt", "type": "text"},
					map[string]any{"path": "radio", "ref": "radio-1", "type": "number"},
					map[string]any{"path": "ct", "type": "color-temp", "min": 2700},
				}}}},
		},
	}
	compare(t, sc)
}
