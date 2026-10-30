package main

// Module host — Go port of src/module-host.js. Each integration runs exactly
// as before in its own Node process (src/module-worker.js, unchanged); only
// the parent side is Go. The channel is Node's own IPC: the child gets one
// end of a socketpair as NODE_CHANNEL_FD with JSON serialization, so
// process.send()/process.on('message') in the worker work untouched
// (newline-delimited JSON on the wire).
//
// Watchdog as in Node: ping every 10 s, kill after 30 s without a pong or
// over the memory limit, restart with backoff 2 s → 2 min (reset after
// 5 min up). A module that can't even load (exit 2 + fatal) isn't retried.

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const (
	pingEvery      = 10 * time.Second
	hangAfter      = 30 * time.Second
	backoffMin     = 2 * time.Second
	backoffMax     = 2 * time.Minute
	stableAfter    = 5 * time.Minute
	commandTimeout = 30 * time.Second
)

type Integration struct {
	File      string  `json:"file"`
	Label     string  `json:"label"`
	Expose    *string `json:"expose"`
	On        bool    `json:"on"`
	Installed bool    `json:"installed"`
}

type ModuleHost struct {
	root        string
	node        string
	store       *Store
	reg         *Registry
	ps          *PlatformStatus
	config      func() (map[string]any, error)
	memoryLimit uint64

	mu       sync.Mutex
	modules  map[string]*ModuleProcess
	order    []string
	stopping bool
}

type ModuleProcess struct {
	host *ModuleHost
	it   Integration

	mu         sync.Mutex
	cmd        *exec.Cmd
	conn       net.Conn
	enc        *json.Encoder
	state      string
	restarts   int
	startedAt  time.Time
	lastExit   map[string]any
	lastPong   time.Time
	rss, heap  float64
	devices    map[string]bool
	platforms  map[string]bool
	subscribed bool
	fatal      string
	pend       map[int]chan ipcMsg
	seq        int
	backoff    time.Duration
	wanted     bool
	timer      *time.Timer
	exited     chan struct{}
}

type ipcMsg struct {
	T        string          `json:"t"`
	K        string          `json:"k,omitempty"`
	V        json.RawMessage `json:"v,omitempty"`
	Device   map[string]any  `json:"device,omitempty"`
	Writable bool            `json:"writable,omitempty"`
	All      map[string]bool `json:"all,omitempty"`
	ID       int             `json:"id,omitempty"`
	OK       bool            `json:"ok,omitempty"`
	Value    json.RawMessage `json:"value,omitempty"`
	Error    string          `json:"error,omitempty"`
	RSS      float64         `json:"rss,omitempty"`
	Heap     float64         `json:"heap,omitempty"`
	Cmd      string          `json:"cmd,omitempty"` // Node-internal messages (NODE_*)
}

func NewModuleHost(root, node string, store *Store, reg *Registry, ps *PlatformStatus, config func() (map[string]any, error), memoryLimitMB float64) *ModuleHost {
	h := &ModuleHost{root: root, node: node, store: store, reg: reg, ps: ps, config: config, modules: map[string]*ModuleProcess{}}
	if memoryLimitMB > 0 {
		h.memoryLimit = uint64(memoryLimitMB * 1048576)
	}
	// values set anywhere else reach the modules that listen for changes
	store.OnChange(func(c Change) {
		h.mu.Lock()
		mods := make([]*ModuleProcess, 0, len(h.modules))
		for _, m := range h.modules {
			mods = append(mods, m)
		}
		h.mu.Unlock()
		for _, m := range mods {
			if m == c.From {
				continue
			}
			m.mu.Lock()
			sub := m.subscribed && m.enc != nil
			m.mu.Unlock()
			if sub {
				m.send(map[string]any{"t": "chg", "k": c.Key, "v": c.Value, "ts": store.Timestamp(c.Key)})
			}
		}
	})
	go func() {
		for range time.Tick(pingEvery) {
			h.mu.Lock()
			mods := make([]*ModuleProcess, 0, len(h.modules))
			for _, m := range h.modules {
				mods = append(mods, m)
			}
			h.mu.Unlock()
			for _, m := range mods {
				m.ping()
			}
		}
	}()
	return h
}

func (h *ModuleHost) Add(it Integration) *ModuleProcess {
	m := &ModuleProcess{host: h, it: it, state: "stopped", backoff: backoffMin, devices: map[string]bool{}, platforms: map[string]bool{}, pend: map[int]chan ipcMsg{}}
	h.mu.Lock()
	h.modules[it.File] = m
	h.order = append(h.order, it.File)
	h.mu.Unlock()
	m.Start()
	return m
}

func (h *ModuleHost) Get(id string) *ModuleProcess {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.modules[id]
}

func (h *ModuleHost) List() []map[string]any {
	h.mu.Lock()
	ids := append([]string(nil), h.order...)
	h.mu.Unlock()
	out := []map[string]any{}
	for _, id := range ids {
		out = append(out, h.Get(id).Info())
	}
	return out
}

func (h *ModuleHost) StopAll() {
	h.mu.Lock()
	h.stopping = true
	mods := make([]*ModuleProcess, 0, len(h.modules))
	for _, m := range h.modules {
		mods = append(mods, m)
	}
	h.mu.Unlock()
	var wg sync.WaitGroup
	for _, m := range mods {
		wg.Add(1)
		go func() { defer wg.Done(); m.Stop() }()
	}
	wg.Wait()
}

func (m *ModuleProcess) send(v any) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.enc == nil {
		return errors.New("not running")
	}
	return m.enc.Encode(v) // Encode appends the '\n' Node's JSON channel frames on
}

func (m *ModuleProcess) Start() {
	m.mu.Lock()
	m.wanted = true
	if m.cmd != nil {
		m.mu.Unlock()
		return
	}
	if m.timer != nil {
		m.timer.Stop()
	}
	m.mu.Unlock()

	config, err := m.host.config()
	if err != nil {
		log.Printf("[Modules] %s: reading config failed: %v", m.it.Label, err)
		return
	}
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		log.Printf("[Modules] %s: socketpair: %v", m.it.Label, err)
		return
	}
	parentF, childF := os.NewFile(uintptr(fds[0]), "ipc-parent"), os.NewFile(uintptr(fds[1]), "ipc-child")
	conn, err := net.FileConn(parentF)
	parentF.Close()
	if err != nil {
		childF.Close()
		log.Printf("[Modules] %s: ipc: %v", m.it.Label, err)
		return
	}

	cmd := exec.Command(m.host.node, filepath.Join(m.host.root, "src", "module-worker.js"), m.it.File)
	cmd.Dir = m.host.root
	cmd.ExtraFiles = []*os.File{childF} // fd 3
	cmd.Env = append(os.Environ(), "NODE_CHANNEL_FD=3", "NODE_CHANNEL_SERIALIZATION_MODE=json", "LSH_MODULE="+m.it.File)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		childF.Close()
		conn.Close()
		log.Printf("[Modules] %s: start failed: %v", m.it.Label, err)
		return
	}
	childF.Close()

	m.mu.Lock()
	m.cmd, m.conn, m.enc = cmd, conn, json.NewEncoder(conn)
	m.state, m.startedAt, m.lastPong = "starting", time.Now(), time.Now()
	m.subscribed, m.fatal = false, ""
	m.exited = make(chan struct{})
	m.mu.Unlock()

	// the module's own lines go to our log, as Node's host printed them
	for _, r := range []interface{ Read([]byte) (int, error) }{stdout, stderr} {
		go func() {
			sc := bufio.NewScanner(r)
			sc.Buffer(make([]byte, 64*1024), 1<<20)
			for sc.Scan() {
				if l := sc.Text(); l != "" {
					log.Print(l)
				}
			}
		}()
	}
	go m.readLoop(conn)
	go func() {
		err := cmd.Wait()
		m.onExit(cmd, err)
	}()

	m.send(map[string]any{"t": "init", "file": m.it.File, "label": m.it.Label, "config": config, "snapshot": m.host.store.Snapshot()})
	log.Printf("[Modules] %s started (pid %d)", m.it.Label, cmd.Process.Pid)
}

func (m *ModuleProcess) readLoop(conn net.Conn) {
	dec := json.NewDecoder(bufio.NewReaderSize(conn, 256*1024))
	for {
		var msg ipcMsg
		if err := dec.Decode(&msg); err != nil {
			return
		}
		m.onMessage(msg)
	}
}

func decodeAny(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var v any
	json.Unmarshal(raw, &v)
	return v
}

func (m *ModuleProcess) onMessage(msg ipcMsg) {
	switch msg.T {
	case "set":
		m.host.store.SetFrom(msg.K, decodeAny(msg.V), m)
	case "dev":
		m.device(msg.Device, msg.Writable)
	case "ps":
		m.mu.Lock()
		for name := range msg.All {
			m.platforms[name] = true
		}
		m.mu.Unlock()
		for name, ok := range msg.All {
			m.host.ps.Set(name, ok)
		}
	case "sub":
		m.mu.Lock()
		m.subscribed = true
		m.mu.Unlock()
	case "ready":
		m.mu.Lock()
		m.state = "running"
		m.mu.Unlock()
	case "pong":
		m.mu.Lock()
		m.lastPong, m.rss, m.heap = time.Now(), msg.RSS, msg.Heap
		m.mu.Unlock()
	case "res":
		m.mu.Lock()
		ch := m.pend[msg.ID]
		delete(m.pend, msg.ID)
		m.mu.Unlock()
		if ch != nil {
			ch <- msg
		}
	case "fatal":
		m.mu.Lock()
		m.fatal = msg.Error
		m.mu.Unlock()
	}
}

func (m *ModuleProcess) device(d map[string]any, writable bool) {
	key, _ := d["key"].(string)
	if key == "" {
		return
	}
	m.mu.Lock()
	m.devices[key] = true
	m.mu.Unlock()
	var w Writer
	if writable {
		w = func(args []any) (any, error) { return m.Write(key, args) }
	}
	if m.host.reg.Has(key) {
		m.host.reg.Refresh(d, w)
	} else {
		m.host.reg.Register(d, w)
	}
}

// Write asks the process to run one of its devices' _writeCapability.
func (m *ModuleProcess) Write(key string, args []any) (any, error) {
	m.mu.Lock()
	if m.enc == nil || m.state != "running" {
		st := m.state
		m.mu.Unlock()
		return nil, fmt.Errorf("%s is not running (%s)", m.it.Label, st)
	}
	m.seq++
	id := m.seq
	ch := make(chan ipcMsg, 1)
	m.pend[id] = ch
	m.mu.Unlock()
	if err := m.send(map[string]any{"t": "write", "id": id, "key": key, "args": args}); err != nil {
		return nil, err
	}
	select {
	case res := <-ch:
		if !res.OK {
			return nil, errors.New(res.Error)
		}
		return decodeAny(res.Value), nil
	case <-time.After(commandTimeout):
		m.mu.Lock()
		delete(m.pend, id)
		m.mu.Unlock()
		return nil, fmt.Errorf("%s did not answer the command in time", m.it.Label)
	}
}

func (m *ModuleProcess) kill(reason string) {
	m.mu.Lock()
	m.lastExit = map[string]any{"at": nowMs(), "reason": reason}
	cmd := m.cmd
	m.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		cmd.Process.Kill()
	}
}

func (m *ModuleProcess) ping() {
	m.mu.Lock()
	running := m.cmd != nil
	silent := time.Since(m.lastPong)
	rss := m.rss
	m.mu.Unlock()
	if !running {
		return
	}
	if silent > hangAfter {
		log.Printf("[Modules] %s not responding for %d s — killing it", m.it.Label, int(silent.Seconds()))
		m.kill("hung")
		return
	}
	if lim := m.host.memoryLimit; lim > 0 && uint64(rss) > lim {
		log.Printf("[Modules] %s uses %d MB (limit %d MB) — restarting it", m.it.Label, uint64(rss)/1048576, lim/1048576)
		m.kill("memory")
		return
	}
	m.send(map[string]any{"t": "ping", "n": nowMs()})
}

func (m *ModuleProcess) Stop() {
	m.mu.Lock()
	m.wanted = false
	if m.timer != nil {
		m.timer.Stop()
	}
	cmd, exited := m.cmd, m.exited
	if cmd == nil {
		m.state = "stopped"
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	if m.send(map[string]any{"t": "stop"}) != nil {
		cmd.Process.Signal(syscall.SIGTERM)
	}
	select {
	case <-exited:
	case <-time.After(3 * time.Second):
		cmd.Process.Kill()
		<-exited
	}
}

func (m *ModuleProcess) Restart(reason string) {
	log.Printf("[Modules] %s restarting (%s)", m.it.Label, reason)
	m.Stop()
	m.mu.Lock()
	m.backoff = backoffMin
	m.mu.Unlock()
	m.Start()
}

func (m *ModuleProcess) onExit(cmd *exec.Cmd, waitErr error) {
	code, signal := cmd.ProcessState.ExitCode(), ""
	if ws, ok := cmd.ProcessState.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		signal = ws.Signal().String()
	}
	m.mu.Lock()
	m.conn.Close()
	m.cmd, m.conn, m.enc = nil, nil, nil
	for id, ch := range m.pend {
		ch <- ipcMsg{T: "res", ID: id, Error: m.it.Label + " stopped"}
	}
	m.pend = map[int]chan ipcMsg{}
	platforms := make([]string, 0, len(m.platforms))
	for p := range m.platforms {
		platforms = append(platforms, p)
	}
	uptime := time.Since(m.startedAt)
	if m.lastExit == nil || m.lastExit["at"].(int64) < m.startedAt.UnixMilli() {
		reason := fmt.Sprintf("exit %d", code)
		if signal != "" {
			reason = "signal " + signal
		}
		m.lastExit = map[string]any{"at": nowMs(), "reason": reason}
	}
	m.lastExit["code"], m.lastExit["signal"] = code, signal
	close(m.exited)
	m.host.mu.Lock()
	stopping := m.host.stopping
	m.host.mu.Unlock()
	var delay time.Duration
	switch {
	case !m.wanted || stopping:
		m.state = "stopped"
	case code == 2 && m.fatal != "":
		m.state = "failed"
		log.Printf("[Modules] %s can't load — not restarting: %s", m.it.Label, m.fatal)
	default:
		if uptime > stableAfter {
			m.backoff = backoffMin
		}
		delay = m.backoff
		m.backoff = min(m.backoff*2, backoffMax)
		m.restarts++
		m.state = "restarting"
		log.Printf("[Modules] %s exited (%v) after %d s — restart in %d s", m.it.Label, m.lastExit["reason"], int(uptime.Seconds()), int(delay.Seconds()))
		m.timer = time.AfterFunc(delay, m.Start)
	}
	m.mu.Unlock()
	for _, p := range platforms {
		m.host.ps.Set(p, false)
	}
}

func (m *ModuleProcess) Info() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	info := map[string]any{
		"id": m.it.File, "label": m.it.Label, "state": m.state, "pid": nil, "uptime": 0,
		"restarts": m.restarts, "lastExit": m.lastExit, "rss": nil, "heap": nil, "devices": len(m.devices),
	}
	if m.cmd != nil && m.cmd.Process != nil {
		info["pid"] = m.cmd.Process.Pid
		info["uptime"] = time.Since(m.startedAt).Milliseconds()
	}
	if m.rss > 0 {
		info["rss"], info["heap"] = m.rss, m.heap
	}
	if m.state == "failed" {
		info["error"] = m.fatal
	}
	return info
}
