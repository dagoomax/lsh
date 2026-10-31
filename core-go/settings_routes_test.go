package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A config touching every redaction path, plus non-secret fields and order.
const settingsConfig = `{
  "jwtSecret": "topsecret",
  "mqtt": {"host": "1.2.3.4", "port": 1883},
  "vrm": {"installationId": "42", "password": "pw", "apiToken": "tok", "email": "a@b.c"},
  "solaredge": {"siteId": "s1", "apiKey": "ak", "extra": "kept-by-node?"},
  "smartthings": {"token": "t", "clientId": "cid", "clientSecret": "cs", "webhookSecret": "ws", "webhookUrl": "http://x", "cameraToken": "ct", "deviceIds": ["d1"]},
  "editPin": "1234", "dashboardPin": "5678",
  "satel": {"armCode": "0000"},
  "dsc": {"type2Key": "k2", "type1Code": "c1", "userCode": "uc"},
  "unifi": {"password": "p", "apiKey": "k"},
  "sinum": {"token": "tk", "password": "pp"},
  "ezviz": {"password": "p", "codes": {"ABC": "111", "DEF": "222"}},
  "lgthinq": {"username": "u", "password": "p", "token": "t", "country": "PL"},
  "airplay": {"speakers": [{"id": "s1", "password": "sp"}, {"id": "s2"}]},
  "midea": {"devices": [{"id": "m1", "token": "mt", "key": "mk"}]},
  "cameras": [{"name": "Front", "onvif": {"host": "10.0.0.9", "password": "cp"}}, {"name": "NoOnvif"}],
  "tuya": {"accessId": "ai", "accessSecret": "as", "devices": [{"id": "t1", "key": "tk"}]},
  "sonoff": {"devices": [{"id": "sn1", "devicekey": "dk"}]},
  "nuki": {"webToken": "wt", "bridges": [{"id": "b1", "token": "bt"}]},
  "loxoneOut": {"host": "ms", "password": "lp"},
  "openweather": {"apiKey": "ow", "lat": 52.2},
  "homekit": {"pin": "111-22-333", "setupID": "ABCD", "name": "lsh"},
  "server": {"port": 3001}
}`

func settingsHarness(t *testing.T, mode, in, out, body string) []byte {
	t.Helper()
	args := []string{"testdata/settings-harness.js", mode, in, out}
	if body != "" {
		args = append(args, body)
	}
	o, err := exec.Command("node", args...).Output()
	if err != nil {
		t.Fatalf("harness: %v", err)
	}
	return o
}

func TestDiffSettingsGet(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "config.json")
	os.WriteFile(in, []byte(settingsConfig), 0o644)

	nodeOut := settingsHarness(t, "get", in, filepath.Join(dir, "out.json"), "")
	var nodeResp struct{ Data json.RawMessage }
	if err := json.Unmarshal(nodeOut, &nodeResp); err != nil {
		t.Fatalf("node: %v\n%s", err, nodeOut)
	}
	// Go masks smartthings.cameraToken (a camera PAT) which Node leaks in clear;
	// drop that one key from both so the compare covers everything else.
	nodeMasked := canonDrop(t, nodeResp.Data)

	srv := &Server{root: ".."} // lgthinq token file lives under ../persist
	goMasked := canonDrop(t, mustJSON(t, srv.redactSettings(rawOrdered([]byte(settingsConfig)).(*OMap))))

	if nodeMasked != goMasked {
		t.Fatalf("redaction differs:\n--- node ---\n%s\n--- go ---\n%s", nodeMasked, goMasked)
	}
	// sanity: real secrets gone, bullets present, non-secrets kept
	for _, leaked := range []string{`"topsecret"`, `"pw"`, `"as"`, `"cp"`, `"bt"`, `"111"`} {
		if strings.Contains(goMasked, leaked) {
			t.Fatalf("leaked %s", leaked)
		}
	}
	if !strings.Contains(goMasked, "••••••••") || !strings.Contains(goMasked, `"installationId":"42"`) || !strings.Contains(goMasked, `"hasTokens"`) {
		t.Fatal("expected masking / kept fields / lgthinq.hasTokens")
	}
}

func TestDiffSettingsPost(t *testing.T) {
	cases := map[string]string{
		"keep-masked-and-pin-unchanged": `{"mqtt":{"host":"9.9.9.9"},"vrm":{"password":"••••••••","apiToken":"newtok","email":"z@z.z"},"solaredge":{"siteId":"s9","apiKey":"••••••••"},"smartthings":{"token":"••••••••","clientSecret":"••••••••","deviceIds":["x"]},"homekit":{"pin":"111-22-333","name":"renamed"},"server":{"port":3005},"relays":[{"index":0,"name":"R0"}]}`,
		"pin-change":                    `{"homekit":{"pin":"999-88-777"}}`,
		"keep-setupid":                  `{"homekit":{"name":"x"}}`,
		"empty-body":                    `{}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			in := filepath.Join(dir, "config.json")
			os.WriteFile(in, []byte(settingsConfig), 0o644)
			bf := filepath.Join(dir, "body.json")
			os.WriteFile(bf, []byte(body), 0o644)

			raw := settingsHarness(t, "post", in, filepath.Join(dir, "out.json"), bf)
			// harness prints {json reply}{written config}
			written := raw[strings.Index(string(raw), "}")+1:]
			cfg := rawOrdered([]byte(settingsConfig)).(*OMap)
			srv := &Server{root: dir}
			goWritten := srv.settingsMerge(cfg, rawOrdered([]byte(body)).(*OMap))

			// setupID is random on a PIN change / fresh gen; the harness fixes
			// Node's to ZZZZ, the Go one isn't — compare with it normalised
			// Node's rebuild drops smartthings.{cameraToken,webhookSecret,webhookUrl};
			// Go preserves them (the documented fix). Drop them from both.
			nodeCfg := normSetupID(canonDrop(t, written))
			goCfg := normSetupID(canonDrop(t, mustJSON(t, goWritten)))
			if nodeCfg != goCfg {
				t.Fatalf("merge differs:\n--- node ---\n%s\n--- go ---\n%s", nodeCfg, goCfg)
			}
		})
	}
}

func normSetupID(s string) string {
	i := strings.Index(s, `"setupID":"`)
	if i < 0 {
		return s
	}
	j := strings.Index(s[i+11:], `"`)
	return s[:i+11] + "XXXX" + s[i+11+j:]
}

// canonDrop canonicalises like canon but first removes the smartthings keys
// that are the two documented Go/Node differences (cameraToken masking; the
// webhook/camera fields Node's rebuild loses on save).
func canonDrop(t *testing.T, raw []byte) string {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("canonDrop: %v\n%s", err, raw)
	}
	if st, ok := v["smartthings"].(map[string]any); ok {
		delete(st, "cameraToken")
		delete(st, "webhookSecret")
		delete(st, "webhookUrl")
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func canon(t *testing.T, raw []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("canon: %v\n%s", err, raw)
	}
	b, _ := json.Marshal(v) // Go sorts map keys → order-independent compare
	return string(b)
}

func mustJSON(t *testing.T, o *OMap) []byte {
	t.Helper()
	b, err := marshalJS(o)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
