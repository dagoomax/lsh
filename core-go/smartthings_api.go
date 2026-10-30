package main

// SmartThings — src/smartthings-client.js runs unchanged as a module
// process; this is the server side of it: the routes of
// src/routes/smartthings.js and the SmartThings camera routes of
// src/routes/sonos.js, plus server.js's 24 h OAuth token delivery to
// persist/smartthings-token-latest.txt. The client's own methods
// (getToken, handleWebhookEvent) are reached over the module channel.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const smartThingsAPI = "https://api.smartthings.com/v1"

func smartThingsModule(cfg map[string]any, root string) Integration {
	st := section(cfg, "smartthings")
	on := str(st, "token") != "" || (str(st, "clientId") != "" && str(st, "clientSecret") != "")
	return Integration{File: "smartthings-client", Label: "SmartThings", On: on,
		Installed: fileExists(filepath.Join(root, "src", "smartthings-client.js"))}
}

func (s *Server) smartThings() *ModuleProcess { return s.host.Get("smartthings-client") }

// stToken is the client's current token (OAuth, refreshed by it), else
// config.smartthings.token.
func (s *Server) stToken() (string, error) {
	if m := s.smartThings(); m != nil {
		if v, err := m.Call("getToken"); err == nil {
			if t, ok := v.(string); ok && t != "" {
				return t, nil
			}
		}
		return "", errors.New("No SmartThings token configured")
	}
	if t := str(section(s.readConfigFile(), "smartthings"), "token"); t != "" {
		return t, nil
	}
	return "", errors.New("No SmartThings token configured")
}

// stCameraToken — the media host only accepts a Personal Access Token for
// "sensitive" camera images (config.smartthings.cameraToken), see
// src/smartthings-media.js.
func (s *Server) stCameraToken() string {
	st := section(s.readConfigFile(), "smartthings")
	if t := str(st, "cameraToken"); t != "" {
		return t
	}
	if t := str(st, "token"); t != "" {
		return t
	}
	if m := s.smartThings(); m != nil {
		if v, err := m.Call("getToken"); err == nil {
			t, _ := v.(string)
			return t
		}
	}
	return ""
}

var stHTTP = &http.Client{Timeout: 30 * time.Second}

func (s *Server) stCommand(deviceID, capability, command string, args []any) error {
	token, err := s.stToken()
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]any{"commands": []any{map[string]any{"component": "main", "capability": capability, "command": command, "arguments": args}}})
	req, _ := http.NewRequest("POST", smartThingsAPI+"/devices/"+deviceID+"/commands", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := stHTTP.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return nil
}

func (s *Server) proxyMedia(w http.ResponseWriter, url string) {
	req, _ := http.NewRequest("GET", url, nil)
	if t := s.stCameraToken(); t != "" {
		req.Header.Set("Authorization", "Bearer "+t)
	}
	res, err := stHTTP.Do(req)
	if err == nil && res.StatusCode >= 300 {
		res.Body.Close()
		err = fmt.Errorf("HTTP %d", res.StatusCode)
	}
	if err != nil {
		w.WriteHeader(502)
		w.Write([]byte("Image fetch failed: " + err.Error()))
		return
	}
	defer res.Body.Close()
	ct := res.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "no-cache")
	io.Copy(w, res.Body)
}

var stMediaHostRe = regexp.MustCompile(`(?i)^https://[a-z0-9.-]+\.ec2\.st-av\.net/`)

// deliverSmartThingsToken writes the current OAuth token for tools outside
// LSH — after start, then every 24 h (OAuth setups only).
func (s *Server) deliverSmartThingsToken(cfg map[string]any) {
	st := section(cfg, "smartthings")
	if str(st, "clientId") == "" || str(st, "clientSecret") == "" {
		return
	}
	deliver := func() bool {
		m := s.smartThings()
		if m == nil {
			return false
		}
		v, err := m.Call("getToken")
		token, _ := v.(string)
		if err != nil || token == "" {
			if err == nil {
				err = errors.New("no token")
			}
			log.Printf("[SmartThings] Token delivery failed: %v", err)
			return false
		}
		out := filepath.Join(s.root, "persist", "smartthings-token-latest.txt")
		if err := os.WriteFile(out, []byte(token+"\ndelivered_at: "+time.Now().UTC().Format("2006-01-02T15:04:05.000Z")+"\n"), 0o600); err != nil {
			log.Printf("[SmartThings] Token delivery failed: %v", err)
			return false
		}
		log.Printf("[SmartThings] Token delivered to %s", out)
		return true
	}
	go func() {
		// first delivery once the client is up (it refreshes the token in start())
		for i := 0; i < 12; i++ {
			time.Sleep(10 * time.Second)
			if m := s.smartThings(); m != nil && m.Info()["state"] == "running" && deliver() {
				break
			}
		}
		for range time.Tick(24 * time.Hour) {
			deliver()
		}
	}()
}

func (s *Server) smartThingsRoutes(api *http.ServeMux) {
	api.HandleFunc("POST /api/settings/test-smartthings", s.admin(func(w http.ResponseWriter, r *http.Request) {
		token := jsString(orStr(readBody(r).Get("token")))
		if token == "" {
			fail(w, 400, "token is required")
			return
		}
		req, _ := http.NewRequest("GET", smartThingsAPI+"/devices", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := stHTTP.Do(req)
		if err != nil {
			writeJSON(w, 200, OM("success", false, "error", err.Error()))
			return
		}
		defer res.Body.Close()
		if res.StatusCode == 401 || res.StatusCode == 403 {
			writeJSON(w, 200, OM("success", false, "error", "Invalid token"))
			return
		}
		if res.StatusCode >= 300 {
			writeJSON(w, 200, OM("success", false, "error", fmt.Sprintf("SmartThings returned HTTP %d", res.StatusCode)))
			return
		}
		var data struct {
			Items []any `json:"items"`
		}
		json.NewDecoder(res.Body).Decode(&data)
		n := float64(len(data.Items))
		writeJSON(w, 200, OM("success", true, "message", fmt.Sprintf("Connected — %d device(s) found", len(data.Items)), "data", OM("count", n)))
	}))

	api.HandleFunc("POST /api/settings/smartthings", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		keep := func(v any, cur *OMap, k string) any {
			if t, ok := v.(string); ok && t != "" && !masked(t) {
				return t
			}
			if x := cur.Get(k); x != nil {
				return x
			}
			return ""
		}
		cfg, err := s.saveSection("smartthings", func(cur *OMap) *OMap {
			ids := b.Get("deviceIds")
			if _, ok := ids.([]any); !ok {
				ids = cur.Get("deviceIds")
				if ids == nil {
					ids = []any{}
				}
			}
			url := b.Get("webhookUrl")
			if !truthy(url) {
				url = cur.Get("webhookUrl")
				if url == nil {
					url = ""
				}
			}
			// Node's save rebuilt the section from these four fields only;
			// OAuth fields are kept here, otherwise saving would log it out
			sec := cur.Clone()
			sec.Set("token", keep(b.Get("token"), cur, "token"))
			sec.Set("deviceIds", ids)
			sec.Set("webhookUrl", url)
			sec.Set("webhookSecret", keep(b.Get("webhookSecret"), cur, "webhookSecret"))
			return sec
		})
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		s.host.Apply(smartThingsModule(plainConfig(cfg), s.root))
		writeJSON(w, 200, OM("success", true, "message", "SmartThings settings saved and applied."))
	}))

	// SmartThings' servers call this, so it checks a shared secret itself
	// (public route — see publicAPI).
	api.HandleFunc("POST /api/webhooks/smartthings", func(w http.ResponseWriter, r *http.Request) {
		m := s.smartThings()
		if m == nil {
			fail(w, 503, "SmartThings not configured")
			return
		}
		secret := str(section(s.readConfigFile(), "smartthings"), "webhookSecret")
		if secret == "" {
			log.Printf("[SmartThings Webhook] Rejected — no webhookSecret configured (Settings → SmartThings)")
			fail(w, 503, "Webhook secret not configured — set one in Settings → SmartThings")
			return
		}
		given := r.Header.Get("X-Webhook-Secret")
		if given == "" {
			given = r.URL.Query().Get("secret")
		}
		if given != secret {
			log.Printf("[SmartThings Webhook] Rejected — bad secret from %s", clientIP(r))
			fail(w, 401, "Invalid webhook secret")
			return
		}
		if _, err := m.Call("handleWebhookEvent", readBody(r)); err != nil {
			log.Printf("[SmartThings Webhook] Error: %v", err)
			fail(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, OM("success", true))
	})

	api.HandleFunc("GET /api/smartthings-camera/image-proxy", func(w http.ResponseWriter, r *http.Request) {
		url := r.URL.Query().Get("url")
		if !stMediaHostRe.MatchString(url) {
			w.WriteHeader(400)
			w.Write([]byte("Invalid or disallowed image URL"))
			return
		}
		s.proxyMedia(w, url)
	})
	api.HandleFunc("GET /api/smartthings-camera/{id}/snapshot", func(w http.ResponseWriter, r *http.Request) {
		url, _ := s.store.Get("smartthings/" + r.PathValue("id") + "/image").(string)
		if !strings.HasPrefix(url, "http") {
			w.WriteHeader(404)
			w.Write([]byte("No snapshot available — trigger a capture first"))
			return
		}
		s.proxyMedia(w, url)
	})
	api.HandleFunc("POST /api/smartthings-camera/{id}/take", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.stCommand(id, "imageCapture", "take", []any{}); err != nil {
			writeJSON(w, 200, OM("success", false, "error", err.Error()))
			return
		}
		name := id
		for _, d := range s.reg.Devices() {
			if d.Get("instance") == id && truthy(d.Get("label")) {
				name = jsString(d.Get("label"))
				break
			}
		}
		s.camera.Log(name, "capture-triggered", "")
		writeJSON(w, 200, OM("success", true, "message", "Capture triggered — snapshot will update within a few seconds"))
	})
	api.HandleFunc("GET /api/smartthings-camera/{id}/presets", func(w http.ResponseWriter, r *http.Request) {
		token, err := s.stToken()
		if err != nil {
			fail(w, 401, err.Error())
			return
		}
		req, _ := http.NewRequest("GET", smartThingsAPI+"/devices/"+r.PathValue("id")+"/status", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := stHTTP.Do(req)
		if err == nil && res.StatusCode >= 300 {
			res.Body.Close()
			err = fmt.Errorf("HTTP %d", res.StatusCode)
		}
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		defer res.Body.Close()
		raw, _ := io.ReadAll(res.Body)
		var presets any = []any{}
		if st, ok := rawOrdered(raw).(*OMap); ok {
			if c, ok := st.Get("components").(*OMap); ok {
				if mn, ok := c.Get("main").(*OMap); ok {
					if cp, ok := mn.Get("cameraPreset").(*OMap); ok {
						if p, ok := cp.Get("presets").(*OMap); ok && truthy(p.Get("value")) {
							presets = p.Get("value")
						}
					}
				}
			}
		}
		ok(w, presets)
	})
	presetCmd := func(command string, args func(r *http.Request) ([]any, error), reply func(w http.ResponseWriter)) http.HandlerFunc {
		return s.admin(func(w http.ResponseWriter, r *http.Request) {
			a, err := args(r)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if err := s.stCommand(r.PathValue("id"), "cameraPreset", command, a); err != nil {
				writeJSON(w, 200, OM("success", false, "error", err.Error()))
				return
			}
			reply(w)
		})
	}
	plainOK := func(w http.ResponseWriter) { writeJSON(w, 200, OM("success", true)) }
	api.HandleFunc("POST /api/smartthings-camera/{id}/presets", presetCmd("create", func(r *http.Request) ([]any, error) {
		name := strings.TrimSpace(jsString(orEmpty(jget(readBody(r), "name"))))
		if name == "" {
			return nil, errors.New("name required")
		}
		return []any{name}, nil
	}, func(w http.ResponseWriter) { writeJSON(w, 200, OM("success", true, "message", "Preset saved")) }))
	api.HandleFunc("POST /api/smartthings-camera/{id}/presets/{preset}/execute", presetCmd("execute", func(r *http.Request) ([]any, error) {
		return []any{r.PathValue("preset")}, nil
	}, plainOK))
	api.HandleFunc("DELETE /api/smartthings-camera/{id}/presets/{preset}", presetCmd("delete", func(r *http.Request) ([]any, error) {
		return []any{r.PathValue("preset")}, nil
	}, plainOK))

	api.HandleFunc("GET /api/settings/smartthings-token", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b, err := os.ReadFile(filepath.Join(s.root, "persist", "smartthings-token-latest.txt"))
		if err != nil {
			writeJSON(w, 200, OM("success", false, "error", "No token delivered yet — restart LSH with SmartThings OAuth configured"))
			return
		}
		lines := strings.Split(strings.TrimSpace(string(b)), "\n")
		var delivered any
		if len(lines) > 1 {
			if d := strings.TrimSpace(strings.Replace(lines[1], "delivered_at:", "", 1)); d != "" {
				delivered = d
			}
		}
		writeJSON(w, 200, OM("success", true, "token", lines[0], "deliveredAt", delivered))
	}))
}
