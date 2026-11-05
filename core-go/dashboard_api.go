package main

// Core dashboard routes that were "Not in the Go core yet" — the config- and
// registry-backed endpoints the main dashboard loads regardless of which
// integrations are configured. Ports of src/routes/home-plan.js,
// ev-charging.js (the GET /ev-visual read), device-customization.js
// (edit-pin status), cameras.js (manual + SmartThings cameras) and
// css-themes.js. Routes that back onto a whole Node subsystem not present in
// the Go core (agenda → Google Calendar/call/motion logs, locations, paging,
// HomeKit accessories, manuals, the per-category log files, device-customize
// writes) are intentionally left out — they need their subsystem ported, not
// just a handler.

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (s *Server) dashboardRoutes(api *http.ServeMux) {
	// GET /api/home-plan — isometric floor plan (config.homePlan).
	api.HandleFunc("GET /api/home-plan", func(w http.ResponseWriter, r *http.Request) {
		plan := readConfigOrdered(s.configPath()).Get("homePlan")
		if plan == nil {
			plan = OM("rooms", []any{})
		}
		writeJSON(w, 200, OM("success", true, "plan", plan))
	})

	// GET /api/ev-visual — which Sketchfab car the Energy tab's EV card shows.
	api.HandleFunc("GET /api/ev-visual", func(w http.ResponseWriter, r *http.Request) {
		const defID = "f583b5bfc17346c08573dc4f1edebefe"
		const defName = "2025 Mercedes-Benz G-Class AMG G63"
		modelID, modelName := defID, defName
		var devices any = OM()
		if ev, _ := readConfigOrdered(s.configPath()).Get("evVisual").(*OMap); ev != nil {
			if v := jsString(ev.Get("modelId")); v != "" {
				modelID = v
			}
			if v := jsString(ev.Get("modelName")); v != "" {
				modelName = v
			}
			if d := ev.Get("devices"); d != nil {
				devices = d
			}
		}
		writeJSON(w, 200, OM("success", true, "modelId", modelID, "modelName", modelName,
			"default", OM("modelId", modelID, "modelName", modelName), "devices", devices))
	})

	// GET /api/edit-pin/status — whether device edits are PIN-locked.
	api.HandleFunc("GET /api/edit-pin/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, OM("success", true, "enabled", truthy(readConfigOrdered(s.configPath()).Get("editPin"))))
	})

	// GET /api/cameras — manual cameras (config.cameras) + SmartThings cameras.
	// The other camera integrations run as Node module workers and aren't
	// reachable from the Go core, so they're absent here exactly as they would
	// be in Node when those integrations aren't configured.
	api.HandleFunc("GET /api/cameras", func(w http.ResponseWriter, r *http.Request) {
		out := []any{}
		cams, _ := readConfigOrdered(s.configPath()).Get("cameras").([]any)
		for idx, c := range cams {
			cm, isMap := c.(*OMap)
			if !isMap {
				continue
			}
			e := cm.Clone()
			if on, hasOnvif := cm.Get("onvif").(*OMap); hasOnvif {
				o := on.Clone()
				if jsString(on.Get("password")) != "" {
					o.Set("password", bullets)
				} else {
					o.Set("password", "")
				}
				e.Set("onvif", o)
				e.Set("ptzUrl", fmt.Sprintf("/api/camera/ptz/%d", idx))
				e.Set("presetUrl", fmt.Sprintf("/api/camera/preset/%d", idx))
				e.Set("irUrl", fmt.Sprintf("/api/camera/ir/%d", idx))
			}
			if jsString(cm.Get("url")) != "" && jsString(cm.Get("snapshotUrl")) == "" && jsString(cm.Get("mjpegUrl")) == "" {
				e.Set("snapshotUrl", fmt.Sprintf("/api/camera/snapshot/%d", idx))
			}
			out = append(out, e)
		}
		for _, d := range s.reg.Devices() {
			if d.Str("type") != "smartthings" {
				continue
			}
			hasImage := false
			for _, sen := range sensorsOf(d) {
				if jsString(sen.Get("path")) == "image" {
					hasImage = true
					break
				}
			}
			if !hasImage {
				continue
			}
			deviceID := strings.TrimPrefix(d.Str("key"), "smartthings/")
			out = append(out, OM(
				"name", d.Get("label"), "url", "",
				"snapshotUrl", "/api/smartthings-camera/"+deviceID+"/snapshot",
				"mjpegUrl", "", "webrtcUrl", "", "_smartthings", true, "_deviceId", deviceID))
		}
		writeJSON(w, 200, OM("success", true, "data", out))
	})

	// ── Custom CSS themes (persist/css-themes/ + bundled public/css-themes/) ──
	builtinDir := filepath.Join(s.root, "react-dashboard", "public", "css-themes")
	customDir := filepath.Join(s.root, "persist", "css-themes")

	api.HandleFunc("GET /api/settings/css-themes", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, OM("success", true, "data", OM(
			"builtin", listCssThemes(builtinDir), "custom", listCssThemes(customDir))))
	})
	api.HandleFunc("GET /api/settings/css-themes/{kind}/{name}", func(w http.ResponseWriter, r *http.Request) {
		var dir string
		switch r.PathValue("kind") {
		case "builtin":
			dir = builtinDir
		case "custom":
			dir = customDir
		default:
			fail(w, 400, "kind must be builtin or custom, name required")
			return
		}
		name := sanitizeThemeName(r.PathValue("name"))
		if name == "" {
			fail(w, 400, "kind must be builtin or custom, name required")
			return
		}
		css, err := os.ReadFile(filepath.Join(dir, name+".css"))
		if err != nil {
			fail(w, 404, "Theme not found")
			return
		}
		writeJSON(w, 200, OM("success", true, "data", OM("css", string(css))))
	})
	api.HandleFunc("POST /api/settings/css-themes/custom/{name}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		name := sanitizeThemeName(r.PathValue("name"))
		if name == "" {
			fail(w, 400, "Invalid theme name")
			return
		}
		css := jsString(readBody(r).Get("css"))
		if len(css) > 200*1024 {
			fail(w, 400, "CSS too large (max 200 KB)")
			return
		}
		if err := os.MkdirAll(customDir, 0o755); err != nil {
			fail(w, 500, err.Error())
			return
		}
		if err := os.WriteFile(filepath.Join(customDir, name+".css"), []byte(css), 0o644); err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, OM("success", true, "data", OM("name", name)))
	}))
	api.HandleFunc("DELETE /api/settings/css-themes/custom/{name}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		name := sanitizeThemeName(r.PathValue("name"))
		if name == "" {
			fail(w, 400, "Invalid theme name")
			return
		}
		os.Remove(filepath.Join(customDir, name+".css")) // already gone is fine
		w.WriteHeader(204)
	}))
}

// sanitizeThemeName mirrors routes/css-themes.js: lowercase, every run of
// characters outside [a-z0-9-] collapses to a single '-', trimmed, max 40 —
// so the name can never escape its directory.
func sanitizeThemeName(raw string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(raw) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
			prevDash = r == '-'
		} else if !prevDash {
			b.WriteByte('-')
			prevDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 40 {
		out = strings.Trim(out[:40], "-")
	}
	return out
}

func listCssThemes(dir string) []string {
	out := []string{}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return out
	}
	for _, e := range ents {
		if n := e.Name(); strings.HasSuffix(n, ".css") {
			out = append(out, strings.TrimSuffix(n, ".css"))
		}
	}
	sort.Strings(out)
	return out
}
