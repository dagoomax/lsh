// LSH core in Go — store, device registry, auth, REST, Socket.IO and the
// module host. Integrations are the unchanged Node clients, each in its own
// src/module-worker.js process (see modules.go).
//
//	go build -o lsh-core . && ./lsh-core -root .. -port 3002
//
// It reads the LSH checkout's config.json, persist/users.json,
// persist/api-tokens.json and persist/device-overrides.json, and keeps its
// own store snapshot (-data), seeded from persist/store-data.json.gz on the
// first start, so it can run next to the Node core during the migration.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

type bootInfo struct {
	Config       map[string]any  `json:"config"`
	Integrations []Integration   `json:"integrations"`
	DeviceTypes  json.RawMessage `json:"deviceTypes"`
}

// loadBoot asks Node for config.js's effective config and which
// integrations' `when` predicates match it.
func loadBoot(node, root string) (*bootInfo, error) {
	out, err := exec.Command(node, filepath.Join(root, "core-go", "node", "integrations.js"), root).Output()
	if err != nil {
		return nil, fmt.Errorf("integrations helper: %w", err)
	}
	var b bootInfo
	if err := json.Unmarshal(out, &b); err != nil {
		return nil, err
	}
	return &b, nil
}

var started = time.Now()

func coreInfo(s *Server) map[string]any {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return map[string]any{
		"impl": "go", "goVersion": runtime.Version(), "uptime": time.Since(started).Milliseconds(),
		"heapAlloc": ms.HeapAlloc, "sys": ms.Sys, "goroutines": runtime.NumGoroutine(),
		"devices": s.reg.Count(), "sockets": s.sio.Count(), "modules": len(s.host.List()),
	}
}

func main() {
	root := flag.String("root", "..", "LSH checkout (config.json, persist/, src/, react-dashboard/dist)")
	port := flag.Int("port", 3002, "HTTP port")
	dataDir := flag.String("data", "", "where this core keeps its store snapshot (default <root>/core-go/data)")
	nodeBin := flag.String("node", "node", "node binary for the integration processes")
	automations := flag.String("automations", "", "automations.json this core runs and edits (default <data>/automations.json, seeded from <root>/automations.json)")
	modules := flag.String("modules", "all", `"all" (every configured integration), "none", or a comma list of src/ file names or .js paths`)
	flag.Parse()

	abs, err := filepath.Abs(*root)
	if err != nil {
		log.Fatal(err)
	}
	*root = abs
	if *dataDir == "" {
		*dataDir = filepath.Join(*root, "core-go", "data")
	}
	persistDir := filepath.Join(*root, "persist")
	log.SetFlags(log.Ldate | log.Ltime)

	boot, err := loadBoot(*nodeBin, *root)
	if err != nil {
		log.Fatalf("[Server] %v", err)
	}

	store := NewStore(filepath.Join(*dataDir, "store-data.json.gz"))
	store.Load(filepath.Join(persistDir, "store-data.json.gz"))
	store.StartPersistence()

	reg := NewRegistry(store, filepath.Join(persistDir, "device-overrides.json"))
	if types, ok := rawOrdered(boot.DeviceTypes).(*OMap); ok {
		reg.SetDeviceTypes(types)
	}
	ps := NewPlatformStatus()
	secret, _ := boot.Config["jwtSecret"].(string)
	auth := NewAuth(persistDir, secret)

	memMB := 512.0
	if m, ok := boot.Config["modules"].(map[string]any); ok {
		if v, ok := m["memoryLimitMB"].(float64); ok {
			memMB = v
		}
	}
	// A restarted module gets config.json as it is now, like the Node host.
	freshConfig := func() (map[string]any, error) {
		b, err := loadBoot(*nodeBin, *root)
		if err != nil {
			return boot.Config, nil
		}
		return b.Config, nil
	}
	host := NewModuleHost(*root, *nodeBin, store, reg, ps, freshConfig, memMB)

	victron := NewVictron(boot.Config, store, ps)
	relays := &Relays{cfg: func() map[string]any { return boot.Config }, store: store, victron: victron}
	srv := &Server{root: *root, store: store, reg: reg, ps: ps, auth: auth, host: host, victron: victron, relays: relays}
	srv.sio = NewSocketIO(srv.sioAuthorize, srv.sioConnect)
	srv.wireEvents()

	if *automations == "" {
		*automations = filepath.Join(*dataDir, "automations.json")
		if _, err := os.Stat(*automations); err != nil {
			if b, err := os.ReadFile(filepath.Join(*root, "automations.json")); err == nil {
				os.MkdirAll(*dataDir, 0o755)
				os.WriteFile(*automations, b, 0o644)
			}
		}
	}
	srv.auto = NewAutomation(store, reg, boot.Config, *automations, *dataDir, srv.sio.Emit)
	srv.auto.relays = relays
	srv.auto.Start()
	victron.Start()

	// integrations server.js starts inline: Loxone In as a module process;
	// Loxone Out / Fibaro Out are Go (loxone_out.go, fibaro_out.go)
	boot.Integrations = append(boot.Integrations, loxoneInModule(boot.Config, *root), smartThingsModule(boot.Config, *root))
	srv.applyOutBridges(boot.Config, "")
	for _, it := range selectModules(*modules, boot.Integrations) {
		host.Add(it)
	}

	srv.deliverSmartThingsToken(boot.Config)

	httpSrv := &http.Server{Addr: fmt.Sprintf(":%d", *port), Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("[Server] LSH Go core on http://localhost:%d (root %s)", *port, *root)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Server] %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	s := <-sig
	log.Printf("[Store] %v received — saving before exit", s)
	go func() { <-sig; os.Exit(1) }() // a second signal forces it
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	httpSrv.Shutdown(ctx)
	cancel()
	srv.auto.Stop()
	victron.Stop()
	srv.out.mu.Lock()
	if srv.out.loxoneOut != nil {
		srv.out.loxoneOut.Stop()
	}
	if srv.out.fibaroOut != nil {
		srv.out.fibaroOut.Stop()
	}
	srv.out.mu.Unlock()
	host.StopAll()
	if n, err := store.Persist(); err != nil {
		log.Printf("[Store] Persist failed: %v", err)
	} else {
		log.Printf("[Store] Saved on shutdown (%d kB)", n/1024)
	}
}

func selectModules(spec string, all []Integration) []Integration {
	var out []Integration
	switch spec {
	case "none", "":
		return nil
	case "all":
		for _, it := range all {
			if !it.On {
				continue
			}
			if !it.Installed {
				log.Printf("[Server] Optional module unavailable: ./src/%s (file not installed)", it.File)
				continue
			}
			out = append(out, it)
		}
		return out
	}
	byFile := map[string]Integration{}
	for _, it := range all {
		byFile[it.File] = it
	}
	for _, name := range strings.Split(spec, ",") {
		name = strings.TrimSpace(name)
		if it, ok := byFile[name]; ok {
			out = append(out, it)
		} else if strings.HasSuffix(name, ".js") {
			p, _ := filepath.Abs(name)
			out = append(out, Integration{File: p, Label: strings.TrimSuffix(filepath.Base(p), ".js"), On: true, Installed: true})
		} else {
			log.Printf("[Server] Unknown module %q", name)
		}
	}
	return out
}
