package main

// Hardware simulators — port of src/routes/simulators.js + src/simulator-manager.js.
// Runs the bundled scripts/*-simulator.js as child processes per
// config.simulators, toggled live via:
//   GET  /api/simulators            → list (name, port, enabled, running, pid)
//   POST /api/simulators/{name}     → { enabled, port? }, persisted to config.json
// The Node core restarts a simulator that crashes after 5 s; this port does not
// re-spawn on an unexpected exit (a toggle off/on restarts it), everything else
// matches.

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
)

type simMeta struct {
	script string
	desc   string
	port   int
}

// Insertion order matches the Node CATALOG, so GET /api/simulators lists them
// the same way.
var simOrder = []string{"grenton", "miele", "ampio", "aqara", "hue"}
var simCatalog = map[string]simMeta{
	"grenton": {"grenton-simulator.js", "Grenton GATE (HTTP)", 8199},
	"miele":   {"miele-simulator.js", "Miele API (HTTP + SSE)", 8299},
	"ampio":   {"ampio-simulator.js", "Ampio M-SERV (MQTT broker)", 1884},
	"aqara":   {"aqara-simulator.js", "Aqara gateway (UDP)", 19898},
	"hue":     {"hue-simulator.js", "Hue bridge (HTTP)", 8180},
}

type simManager struct {
	root, node string
	mu         sync.Mutex
	procs      map[string]*exec.Cmd
}

var (
	simOnce sync.Once
	simMgr  *simManager
)

func (s *Server) sims() *simManager {
	simOnce.Do(func() {
		simMgr = &simManager{root: s.root, node: s.host.node, procs: map[string]*exec.Cmd{}}
	})
	return simMgr
}

// simNormalize mirrors the Node normalize(): true → enabled, an object →
// {enabled, port}, anything falsy → disabled.
func simNormalize(v any) (enabled bool, port int) {
	switch t := v.(type) {
	case bool:
		return t, 0
	case *OMap:
		enabled = truthy(t.Get("enabled"))
		if p := jsNumber(t.Get("port")); p > 0 {
			port = int(p)
		}
	}
	return
}

// spawn runs scripts/<script> <port>; port 0 uses the catalog default.
func (m *simManager) spawn(name string, port int) {
	meta, ok := simCatalog[name]
	if !ok {
		return
	}
	if port == 0 {
		port = meta.port
	}
	script := filepath.Join(m.root, "scripts", meta.script)
	if _, err := os.Stat(script); err != nil {
		log.Printf("[Simulators] Missing %s", script)
		return
	}
	cmd := exec.Command(m.node, script, strconv.Itoa(port))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Printf("[Simulators] %s failed to start: %v", name, err)
		return
	}
	m.procs[name] = cmd
	log.Printf("[Simulators] Started %s on :%d (pid %d)", name, port, cmd.Process.Pid)
	go func() {
		cmd.Wait()
		m.mu.Lock()
		if m.procs[name] == cmd {
			delete(m.procs, name)
		}
		m.mu.Unlock()
	}()
}

func (m *simManager) kill(name string) {
	c := m.procs[name]
	if c == nil {
		return
	}
	delete(m.procs, name) // delete first so the exit watcher is a no-op
	if c.Process != nil {
		c.Process.Kill()
	}
	log.Printf("[Simulators] Stopped %s", name)
}

func (m *simManager) setEnabled(name string, enabled bool, port int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if enabled {
		if _, running := m.procs[name]; !running {
			m.spawn(name, port)
		}
	} else {
		m.kill(name)
	}
}

// status builds one list entry; sims is config.simulators as stored.
func (m *simManager) status(name string, sims *OMap) *OMap {
	meta := simCatalog[name]
	enabled, port := simNormalize(sims.Get(name))
	if port == 0 {
		port = meta.port
	}
	o := NewOMap()
	o.Set("name", name)
	o.Set("description", meta.desc)
	o.Set("script", "scripts/"+meta.script)
	o.Set("port", port)
	o.Set("enabled", enabled)
	m.mu.Lock()
	c, running := m.procs[name]
	m.mu.Unlock()
	o.Set("running", running)
	if running && c.Process != nil {
		o.Set("pid", c.Process.Pid)
	}
	return o
}

func (s *Server) simulatorsRoutes(api *http.ServeMux) {
	m := s.sims()
	// Boot: start any simulator already enabled in config (Node's start()).
	bootSims := omap(readConfigOrdered(s.configPath()).Get("simulators"))
	for _, name := range simOrder {
		if en, port := simNormalize(bootSims.Get(name)); en {
			m.mu.Lock()
			m.spawn(name, port)
			m.mu.Unlock()
		}
	}

	api.HandleFunc("GET /api/simulators", s.admin(func(w http.ResponseWriter, r *http.Request) {
		sims := omap(readConfigOrdered(s.configPath()).Get("simulators"))
		list := []any{}
		for _, name := range simOrder {
			list = append(list, m.status(name, sims))
		}
		ok(w, list)
	}))

	api.HandleFunc("POST /api/simulators/{name}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if _, known := simCatalog[name]; !known {
			fail(w, 400, "Unknown simulator: "+name)
			return
		}
		body := readBody(r)
		enabled, isBool := body.Get("enabled").(bool)
		if !isBool {
			fail(w, 400, "Body must include enabled: true|false")
			return
		}
		cfg := readConfigOrdered(s.configPath())
		sims := omap(cfg.Get("simulators")).Clone()

		// Port: explicit body value, else the previously stored one, else default.
		port := 0
		if p := jsNumber(body.Get("port")); p > 0 {
			port = int(p)
		}
		if port == 0 {
			_, port = simNormalize(sims.Get(name))
		}

		m.setEnabled(name, enabled, port)

		entry := NewOMap()
		entry.Set("enabled", enabled)
		if port > 0 {
			entry.Set("port", port)
		}
		sims.Set(name, entry)
		cfg.Set("simulators", sims)
		if err := writeConfigFile(s.configPath(), cfg); err != nil {
			fail(w, 500, err.Error())
			return
		}
		ok(w, m.status(name, sims))
	}))
}
