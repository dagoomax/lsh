package main

// HTTP: the React dashboard (/react/), the core REST routes (ports of
// src/routes/auth.js, devices.js, history.js, modules.js) and Socket.IO.
// Routes not ported yet answer 501 so the dashboard degrades per widget.

import (
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	root    string
	store   *Store
	reg     *Registry
	ps      *PlatformStatus
	auth    *Auth
	host    *ModuleHost
	sio     *SocketIO
	auto    *Automation
	victron *Victron
	relays  *Relays
	out     outBridges
	camera  *CameraEvents
}

type ctxUser struct{}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	b, err := marshalJS(v) // like res.json(): <, >, & as they are, no trailing newline
	if err != nil {
		b = []byte(`{"success":false,"error":"response encoding failed"}`)
	}
	w.Write(b)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, OM("success", false, "error", msg))
}

func ok(w http.ResponseWriter, data any) {
	writeJSON(w, 200, OM("success", true, "data", data))
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// readBody parses a JSON object body, key order kept (scenes, flows and
// rules are stored back exactly as sent).
func readBody(r *http.Request) *OMap {
	raw, _ := io.ReadAll(http.MaxBytesReader(nil, r.Body, 8<<20))
	if o, ok := rawOrdered(raw).(*OMap); ok {
		return o
	}
	return NewOMap()
}

func (s *Server) Handler() http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("POST /api/auth/setup", s.authSetup)
	api.HandleFunc("POST /api/auth/login", s.authLogin)
	api.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		clearSessionCookie(w)
		writeJSON(w, 200, OM("success", true))
	})
	api.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		u := userOf(r)
		data := map[string]any{}
		for k, v := range u {
			data[k] = v
		}
		id, _ := u["id"].(string)
		data["permissions"] = s.auth.Permissions(id)
		ok(w, data)
	})
	api.HandleFunc("GET /api/connection", func(w http.ResponseWriter, r *http.Request) { ok(w, s.victron.Status()) })
	api.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		g := grouped(s.store)
		g["relays"] = s.relays.All()
		ok(w, g)
	})
	api.HandleFunc("GET /api/relays", func(w http.ResponseWriter, r *http.Request) { ok(w, s.relays.All()) })
	api.HandleFunc("POST /api/relay/{index}/state", s.admin(func(w http.ResponseWriter, r *http.Request) {
		index := math.NaN() // parseInt(req.params.index)
		if n, err := strconv.Atoi(leadingInt(r.PathValue("index"))); err == nil {
			index = float64(n)
		}
		on, isBool := readBody(r).Get("on").(bool)
		if !isBool {
			fail(w, 400, `Body must contain { "on": true/false }`)
			return
		}
		if !s.relays.Configured(index) {
			fail(w, 404, "Relay not found")
			return
		}
		if err := s.relays.SetState(index, on); err != nil {
			fail(w, 500, err.Error())
			return
		}
		ok(w, OM("index", index, "on", on))
	}))
	api.HandleFunc("GET /api/devices", func(w http.ResponseWriter, r *http.Request) { ok(w, s.reg.AllReadings()) })
	api.HandleFunc("GET /api/devices/{key...}", s.deviceGet)
	api.HandleFunc("POST /api/device/{key...}", s.deviceCommand) // …/<key>/command
	api.HandleFunc("GET /api/device/{key...}", s.deviceSet)      // …/<key>/set?sensor=&value=
	api.HandleFunc("GET /api/history/{key...}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, OM("success", true, "key", r.PathValue("key"), "points", s.store.History(r.PathValue("key"))))
	})
	api.HandleFunc("GET /api/history-status", func(w http.ResponseWriter, r *http.Request) {
		ok(w, OM("mongoEnabled", false, "retentionDays", 90, "bufferHours", 6))
	})
	api.HandleFunc("GET /api/platform-status", func(w http.ResponseWriter, r *http.Request) { ok(w, s.ps.All()) })
	s.automationRoutes(api)
	s.loxoneRoutes(api)
	s.smartThingsRoutes(api)
	s.cameraEventRoutes(api)
	api.HandleFunc("GET /api/modules/processes", s.admin(func(w http.ResponseWriter, r *http.Request) {
		ok(w, OM("isolated", true, "processes", s.host.List()))
	}))
	api.HandleFunc("POST /api/modules/processes/{id}/restart", s.admin(func(w http.ResponseWriter, r *http.Request) {
		m := s.host.Get(r.PathValue("id"))
		if m == nil {
			fail(w, 404, "No such module process")
			return
		}
		m.Restart("restarted from Settings")
		ok(w, m.Info())
	}))
	api.HandleFunc("GET /api/core", func(w http.ResponseWriter, r *http.Request) { ok(w, coreInfo(s)) })
	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotImplemented, "Not in the Go core yet: "+r.Method+" "+r.URL.Path)
	})

	dist := filepath.Join(s.root, "react-dashboard", "dist")
	reactFS := http.StripPrefix("/react/", http.FileServer(http.Dir(dist)))
	public := http.FileServer(http.Dir(filepath.Join(s.root, "public")))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == "/" || p == "/index.html" || p == "/react":
			http.Redirect(w, r, "/react/", http.StatusFound)
		case strings.HasPrefix(p, "/socket.io/"):
			s.sio.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/react/"):
			// SPA: unknown paths are client-side views (/react/settings, …)
			if _, err := os.Stat(filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(p, "/react/")))); err != nil || p == "/react/" {
				w.Header().Set("Cache-Control", "no-cache")
				http.ServeFile(w, r, filepath.Join(dist, "index.html"))
				return
			}
			reactFS.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/api/"):
			s.withAuth(api).ServeHTTP(w, r)
		default:
			public.ServeHTTP(w, r)
		}
	})
}

func userOf(r *http.Request) map[string]any {
	u, _ := r.Context().Value(ctxUser{}).(map[string]any)
	return u
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, p := range publicAPI {
			if strings.HasPrefix(r.URL.Path, p) {
				next.ServeHTTP(w, r)
				return
			}
		}
		if !s.auth.HasUsers() {
			writeJSON(w, 503, OM("success", false, "setupRequired", true, "error", "Server not configured — open the dashboard to create your admin account."))
			return
		}
		u, bad := s.auth.UserFor(r)
		if bad {
			fail(w, 401, "Invalid token")
			return
		}
		if u == nil {
			fail(w, 401, "Authentication required")
			return
		}
		next.ServeHTTP(w, r.WithContext(contextWith(r, u)))
	})
}

func (s *Server) admin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if userOf(r)["role"] != "admin" {
			fail(w, 403, "Admin access required")
			return
		}
		h(w, r)
	}
}

func (s *Server) authSetup(w http.ResponseWriter, r *http.Request) {
	if s.auth.HasUsers() {
		fail(w, 409, "Already set up — sign in instead.")
		return
	}
	b := readBody(r)
	name := b.Str("adminUsername")
	pw := b.Str("adminPassword")
	if name == "" || pw == "" {
		fail(w, 400, "adminUsername and adminPassword required")
		return
	}
	if len(pw) < 8 {
		fail(w, 400, "Password must be at least 8 characters")
		return
	}
	u, err := s.auth.CreateFirstUser(name, pw)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	tok, _ := s.auth.Sign(u)
	setSessionCookie(w, r, tok)
	writeJSON(w, 200, OM("success", true, "user", u))
}

func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if s.auth.RateLimited(ip) {
		fail(w, 429, "Too many failed login attempts. Try again in a few minutes.")
		return
	}
	b := readBody(r)
	name := b.Str("username")
	pw := b.Str("password")
	if name == "" || pw == "" {
		fail(w, 400, "username and password required")
		return
	}
	u := s.auth.Authenticate(name, pw)
	log.Printf("[Auth] Login %s for %q from %s", map[bool]string{true: "OK", false: "FAILED"}[u != nil], name, ip)
	if u == nil {
		s.auth.LoginFailed(ip)
		fail(w, 401, "Invalid username or password")
		return
	}
	s.auth.LoginOK(ip)
	tok, _ := s.auth.Sign(u)
	setSessionCookie(w, r, tok)
	writeJSON(w, 200, OM("success", true, "user", u))
}

func (s *Server) deviceGet(w http.ResponseWriter, r *http.Request) {
	d := s.reg.DeviceReadings(r.PathValue("key"))
	if d == nil {
		fail(w, 404, "Device not found")
		return
	}
	if sensor := r.URL.Query().Get("sensor"); sensor != "" {
		rd, _ := d.Get("readings").(*OMap).Get(sensor).(*OMap)
		if rd == nil {
			fail(w, 404, "Sensor '"+sensor+"' not found")
			return
		}
		w.Write([]byte(jsString(rd.Get("value"))))
		return
	}
	ok(w, d)
}

func (s *Server) deviceCommand(w http.ResponseWriter, r *http.Request) {
	key, found := strings.CutSuffix(r.PathValue("key"), "/command")
	if !found {
		fail(w, http.StatusNotImplemented, "Not in the Go core yet: POST "+r.URL.Path)
		return
	}
	if userOf(r)["role"] != "admin" {
		fail(w, 403, "Admin access required")
		return
	}
	b := readBody(r)
	sensor := b.Str("sensor")
	value, has := b.Lookup("value")
	if !has {
		value, has = b.Lookup("on") // legacy
	}
	if sensor == "" || !has {
		fail(w, 400, "Body must contain { sensor: string, value: any }")
		return
	}
	if err := s.reg.SendCommand(key, sensor, value); err != nil {
		fail(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, OM("success", true))
}

func (s *Server) deviceSet(w http.ResponseWriter, r *http.Request) {
	key, found := strings.CutSuffix(r.PathValue("key"), "/set")
	if !found {
		fail(w, http.StatusNotImplemented, "Not in the Go core yet: GET "+r.URL.Path)
		return
	}
	q := r.URL.Query()
	if q.Get("sensor") == "" || !q.Has("value") {
		fail(w, 400, "Query must contain sensor and value")
		return
	}
	if err := s.reg.SendCommand(key, q.Get("sensor"), q.Get("value")); err != nil {
		fail(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, OM("success", true))
}

// Socket.IO handshake auth — same order as src/websocket.js.
func (s *Server) sioAuthorize(r *http.Request, hs map[string]any) bool {
	if !s.auth.HasUsers() {
		return true
	}
	if t, _ := hs["token"].(string); t != "" && (s.auth.VerifyAPIToken(t) || s.auth.VerifyJWT(t) != nil) {
		return true
	}
	if c, err := r.Cookie(cookieName); err == nil && s.auth.VerifyJWT(c.Value) != nil {
		return true
	}
	return false
}

func (s *Server) sioConnect(emit func(string, any)) {
	emit("snapshot", s.store.GetAll())
	emit("devices", s.reg.AllReadings())
	emit("rooms", s.reg.RoomMeta())
	emit("connection-status", s.victron.Status())
	emit("platform-status", s.ps.Visible())
}

// Wire store / registry / platform events to the browsers: value changes
// batched (unchanged repeats skipped), device lists debounced.
func (s *Server) wireEvents() {
	var mu sync.Mutex
	pending := map[string]any{}
	scheduled := false
	s.store.OnChange(func(c Change) {
		mu.Lock()
		defer mu.Unlock()
		if _, inBatch := pending[c.Key]; !c.Changed && !inBatch {
			return
		}
		pending[c.Key] = c.Value
		if !scheduled {
			scheduled = true
			time.AfterFunc(20*time.Millisecond, func() {
				mu.Lock()
				batch := pending
				pending, scheduled = map[string]any{}, false
				mu.Unlock()
				s.sio.Emit("update", batch)
			})
		}
	})
	var devTimer *time.Timer
	var devMu sync.Mutex
	s.reg.On(func(event string, payload any) {
		if event == "device-discovered" {
			s.sio.Emit("device-discovered", payload)
		}
		devMu.Lock()
		defer devMu.Unlock()
		if devTimer == nil {
			devTimer = time.AfterFunc(200*time.Millisecond, func() {
				devMu.Lock()
				devTimer = nil
				devMu.Unlock()
				s.sio.Emit("devices", s.reg.AllReadings())
			})
		}
	})
	s.ps.OnChange(func() { s.sio.Emit("platform-status", s.ps.Visible()) })
	s.victron.OnSourceChanged(func() { s.sio.Emit("connection-status", s.victron.Status()) })
}
