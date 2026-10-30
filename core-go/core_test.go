package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func newTestCore(t *testing.T) (*Server, *ModuleProcess) {
	root, _ := filepath.Abs("..")
	store := NewStore(filepath.Join(t.TempDir(), "store.json.gz"))
	reg := NewRegistry(store, filepath.Join(t.TempDir(), "none.json"))
	ps := NewPlatformStatus()
	cfg := func() (map[string]any, error) { return map[string]any{}, nil }
	host := NewModuleHost(root, "node", store, reg, ps, cfg, 512)
	victron := NewVictron(map[string]any{}, store, ps)
	srv := &Server{root: root, store: store, reg: reg, ps: ps, auth: NewAuth(t.TempDir(), "test-secret"), host: host,
		victron: victron, relays: &Relays{cfg: func() map[string]any { return map[string]any{} }, store: store, victron: victron}}
	srv.sio = NewSocketIO(srv.sioAuthorize, srv.sioConnect)
	srv.wireEvents()
	srv.auto = NewAutomation(store, reg, map[string]any{}, filepath.Join(t.TempDir(), "automations.json"), t.TempDir(), srv.sio.Emit)
	srv.auto.Start()
	srv.camera = NewCameraEvents(srv.sio.Emit)
	host.Hooks = HostHooks{Flows: srv.auto.Flows, Notify: func(l, m string, src any) { srv.auto.Notify(l, m, src) },
		SaveFlow: func(f *OMap) { srv.auto.SaveFlow(f) }, CamLog: srv.camera.Push, Boxes: srv.camera.SetBoxes}
	fake, _ := filepath.Abs("testdata/fake-client.js")
	m := host.Add(Integration{File: fake, Label: "Fake", On: true, Installed: true, Automation: true})
	t.Cleanup(host.StopAll)
	return srv, m
}

func TestModuleWorkerOverNodeIPC(t *testing.T) {
	srv, m := newTestCore(t)
	waitFor(t, "device registered", func() bool { return srv.reg.Has("fake/1") })
	waitFor(t, "value from module", func() bool { return srv.store.Get("fake/1/level") == 42.0 })
	waitFor(t, "platform status", func() bool { return srv.ps.All()["fake"] })
	waitFor(t, "running", func() bool { return m.Info()["state"] == "running" })

	// command → module's _writeCapability → value back in the store
	if err := srv.reg.SendCommand("fake/1", "on", "on"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "toggle applied", func() bool { return srv.store.Get("fake/1/on") == true })
	if err := srv.reg.SendCommand("fake/1", "level", 77.0); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "level applied", func() bool { return srv.store.Get("fake/1/level") == 77.0 })

	// a change made in the core reaches the subscribed module
	srv.store.Set("test/ping", "hello")
	waitFor(t, "echo", func() bool { return srv.store.Get("fake/1/echo") == "hello" })

	// watchdog pong carries memory
	m.ping()
	waitFor(t, "pong", func() bool { return m.Info()["rss"] != nil })

	// crash → restarted with backoff
	m.mu.Lock()
	pid := m.cmd.Process.Pid
	m.mu.Unlock()
	m.kill("test")
	waitFor(t, "restart", func() bool {
		i := m.Info()
		return i["state"] == "running" && i["pid"] != nil && i["pid"] != pid
	})
	if m.Info()["restarts"] != 1 {
		t.Fatalf("restarts = %v", m.Info()["restarts"])
	}
}

func TestRESTAndSocketIO(t *testing.T) {
	srv, _ := newTestCore(t)
	// first run (no users) is open; create the admin like the SetupScreen does
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	res, err := http.Post(ts.URL+"/api/auth/setup", "application/json", strings.NewReader(`{"adminUsername":"admin","adminPassword":"longpassword"}`))
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("setup: %v %v", err, res.Status)
	}
	var cookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == cookieName {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("no session cookie")
	}

	if r, _ := http.Get(ts.URL + "/api/devices"); r.StatusCode != 401 {
		t.Fatalf("unauthenticated /api/devices = %d", r.StatusCode)
	}

	waitFor(t, "device", func() bool { return srv.reg.Has("fake/1") })
	waitFor(t, "value from module", func() bool { return srv.store.Get("fake/1/level") == 42.0 })

	// socket.io: open → connect → snapshot/devices → live update
	hdr := http.Header{"Cookie": {cookie.Name + "=" + cookie.Value}}
	ws, _, err := websocket.DefaultDialer.Dial(strings.Replace(ts.URL, "http", "ws", 1)+"/socket.io/?EIO=4&transport=websocket", hdr)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_, open, _ := ws.ReadMessage()
	if open[0] != '0' {
		t.Fatalf("open packet %q", open)
	}
	ws.WriteMessage(websocket.TextMessage, []byte("40"))
	events := map[string]json.RawMessage{}
	read := func(until string) {
		t.Helper()
		ws.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				t.Fatalf("waiting for %s: %v", until, err)
			}
			if strings.HasPrefix(string(msg), "42") {
				var ev []json.RawMessage
				json.Unmarshal(msg[2:], &ev)
				var name string
				json.Unmarshal(ev[0], &name)
				events[name] = ev[1]
				if name == until {
					return
				}
			}
		}
	}
	read("platform-status")
	if !strings.Contains(string(events["devices"]), `"fake/1"`) || !strings.Contains(string(events["snapshot"]), `"fake/1/level":42`) {
		t.Fatalf("connect payload: devices=%s snapshot=%s", events["devices"], events["snapshot"])
	}

	// command over REST → module → update event to the browser
	req, _ := http.NewRequest("POST", ts.URL+"/api/device/fake/1/command", strings.NewReader(`{"sensor":"level","value":13}`))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	r, err := http.DefaultClient.Do(req)
	if err != nil || r.StatusCode != 200 {
		t.Fatalf("command: %v %v", err, r.Status)
	}
	read("update")
	if !strings.Contains(string(events["update"]), `"fake/1/level":13`) {
		t.Fatalf("update = %s", events["update"])
	}

	// readings + history
	req, _ = http.NewRequest("GET", ts.URL+"/api/devices/fake/1?sensor=level", nil)
	req.AddCookie(cookie)
	r, _ = http.DefaultClient.Do(req)
	b := make([]byte, 16)
	n, _ := r.Body.Read(b)
	if string(b[:n]) != "13" {
		t.Fatalf("?sensor=level → %q", b[:n])
	}
	if len(srv.store.History("fake/1/level")) == 0 {
		t.Fatal("no history recorded")
	}
}

func TestStorePersistRoundTrip(t *testing.T) {
	f := filepath.Join(t.TempDir(), "s.json.gz")
	a := NewStore(f)
	a.Set("x/1/v", 1.5)
	a.Set("x/1/s", "on")
	if _, err := a.Persist(); err != nil {
		t.Fatal(err)
	}
	b := NewStore(f)
	b.Load("")
	if b.Get("x/1/v") != 1.5 || b.Get("x/1/s") != "on" || len(b.History("x/1/v")) != 1 {
		t.Fatalf("restored %v %v %v", b.Get("x/1/v"), b.Get("x/1/s"), b.History("x/1/v"))
	}
	if _, err := os.Stat(f + ".tmp"); err == nil {
		t.Fatal("tmp file left behind")
	}
}

func TestNormalizeColor(t *testing.T) {
	c := normalizeColor("255,0,0")
	if c["hue"] != 0.0 || c["saturation"] != 100.0 || c["level"] != 100.0 {
		t.Fatalf("rgb: %v", c)
	}
	c = normalizeColor(100.0) // Loxone composite: red 100 %
	if c["saturation"] != 100.0 {
		t.Fatalf("composite: %v", c)
	}
}

func TestModuleCall(t *testing.T) {
	srv, m := newTestCore(t)
	waitFor(t, "running", func() bool { return m.Info()["state"] == "running" })
	if v, err := m.Call("getToken"); err != nil || v != "tok-123" {
		t.Fatalf("getToken: %v %v", v, err)
	}
	if _, err := m.Call("handleWebhookEvent", OM("deviceId", "1", "attribute", "temp", "value", 20.5)); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "webhook value", func() bool { return srv.store.Get("fake/1/temp") == 20.5 })
	if _, err := m.Call("handleWebhookEvent", OM()); err == nil || err.Error() != "bad payload" {
		t.Fatalf("thrown error: %v", err)
	}
	for _, name := range []string{"_secret", "nope", "constructor", "toString", "hasOwnProperty"} {
		if _, err := m.Call(name); err == nil {
			t.Fatalf("%s should be refused", name)
		}
	}
}

func TestModuleAutomationAndCameraEvents(t *testing.T) {
	srv, m := newTestCore(t)
	waitFor(t, "running", func() bool { return m.Info()["state"] == "running" })
	v, err := m.Call("reportCamera")
	if err != nil {
		t.Fatal(err)
	}
	if r := v.(*OMap); r.Get("had") != 0.0 || r.Get("now") != 1.0 {
		t.Fatalf("flows seen by the module: %s", must(r))
	}
	waitFor(t, "flow saved in the core", func() bool {
		for _, f := range srv.auto.Flows() {
			if f.Get("id") == "fake-auto" && f.Get("name") == "Auto flow from fake" {
				return true
			}
		}
		return false
	})
	waitFor(t, "notification", func() bool {
		for _, n := range srv.auto.Notifications() {
			if n.Get("message") == "Person at the door" && n.Get("level") == "warning" && n.Get("source") == "fake" {
				return true
			}
		}
		return false
	})
	waitFor(t, "camera log", func() bool {
		r := srv.camera.Recent(10, "Wejście")
		return len(r) == 1 && r[0].Get("type") == "motion" && r[0].Get("detail") == "person"
	})
	waitFor(t, "boxes", func() bool { return srv.camera.Boxes("Wejście").Get("imgWidth") == 640.0 })
	if b := must(srv.camera.Boxes("Wejście").Get("items")); b != `[{"class":"person","score":0.9,"bbox":[1,2,3,4]}]` {
		t.Fatalf("boxes %s", b)
	}
	// a restarted module starts with the core's flows, its own included
	m.Restart("test")
	waitFor(t, "running again", func() bool { return m.Info()["state"] == "running" })
	v, _ = m.Call("reportCamera")
	if v.(*OMap).Get("had") != 1.0 {
		t.Fatalf("after restart: %s", must(v))
	}
}
