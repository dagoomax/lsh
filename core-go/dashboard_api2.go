package main

// More core-dashboard routes ported from the Node routes that were "Not in the
// Go core yet": device customization + room icons + plan decor (registry
// writers, device-customization.js), the unified agenda feed + private events
// (agenda.js / private-events.js, reading persist/*.json), the per-category log
// viewer (logs.js, served from the in-memory logBuf), HomeKit accessory
// exclusion (homekit.js — read-only here, there is no HomeKit bridge in the Go
// core so everything reads as un-bridged), paging (paging.js — the live
// Socket.IO channel isn't in the Go core, so these behave exactly as Node does
// with paging disabled), and the read side of Locations (locations.js — the
// pairing / reverse-proxy subsystem stays on the Node core).

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// randUUID returns a v4 UUID, like private-events.js's crypto.randomUUID().
func randUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func (s *Server) persistPath(name string) string {
	return filepath.Join(s.root, "persist", name)
}

func (s *Server) editPinOk(body *OMap) bool {
	pin := jsString(readConfigOrdered(s.configPath()).Get("editPin"))
	return pin == "" || jsString(body.Get("pin")) == pin
}

// deviceCustomize — POST /api/device/<key>/customize (dispatched from
// deviceCommand because device keys contain slashes).
func (s *Server) deviceCustomize(w http.ResponseWriter, r *http.Request, key string) {
	body := readBody(r)
	if !s.editPinOk(body) {
		fail(w, 403, "PIN_REQUIRED")
		return
	}
	dev, err := s.reg.SetOverride(key, body)
	if err != nil {
		fail(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, OM("success", true, "device", OM(
		"key", dev.Get("key"), "label", dev.Get("label"),
		"room", dev.Get("room"), "customIcon", dev.Get("customIcon"))))
}

func (s *Server) dashboardRoutes2(api *http.ServeMux) {
	// ── Device customization / rooms / plan decor ──────────────
	api.HandleFunc("GET /api/edit-pin/verify", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, OM("success", true, "ok", s.editPinOk(readBody(r))))
	})
	api.HandleFunc("POST /api/edit-pin/verify", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, OM("success", true, "ok", s.editPinOk(readBody(r))))
	})
	api.HandleFunc("GET /api/rooms", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, OM("success", true, "rooms", s.reg.RoomMeta()))
	})
	api.HandleFunc("POST /api/room/{name}/icon", func(w http.ResponseWriter, r *http.Request) {
		if !s.editPinOk(readBody(r)) {
			fail(w, 403, "PIN_REQUIRED")
			return
		}
		rooms, err := s.reg.SetRoomIcon(r.PathValue("name"), jsString(readBody(r).Get("icon")))
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, OM("success", true, "rooms", rooms))
	})
	api.HandleFunc("GET /api/plan-decor", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, OM("success", true, "decor", s.reg.GetDecor()))
	})
	api.HandleFunc("POST /api/plan-decor", func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		if !s.editPinOk(b) {
			fail(w, 403, "PIN_REQUIRED")
			return
		}
		var decor any
		var err error
		switch b.Str("op") {
		case "add":
			decor, err = s.reg.AddDecor(b.Str("floor"), b.Str("emoji"), b.Str("image"),
				numOr(b.Get("x"), 0.5), numOr(b.Get("y"), 0.5), b.Str("hideAuto"))
		case "move":
			decor, err = s.reg.MoveDecor(b.Str("id"), numOr(b.Get("x"), 0), numOr(b.Get("y"), 0))
		case "remove":
			decor, err = s.reg.RemoveDecor(b.Str("id"))
		case "hide":
			decor, err = s.reg.HideAutoDecor(b.Str("id"))
		default:
			fail(w, 400, "Unknown op '"+b.Str("op")+"'")
			return
		}
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, OM("success", true, "decor", decor))
	})

	// ── Agenda (private events + missed calls + motion), the Wall Dashboard ──
	api.HandleFunc("GET /api/agenda", func(w http.ResponseWriter, r *http.Request) {
		events := []any{}
		for _, e := range s.loadPrivateEvents() {
			ev := e.Clone()
			ev.Set("kind", "private")
			events = append(events, ev)
		}
		for _, c := range tailJSONLog(s.persistPath("call-log.json"), 10) {
			d := time.UnixMilli(int64(jsNumber(c["ts"])))
			events = append(events, OM("date", d.Format("2006-01-02"),
				"title", "Missed call — "+jsString(c["caller"]), "time", d.Format("15:04"), "kind", "call"))
		}
		for _, m := range tailJSONLog(s.persistPath("motion-log.json"), 10) {
			d := time.UnixMilli(int64(jsNumber(m["ts"])))
			events = append(events, OM("date", d.Format("2006-01-02"),
				"title", "Motion — "+jsString(m["device"]), "time", d.Format("15:04"), "kind", "motion"))
		}
		sort.SliceStable(events, func(i, j int) bool {
			return agendaSortKey(events[i]) < agendaSortKey(events[j])
		})
		ok(w, events)
	})
	api.HandleFunc("POST /api/agenda/private", func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		date, title := jsString(b.Get("date")), strings.TrimSpace(jsString(b.Get("title")))
		if date == "" || title == "" {
			fail(w, 400, "date and title required")
			return
		}
		item := OM("id", randUUID(), "date", slice10(date), "title", slice(title, 120))
		if t := jsString(b.Get("time")); t != "" {
			item.Set("time", slice(t, 5))
		} else {
			item.Set("time", nil)
		}
		list := s.loadPrivateEvents()
		list = append(list, item)
		if err := s.savePrivateEvents(list); err != nil {
			fail(w, 500, err.Error())
			return
		}
		ok(w, item)
	})
	api.HandleFunc("DELETE /api/agenda/private/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		list := s.loadPrivateEvents()
		kept := make([]*OMap, 0, len(list))
		for _, e := range list {
			if e.Str("id") != id {
				kept = append(kept, e)
			}
		}
		if len(kept) == len(list) {
			fail(w, 404, "Not found")
			return
		}
		if err := s.savePrivateEvents(kept); err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, OM("success", true))
	})

	// ── Logs (per-category buffer; app first) ──────────────────
	api.HandleFunc("GET /api/logs", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, OM("success", true, "categories", logBuf.categories()))
	})
	api.HandleFunc("GET /api/logs/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := sanitizeLogCat(r.PathValue("name"))
		limit := 300
		if n, err := strconv.Atoi(r.URL.Query().Get("lines")); err == nil && n > 0 {
			limit = n
		}
		if limit > 2000 {
			limit = 2000
		}
		writeJSON(w, 200, OM("success", true, "name", name, "lines", logBuf.tail(name, limit)))
	})
	api.HandleFunc("DELETE /api/logs/{name}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		logBuf.clear(sanitizeLogCat(r.PathValue("name")))
		writeJSON(w, 200, OM("success", true))
	}))

	// ── HomeKit accessory list (read-only; no bridge in the Go core) ───────
	api.HandleFunc("GET /api/homekit/accessories", s.admin(func(w http.ResponseWriter, r *http.Request) {
		ex, _ := readConfigOrdered(s.configPath()).Get("homekit").(*OMap)
		var exc *OMap
		if ex != nil {
			exc, _ = ex.Get("exclude").(*OMap)
		}
		excList := func(k string) any {
			if exc != nil {
				if v := exc.Get(k); v != nil {
					return v
				}
			}
			return []any{}
		}
		devices := []any{}
		typeSet := map[string]bool{}
		for _, d := range s.reg.Devices() {
			hk, _ := d.Get("homekit").([]any)
			light := false
			for _, sen := range sensorsOf(d) {
				if h, ok := sen.Get("homekit").(*OMap); ok && jsString(h.Get("service")) == "Lightbulb" {
					light = true
				}
			}
			if len(hk) == 0 && !light {
				continue
			}
			kinds := append([]any{}, hk...)
			if light {
				kinds = append(kinds, "light")
			}
			t := d.Str("type")
			if t != "" {
				typeSet[t] = true
			}
			devices = append(devices, OM("key", d.Get("key"), "label", d.Get("label"),
				"type", t, "room", d.Get("room"), "kinds", kinds, "bridged", false))
		}
		types := make([]string, 0, len(typeSet))
		for t := range typeSet {
			types = append(types, t)
		}
		sort.Strings(types)
		scenes := []any{}
		if s.auto != nil {
			for _, sc := range s.auto.Scenes() {
				scenes = append(scenes, OM("id", sc.Get("id"), "name", sc.Get("name"), "bridged", false))
			}
		}
		ok(w, OM("running", false,
			"exclude", OM("devices", excList("devices"), "types", excList("types"),
				"cameras", excList("cameras"), "scenes", excList("scenes"), "relays", excList("relays")),
			"devices", devices, "types", types, "cameras", []any{}, "scenes", scenes))
	}))

	// ── Paging: the live channel is Socket.IO + audio, not in the Go core.
	// These mirror Node with paging disabled (no rooms, actions 503). ───────
	api.HandleFunc("GET /api/paging/rooms", func(w http.ResponseWriter, r *http.Request) {
		ok(w, []any{})
	})
	api.HandleFunc("GET /api/paging/messages", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("room") == "" {
			fail(w, 400, "room is required")
			return
		}
		ok(w, []any{})
	})
	pagingOff := func(w http.ResponseWriter, r *http.Request) { fail(w, 503, "Paging not enabled") }
	api.HandleFunc("POST /api/paging/start", pagingOff)
	api.HandleFunc("POST /api/paging/message", pagingOff)

	// ── Locations: read side only (the pairing/proxy subsystem stays on Node) ─
	api.HandleFunc("GET /api/locations", func(w http.ResponseWriter, r *http.Request) {
		ok(w, s.locationsPublic())
	})
	api.HandleFunc("GET /api/locations/site", func(w http.ResponseWriter, r *http.Request) {
		cfg := readConfigOrdered(s.configPath())
		ok(w, OM("name", s.siteName(), "configured", jsString(cfg.Get("siteName")) != ""))
	})
	api.HandleFunc("POST /api/locations/site", s.admin(func(w http.ResponseWriter, r *http.Request) {
		name := slice(strings.TrimSpace(jsString(readBody(r).Get("name"))), 60)
		cfg := readConfigOrdered(s.configPath())
		if name != "" {
			cfg.Set("siteName", name)
		} else {
			cfg.Delete("siteName")
		}
		if err := writeConfigFile(s.configPath(), cfg); err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, OM("success", true, "message", "Saved.", "data", OM("name", s.siteName())))
	}))
}

// ── helpers ──────────────────────────────────────────────────────────────

func (s *Server) siteName() string {
	if n := strings.TrimSpace(jsString(readConfigOrdered(s.configPath()).Get("siteName"))); n != "" {
		return n
	}
	if h, err := os.Hostname(); err == nil {
		return h
	}
	return "LSH"
}

// locationsPublic returns persist/locations.json with the token field dropped
// and hasToken added — never the tokens themselves.
func (s *Server) locationsPublic() []any {
	out := []any{}
	b, err := os.ReadFile(s.persistPath("locations.json"))
	if err != nil {
		return out
	}
	var list []map[string]any
	if json.Unmarshal(b, &list) != nil {
		return out
	}
	for _, l := range list {
		pub := OM()
		for k, v := range l {
			if k != "token" {
				pub.Set(k, v)
			}
		}
		pub.Set("hasToken", jsString(l["token"]) != "")
		out = append(out, pub)
	}
	return out
}

func (s *Server) loadPrivateEvents() []*OMap {
	out := []*OMap{}
	b, err := os.ReadFile(s.persistPath("private-events.json"))
	if err != nil {
		return out
	}
	var raw []json.RawMessage
	if json.Unmarshal(b, &raw) != nil {
		return out
	}
	for _, r := range raw {
		o := NewOMap()
		if json.Unmarshal(r, o) == nil {
			out = append(out, o)
		}
	}
	return out
}

func (s *Server) savePrivateEvents(list []*OMap) error {
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.persistPath(""), 0o755); err != nil {
		return err
	}
	return os.WriteFile(s.persistPath("private-events.json"), b, 0o644)
}

// tailJSONLog reads a persisted ring-buffer log ([{ts,...}] newest-first) and
// returns up to n of its entries as maps.
func tailJSONLog(path string, n int) []map[string]any {
	out := []map[string]any{}
	b, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	var list []map[string]any
	if json.Unmarshal(b, &list) != nil {
		return out
	}
	if len(list) > n {
		list = list[:n]
	}
	return list
}

func agendaSortKey(e any) string {
	o, _ := e.(*OMap)
	if o == nil {
		return ""
	}
	t := jsString(o.Get("time"))
	if t == "" {
		t = "00:00"
	}
	return jsString(o.Get("date")) + "T" + t
}

func numOr(v any, def float64) float64 {
	if v == nil {
		return def
	}
	n := jsNumber(v)
	if n != n { // NaN
		return def
	}
	return n
}

func slice(s string, max int) string {
	if len(s) > max {
		return s[:max]
	}
	return s
}

func slice10(s string) string { return slice(s, 10) }
