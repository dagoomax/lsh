package main

// Automation engine — Go port of src/automation-engine.js: rules, scenes,
// notifications and Node-RED-style flows, on the same automations.json.
//
// Rule:   { id, name, enabled, trigger: { key, op, value }, actions, cooldownSeconds }
//         op: > < >= <= == != (edge-triggered: false→true) | changes (every update)
// Scene:  { id, name, icon, actions }
// Action: device | relay | notify | scene | page
// Flow:   { id, name, enabled, nodes: [{ id, type, config, wires: [[targetId…]…] }] }
//
// A store change (every update, repeats included — as in Node) is checked
// against rule and `trigger` node conditions; `time` and `mqttIn` nodes are
// entry points too. A node runs, then each wired downstream node gets a copy
// of its output message. Ordering follows Node's un-awaited promises: a node
// that never waits runs right away, in wire order (so two scene generators
// or a global set/get pair behave the same every time); one that waits
// (delay, http, device commands) continues on its own goroutine. Depth is
// capped at 50. Comparisons and templates follow JavaScript's
// Number()/String() rules (jsval.go) so existing flows behave the same.
//
// Objects (rules, scenes, flows, messages) stay ordered maps so
// automations.json round-trips byte-for-byte in key order.

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

var triggerTypes = map[string]bool{"trigger": true, "time": true, "mqttIn": true}

// Node types that wait on something (timer, network, a module process).
var waits = map[string]bool{"delay": true, "http": true, "device": true, "virtual": true, "sync": true, "scene": true}

const (
	maxNotifications     = 200
	maxSnapshotBytes     = 8 * 1024 * 1024
	maxTextResponseBytes = 3 * 1024 * 1024
	httpUserAgent        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
	flowDepthCap         = 50
)

// Content-Type → extension for the http node's saveAs (jpg when unknown).
var saveAsTypes = []struct {
	ext, mime string
	match     *regexp.Regexp
}{
	{"jpg", "image/jpeg", regexp.MustCompile(`(?i)image/jpe?g`)},
	{"png", "image/png", regexp.MustCompile(`(?i)image/png`)},
	{"xml", "application/xml; charset=utf-8", regexp.MustCompile(`(?i)[+/]xml`)},
	{"zip", "application/zip", regexp.MustCompile(`(?i)\bzip\b`)},
	{"json", "application/json; charset=utf-8", regexp.MustCompile(`(?i)json`)},
	{"pdf", "application/pdf", regexp.MustCompile(`(?i)pdf`)},
	{"txt", "text/plain; charset=utf-8", regexp.MustCompile(`(?i)^text/`)},
}

func extFromContentType(ct string) string {
	for _, t := range saveAsTypes {
		if t.match.MatchString(ct) {
			return t.ext
		}
	}
	return saveAsTypes[0].ext
}

func mimeForExt(ext string) string {
	e := strings.ToLower(strings.TrimPrefix(ext, "."))
	for _, t := range saveAsTypes {
		if t.ext == e {
			return t.mime
		}
	}
	return "application/octet-stream"
}

var ops = map[string]func(a, b any) bool{
	">":  func(a, b any) bool { return jsNumber(a) > jsNumber(b) },
	"<":  func(a, b any) bool { return jsNumber(a) < jsNumber(b) },
	">=": func(a, b any) bool { return jsNumber(a) >= jsNumber(b) },
	"<=": func(a, b any) bool { return jsNumber(a) <= jsNumber(b) },
	"==": func(a, b any) bool { return jsString(a) == jsString(b) || jsNumber(a) == jsNumber(b) },
	"!=": func(a, b any) bool { return jsString(a) != jsString(b) && jsNumber(a) != jsNumber(b) },
}

type ruleState struct {
	matched   bool
	lastFired int64
}

type mqttSub struct {
	flow *OMap
	node *OMap
}

type Automation struct {
	store  *Store
	reg    *Registry
	config map[string]any
	emit   func(event string, data any) // Socket.IO broadcast
	send   func(key, sensor string, value any) error
	relays *Relays // nil → "No data client connected", like a RelayController without a source

	file, snapshotsDir, loxoneDir string

	mu             sync.Mutex
	rules          []*OMap
	scenes         []*OMap
	flows          []*OMap
	notifications  []*OMap
	nextNotifID    int
	ruleState      map[string]*ruleState
	flowState      map[string]bool // flowId:nodeId → matched
	timers         map[string]chan struct{}
	flowDeviceKeys map[string]bool
	globals        map[string]any
	sceneListeners []func([]*OMap)

	mqttMu     sync.Mutex
	mqtt       mqtt.Client
	mqttSubs   map[string][]mqttSub
	mqttTopics map[string]bool

	http *http.Client
}

func NewAutomation(store *Store, reg *Registry, config map[string]any, file, dataDir string, emit func(string, any)) *Automation {
	return &Automation{
		store: store, reg: reg, config: config, emit: emit, file: file, send: reg.SendCommand,
		snapshotsDir: filepath.Join(dataDir, "flow-snapshots"), loxoneDir: filepath.Join(dataDir, "flow-loxone"),
		nextNotifID: 1, ruleState: map[string]*ruleState{}, flowState: map[string]bool{}, timers: map[string]chan struct{}{},
		flowDeviceKeys: map[string]bool{}, globals: map[string]any{}, mqttSubs: map[string][]mqttSub{}, mqttTopics: map[string]bool{},
		// 10 s to connect and get headers (Node's socket timeout); a big
		// scraped page then has a minute to arrive
		http: &http.Client{
			Timeout: 70 * time.Second,
			Transport: &http.Transport{
				Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 10 * time.Second, TLSHandshakeTimeout: 10 * time.Second,
				TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
			},
		},
	}
}

// ── small accessors over ordered maps ───────────────────────────────────────

// jget is obj.k with JS semantics: Undefined when the property is missing.
func jget(o *OMap, k string) any {
	if v, ok := o.Lookup(k); ok {
		return v
	}
	return Undefined
}

func cfgOf(node *OMap) *OMap {
	if c, ok := node.Get("config").(*OMap); ok {
		return c
	}
	return NewOMap()
}

func arr(v any) []any {
	a, _ := v.([]any)
	return a
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil, undefinedT:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	}
	return true
}

func idOf(o *OMap) string { return jsString(orEmpty(jget(o, "id"))) }

// resolveTemplate: exact "{value}" keeps the payload's type; {value}/{key}
// inside a string substitute text; anything else is a literal.
func resolveTemplate(value any, msg *OMap) any {
	if s, ok := value.(string); ok {
		if s == "{value}" {
			return jget(msg, "payload")
		}
		if strings.Contains(s, "{value}") || strings.Contains(s, "{key}") {
			return templateText(s, jget(msg, "payload"), jget(msg, "key"))
		}
	}
	return value
}

// sanitizeSnapshotName — alphanumerics, dash, underscore; can't escape the dir.
func sanitizeSnapshotName(name any) (string, error) {
	s := jsSlice(slugChars(jsString(orEmpty(name))), 100)
	if s == "" {
		return "", errors.New("saveAs must contain at least one valid character")
	}
	return s, nil
}

// slugChars is String(x).replace(/[^a-zA-Z0-9_-]/g, '_') — per UTF-16 code
// unit, so an emoji (a surrogate pair) becomes two underscores, like in Node.
func slugChars(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		case r > 0xFFFF:
			b.WriteString("__")
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}

// jsSlice is .slice(0, n) on an ASCII-only string.
func jsSlice(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func base36Now() string { return strconv.FormatInt(time.Now().UnixMilli(), 36) }

// ── lifecycle ───────────────────────────────────────────────────────────────

func (a *Automation) Start() {
	a.load()
	a.store.OnChange(func(c Change) { a.onChange(c.Key, c.Value) })
	a.setupTriggers()
	a.registerFlowDevices()
	a.mu.Lock()
	log.Printf("[Automation] Started — %d rule(s), %d scene(s), %d flow(s)", len(a.rules), len(a.scenes), len(a.flows))
	a.mu.Unlock()
}

func (a *Automation) Stop() {
	a.mu.Lock()
	for k, stop := range a.timers {
		close(stop)
		delete(a.timers, k)
	}
	a.mu.Unlock()
	a.mqttMu.Lock()
	if a.mqtt != nil {
		a.mqtt.Disconnect(250)
		a.mqtt = nil
	}
	a.mqttMu.Unlock()
}

// store/loxoneXml devices come back at startup, before their flow next runs.
func (a *Automation) registerFlowDevices() {
	a.mu.Lock()
	flows := append([]*OMap(nil), a.flows...)
	a.mu.Unlock()
	for _, flow := range flows {
		for _, n := range arr(flow.Get("nodes")) {
			node, ok := n.(*OMap)
			if !ok {
				continue
			}
			c := cfgOf(node)
			if !truthy(jget(c, "name")) {
				continue
			}
			switch node.Get("type") {
			case "store":
				a.registerFlowDevice(c, "flow")
			case "loxoneXml":
				a.registerFlowDevice(c, "flowloxone")
			}
		}
	}
}

func (a *Automation) load() {
	b, err := os.ReadFile(a.file)
	if err != nil {
		return
	}
	v, err := decodeOrdered(b)
	data, ok := v.(*OMap)
	if err != nil || !ok {
		log.Printf("[Automation] Failed to load automations.json: %v", err)
		return
	}
	toList := func(k string) []*OMap {
		out := []*OMap{}
		for _, x := range arr(data.Get(k)) {
			if o, ok := x.(*OMap); ok {
				out = append(out, o)
			}
		}
		return out
	}
	a.mu.Lock()
	a.rules, a.scenes, a.flows = toList("rules"), toList("scenes"), toList("flows")
	a.mu.Unlock()
}

// save writes JSON.stringify({rules, scenes, flows}, null, 2). Caller holds a.mu.
func (a *Automation) save() error {
	raw, err := marshalJS(OM("rules", a.rules, "scenes", a.scenes, "flows", a.flows))
	if err != nil {
		return err
	}
	var out bytes.Buffer
	if err := json.Indent(&out, raw, "", "  "); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(a.file), 0o755); err != nil {
		return err
	}
	tmp := a.file + ".tmp"
	if err := os.WriteFile(tmp, out.Bytes(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, a.file)
}

// ── time + MQTT triggers ────────────────────────────────────────────────────

func (a *Automation) setupTriggers() {
	a.mu.Lock()
	for k, stop := range a.timers {
		close(stop)
		delete(a.timers, k)
	}
	want := map[string]bool{}
	subs := map[string][]mqttSub{}
	for _, flow := range a.flows {
		if flow.Get("enabled") == false {
			continue
		}
		for _, n := range arr(flow.Get("nodes")) {
			node, ok := n.(*OMap)
			if !ok {
				continue
			}
			c := cfgOf(node)
			switch node.Get("type") {
			case "time":
				secs := jsNumber(jget(c, "intervalSeconds"))
				if math.IsNaN(secs) || secs == 0 {
					secs = 60
				}
				secs = math.Max(1, secs)
				stop := make(chan struct{})
				a.timers[idOf(flow)+":"+idOf(node)] = stop
				go func(flow, node *OMap, every time.Duration) {
					t := time.NewTicker(every)
					defer t.Stop()
					for {
						select {
						case <-t.C:
							go a.propagate(flow, node, OM("payload", float64(time.Now().UnixMilli()), "source", "flow:"+jsString(flow.Get("name"))), 0)
						case <-stop:
							return
						}
					}
				}(flow, node, time.Duration(secs*float64(time.Second)))
			case "mqttIn":
				if topic, ok := c.Get("topic").(string); ok && topic != "" {
					want[topic] = true
					subs[topic] = append(subs[topic], mqttSub{flow, node})
				}
			}
		}
	}
	a.mu.Unlock()
	a.mqttMu.Lock()
	a.mqttSubs = subs
	a.mqttMu.Unlock()
	a.syncMqtt(want)
}

// sharedBroker — src/mqtt-target.js: LSH's built-in broker when enabled,
// else config.mqtt.
func sharedBroker(config map[string]any) (host string, port int, user, pass string, ok bool) {
	num := func(v any, def int) int {
		if n := jsNumber(v); !math.IsNaN(n) && n != 0 {
			return int(n)
		}
		return def
	}
	if b, _ := config["mqttBroker"].(map[string]any); b != nil && truthy(b["enabled"]) {
		u, _ := b["username"].(string)
		p, _ := b["password"].(string)
		if u == "" {
			p = ""
		}
		return "127.0.0.1", num(b["port"], 1883), u, p, true
	}
	m, _ := config["mqtt"].(map[string]any)
	h, _ := m["host"].(string)
	if h == "" {
		return "", 0, "", "", false
	}
	u, _ := m["username"].(string)
	p, _ := m["password"].(string)
	return h, num(m["port"], 1883), u, p, true
}

func (a *Automation) ensureMqtt() mqtt.Client {
	a.mqttMu.Lock()
	defer a.mqttMu.Unlock()
	if a.mqtt != nil {
		return a.mqtt
	}
	host, port, user, pass, ok := sharedBroker(a.config)
	if !ok {
		return nil
	}
	opts := mqtt.NewClientOptions().AddBroker(fmt.Sprintf("tcp://%s:%d", host, port)).
		SetClientID("lsh-go-automation-" + base36Now()).
		SetConnectTimeout(8 * time.Second).SetConnectRetry(true).SetConnectRetryInterval(5 * time.Second).
		SetAutoReconnect(true).SetMaxReconnectInterval(5 * time.Second)
	if user != "" {
		opts.SetUsername(user).SetPassword(pass)
	}
	opts.SetOnConnectHandler(func(c mqtt.Client) {
		a.mqttMu.Lock()
		topics := make([]string, 0, len(a.mqttTopics))
		for t := range a.mqttTopics {
			topics = append(topics, t)
		}
		a.mqttMu.Unlock()
		for _, t := range topics {
			c.Subscribe(t, 0, nil)
		}
	})
	opts.SetConnectionLostHandler(func(_ mqtt.Client, err error) { log.Printf("[Automation] MQTT: %v", err) })
	// Exact topic lookup, as in Node: a wildcard subscription receives but
	// never matches a flow.
	opts.SetDefaultPublishHandler(func(_ mqtt.Client, m mqtt.Message) {
		a.mqttMu.Lock()
		subs := a.mqttSubs[m.Topic()]
		a.mqttMu.Unlock()
		for _, s := range subs {
			go a.propagate(s.flow, s.node, OM("payload", string(m.Payload()), "topic", m.Topic(), "source", "flow:"+jsString(s.flow.Get("name"))), 0)
		}
	})
	a.mqtt = mqtt.NewClient(opts)
	a.mqtt.Connect()
	return a.mqtt
}

func (a *Automation) syncMqtt(want map[string]bool) {
	if len(want) == 0 {
		a.mqttMu.Lock()
		if a.mqtt != nil {
			for t := range a.mqttTopics {
				a.mqtt.Unsubscribe(t)
			}
		}
		a.mqttTopics = map[string]bool{}
		a.mqttMu.Unlock()
		return
	}
	client := a.ensureMqtt()
	if client == nil {
		log.Printf("[Automation] MQTT node(s) present but no MQTT broker configured — skipping")
		return
	}
	a.mqttMu.Lock()
	defer a.mqttMu.Unlock()
	for t := range a.mqttTopics {
		if !want[t] {
			client.Unsubscribe(t)
		}
	}
	for t := range want {
		if !a.mqttTopics[t] && client.IsConnectionOpen() {
			client.Subscribe(t, 0, nil)
		}
	}
	a.mqttTopics = want
}

// ── HTTP ────────────────────────────────────────────────────────────────────

func (a *Automation) httpRequest(method, rawURL string, body *string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("Invalid URL")
	}
	var rd io.Reader
	if body != nil {
		rd = strings.NewReader(*body)
	}
	req, err := http.NewRequest(method, u.String(), rd)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", httpUserAgent)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := a.http.Do(req)
	if err != nil {
		if os.IsTimeout(err) || strings.Contains(err.Error(), "timeout") {
			return "", errors.New("Timeout")
		}
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, maxTextResponseBytes+1))
	if len(raw) == 0 {
		return fmt.Sprintf("HTTP %d", res.StatusCode), nil
	}
	return string(raw), nil
}

func (a *Automation) httpRequestBuffer(method, rawURL string) ([]byte, string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, "", errors.New("Invalid URL")
	}
	req, err := http.NewRequest(method, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", httpUserAgent)
	res, err := a.http.Do(req)
	if err != nil {
		if os.IsTimeout(err) || strings.Contains(err.Error(), "timeout") {
			return nil, "", errors.New("Timeout")
		}
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		io.Copy(io.Discard, res.Body)
		return nil, "", fmt.Errorf("HTTP %d", res.StatusCode)
	}
	buf, err := io.ReadAll(io.LimitReader(res.Body, maxSnapshotBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(buf) > maxSnapshotBytes {
		return nil, "", errors.New("Response too large (>8MB)")
	}
	return buf, res.Header.Get("Content-Type"), nil
}

// ── flow devices (store / loxoneXml) ────────────────────────────────────────

func (a *Automation) registerFlowDevice(c *OMap, namespace string) string {
	slug := jsSlice(slugChars(jsString(c.Get("name"))), 60)
	if slug == "" {
		slug = "value"
	}
	key := namespace + "/" + slug
	a.mu.Lock()
	done := a.flowDeviceKeys[key]
	a.flowDeviceKeys[key] = true
	a.mu.Unlock()
	if done {
		return key
	}
	sensor := OM("path", "value", "name", "Value")
	switch c.Get("kind") {
	case "boolean":
		sensor.Set("sensorType", "switch")
		sensor.Set("format", "on-off")
	case "text":
		sensor.Set("raw", true)
	default:
		finite := func(v any, def float64) float64 {
			if f, ok := v.(float64); ok && !math.IsNaN(f) && !math.IsInf(f, 0) {
				return f
			}
			return def
		}
		unit := c.Get("unit")
		if !truthy(unit) {
			unit = ""
		}
		sensor.Set("type", "range")
		sensor.Set("unit", unit)
		sensor.Set("min", finite(c.Get("min"), -1000000))
		sensor.Set("max", finite(c.Get("max"), 1000000))
	}
	icon := c.Get("icon")
	if !truthy(icon) {
		icon = "🧵"
		if namespace == "flowloxone" {
			icon = "🧾"
		}
	}
	d := OM("key", key, "label", c.Get("name"), "type", "flow", "icon", icon)
	if color := c.Get("color"); truthy(color) {
		d.Set("color", color)
	}
	d.Set("homekit", []any{})
	d.Set("sensors", []any{sensor})
	a.reg.Register(d, nil)
	return key
}

// ── rules ───────────────────────────────────────────────────────────────────

func (a *Automation) onChange(key string, value any) {
	type flowFire struct {
		flow, node *OMap
	}
	var rules []*OMap
	var flowFires []flowFire
	a.mu.Lock()
	for _, rule := range a.rules {
		trig, _ := rule.Get("trigger").(*OMap)
		if !truthy(rule.Get("enabled")) || trig == nil || trig.Get("key") != key {
			continue
		}
		if a.evaluate(rule, trig, value) {
			rules = append(rules, rule)
		}
	}
	for _, flow := range a.flows {
		if flow.Get("enabled") == false {
			continue
		}
		for _, n := range arr(flow.Get("nodes")) {
			node, ok := n.(*OMap)
			if !ok || node.Get("type") != "trigger" {
				continue
			}
			c := cfgOf(node)
			if c.Get("key") != key {
				continue
			}
			op := c.Get("op")
			if !truthy(op) {
				op = "changes"
			}
			fire := false
			if op == "changes" {
				fire = true
			} else {
				cmp, ok := ops[jsString(op)]
				if !ok {
					continue
				}
				skey := idOf(flow) + ":" + idOf(node)
				matched := cmp(value, jget(c, "value"))
				fire = matched && !a.flowState[skey]
				a.flowState[skey] = matched
			}
			if fire {
				flowFires = append(flowFires, flowFire{flow, node})
			}
		}
	}
	a.mu.Unlock()
	for _, rule := range rules {
		log.Printf("[Automation] Rule fired: %s (%s = %s)", jsString(rule.Get("name")), key, jsString(value))
		go a.RunActions(arr(rule.Get("actions")), OM("key", key, "value", value, "source", "rule:"+jsString(rule.Get("name"))))
	}
	for _, f := range flowFires {
		a.propagate(f.flow, f.node, OM("payload", value, "key", key, "source", "flow:"+jsString(f.flow.Get("name"))), 0)
	}
}

// evaluate decides whether a rule fires now. Caller holds a.mu.
func (a *Automation) evaluate(rule, trig *OMap, value any) bool {
	id := idOf(rule)
	st := a.ruleState[id]
	if st == nil {
		st = &ruleState{}
	}
	fire := false
	if op := trig.Get("op"); op == "changes" {
		fire = true
	} else {
		cmp, ok := ops[jsString(op)]
		if !ok {
			return false
		}
		matched := cmp(value, jget(trig, "value"))
		fire = matched && !st.matched
		st.matched = matched
	}
	cooldown := jsNumber(rule.Get("cooldownSeconds"))
	if math.IsNaN(cooldown) {
		cooldown = 0
	}
	now := time.Now().UnixMilli()
	fired := false
	if fire && float64(now-st.lastFired) >= cooldown*1000 {
		st.lastFired = now
		fired = true
	}
	a.ruleState[id] = st
	return fired
}

// ── actions ─────────────────────────────────────────────────────────────────

func (a *Automation) RunActions(actions []any, ctx *OMap) {
	for _, x := range actions {
		action, _ := x.(*OMap)
		if action == nil {
			action = NewOMap()
		}
		if err := a.runAction(action, ctx); err != nil {
			log.Printf("[Automation] Action failed (%s): %v", jsString(jget(action, "type")), err)
			a.Notify("warning", "Action failed: "+err.Error(), ctx.Get("source"))
		}
	}
}

func (a *Automation) runAction(action, ctx *OMap) error {
	switch action.Get("type") {
	case "device":
		return a.send(jsString(orEmpty(jget(action, "deviceKey"))), jsString(orEmpty(jget(action, "sensor"))), jget(action, "value"))
	case "relay":
		return a.relays.SetState(jsNumber(jget(action, "index")), truthy(action.Get("on")))
	case "notify":
		level := action.Get("level")
		if !truthy(level) {
			level = "info"
		}
		a.Notify(jsString(level), templateText(jsString(orEmpty(action.Get("message"))), jget(ctx, "value"), jget(ctx, "key")), ctx.Get("source"))
	case "scene":
		if scene := a.sceneByID(action.Get("sceneId")); scene != nil {
			a.RunActions(arr(scene.Get("actions")), ctx)
		}
	case "page":
		return errors.New("Paging not enabled")
	default:
		return fmt.Errorf("Unknown action type: %s", jsString(jget(action, "type")))
	}
	return nil
}

func (a *Automation) sceneByID(id any) *OMap {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, s := range a.scenes {
		if s.Get("id") == id {
			return s
		}
	}
	return nil
}

// ── flows ───────────────────────────────────────────────────────────────────

func (a *Automation) propagate(flow, node *OMap, msg *OMap, depth int) {
	if depth > flowDepthCap {
		log.Printf("[Automation] Flow %q depth cap hit", jsString(flow.Get("name")))
		return
	}
	outputs, err := a.execNode(node, msg)
	if err != nil {
		// a failing node never stops other flows — log, notify, end this branch
		log.Printf("[Automation] Flow %q node %s (%s) failed: %v", jsString(flow.Get("name")), idOf(node), jsString(node.Get("type")), err)
		a.Notify("warning", fmt.Sprintf("Flow %q: %s node failed — %s", jsString(flow.Get("name")), jsString(node.Get("type")), err), msg.Get("source"))
		return
	}
	wires := arr(node.Get("wires"))
	nodes := arr(flow.Get("nodes"))
	for port, out := range outputs {
		if out == nil || port >= len(wires) {
			continue
		}
		for _, tid := range arr(wires[port]) {
			for _, n := range nodes {
				if t, ok := n.(*OMap); ok && t.Get("id") == tid {
					if waits[jsString(t.Get("type"))] {
						go a.propagate(flow, t, out.Clone(), depth+1)
					} else {
						a.propagate(flow, t, out.Clone(), depth+1)
					}
					break
				}
			}
		}
	}
}

func with(msg *OMap, payload any) *OMap {
	m := msg.Clone()
	m.Set("payload", payload)
	return m
}

// jsRegexp compiles a JS pattern + flags for RE2. i/m/s map to inline flags;
// g/y/u don't change a single exec() from a fresh RegExp.
func jsRegexp(pattern, flags string) (*regexp.Regexp, error) {
	inline := ""
	for _, f := range flags {
		switch f {
		case 'i', 'm', 's':
			inline += string(f)
		case 'g', 'y', 'u', 'd':
		default:
			return nil, fmt.Errorf("Invalid flags supplied to RegExp constructor '%s'", flags)
		}
	}
	if inline != "" {
		pattern = "(?" + inline + ")" + pattern
	}
	return regexp.Compile(pattern)
}

// execNode runs one node; one message per output port (nil = no emit).
func (a *Automation) execNode(node, msg *OMap) ([]*OMap, error) {
	c := cfgOf(node)
	payload := jget(msg, "payload")
	switch node.Get("type") {
	case "trigger", "time", "mqttIn":
		return []*OMap{msg}, nil

	case "extract":
		pattern := c.Get("pattern")
		if !truthy(pattern) {
			return []*OMap{nil}, nil
		}
		flags := ""
		if f := c.Get("flags"); truthy(f) {
			flags = jsString(f)
		}
		re, err := jsRegexp(jsString(pattern), flags)
		if err != nil {
			return nil, fmt.Errorf("Bad regex: %v", err)
		}
		m := re.FindStringSubmatchIndex(jsString(orEmpty(payload)))
		if m == nil {
			return []*OMap{nil}, nil
		}
		text := jsString(orEmpty(payload))
		// Number.isFinite(group) ? group : (Number(group) || 1)
		group := 1
		if g, ok := c.Get("group").(float64); ok && !math.IsNaN(g) && !math.IsInf(g, 0) {
			group = int(g)
		} else if n := jsNumber(jget(c, "group")); !math.IsNaN(n) && n != 0 {
			group = int(n)
		}
		out := text[m[0]:m[1]]
		if group >= 0 && group*2+1 < len(m) && m[group*2] >= 0 {
			out = text[m[group*2]:m[group*2+1]]
		}
		return []*OMap{with(msg, out)}, nil

	case "condition":
		pass := false
		if cmp, ok := ops[jsString(jget(c, "op"))]; ok {
			pass = cmp(payload, jget(c, "value"))
		}
		if pass {
			return []*OMap{msg, nil}, nil
		}
		return []*OMap{nil, msg}, nil

	case "device":
		err := a.send(jsString(orEmpty(jget(c, "deviceKey"))), jsString(orEmpty(jget(c, "sensor"))), resolveTemplate(jget(c, "value"), msg))
		return []*OMap{msg}, err

	case "virtual":
		sensor := jget(c, "sensor")
		if !truthy(sensor) {
			sensor = "value"
		}
		err := a.send(jsString(orEmpty(jget(c, "deviceKey"))), jsString(sensor), resolveTemplate(jget(c, "value"), msg))
		return []*OMap{msg}, err

	case "global":
		name := jget(c, "name")
		if !truthy(name) {
			return nil, errors.New("Global node needs a name")
		}
		k := jsString(name)
		if c.Get("mode") == "set" {
			val := payload
			if v := jget(c, "value"); v != Undefined && v != "" {
				val = resolveTemplate(v, msg)
			}
			a.mu.Lock()
			a.globals[k] = val
			a.mu.Unlock()
			return []*OMap{with(msg, val)}, nil
		}
		a.mu.Lock()
		val, ok := a.globals[k]
		a.mu.Unlock()
		if !ok {
			val = Undefined
		}
		return []*OMap{with(msg, val)}, nil

	case "sync":
		sensor := jget(c, "sensor")
		if !truthy(sensor) {
			sensor = "switch"
		}
		tmpl := jget(c, "value")
		if tmpl == Undefined || tmpl == "" {
			tmpl = "{value}"
		}
		val := resolveTemplate(tmpl, msg)
		for _, t := range regexp.MustCompile(`\r?\n|,`).Split(jsString(orEmpty(jget(c, "targets"))), -1) {
			if t = strings.TrimSpace(t); t == "" {
				continue
			}
			if err := a.send(t, jsString(sensor), val); err != nil {
				log.Printf("[Automation] Sync target %q failed: %v", t, err)
			}
		}
		return []*OMap{msg}, nil

	case "store":
		if !truthy(jget(c, "name")) {
			return nil, errors.New("Store node needs a name")
		}
		key := a.registerFlowDevice(c, "flow")
		var value any
		switch c.Get("kind") {
		case "boolean":
			value = payload == true || payload == 1.0 || payload == "1" || payload == "on" || payload == "true"
		case "text":
			value = jsString(orEmpty(payload))
		default:
			if n := jsNumber(payload); math.IsNaN(n) {
				value = jsString(orEmpty(payload))
			} else {
				value = n
			}
		}
		a.store.Set(key+"/value", value)
		return []*OMap{msg}, nil

	case "loxoneXml":
		if !truthy(jget(c, "name")) {
			return nil, errors.New("Loxone XML node needs a name")
		}
		key := a.registerFlowDevice(c, "flowloxone")
		slug := strings.SplitN(key, "/", 2)[1]
		if n := jsNumber(payload); math.IsNaN(n) {
			a.store.Set(key+"/value", jsString(orEmpty(payload)))
		} else {
			a.store.Set(key+"/value", n)
		}
		host := c.Get("host")
		if !truthy(host) {
			port := 3001.0
			if srv, _ := a.config["server"].(map[string]any); srv != nil && truthy(srv["port"]) {
				port = jsNumber(srv["port"])
			}
			host = "localhost:" + numberToString(port)
		}
		token := c.Get("token")
		if !truthy(token) {
			token = "YOUR_API_TOKEN"
		}
		if d := a.reg.Device(key); d != nil {
			if xml := strings.Join(buildInputsXMLs([]*OMap{d}, xmlOpts{host: jsString(host), token: jsString(token)}), "\n"); xml != "" {
				if err := os.MkdirAll(a.loxoneDir, 0o755); err != nil {
					return nil, err
				}
				if err := os.WriteFile(filepath.Join(a.loxoneDir, slug+".xml"), []byte(xml), 0o644); err != nil {
					return nil, err
				}
			}
		}
		return []*OMap{with(msg, "/api/flow-loxone/"+slug+".xml")}, nil

	case "sceneGen":
		if !truthy(jget(c, "name")) {
			return nil, errors.New("Scene Generator node needs a name")
		}
		slug := jsSlice(slugChars(jsString(c.Get("name"))), 60)
		if slug == "" {
			slug = "scene"
		}
		var action *OMap
		actionType := jget(c, "actionType")
		if !truthy(actionType) {
			actionType = "device"
		}
		switch actionType {
		case "device":
			action = OM("type", "device", "deviceKey", jget(c, "deviceKey"), "sensor", jget(c, "sensor"), "value", resolveTemplate(jget(c, "value"), msg))
		case "relay":
			action = OM("type", "relay", "index", jsNumber(jget(c, "index")), "on", truthy(c.Get("on")))
		case "notify":
			level := c.Get("level")
			if !truthy(level) {
				level = "info"
			}
			action = OM("type", "notify", "level", level, "message", templateText(jsString(orEmpty(c.Get("message"))), payload, jget(msg, "key")))
		default:
			return nil, fmt.Errorf("Scene Generator: unknown action type %q", jsString(actionType))
		}
		icon := c.Get("icon")
		if !truthy(icon) {
			icon = "🎬"
		}
		_, err := a.SaveScene(OM("id", "flowscene-"+slug, "name", c.Get("name"), "icon", icon, "enabled", c.Get("enabled") != false, "actions", []any{action}))
		return []*OMap{msg}, err

	case "relay":
		return []*OMap{msg}, a.relays.SetState(jsNumber(jget(c, "index")), truthy(c.Get("on")))

	case "notify":
		level := c.Get("level")
		if !truthy(level) {
			level = "info"
		}
		a.Notify(jsString(level), templateText(jsString(orEmpty(c.Get("message"))), payload, jget(msg, "key")), msg.Get("source"))
		return []*OMap{msg}, nil

	case "scene":
		if scene := a.sceneByID(c.Get("sceneId")); scene != nil {
			a.RunActions(arr(scene.Get("actions")), msg)
		}
		return []*OMap{msg}, nil

	case "page":
		return nil, errors.New("Paging not enabled")

	case "delay":
		secs := jsNumber(jget(c, "seconds"))
		if math.IsNaN(secs) || secs < 0 {
			secs = 0
		}
		time.Sleep(time.Duration(secs * float64(time.Second)))
		return []*OMap{msg}, nil

	case "http":
		method := "GET"
		if m := c.Get("method"); truthy(m) {
			method = strings.ToUpper(jsString(m))
		}
		urlStr := jsString(orEmpty(jget(c, "url")))
		if saveAs := c.Get("saveAs"); truthy(saveAs) {
			name, err := sanitizeSnapshotName(saveAs)
			if err != nil {
				return nil, err
			}
			buf, ct, err := a.httpRequestBuffer(method, urlStr)
			if err != nil {
				return nil, err
			}
			ext := extFromContentType(ct)
			if err := os.MkdirAll(a.snapshotsDir, 0o755); err != nil {
				return nil, err
			}
			// a different extension from an earlier save would be served instead
			entries, _ := os.ReadDir(a.snapshotsDir)
			for _, e := range entries {
				if f := e.Name(); f != name+"."+ext && strings.HasPrefix(f, name+".") {
					os.Remove(filepath.Join(a.snapshotsDir, f))
				}
			}
			if err := os.WriteFile(filepath.Join(a.snapshotsDir, name+"."+ext), buf, 0o644); err != nil {
				return nil, err
			}
			return []*OMap{with(msg, "/api/flow-snapshots/"+name+"."+ext)}, nil
		}
		var body *string
		if b := c.Get("body"); truthy(b) && method != "GET" {
			s := strings.ReplaceAll(jsString(b), "{value}", jsString(orEmpty(payload)))
			body = &s
		}
		resp, err := a.httpRequest(method, urlStr, body)
		if err != nil {
			return nil, err
		}
		return []*OMap{with(msg, resp)}, nil

	case "mqttOut":
		topic, _ := c.Get("topic").(string)
		if client := a.ensureMqtt(); client != nil && topic != "" {
			src := jget(c, "payload")
			if isNullish(src) {
				src = payload
			}
			client.Publish(topic, 0, false, strings.ReplaceAll(jsString(orEmpty(src)), "{value}", jsString(orEmpty(payload))))
		}
		return []*OMap{msg}, nil

	case "debug":
		label := "debug"
		if n := c.Get("name"); truthy(n) {
			label = jsString(n)
		}
		pj := "undefined"
		if payload != Undefined {
			if b, err := marshalJS(payload); err == nil {
				pj = string(b)
			}
		}
		log.Printf("[Flow debug] %s: %s = %s", label, jsString(orEmpty(jget(msg, "key"))), pj)
		key := jget(msg, "key")
		if key == Undefined {
			key = nil
		}
		source := msg.Get("source")
		if !truthy(source) {
			source = nil
		}
		a.emit("flow-debug", OM("time", float64(time.Now().UnixMilli()), "label", label, "key", key, "payload", payload, "source", source))
		return nil, nil // terminal tap
	}
	return []*OMap{msg}, nil
}

// ── Loxone XML helpers shared with loxone_xml.go ──

func xmlEsc(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

func isMomentary(s *OMap) bool {
	on := s.Get("writeOn")
	return truthy(s.Get("controllable")) && s.Get("type") == "toggle" && truthy(on) && on == s.Get("writeOff")
}

func isInputSensor(s *OMap) bool {
	switch s.Get("type") {
	case "color", "trigger", "text", "label":
		return false
	}
	return !truthy(s.Get("hidden")) && !isMomentary(s)
}

func checkPattern(s *OMap) string {
	if ref := s.Get("ref"); truthy(ref) {
		b, _ := marshalJS(ref)
		return `"ref":` + string(b) + `,"value":\v`
	}
	withVal := s.Clone()
	withVal.Set("value", 0.0)
	b, _ := marshalJS(withVal)
	j := string(b[1 : len(b)-1])
	if strings.HasSuffix(j, `"value":0`) {
		j = strings.TrimSuffix(j, `"value":0`) + `"value":\v`
	}
	return j
}

// ── CRUD + notifications ────────────────────────────────────────────────────

func (a *Automation) Notify(level, message string, source any) *OMap {
	if !truthy(source) {
		source = nil
	}
	a.mu.Lock()
	entry := OM("id", float64(a.nextNotifID), "time", float64(time.Now().UnixMilli()), "level", level, "message", message, "source", source)
	a.nextNotifID++
	a.notifications = append(a.notifications, entry)
	if len(a.notifications) > maxNotifications {
		a.notifications = a.notifications[1:]
	}
	a.mu.Unlock()
	a.emit("notification", entry)
	log.Printf("[Automation] [%s] %s", level, message)
	return entry
}

func (a *Automation) Notifications() []*OMap {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]*OMap{}, a.notifications...)
}

func (a *Automation) ClearNotifications() {
	a.mu.Lock()
	a.notifications = nil
	a.mu.Unlock()
}

func (a *Automation) Rules() []*OMap {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]*OMap{}, a.rules...)
}
func (a *Automation) Scenes() []*OMap {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]*OMap{}, a.scenes...)
}
func (a *Automation) Flows() []*OMap {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]*OMap{}, a.flows...)
}

func upsert(list []*OMap, item *OMap) []*OMap {
	for i, x := range list {
		if x.Get("id") == item.Get("id") {
			list[i] = item
			return list
		}
	}
	return append(list, item)
}

func remove(list []*OMap, id string) []*OMap {
	out := list[:0:0]
	for _, x := range list {
		if x.Get("id") != id {
			out = append(out, x)
		}
	}
	return out
}

func (a *Automation) SaveRule(rule *OMap) (*OMap, error) {
	trig, _ := rule.Get("trigger").(*OMap)
	if !truthy(rule.Get("name")) || trig == nil || !truthy(trig.Get("key")) || !truthy(trig.Get("op")) {
		return nil, errors.New("Rule needs name, trigger.key and trigger.op")
	}
	if !truthy(rule.Get("id")) {
		rule.Set("id", "r"+base36Now())
	}
	if _, ok := rule.Lookup("enabled"); !ok {
		rule.Set("enabled", true)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.rules = upsert(a.rules, rule)
	delete(a.ruleState, idOf(rule))
	return rule, a.save()
}

func (a *Automation) DeleteRule(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.rules = remove(a.rules, id)
	delete(a.ruleState, id)
	return a.save()
}

func (a *Automation) SaveScene(scene *OMap) (*OMap, error) {
	if !truthy(scene.Get("name")) {
		return nil, errors.New("Scene needs a name")
	}
	if !truthy(scene.Get("id")) {
		scene.Set("id", "s"+base36Now())
	}
	a.mu.Lock()
	a.scenes = upsert(a.scenes, scene)
	err := a.save()
	a.mu.Unlock()
	a.scenesChanged()
	return scene, err
}

func (a *Automation) DeleteScene(id string) error {
	a.mu.Lock()
	a.scenes = remove(a.scenes, id)
	err := a.save()
	a.mu.Unlock()
	a.scenesChanged()
	return err
}

func (a *Automation) OnScenesChanged(fn func([]*OMap)) {
	a.mu.Lock()
	a.sceneListeners = append(a.sceneListeners, fn)
	a.mu.Unlock()
}

func (a *Automation) scenesChanged() {
	scenes := a.Scenes()
	a.mu.Lock()
	ls := a.sceneListeners
	a.mu.Unlock()
	for _, fn := range ls {
		fn(scenes)
	}
}

func (a *Automation) RunScene(id string) (*OMap, error) {
	scene := a.sceneByID(id)
	if scene == nil {
		return nil, errors.New("Scene not found")
	}
	log.Printf("[Automation] Scene run: %s", jsString(scene.Get("name")))
	a.RunActions(arr(scene.Get("actions")), OM("source", "scene:"+jsString(scene.Get("name"))))
	return scene, nil
}

// snapshotActions captures the current state of every controllable device into
// scene actions — the "save the house exactly as it is right now" button.
// Unlike the dashboard editor (which models only each device's hero switch +
// level), this records EVERY controllable sensor with a stable settable value:
// lighting on/off and brightness, thermostat setpoints, HVAC modes, speaker
// volume, colour… Momentary controls (cover up/down/stop, scene buttons) have
// no state to restore, so snapshotValue drops them.
func (a *Automation) snapshotActions() []any {
	actions := []any{}
	for _, d := range a.reg.Devices() {
		key := d.Str("key")
		if key == "" || !a.reg.Writable(key) {
			continue
		}
		snap := a.reg.DeviceReadings(key)
		if snap == nil {
			continue
		}
		readings, _ := snap.Get("readings").(*OMap)
		if readings == nil {
			continue
		}
		for _, s := range sensorsOf(d) {
			if !truthy(s.Get("controllable")) || truthy(s.Get("hidden")) {
				continue
			}
			path := jsString(s.Get("path"))
			rd, _ := readings.Get(path).(*OMap)
			if rd == nil {
				continue // no live reading yet → nothing to capture
			}
			value, okv := snapshotValue(s, rd.Get("value"))
			if !okv {
				continue // momentary / non-settable sensor
			}
			actions = append(actions, OM("type", "device", "deviceKey", key, "sensor", path, "value", value))
		}
	}
	return actions
}

// SnapshotScene builds (or, when id is given, re-captures into) a scene from the
// live device state.
func (a *Automation) SnapshotScene(name, icon, id string) (*OMap, error) {
	actions := a.snapshotActions()
	if len(actions) == 0 {
		return nil, errors.New("No controllable devices with a current state to capture")
	}
	var existing *OMap
	if id != "" {
		existing = a.sceneByID(id)
	}
	scene := NewOMap()
	if existing != nil {
		scene = existing.Clone() // keeps id + any fields the dashboard doesn't model
	}
	name = strings.TrimSpace(name)
	if name == "" {
		if existing != nil && truthy(existing.Get("name")) {
			name = existing.Str("name")
		} else {
			name = "Snapshot " + time.Now().Format("2006-01-02 15:04")
		}
	}
	scene.Set("name", name)
	if icon == "" {
		if existing != nil && truthy(existing.Get("icon")) {
			icon = existing.Str("icon")
		} else {
			icon = "📸"
		}
	}
	scene.Set("icon", icon)
	if existing != nil {
		scene.Set("enabled", existing.Get("enabled") != false)
	} else {
		scene.Set("enabled", true)
	}
	scene.Set("actions", actions)
	return a.SaveScene(scene) // assigns a fresh id when there's no existing one
}

// A controllable sensor's live reading → the value SendCommand needs to restore
// it. Returns ok=false for anything with no stable settable state, so
// snapshotActions leaves it out of the scene.
var momentaryPaths = map[string]bool{"up": true, "down": true, "stop": true, "my": true, "open": true, "close": true}

func snapshotValue(sensor *OMap, raw any) (any, bool) {
	if raw == nil {
		return nil, false
	}
	if momentaryPaths[jsString(sensor.Get("path"))] {
		return nil, false // cover / press buttons — momentary, no state
	}
	switch jsString(sensor.Get("type")) {
	case "range", "color-temp":
		n := jsNumber(raw)
		if math.IsNaN(n) {
			return nil, false
		}
		return n, true
	case "text":
		return jsString(raw), true
	case "color":
		return raw, true // object { hue, saturation } or scalar — SendCommand normalises both
	case "toggle":
		if b, ok := raw.(bool); ok {
			return b, true
		}
		if sv, ok := raw.(string); ok {
			return sv == "on" || sv == "1" || sv == "true", true
		}
		return jsNumber(raw) == 1, true
	default:
		return nil, false // unknown / read-only-shaped sensor type
	}
}

func (a *Automation) resetFlowState(id string) {
	for k := range a.flowState {
		if strings.HasPrefix(k, id+":") {
			delete(a.flowState, k)
		}
	}
}

func (a *Automation) SaveFlow(flow *OMap) (*OMap, error) {
	if !truthy(flow.Get("name")) {
		return nil, errors.New("Flow needs a name")
	}
	if !truthy(flow.Get("id")) {
		flow.Set("id", "f"+base36Now())
	}
	if _, ok := flow.Lookup("enabled"); !ok {
		flow.Set("enabled", true)
	}
	if _, ok := flow.Get("nodes").([]any); !ok {
		flow.Set("nodes", []any{})
	}
	a.mu.Lock()
	a.flows = upsert(a.flows, flow)
	a.resetFlowState(idOf(flow))
	err := a.save()
	a.mu.Unlock()
	a.setupTriggers()
	return flow, err
}

func (a *Automation) DeleteFlow(id string) error {
	a.mu.Lock()
	a.flows = remove(a.flows, id)
	a.resetFlowState(id)
	err := a.save()
	a.mu.Unlock()
	a.setupTriggers()
	return err
}

// RunFlow fires a flow from its entry nodes — the editor's "Test run".
func (a *Automation) RunFlow(id string) (*OMap, error) {
	var flow *OMap
	for _, f := range a.Flows() {
		if f.Get("id") == id {
			flow = f
		}
	}
	if flow == nil {
		return nil, errors.New("Flow not found")
	}
	for _, n := range arr(flow.Get("nodes")) {
		node, ok := n.(*OMap)
		if !ok || !triggerTypes[jsString(node.Get("type"))] {
			continue
		}
		key := jget(cfgOf(node), "key")
		var payload any = float64(time.Now().UnixMilli())
		if truthy(key) {
			payload = a.store.Get(jsString(key))
		}
		a.propagate(flow, node, OM("payload", payload, "key", key, "source", "flow-test:"+jsString(flow.Get("name"))), 0)
	}
	return flow, nil
}
