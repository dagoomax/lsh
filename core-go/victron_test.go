package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

type fakeVenus struct {
	cmd  *exec.Cmd
	mu   sync.Mutex
	msgs []map[string]string
}

func startFakeVenus(t *testing.T, port int) *fakeVenus {
	t.Helper()
	f := &fakeVenus{cmd: exec.Command("node", "testdata/fake-venus.js", fmt.Sprint(port))}
	out, _ := f.cmd.StdoutPipe()
	if err := f.cmd.Start(); err != nil {
		t.Fatal(err)
	}
	ready := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(out)
		for sc.Scan() {
			var m map[string]any
			json.Unmarshal(sc.Bytes(), &m)
			if m["ready"] == true {
				close(ready)
				continue
			}
			f.mu.Lock()
			f.msgs = append(f.msgs, map[string]string{"topic": fmt.Sprint(m["topic"]), "payload": fmt.Sprint(m["payload"])})
			f.mu.Unlock()
		}
	}()
	select {
	case <-ready:
	case <-time.After(10 * time.Second):
		t.Fatal("fake Venus didn't start")
	}
	t.Cleanup(func() { f.cmd.Process.Kill(); f.cmd.Wait() })
	return f
}

func (f *fakeVenus) got(topic, payload string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, m := range f.msgs {
		if m["topic"] == topic && (payload == "" || m["payload"] == payload) {
			return true
		}
	}
	return false
}

func deviceTypes(t *testing.T) *OMap {
	out, err := exec.Command("node", "-e", `process.stdout.write(JSON.stringify(require("../src/device-definitions").DEVICE_TYPES))`).Output()
	if err != nil {
		t.Fatal(err)
	}
	return rawOrdered(out).(*OMap)
}

func newVictronCore(t *testing.T, cfg map[string]any) (*Store, *Registry, *PlatformStatus, *Victron, *Relays) {
	store := NewStore(filepath.Join(t.TempDir(), "s.gz"))
	reg := NewRegistry(store, "")
	reg.SetDeviceTypes(deviceTypes(t))
	ps := NewPlatformStatus()
	v := NewVictron(cfg, store, ps)
	t.Cleanup(v.Stop)
	return store, reg, ps, v, &Relays{cfg: func() map[string]any { return cfg }, store: store, victron: v}
}

func TestVictronMQTT(t *testing.T) {
	port := freePort(t)
	venus := startFakeVenus(t, port)
	cfg := map[string]any{"mqtt": map[string]any{"host": "127.0.0.1", "port": float64(port)}, "relays": []any{map[string]any{"index": 0.0, "name": "Pump"}}}
	store, reg, ps, v, relays := newVictronCore(t, cfg)
	v.Start()

	waitFor(t, "values from Venus", func() bool { return store.Get("system/0/Dc/Battery/Soc") == 76.5 })
	if v.Status().Get("source") != "mqtt" || !ps.All()["victron-mqtt"] {
		t.Fatalf("status %s / %v", must(v.Status()), ps.All())
	}
	waitFor(t, "keepalive", func() bool { return venus.got("R/c0619ab1e2f3/keepalive", "") })

	// auto-discovered Victron devices, Node's label rules ("Battery", "Solar Charger 279")
	waitFor(t, "devices", func() bool { return reg.Has("battery/0") && reg.Has("solarcharger/279") })
	if l := reg.Device("battery/0").Get("label"); !strings.HasPrefix(jsString(l), "Battery") || strings.HasSuffix(jsString(l), " 0") {
		t.Fatalf("battery label %q", l)
	}
	if l := jsString(reg.Device("solarcharger/279").Get("label")); !strings.HasSuffix(l, " 279") {
		t.Fatalf("solarcharger label %q", l)
	}

	// relay write → W/ topic → Venus echoes the new state
	if err := relays.SetState(0, true); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "relay write", func() bool { return venus.got("W/c0619ab1e2f3/system/0/Relay/0/State", `{"value":1}`) })
	waitFor(t, "relay state", func() bool { return relays.State(0.0) })
	if all := must(relays.All()); all != `[{"index":0,"name":"Pump","on":true}]` {
		t.Fatalf("relays %s", all)
	}
}

func must(v any) string {
	b, err := marshalJS(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func TestVictronVRMFallbackAndBack(t *testing.T) {
	var mu sync.Mutex
	logins, polls, relayPosts := 0, 0, []string{}
	expired := true
	vrm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.URL.Path == "/auth/login":
			logins++
			w.Write([]byte(fmt.Sprintf(`{"token":"tok%d"}`, logins)))
		case strings.HasSuffix(r.URL.Path, "/diagnostics"):
			if r.Header.Get("x-authorization") == "Bearer tok1" && expired {
				expired = false
				w.WriteHeader(401) // first token expires → re-login
				return
			}
			polls++
			w.Write([]byte(`{"records":[
				{"idDataAttribute":51,"rawValue":"11"},
				{"idDataAttribute":144,"rawValue":"88%"},
				{"idDataAttribute":240,"rawValue":99},
				{"idDataAttribute":32,"rawValue":null,"formattedValue":"52.1 V"},
				{"idDataAttribute":518,"rawValue":"Bulk"},
				{"idDataAttribute":306,"rawValue":1},
				{"idDataAttribute":9999,"rawValue":5}]}`))
		case strings.Contains(r.URL.Path, "/relay/"):
			b := make([]byte, 64)
			n, _ := r.Body.Read(b)
			relayPosts = append(relayPosts, r.URL.Path+" "+string(b[:n])+" "+r.Header.Get("x-authorization"))
		}
	}))
	defer vrm.Close()

	port := freePort(t) // nothing listening yet: MQTT unreachable
	cfg := map[string]any{
		"mqtt":   map[string]any{"host": "127.0.0.1", "port": float64(port)},
		"vrm":    map[string]any{"email": "a@b.c", "password": "pw", "installationId": "4242"},
		"relays": []any{map[string]any{"index": 1.0, "name": "Gate"}},
	}
	store, _, ps, v, relays := newVictronCore(t, cfg)
	v.vrmBase = vrm.URL
	v.Start()

	waitFor(t, "VRM source", func() bool { return v.Status().Get("source") == "vrm" })
	waitFor(t, "VRM values", func() bool { return store.Get("system/0/Dc/Battery/Voltage") == 52.1 })
	// primary 144 wins over the alt ids; parseFloat("88%") = 88; text stays text
	if soc := store.Get("system/0/Dc/Battery/Soc"); soc != 88.0 {
		t.Fatalf("soc %v", soc)
	}
	if st := store.Get("solarcharger/0/State"); st != "Bulk" {
		t.Fatalf("state %v", st)
	}
	mu.Lock()
	if logins != 2 {
		t.Fatalf("logins %d (expected re-auth after 401)", logins)
	}
	mu.Unlock()
	if !ps.All()["victron-vrm"] || ps.All()["victron-mqtt"] {
		t.Fatalf("platforms %v", ps.All())
	}

	if err := relays.SetState(1, false); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "VRM relay POST", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(relayPosts) == 1 && relayPosts[0] == `/installations/4242/relay/1 {"state":0} Bearer tok2`
	})

	// the Venus broker comes up: MQTT takes over, VRM polling stops
	startFakeVenus(t, port)
	waitFor(t, "MQTT source", func() bool { return v.Status().Get("source") == "mqtt" })
	waitFor(t, "MQTT values", func() bool { return store.Get("system/0/Dc/Battery/Soc") == 76.5 })
	if ps.All()["victron-vrm"] || !ps.All()["victron-mqtt"] {
		t.Fatalf("platforms after switch %v", ps.All())
	}
	mu.Lock()
	before := polls
	mu.Unlock()
	time.Sleep(200 * time.Millisecond)
	mu.Lock()
	after := polls
	mu.Unlock()
	if after != before {
		t.Fatal("VRM still polling after MQTT came back")
	}
	if s := must(v.Status()); s != fmt.Sprintf(`{"source":"mqtt","mqtt":{"configured":true,"connected":true,"host":"127.0.0.1"},"vrm":{"configured":true,"connected":false}}`) {
		t.Fatalf("status %s", s)
	}
}

func TestVictronNoSource(t *testing.T) {
	_, _, _, v, relays := newVictronCore(t, map[string]any{"mqtt": map[string]any{"host": ""}})
	v.Start()
	if err := relays.SetState(0, true); err == nil || err.Error() != "No data client connected" {
		t.Fatalf("err %v", err)
	}
	if s := must(v.Status()); s != `{"source":null,"mqtt":{"configured":false,"connected":false,"host":null},"vrm":{"configured":false,"connected":false}}` {
		t.Fatalf("status %s", s)
	}
}

// parseFloat must agree with JavaScript's on the shapes VRM sends.
func TestParseFloatMatchesJS(t *testing.T) {
	inputs := []any{"88%", " 52.1 V", "1e3x", ".5", "-0.25kW", "abc", "", "Infinity", "-Infinity W", "+3", "1.2.3", true, nil, 42.0, "0x10", "1e", "۳"}
	b, _ := json.Marshal(inputs)
	out, err := exec.Command("node", "-e", `process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map((v) => { const n = parseFloat(v); return Number.isNaN(n) ? "NaN" : Number.isFinite(n) ? n : String(n); })))`, string(b)).Output()
	if err != nil {
		t.Fatal(err)
	}
	var want []any
	json.Unmarshal(out, &want)
	for i, in := range inputs {
		g := jsParseFloat(in)
		var got any = g
		if math.IsNaN(g) {
			got = "NaN"
		} else if math.IsInf(g, 0) {
			got = numberToString(g)
		}
		if fmt.Sprint(got) != fmt.Sprint(want[i]) {
			t.Errorf("parseFloat(%#v): node %v, go %v", in, want[i], got)
		}
	}
}
