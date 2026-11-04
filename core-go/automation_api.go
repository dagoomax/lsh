package main

// /api/automation/* and the flow file routes — port of src/routes/automation.js.

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// readConfigFile reads config.json as it is now (no env overrides), like
// routes/helpers.js readConfigFile().
func (s *Server) readConfigFile() map[string]any {
	var cfg map[string]any
	if b, err := os.ReadFile(filepath.Join(s.root, "config.json")); err == nil {
		json.Unmarshal(b, &cfg)
	}
	return cfg
}

// requirePermission — a per-user capability on top of admin; API tokens are exempt.
func (s *Server) requirePermission(key string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, _ := userOf(r)["id"].(string)
		if id != "api-token" && !s.auth.Permissions(id)[key] {
			fail(w, 403, "Missing '"+key+"' permission — ask an admin with installer mode enabled to grant it in Settings → Security")
			return
		}
		h(w, r)
	}
}

// `homekit` = not in config.homekit.exclude.scenes; `inHomekit` = published on
// the running bridge (there is none in the Go core yet).
func (s *Server) hkScene(scene *OMap, excluded map[string]bool) *OMap {
	out := scene.Clone()
	out.Set("homekit", !excluded[jsString(scene.Get("id"))])
	out.Set("inHomekit", false)
	return out
}

func (s *Server) excludedScenes() map[string]bool {
	ex := map[string]bool{}
	hk, _ := s.readConfigFile()["homekit"].(map[string]any)
	exc, _ := hk["exclude"].(map[string]any)
	for _, id := range arr(exc["scenes"]) {
		ex[jsString(id)] = true
	}
	return ex
}

var extRe = regexp.MustCompile(`\.[a-zA-Z0-9]+$`)

func (s *Server) automationRoutes(api *http.ServeMux) {
	a := s.auto
	okOr400 := func(w http.ResponseWriter, data any, err error) {
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		ok(w, data)
	}
	done := func(w http.ResponseWriter) { writeJSON(w, 200, OM("success", true)) }

	api.HandleFunc("GET /api/automation/rules", func(w http.ResponseWriter, r *http.Request) { ok(w, a.Rules()) })
	api.HandleFunc("POST /api/automation/rules", s.admin(func(w http.ResponseWriter, r *http.Request) {
		rule, err := a.SaveRule(readBody(r))
		okOr400(w, rule, err)
	}))
	api.HandleFunc("DELETE /api/automation/rules/{id}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		a.DeleteRule(r.PathValue("id"))
		done(w)
	}))

	api.HandleFunc("GET /api/automation/scenes", func(w http.ResponseWriter, r *http.Request) {
		ex := s.excludedScenes()
		out := []*OMap{}
		for _, sc := range a.Scenes() {
			out = append(out, s.hkScene(sc, ex))
		}
		ok(w, out)
	})
	api.HandleFunc("POST /api/automation/scenes", s.admin(func(w http.ResponseWriter, r *http.Request) {
		scene := readBody(r)
		scene.Delete("homekit") // derived fields, never stored
		scene.Delete("inHomekit")
		saved, err := a.SaveScene(scene)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		ok(w, s.hkScene(saved, s.excludedScenes()))
	}))
	api.HandleFunc("DELETE /api/automation/scenes/{id}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		a.DeleteScene(r.PathValue("id"))
		done(w)
	}))
	// Capture the whole current state (lighting, setpoints, modes, volume,
	// colour…) into a scene in one tap. { name, icon } label it; { id }
	// re-captures into an existing scene.
	api.HandleFunc("POST /api/automation/scenes/snapshot", s.admin(func(w http.ResponseWriter, r *http.Request) {
		body := readBody(r)
		saved, err := a.SnapshotScene(body.Str("name"), body.Str("icon"), body.Str("id"))
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		ok(w, s.hkScene(saved, s.excludedScenes()))
	}))
	runScene := func(w http.ResponseWriter, r *http.Request) {
		scene, err := a.RunScene(r.PathValue("id"))
		okOr400(w, scene, err)
	}
	api.HandleFunc("POST /api/automation/scenes/{id}/run", runScene)
	api.HandleFunc("GET /api/automation/scenes/{id}/run", runScene) // Loxone Virtual Outputs send GET

	api.HandleFunc("GET /api/automation/flows", func(w http.ResponseWriter, r *http.Request) { ok(w, a.Flows()) })
	api.HandleFunc("POST /api/automation/flows", s.admin(s.requirePermission("flows", func(w http.ResponseWriter, r *http.Request) {
		flow, err := a.SaveFlow(readBody(r))
		okOr400(w, flow, err)
	})))
	api.HandleFunc("DELETE /api/automation/flows/{id}", s.admin(s.requirePermission("flows", func(w http.ResponseWriter, r *http.Request) {
		a.DeleteFlow(r.PathValue("id"))
		done(w)
	})))
	api.HandleFunc("POST /api/automation/flows/{id}/run", func(w http.ResponseWriter, r *http.Request) {
		flow, err := a.RunFlow(r.PathValue("id"))
		okOr400(w, flow, err)
	})

	api.HandleFunc("GET /api/flow-snapshots/{name}", func(w http.ResponseWriter, r *http.Request) {
		name, err := sanitizeSnapshotName(extRe.ReplaceAllString(r.PathValue("name"), ""))
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		entries, _ := os.ReadDir(a.snapshotsDir)
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), name+".") {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", mimeForExt(filepath.Ext(e.Name())))
				http.ServeFile(w, r, filepath.Join(a.snapshotsDir, e.Name()))
				return
			}
		}
		fail(w, 404, "No snapshot saved yet")
	})
	api.HandleFunc("GET /api/flow-loxone/{name}", func(w http.ResponseWriter, r *http.Request) {
		name, err := sanitizeSnapshotName(regexp.MustCompile(`(?i)\.xml$`).ReplaceAllString(r.PathValue("name"), ""))
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		b, err := os.ReadFile(filepath.Join(a.loxoneDir, name+".xml"))
		if err != nil {
			fail(w, 404, "No XML generated yet — run the flow at least once")
			return
		}
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.xml"`)
		w.Write(b)
	})

	api.HandleFunc("GET /api/automation/notifications", func(w http.ResponseWriter, r *http.Request) { ok(w, a.Notifications()) })
	api.HandleFunc("POST /api/automation/notifications", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		msg := b.Get("message")
		if !truthy(msg) {
			fail(w, 400, "message required")
			return
		}
		level, source := b.Get("level"), b.Get("source")
		if !truthy(level) {
			level = "info"
		}
		if !truthy(source) {
			source = "api"
		}
		ok(w, a.Notify(jsString(level), jsString(msg), source))
	}))
	api.HandleFunc("DELETE /api/automation/notifications", s.admin(func(w http.ResponseWriter, r *http.Request) {
		a.ClearNotifications()
		done(w)
	}))
}
