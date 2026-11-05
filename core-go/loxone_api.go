package main

// Loxone / Fibaro routes — ports of src/routes/loxone-xml.js (inputs,
// outputs, scenes, sipout) and the Loxone / Fibaro parts of
// src/routes/loxone.js. Settings saves apply at once here: Loxone In (a Node
// module process) is restarted, Loxone Out / Fibaro Out are rebuilt.

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// loxoneInModule is src/loxone-client.js, run as a module process.
func loxoneInModule(cfg map[string]any, root string) Integration {
	return Integration{File: "loxone-client", Label: "Loxone", On: str(section(cfg, "loxone"), "host") != "",
		Installed: fileExists(filepath.Join(root, "src", "loxone-client.js"))}
}

type outBridges struct {
	mu        sync.Mutex
	loxoneOut *LoxoneOut
	fibaroOut *FibaroOut
}

func mappingCount(cfg map[string]any, k string) int { return len(arr(section(cfg, k)["mappings"])) }

// applyOutBridges (re)builds Loxone Out and Fibaro Out from cfg.
func (s *Server) applyOutBridges(cfg map[string]any, which string) {
	s.out.mu.Lock()
	defer s.out.mu.Unlock()
	if which == "" || which == "loxoneOut" {
		if s.out.loxoneOut != nil {
			s.out.loxoneOut.Stop()
			s.out.loxoneOut = nil
		}
		if o := loxoneOutFrom(cfg, s.store, s.ps); o.Start(mappingCount(cfg, "loxoneOut")) {
			s.out.loxoneOut = o
		}
	}
	if which == "" || which == "fibaroOut" {
		if s.out.fibaroOut != nil {
			s.out.fibaroOut.Stop()
			s.out.fibaroOut = nil
		}
		f := fibaroOutFrom(cfg, s.store, s.ps)
		if f.host != "" && mappingCount(cfg, "fibaroOut") > 0 {
			s.out.fibaroOut = f
			go f.Start(mappingCount(cfg, "fibaroOut"))
		}
	}
}

func (s *Server) configPath() string { return filepath.Join(s.root, "config.json") }

// plainConfig is config.json as plain maps (for the bridges' constructors).
func plainConfig(o *OMap) map[string]any {
	b, _ := marshalJS(o)
	var m map[string]any
	json.Unmarshal(b, &m)
	return m
}

// jsParseInt is parseInt(v || 80) (NaN → null in JSON).
func jsParseIntPort(v any) any {
	if !truthy(v) {
		return 80.0
	}
	s := strings.TrimSpace(jsString(v))
	if n := leadingInt(s); n != "" && n != "-" && n != "+" {
		return jsNumber(n)
	}
	return Undefined
}

func masked(p string) bool { return strings.Contains(p, "•") }

// mergeSection is { ...current, [name]: { …fields } } — kept in place if present.
func (s *Server) saveSection(name string, build func(cur *OMap) *OMap) (*OMap, error) {
	cfg := readConfigOrdered(s.configPath())
	cur, _ := cfg.Get(name).(*OMap)
	if cur == nil {
		cur = NewOMap()
	}
	cfg.Set(name, build(cur))
	return cfg, writeConfigFile(s.configPath(), cfg)
}

func orStr(v ...any) any {
	for _, x := range v {
		if truthy(x) {
			return x
		}
	}
	return ""
}

func (s *Server) credsSection(b, cur *OMap) *OMap {
	pw := b.Get("password")
	if p, ok := pw.(string); !ok || p == "" || masked(p) {
		pw = orStr(cur.Get("password"))
	}
	port := jsParseIntPort(b.Get("port"))
	if port == Undefined {
		port = nil
	}
	return OM("host", orStr(b.Get("host"), cur.Get("host")), "port", port,
		"username", orStr(b.Get("username"), cur.Get("username"), "admin"), "password", pw)
}

var labelCleanRe = regexp.MustCompile(`[^\p{L}\p{N} _-]+`)

func (s *Server) loxoneRoutes(api *http.ServeMux) {
	xmlHandler := func(kind string, fixedType string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query()
			devices := s.reg.Devices()
			if d := q.Get("device"); d != "" {
				devices = filterDevices(devices, func(x *OMap) bool { return x.Str("key") == d })
			}
			typ := q.Get("type")
			if fixedType != "" {
				typ = fixedType
			}
			if typ != "" {
				types := map[string]bool{}
				for _, t := range strings.Split(typ, ",") {
					if t = strings.TrimSpace(t); t != "" {
						types[t] = true
					}
				}
				if types["vicare"] {
					types["vitodens"] = true // merged into vitodens-client.js
				}
				devices = filterDevices(devices, func(x *OMap) bool { return types[jsString(x.Get("type"))] })
			}
			if n := q.Get("named"); n == "1" || n == "true" {
				devices = filterDevices(devices, func(x *OMap) bool { return x.Get("named") != false })
			}
			if len(devices) == 0 {
				fail(w, 404, "No matching devices")
				return
			}
			// Free tier: Loxone export is capped to 1 input and 1 output device.
			lim := s.lic().Limits.LoxoneInputs
			if kind == "outputs" {
				lim = s.lic().Limits.LoxoneOutputs
			}
			if lim > 0 && len(devices) > lim {
				devices = devices[:lim]
			}
			o := s.xmlOpts(r)
			polling := jsNumber(q.Get("polling"))
			if math.IsNaN(polling) || polling == 0 {
				polling = 5000
			}
			o.pollingMs = int(math.Max(1000, polling))
			var parts []string
			if kind == "inputs" {
				parts = buildInputsXMLs(devices, o)
			} else {
				parts = buildOutputsXMLs(devices, o)
			}
			if len(parts) == 0 {
				msg := "Matching devices have no readable sensors"
				if kind == "outputs" {
					msg = "Matching devices have no controllable sensors — use inputs.xml for read-only devices"
				}
				fail(w, 404, msg)
				return
			}
			var base []string
			for _, x := range []string{"lsh-loxone", kind, strings.ReplaceAll(typ, ",", "-")} {
				if x != "" {
					base = append(base, x)
				}
			}
			if typ == "" {
				if d := strings.ReplaceAll(q.Get("device"), "/", "-"); d != "" {
					base = append(base, d)
				}
			}
			sendXMLParts(w, strings.Join(base, "-"), parts)
		}
	}
	api.HandleFunc("GET /api/loxone/inputs.xml", xmlHandler("inputs", ""))
	api.HandleFunc("GET /api/loxone/outputs.xml", xmlHandler("outputs", ""))
	api.HandleFunc("GET /api/loxone/sipout.xml", xmlHandler("outputs", "sip"))
	api.HandleFunc("GET /api/loxone/scenes.xml", func(w http.ResponseWriter, r *http.Request) {
		var ids map[string]bool
		if v := r.URL.Query().Get("ids"); v != "" {
			ids = map[string]bool{}
			for _, x := range strings.Split(v, ",") {
				if x = strings.TrimSpace(x); x != "" {
					ids[x] = true
				}
			}
		}
		var scenes []*OMap
		for _, sc := range s.auto.Scenes() {
			if ids == nil || ids[jsString(sc.Get("id"))] {
				scenes = append(scenes, sc)
			}
		}
		if len(scenes) == 0 {
			fail(w, 404, "No scenes yet — create one in the dashboard’s Scenes section")
			return
		}
		sendXMLParts(w, "lsh-loxone-scenes", buildScenesXMLs(scenes, s.xmlOpts(r)))
	})

	api.HandleFunc("POST /api/settings/test-loxone", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		host := jsString(orStr(b.Get("host")))
		if host == "" {
			fail(w, 400, "host is required")
			return
		}
		port := jsParseIntPort(orStr(b.Get("port"), 80.0))
		req, _ := http.NewRequest("GET", fmt.Sprintf("http://%s:%s/jdev/cfg/version", host, jsString(port)), nil)
		req.SetBasicAuth(jsString(orStr(b.Get("username"), "admin")), jsString(orStr(b.Get("password"))))
		res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
		if err != nil {
			msg := err.Error()
			if isTimeout(err) {
				msg = "Connection timed out"
			}
			writeJSON(w, 200, OM("success", false, "error", msg))
			return
		}
		defer res.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		if j, ok := rawOrdered(raw).(*OMap); ok {
			ver := any("unknown")
			if ll, _ := j.Get("LL").(*OMap); ll != nil {
				if val, ok := ll.Get("value").(*OMap); ok && truthy(val.Get("version")) {
					ver = val.Get("version")
				} else if truthy(ll.Get("value")) {
					ver = ll.Get("value")
				}
			}
			writeJSON(w, 200, OM("success", true, "message", "Connected — Loxone OS "+jsString(ver)))
			return
		}
		msg := fmt.Sprintf("HTTP %d", res.StatusCode)
		if res.StatusCode == 200 {
			msg = "Connected"
		}
		writeJSON(w, 200, OM("success", res.StatusCode == 200, "message", msg))
	}))

	api.HandleFunc("POST /api/settings/loxone", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		cfg, err := s.saveSection("loxone", func(cur *OMap) *OMap { return s.credsSection(b, cur) })
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		s.host.Apply(loxoneInModule(plainConfig(cfg), s.root))
		writeJSON(w, 200, OM("success", true, "message", "Loxone settings saved and applied."))
	}))

	api.HandleFunc("POST /api/settings/loxone-out", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		cfg, err := s.saveSection("loxoneOut", func(cur *OMap) *OMap {
			sec := s.credsSection(b, cur)
			if list, ok := b.Get("mappings").([]any); ok {
				sec.Set("mappings", cleanLoxoneMappings(list))
			} else if m := cur.Get("mappings"); m != nil {
				sec.Set("mappings", m)
			} else {
				sec.Set("mappings", []any{})
			}
			return sec
		})
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		plain := plainConfig(cfg)
		s.applyOutBridges(plain, "loxoneOut")
		host := str(section(plain, "loxoneOut"), "host")
		if host == "" {
			host = "(no host)"
		}
		writeJSON(w, 200, OM("success", true, "message", fmt.Sprintf("Saved — %d mapping(s) pushing to %s", mappingCount(plain, "loxoneOut"), host)))
	}))

	api.HandleFunc("GET /api/settings/loxone-out/suggestions", s.admin(func(w http.ResponseWriter, r *http.Request) {
		out := []*OMap{}
		add := func(storeKey, vi, kind, what string) {
			out = append(out, OM("storeKey", storeKey, "virtualInput", vi, "kind", kind, "what", what))
		}
		images := []*OMap{}
		for _, d := range s.reg.Devices() {
			key := d.Str("key")
			name := strings.TrimSpace(labelCleanRe.ReplaceAllString(jsString(d.Get("label")), ""))
			if name == "" {
				name = key
			}
			switch {
			case d.Get("type") == "radio":
				what := "station — song, e.g. “RMF FM — Artist - Song”"
				if key == "radio/all" {
					what = "every speaker playing: “Salon2: RMF FM — Artist - Song · …”"
				}
				add(key+"/nowPlaying", "LSH "+name+" gra", "text", what)
				if key != "radio/all" {
					add(key+"/song", "LSH "+name+" utwór", "text", "the song as the station sends it, “Artist - Title” (empty when it sends none)")
					add(key+"/artist", "LSH "+name+" wykonawca", "text", "artist of the song")
					add(key+"/songTitle", "LSH "+name+" tytuł", "text", "title of the song")
					add(key+"/cover", "LSH "+name+" logo", "text", "the station logo’s address (changes with the station)")
				}
				add(key+"/station", "LSH "+name+" stacja", "number", "station number, 0 = off")
			case key == "spotify/player":
				add("spotify/player/nowPlaying", "LSH Spotify gra", "text", "track — artist")
				add("spotify/player/track", "LSH Spotify utwór", "text", "track")
				add("spotify/player/artist", "LSH Spotify wykonawca", "text", "artist")
				add("spotify/player/device", "LSH Spotify głośnik", "text", "the room / device it plays on")
				add("spotify/player/album", "LSH Spotify album", "text", "album")
				add("spotify/player/cover", "LSH Spotify okładka", "text", "the album cover’s address (changes with the track)")
			case key == "music/player":
				add("music/player/track", "LSH Muzyka utwór", "text", "track of the selected source")
				add("music/player/artist", "LSH Muzyka wykonawca", "text", "artist of the selected source")
			}
			if d.Get("type") == "radio" || key == "spotify/player" {
				images = append(images, OM("label", d.Get("label"), "path", "/api/loxone/cover/"+key+".jpg"))
			}
		}
		writeJSON(w, 200, OM("success", true, "data", out, "images", images))
	}))

	api.HandleFunc("POST /api/settings/loxone-out/test", s.admin(func(w http.ResponseWriter, r *http.Request) {
		cfg := plainConfig(readConfigOrdered(s.configPath()))
		if str(section(cfg, "loxoneOut"), "host") == "" {
			writeJSON(w, 200, OM("success", false, "error", "Save the Miniserver address first"))
			return
		}
		b := readBody(r)
		vi := strings.TrimSpace(jsString(orEmpty(jget(b, "virtualInput"))))
		if vi == "" {
			writeJSON(w, 200, OM("success", false, "error", "Which Virtual Input?"))
			return
		}
		s.out.mu.Lock()
		c := s.out.loxoneOut
		s.out.mu.Unlock()
		if c == nil {
			c = loxoneOutFrom(cfg, s.store, s.ps)
		}
		value := jget(b, "value")
		if isNullish(value) {
			value = "LSH test " + time.Now().Format("15:04") // toLocaleTimeString(pl-PL, hh:mm)
		}
		if _, err := c.Push(vi, value); err != nil {
			writeJSON(w, 200, OM("success", false, "error", err.Error()))
			return
		}
		writeJSON(w, 200, OM("success", true, "message", "Loxone took “"+jsString(value)+"” on "+vi))
	}))

	api.HandleFunc("POST /api/settings/fibaro-out", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		cfg, err := s.saveSection("fibaroOut", func(cur *OMap) *OMap {
			sec := s.credsSection(b, cur)
			if list, ok := b.Get("mappings").([]any); ok {
				sec.Set("mappings", list)
			} else if m := cur.Get("mappings"); m != nil {
				sec.Set("mappings", m)
			} else {
				sec.Set("mappings", []any{})
			}
			return sec
		})
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		s.applyOutBridges(plainConfig(cfg), "fibaroOut")
		writeJSON(w, 200, OM("success", true, "message", "Fibaro outbound settings saved and applied."))
	}))

	api.HandleFunc("POST /api/settings/test-fibaro-out", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		host := jsString(orStr(b.Get("host")))
		if host == "" {
			fail(w, 400, "Host is required")
			return
		}
		pass := jsString(orStr(b.Get("password")))
		if pass == "" || masked(pass) { // dots mean "use the stored one"
			pass = str(section(plainConfig(readConfigOrdered(s.configPath())), "fibaroOut"), "password")
		}
		port := 80
		if p, ok := jsParseIntPort(b.Get("port")).(float64); ok {
			port = int(p)
		}
		f := &FibaroOut{host: host, port: port, user: jsString(orStr(b.Get("username"), "admin")), pass: pass,
			http: &http.Client{Timeout: 6 * time.Second}}
		var vars []any
		if err := f.request("GET", "/api/globalVariables", nil, &vars); err != nil {
			writeJSON(w, 200, OM("success", false, "error", err.Error()))
			return
		}
		writeJSON(w, 200, OM("success", true, "message", fmt.Sprintf("Connected — %d global variable(s) on the Home Center", len(vars))))
	}))
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func filterDevices(ds []*OMap, keep func(*OMap) bool) []*OMap {
	var out []*OMap
	for _, d := range ds {
		if keep(d) {
			out = append(out, d)
		}
	}
	return out
}

func cleanLoxoneMappings(list []any) []any {
	out := []any{}
	for _, x := range list {
		m, _ := x.(*OMap)
		k := strings.TrimSpace(jsString(orEmpty(jget(m, "storeKey"))))
		vi := strings.TrimSpace(jsString(orEmpty(jget(m, "virtualInput"))))
		if m == nil || k == "" || vi == "" || k == "undefined" {
			continue
		}
		out = append(out, OM("storeKey", k, "virtualInput", vi))
		if len(out) == 500 {
			break
		}
	}
	return out
}

func (s *Server) xmlOpts(r *http.Request) xmlOpts {
	q := r.URL.Query()
	token := q.Get("token")
	if token == "" && q.Get("tokenId") != "" {
		token = s.auth.TokenValue(q.Get("tokenId"))
	}
	if token == "" {
		token = "YOUR_API_TOKEN"
	}
	host := q.Get("host")
	if host == "" {
		host = r.Host
	}
	return xmlOpts{host: host, token: token}
}

func sendXMLParts(w http.ResponseWriter, base string, parts []string) {
	if len(parts) == 1 {
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+base+`.xml"`)
		w.Write([]byte(parts[0]))
		return
	}
	files := make([]zipFile, len(parts))
	for i, p := range parts {
		files[i] = zipFile{fmt.Sprintf("%s-%d.xml", base, i+1), []byte(p)}
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+base+`.zip"`)
	w.Write(zipStore(files))
}
