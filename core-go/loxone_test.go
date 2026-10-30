package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// xmlDevices: every Victron device type, plus sensors shaped like the other
// integrations' (colour, colour-temp, momentary, trigger, hint, ref, hidden,
// strings in min/max, XML-hostile labels). LSH_XML_DEVICES=<file> adds a
// real /api/devices dump.
func xmlDevices(t *testing.T) []any {
	types := deviceTypes(t)
	var devs []any
	for _, k := range types.Keys() {
		def := types.Get(k).(*OMap)
		devs = append(devs, OM("key", k+"/0", "label", def.Get("label"), "type", k, "sensors", def.Get("sensors")))
	}
	devs = append(devs, OM("key", "shelly/plug 1", "label", `Plug <"A"> & ż`, "type", "shelly", "sensors", []any{
		OM("path", "relay", "name", "Relay", "type", "toggle", "controllable", true, "writeOn", "on", "writeOff", "off"),
		OM("path", "up", "label", "Up", "type", "toggle", "controllable", true, "writeOn", "up", "writeOff", "up", "hint", "pulse"),
		OM("path", "go", "type", "trigger", "controllable", true),
		OM("path", "rgb", "type", "color", "controllable", true),
		OM("path", "ct", "type", "color-temp", "controllable", true, "min", 2700, "max", 6500),
		OM("path", "lvl", "type", "range", "controllable", true, "unit", "%"),
		OM("path", "note", "type", "text", "controllable", true),
		OM("path", "secret", "type", "range", "hidden", true, "controllable", true),
		OM("path", "radio", "ref", "radio-7", "type", "number"),
		OM("path", "b", "type", "boolean"),
		OM("path", "lbl", "type", "label"),
	}))
	if f := os.Getenv("LSH_XML_DEVICES"); f != "" {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		real := rawOrdered(raw).(*OMap).Get("data").([]any)
		for _, d := range real {
			d.(*OMap).Delete("readings")
		}
		devs = append(devs, real...)
		t.Logf("+ %d real devices from %s", len(real), f)
	}
	for len(devs) < 45 { // enough commands for several 40-command blocks
		devs = append(devs, devs...)
	}
	return devs
}

func TestDiffLoxoneXML(t *testing.T) {
	devs := xmlDevices(t)
	scenes := []any{OM("id", "s1", "name", "Dobranoc <&>"), OM("id", "s 2"), OM("id", "flowscene-x", "name", "Gen")}
	opts := OM("host", "10.0.0.5:3000", "token", "abc&def", "pollingMs", 7000.0)
	f := filepath.Join(t.TempDir(), "in.json")
	b, _ := marshalJS(OM("devices", devs, "scenes", scenes, "opts", opts))
	os.WriteFile(f, b, 0o644)
	out, err := exec.Command("node", "testdata/xml-harness.js", f).Output()
	if err != nil {
		t.Fatal(err)
	}
	var want struct {
		Inputs, Outputs, Scenes []string
		Zip                     string
		PerDevice               [][2][]string
	}
	if err := json.Unmarshal(out, &want); err != nil {
		t.Fatal(err)
	}
	var ds, ss []*OMap
	for _, d := range devs {
		ds = append(ds, d.(*OMap))
	}
	for _, s := range scenes {
		ss = append(ss, s.(*OMap))
	}
	o := xmlOpts{host: "10.0.0.5:3000", token: "abc&def", pollingMs: 7000}
	check := func(name string, want, got []string) {
		t.Helper()
		if len(want) != len(got) {
			t.Fatalf("%s: node %d blocks, go %d", name, len(want), len(got))
		}
		for i := range want {
			if want[i] != got[i] {
				wl, gl := strings.Split(want[i], "\n"), strings.Split(got[i], "\n")
				for j := range min(len(wl), len(gl)) {
					if wl[j] != gl[j] {
						t.Fatalf("%s block %d line %d:\nnode: %s\ngo:   %s", name, i, j, wl[j], gl[j])
					}
				}
				t.Fatalf("%s block %d: line counts differ", name, i)
			}
		}
	}
	check("inputs", want.Inputs, buildInputsXMLs(ds, o))
	check("outputs", want.Outputs, buildOutputsXMLs(ds, o))
	check("scenes", want.Scenes, buildScenesXMLs(ss, o))
	for i, d := range ds {
		check(fmt.Sprintf("device %d inputs", i), want.PerDevice[i][0], buildInputsXMLs([]*OMap{d}, o))
		check(fmt.Sprintf("device %d outputs", i), want.PerDevice[i][1], buildOutputsXMLs([]*OMap{d}, o))
	}
	var files []zipFile
	for i, p := range buildInputsXMLs(ds, o) {
		files = append(files, zipFile{fmt.Sprintf("lsh-loxone-inputs-%d.xml", i+1), []byte(p)})
	}
	if base64.StdEncoding.EncodeToString(zipStore(files)) != want.Zip {
		t.Fatal("zip differs")
	}
	t.Logf("%d devices, %d input + %d output blocks, zip — identical", len(ds), len(want.Inputs), len(want.Outputs))
}

// Node's outputs.xml throws a TypeError ("toFixed is not a function") on a
// string min/max and the export fails; the Go port formats the number.
func TestOutputsXMLStringRange(t *testing.T) {
	d := OM("key", "a/1", "label", "A", "sensors", []any{OM("path", "ct", "type", "color-temp", "controllable", true, "min", "2700", "max", "6500")})
	x := buildOutputsXMLs([]*OMap{d}, xmlOpts{host: "h", token: "t"})
	if len(x) != 1 || !strings.Contains(x[0], `MinVal="2700.0" MaxVal="6500.0"`) {
		t.Fatalf("%v", x)
	}
}

// ── Loxone Out against a fake Miniserver ────────────────────────────────────

type fakeMiniserver struct {
	mu   sync.Mutex
	hits []string
}

func (f *fakeMiniserver) handler(w http.ResponseWriter, r *http.Request) {
	user, pass, _ := r.BasicAuth()
	f.mu.Lock()
	f.hits = append(f.hits, r.URL.EscapedPath())
	f.mu.Unlock()
	if user != "admin" || pass != "pw" {
		w.WriteHeader(401)
		return
	}
	if strings.Contains(r.URL.EscapedPath(), "/Missing/") {
		w.Write([]byte(`<?xml version="1.0"?><LL control="dev/sps/io/Missing/1" value="" Code="404"/>`))
		return
	}
	w.Write([]byte(`<LL control="x" value="1" Code="200"/>`))
}

func (f *fakeMiniserver) list() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.hits...)
}

func hostPort(u string) (string, float64) {
	hp := strings.TrimPrefix(u, "http://")
	i := strings.LastIndex(hp, ":")
	var p float64
	fmt.Sscan(hp[i+1:], &p)
	return hp[:i], p
}

func TestLoxoneOut(t *testing.T) {
	ms := &fakeMiniserver{}
	srv := httptest.NewServer(http.HandlerFunc(ms.handler))
	defer srv.Close()
	host, port := hostPort(srv.URL)
	store := NewStore("")
	store.Set("a/1/temp", 21.5)
	cfg := map[string]any{"loxoneOut": map[string]any{"host": host, "port": port, "password": "pw", "mappings": []any{
		map[string]any{"storeKey": "a/1/temp", "virtualInput": "LSH Temp"},
		map[string]any{"storeKey": "a/1/temp", "virtualInput": "LSH Temp 2"},
		map[string]any{"storeKey": "radio/x/nowPlaying", "virtualInput": "LSH gra"},
		map[string]any{"storeKey": "a/1/on", "virtualInput": "Missing"},
	}}}
	o := loxoneOutFrom(cfg, store, NewPlatformStatus())
	o.Start(4)
	defer o.Stop()
	waitFor(t, "initial push", func() bool { return len(ms.list()) == 2 })

	// a burst is debounced to its last value; a repeat isn't resent
	for _, v := range []any{1.0, 2.0, 22.25} {
		store.Set("a/1/temp", v)
	}
	store.Set("radio/x/nowPlaying", "RMF FM — Zażółć & gęślą / jaźń?"+strings.Repeat("ż", 600))
	store.Set("a/1/on", true)
	time.Sleep(400 * time.Millisecond)
	store.Set("a/1/temp", 22.25)
	time.Sleep(400 * time.Millisecond)

	hits := ms.list()
	want := []string{"/dev/sps/io/LSH%20Temp/21.5", "/dev/sps/io/LSH%20Temp%202/21.5", "/dev/sps/io/LSH%20Temp/22.25", "/dev/sps/io/LSH%20Temp%202/22.25", "/dev/sps/io/Missing/1"}
	for _, w := range want {
		found := 0
		for _, h := range hits {
			if h == w {
				found++
			}
		}
		if found != 1 {
			t.Fatalf("%s sent %d× — hits %v", w, found, hits)
		}
	}
	// text: encodeURIComponent, cut to 512 UTF-16 units
	var text string
	for _, h := range hits {
		if strings.HasPrefix(h, "/dev/sps/io/LSH%20gra/") {
			text = h
		}
	}
	nodeOut, _ := exec.Command("node", "-e", `const v=("RMF FM — Zażółć & gęślą / jaźń?"+"ż".repeat(600)).slice(0,512);process.stdout.write("/dev/sps/io/"+encodeURIComponent("LSH gra")+"/"+encodeURIComponent(v))`).Output()
	if text != string(nodeOut) {
		t.Fatalf("text push differs:\nnode %s\ngo   %s", nodeOut, text)
	}
	if _, err := o.Push("Missing", 1.0); err == nil || err.Error() != "no Virtual Input called “Missing” on the Miniserver (404)" {
		t.Fatalf("404: %v", err)
	}
	// the 404 one is retried on its next change (not deduped)
	store.Set("a/1/on", true)
	waitFor(t, "retry", func() bool {
		n := 0
		for _, h := range ms.list() {
			if h == "/dev/sps/io/Missing/1" {
				n++
			}
		}
		return n == 2
	})

	bad := loxoneOutFrom(map[string]any{"loxoneOut": map[string]any{"host": host, "port": port, "password": "nope"}}, store, NewPlatformStatus())
	if _, err := bad.Push("X", 1.0); err == nil || !strings.Contains(err.Error(), "HTTP 401") {
		t.Fatalf("401: %v", err)
	}
}

// ── Fibaro Out against a fake Home Center ───────────────────────────────────

func TestFibaroOut(t *testing.T) {
	var mu sync.Mutex
	vars := map[string]string{"LSH_existing": "x", "LSH_race": "y"}
	var log []string
	hc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		body, _ := io.ReadAll(r.Body)
		log = append(log, r.Method+" "+r.URL.EscapedPath()+" "+string(body))
		switch {
		case r.Method == "GET":
			w.Write([]byte(`[{"name":"LSH_existing","value":"x"}]`)) // LSH_race exists but isn't listed
		case r.Method == "POST":
			var v map[string]string
			json.Unmarshal(body, &v)
			if _, ok := vars[v["name"]]; ok {
				w.WriteHeader(409)
				w.Write([]byte(`{"type":"ERROR","reason":"exists"}`))
				return
			}
			vars[v["name"]] = v["value"]
			w.WriteHeader(201)
		case r.Method == "PUT":
			var v map[string]string
			json.Unmarshal(body, &v)
			vars[v["name"]] = v["value"]
		}
	}))
	defer hc.Close()
	host, port := hostPort(hc.URL)
	store := NewStore("")
	store.Set("satel/zone/3/state", true)
	cfg := map[string]any{"fibaroOut": map[string]any{"host": host, "port": port, "mappings": []any{
		map[string]any{"storeKey": "x/armed", "variable": "LSH existing"},
		map[string]any{"storeKey": "x/race", "variable": "LSH_race"},
		map[string]any{"storePrefix": "satel/zone/", "variablePrefix": "LSH_satel_zone_"},
	}}}
	f := fibaroOutFrom(cfg, store, NewPlatformStatus())
	f.Start(3)
	defer f.Stop()
	get := func(k string) string { mu.Lock(); defer mu.Unlock(); return vars[k] }
	waitFor(t, "initial push", func() bool { return get("LSH_satel_zone_3_state") == "1" })
	store.Set("x/armed", false)
	store.Set("x/race", 2.5)
	store.Set("satel/zone/4/ała🙂", nil)
	waitFor(t, "pushes", func() bool {
		return get("LSH_existing") == "0" && get("LSH_race") == "2.5" && get("LSH_satel_zone_4_a_a__") == "0"
	})
	mu.Lock()
	defer mu.Unlock()
	joined := strings.Join(log, "\n")
	for _, w := range []string{"PUT /api/globalVariables/LSH_existing {\"name\":\"LSH_existing\",\"value\":\"0\"}",
		"POST /api/globalVariables {\"name\":\"LSH_race\",\"value\":\"2.5\"}", "PUT /api/globalVariables/LSH_race"} {
		if !strings.Contains(joined, w) {
			t.Fatalf("missing %q in\n%s", w, joined)
		}
	}
}
