package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSettingsSaveKeepsConfig(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "persist"), 0o755)
	os.WriteFile(filepath.Join(dir, "persist", "users.json"), []byte(`[{"id":"u1","username":"a","passwordHash":"x","role":"admin"}]`), 0o600)
	os.WriteFile(filepath.Join(dir, "persist", "api-tokens.json"), []byte(`[{"id":"t1","name":"t","token":"secret-token"}]`), 0o600)
	orig := "{\n  \"zeta\": 1,\n  \"loxoneOut\": {\n    \"host\": \"old\",\n    \"password\": \"keep-me\"\n  },\n  \"alpha\": {\n    \"x\": [\n      1,\n      2\n    ]\n  },\n  \"text\": \"<&> ż\"\n}"
	cfgPath := filepath.Join(dir, "config.json")
	os.WriteFile(cfgPath, []byte(orig), 0o640)

	store := NewStore("")
	reg := NewRegistry(store, "")
	ps := NewPlatformStatus()
	v := NewVictron(map[string]any{}, store, ps)
	srv := &Server{root: dir, store: store, reg: reg, ps: ps, auth: NewAuth(filepath.Join(dir, "persist"), "s"),
		host:    NewModuleHost(dir, "node", store, reg, ps, func() (map[string]any, error) { return nil, nil }, 0),
		victron: v, relays: &Relays{cfg: func() map[string]any { return nil }, store: store, victron: v}}
	srv.sio = NewSocketIO(nil, nil)
	srv.auto = NewAutomation(store, reg, map[string]any{}, filepath.Join(dir, "a.json"), dir, func(string, any) {})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	defer srv.applyOutBridges(map[string]any{}, "")

	post := func(path, body string) string {
		req, _ := http.NewRequest("POST", ts.URL+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer secret-token")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b := make([]byte, 4096)
		n, _ := res.Body.Read(b)
		return string(b[:n])
	}
	out := post("/api/settings/loxone-out", `{"host":"10.1.1.1","port":"8080x","password":"••••••••","mappings":[{"storeKey":" a/b ","virtualInput":"VI"},{"storeKey":"","virtualInput":"x"}]}`)
	if out != `{"success":true,"message":"Saved — 1 mapping(s) pushing to 10.1.1.1"}` {
		t.Fatalf("reply %s", out)
	}
	got, _ := os.ReadFile(cfgPath)
	want := "{\n  \"zeta\": 1,\n  \"loxoneOut\": {\n    \"host\": \"10.1.1.1\",\n    \"port\": 8080,\n    \"username\": \"admin\",\n    \"password\": \"keep-me\",\n    \"mappings\": [\n      {\n        \"storeKey\": \"a/b\",\n        \"virtualInput\": \"VI\"\n      }\n    ]\n  },\n  \"alpha\": {\n    \"x\": [\n      1,\n      2\n    ]\n  },\n  \"text\": \"<&> ż\"\n}"
	if string(got) != want {
		t.Fatalf("config.json:\n%s", got)
	}
	if bak, _ := os.ReadFile(cfgPath + ".bak"); string(bak) != orig {
		t.Fatal(".bak isn't the previous file")
	}
	if st, _ := os.Stat(cfgPath); st.Mode().Perm() != 0o640 {
		t.Fatalf("mode %v", st.Mode().Perm())
	}
	srv.out.mu.Lock()
	running := srv.out.loxoneOut != nil
	srv.out.mu.Unlock()
	if !running {
		t.Fatal("Loxone Out not started after save")
	}
	if out := post("/api/settings/loxone-out/test", `{}`); !strings.Contains(out, "Which Virtual Input?") {
		t.Fatalf("test route %s", out)
	}
}
