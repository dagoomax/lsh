package main

// Settings — port of src/routes/settings.js: GET /api/settings (the whole
// config.json with every secret masked, for the Settings page to load its
// forms), POST /api/settings (merge mqtt / vrm / solaredge / smartthings /
// relays / server / homekit), POST /api/settings/test-mqtt.
//
// The config round-trips as an ordered map, so a save keeps config.json's
// key order and only the sections it touches change. Masked values that come
// back from the page ("••••••••") mean "keep the stored secret".

import (
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

const bullets = "••••••••"

func masked8(s string) bool { return strings.Contains(s, "•") }

// omParent walks to the *OMap that directly holds path's last key.
func omParent(o *OMap, path []string) *OMap {
	cur := o
	for _, k := range path[:len(path)-1] {
		m, ok := cur.Get(k).(*OMap)
		if !ok {
			return nil
		}
		cur = m
	}
	return cur
}

// maskLeaf sets path to bullets when the current value is truthy (Node's
// `if (safe.a?.b) safe.a.b = '••••••••'`).
func maskLeaf(o *OMap, path ...string) {
	if p := omParent(o, path); p != nil {
		last := path[len(path)-1]
		if truthy(p.Get(last)) {
			p.Set(last, bullets)
		}
	}
}

// maskItems masks each field of every object in the array at path.
func maskItems(o *OMap, path []string, fields ...string) {
	p := omParent(o, path)
	if p == nil {
		return
	}
	for _, x := range arr(p.Get(path[len(path)-1])) {
		item, ok := x.(*OMap)
		if !ok {
			continue
		}
		for _, f := range fields {
			if truthy(item.Get(f)) {
				item.Set(f, bullets)
			}
		}
	}
}

// Secret leaves — one per line, mirroring settings.js's redaction block.
var settingsSecretLeaves = [][]string{
	{"vrm", "password"}, {"mongo", "uri"}, {"vrm", "apiToken"}, {"solaredge", "apiKey"},
	{"smartthings", "token"}, {"editPin"}, {"dashboardPin"}, {"smartthings", "clientSecret"},
	{"smartthings", "webhookSecret"}, {"smartthings", "cameraToken"}, {"satel", "armCode"},
	{"dsc", "type2Key"}, {"dsc", "type1Code"}, {"dsc", "userCode"}, {"manuals", "githubToken"},
	{"unifi", "password"}, {"unifi", "apiKey"}, {"googleCalendar", "clientSecret"},
	{"unifiAccess", "password"}, {"unifiAccess", "apiKey"}, {"aqara", "token"}, {"ampio", "password"},
	{"smarttub", "password"}, {"sinum", "token"}, {"sinum", "password"}, {"vclu", "token"},
	{"ugreen", "password"}, {"melcloud", "password"}, {"emodule", "password"}, {"hydrop", "apiKey"},
	{"sensibo", "apiKey"}, {"tidal", "clientSecret"}, {"zway", "password"}, {"wirenboard", "password"},
	{"kenik", "password"}, {"loxone", "password"}, {"dirigera", "token"}, {"tradfri", "psk"},
	{"sip", "password"}, {"tradfri", "securityCode"}, {"homey", "token"}, {"homeConnect", "clientSecret"},
	{"miele", "clientSecret"}, {"miele", "password"}, {"fibaro", "password"}, {"bayrol", "password"},
	{"somfy", "password"}, {"vicare", "password"}, {"thermomix", "password"}, {"grenton", "token"},
	{"suppla", "token"}, {"nuki", "webToken"}, {"ttlock", "clientSecret"}, {"ttlock", "password"},
	{"yale", "password"}, {"somfy", "token"}, {"loxoneOut", "password"}, {"fibaroOut", "password"},
	{"auxair", "password"}, {"roborock", "cloud", "password"}, {"karcher", "password"},
	{"ecovacs", "password"}, {"mqttBroker", "password"}, {"tuya", "accessSecret"}, {"sonoff", "password"},
	{"sonoff", "appSecret"}, {"landroid", "password"}, {"sony", "psk"}, {"ezviz", "password"},
	{"openweather", "apiKey"}, {"airly", "apiKey"},
}

// Secrets inside arrays of objects: {array path..., field}.
var settingsSecretArrays = []struct {
	path   []string
	fields []string
}{
	{[]string{"airplay", "speakers"}, []string{"password"}},
	{[]string{"daikin", "devices"}, []string{"key"}},
	{[]string{"midea", "devices"}, []string{"token", "key"}},
	{[]string{"gree", "devices"}, []string{"key"}},
	{[]string{"reolink", "cameras"}, []string{"password"}},
	{[]string{"mobotix", "cameras"}, []string{"password"}},
	{[]string{"axis", "cameras"}, []string{"password"}},
	{[]string{"dahua", "devices"}, []string{"password"}},
	{[]string{"tedee", "devices"}, []string{"apiToken"}},
	{[]string{"nuki", "bridges"}, []string{"token"}},
	{[]string{"ajax", "accounts"}, []string{"key"}},
	{[]string{"jablotron", "accounts"}, []string{"key"}},
	{[]string{"lshBle", "devices"}, []string{"bindkey"}},
	{[]string{"dreame", "devices"}, []string{"token"}},
	{[]string{"roborock", "devices"}, []string{"token"}},
	{[]string{"tuya", "devices"}, []string{"key"}},
	{[]string{"sonoff", "devices"}, []string{"devicekey"}},
	{[]string{"esphome", "devices"}, []string{"password"}},
	{[]string{"shelly", "devices"}, []string{"password"}},
}

func (s *Server) redactSettings(cfg *OMap) *OMap {
	for _, leaf := range settingsSecretLeaves {
		maskLeaf(cfg, leaf...)
	}
	for _, a := range settingsSecretArrays {
		maskItems(cfg, a.path, a.fields...)
	}
	// cameras[].onvif.password (nested one level in)
	for _, x := range arr(cfg.Get("cameras")) {
		if cam, ok := x.(*OMap); ok {
			if onvif, ok := cam.Get("onvif").(*OMap); ok && truthy(onvif.Get("password")) {
				onvif.Set("password", bullets)
			}
		}
	}
	// ezviz.codes: mask every value
	if ez, ok := cfg.Get("ezviz").(*OMap); ok {
		if codes, ok := ez.Get("codes").(*OMap); ok {
			for _, k := range codes.Keys() {
				codes.Set(k, bullets)
			}
		}
	}
	cfg.Delete("jwtSecret") // never expose the JWT signing secret
	// lgthinq: say whether tokens are persisted, never expose the credentials
	if lg, ok := cfg.Get("lgthinq").(*OMap); ok {
		has := false
		if b, err := os.ReadFile(filepath.Join(s.root, "persist", "lgthinq-tokens.json")); err == nil {
			if t, ok := rawOrdered(b).(*OMap); ok {
				has = truthy(t.Get("access_token"))
			}
		}
		lg.Set("hasTokens", has)
		lg.Delete("username")
		lg.Delete("password")
		lg.Delete("token")
	}
	return cfg
}

func generateSetupID() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 4)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// shallowMerge is {...cur, ...body} for two OMaps (cur's order, body's values).
func shallowMerge(cur, body *OMap) *OMap {
	out := cur.Clone()
	if body != nil {
		for _, k := range body.Keys() {
			out.Set(k, body.Get(k))
		}
	}
	return out
}

func omap(v any) *OMap {
	if m, ok := v.(*OMap); ok {
		return m
	}
	return NewOMap()
}

// keepSecret is the "placeholder means keep the stored one" rule.
func keepSecret(body, cur *OMap, key string) any {
	if v, ok := body.Get(key).(string); ok && v != "" && !masked8(v) {
		return v
	}
	if x := cur.Get(key); x != nil {
		return x
	}
	return ""
}

// settingsMerge applies POST /api/settings onto cfg (ordered). Exposed for
// the differential test.
func (s *Server) settingsMerge(cfg, body *OMap) *OMap {
	get := func(o *OMap, k string) *OMap { return omap(o.Get(k)) }

	// mqtt — shallow merge
	cfg.Set("mqtt", shallowMerge(get(cfg, "mqtt"), get(body, "mqtt")))

	// vrm — shallow merge, keep masked secrets
	bvrm, cvrm := get(body, "vrm"), get(cfg, "vrm")
	vrm := shallowMerge(cvrm, bvrm)
	vrm.Set("password", keepSecret(bvrm, cvrm, "password"))
	vrm.Set("apiToken", keepSecret(bvrm, cvrm, "apiToken"))
	cfg.Set("vrm", vrm)

	// solaredge — rebuilt (siteId + apiKey), as in Node
	bse, cse := get(body, "solaredge"), get(cfg, "solaredge")
	siteId := bse.Get("siteId")
	if siteId == nil {
		if siteId = cse.Get("siteId"); siteId == nil {
			siteId = ""
		}
	}
	cfg.Set("solaredge", OM("siteId", siteId, "apiKey", keepSecret(bse, cse, "apiKey")))

	// smartthings — keep masked secrets; merged over current so OAuth and
	// webhook fields survive a general Settings save (Node rebuilt only
	// token/clientId/clientSecret/deviceIds, which dropped webhookSecret
	// and cameraToken — the same latent bug fixed in smartthings_api.go)
	bst, cst := get(body, "smartthings"), get(cfg, "smartthings")
	st := shallowMerge(cst, bst)
	// Restore the real secret where the page sent back the mask — but only
	// for keys that were actually present, so a save never introduces an
	// empty secret field that wasn't there before.
	for _, k := range []string{"token", "clientSecret", "webhookSecret", "cameraToken"} {
		if _, inBody := bst.Lookup(k); inBody {
			st.Set(k, keepSecret(bst, cst, k))
		} else if _, inCur := cst.Lookup(k); !inCur {
			st.Delete(k)
		}
	}
	if ids, ok := bst.Get("deviceIds").([]any); ok {
		st.Set("deviceIds", ids)
	} else if cst.Get("deviceIds") == nil {
		st.Set("deviceIds", []any{})
	}
	cfg.Set("smartthings", st)

	// relays — body.relays || current.relays
	if relays, ok := body.Get("relays").([]any); ok && relays != nil {
		cfg.Set("relays", relays)
	}

	// server — shallow merge
	cfg.Set("server", shallowMerge(get(cfg, "server"), get(body, "server")))

	// homekit — shallow merge, regenerate setupID when the PIN changes
	bhk, chk := get(body, "homekit"), get(cfg, "homekit")
	hk := shallowMerge(chk, bhk)
	switch {
	case truthy(bhk.Get("pin")) && bhk.Get("pin") != chk.Get("pin"):
		hk.Set("setupID", generateSetupID())
	case truthy(bhk.Get("setupID")):
		hk.Set("setupID", bhk.Get("setupID"))
	case truthy(chk.Get("setupID")):
		hk.Set("setupID", chk.Get("setupID"))
	default:
		hk.Set("setupID", generateSetupID())
	}
	cfg.Set("homekit", hk)
	return cfg
}

func (s *Server) settingsRoutes(api *http.ServeMux) {
	api.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) {
		ok(w, s.redactSettings(readConfigOrdered(s.configPath())))
	})

	api.HandleFunc("POST /api/settings", s.admin(func(w http.ResponseWriter, r *http.Request) {
		cfg := s.settingsMerge(readConfigOrdered(s.configPath()), readBody(r))
		if err := writeConfigFile(s.configPath(), cfg); err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, OM("success", true, "message", "Settings saved. Restart the server to apply connection changes."))
	}))

	api.HandleFunc("POST /api/settings/test-mqtt", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		host := jsString(orStr(b.Get("host")))
		if host == "" {
			fail(w, 400, "host required")
			return
		}
		port := int(jsNumber(orStr(b.Get("port"), 1883.0)))
		opts := mqtt.NewClientOptions().AddBroker(fmt.Sprintf("tcp://%s:%d", host, port)).
			SetClientID("lsh-go-test-" + base36Now()).SetConnectTimeout(5 * time.Second)
		client := mqtt.NewClient(opts)
		tok := client.Connect()
		if !tok.WaitTimeout(6 * time.Second) {
			client.Disconnect(0)
			writeJSON(w, 200, OM("success", false, "error", "Connection timed out"))
			return
		}
		if err := tok.Error(); err != nil {
			client.Disconnect(0)
			writeJSON(w, 200, OM("success", false, "error", err.Error()))
			return
		}
		client.Disconnect(250)
		writeJSON(w, 200, OM("success", true, "message", "MQTT connection successful"))
	}))
}
