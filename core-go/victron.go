package main

// Victron data source — Go port of src/connection-manager.js,
// src/mqtt-client.js, src/vrm-client.js and src/relay-controller.js.
//
// Local MQTT (Venus OS / Cerbo GX) first. If the broker can't be reached
// within 15 s (or refuses at once) the VRM cloud takes over, polling the
// installation's diagnostics every 15 s, while MQTT keeps retrying in the
// background every 5 s; the moment MQTT connects, VRM stops. A drop of a
// working MQTT connection switches to VRM after 15 s.
//
// MQTT: the portal ID comes from config.mqtt.portalId or is discovered from
// N/+/system/0/Serial; then N/<portal>/# is mirrored into the store
// (topic minus the prefix → payload.value) and R/<portal>/keepalive is sent
// every 50 s. Relays: W/<portal>/system/0/Relay/<n>/State over MQTT, or
// POST /installations/<id>/relay/<n> over VRM.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

const (
	fallbackDelay     = 15 * time.Second
	mqttFirstTimeout  = 15 * time.Second
	mqttRetryEvery    = 5 * time.Second
	keepaliveEvery    = 50 * time.Second
	vrmPollEvery      = 15 * time.Second
	defaultVrmBaseURL = "https://vrmapi.victronenergy.com/v2"
)

// Relay indexes stay JS numbers (Number(action.index)) all the way into the
// topic / URL, NaN included, as in Node.
type relayWriter interface {
	writeRelay(index float64, on bool)
}

// ── VRM attribute ID → store path (ids verified against live diagnostics) ──

type vrmAttr struct {
	path string
	alt  bool // only used when the primary for the same path didn't report
}

var vrmAttrs = func() map[float64]vrmAttr {
	list := []struct {
		id   float64
		path string
		alt  bool
	}{
		{144, "system/0/Dc/Battery/Soc", false}, {240, "system/0/Dc/Battery/Soc", true},
		{32, "system/0/Dc/Battery/Voltage", false}, {33, "system/0/Dc/Battery/Current", false},
		{215, "system/0/Dc/Battery/BatteryState", false}, {51, "system/0/Dc/Battery/Soc", true},
		{52, "system/0/Dc/Battery/TimeToGo", false},
		{442, "system/0/Dc/Pv/Power", false}, {86, "solarcharger/0/Pv/V", false},
		{94, "system/0/PvChargerAggregated/Yield/User", false}, {96, "solarcharger/0/History/Daily/1/Yield", false},
		{285, "solarcharger/0/Yield/Total", false}, {518, "solarcharger/0/State", false},
		{111, "system/0/Ac/PvOnOutput/L1/Power", false}, {127, "system/0/Ac/PvOnOutput/L2/Power", false},
		{128, "system/0/Ac/PvOnOutput/L3/Power", false}, {112, "system/0/Ac/PvOnGenset/L1/Power", false},
		{113, "system/0/Dc/Pv/Power2", false},
		{8, "system/0/Ac/Grid/L1/Voltage", false}, {9, "system/0/Ac/Grid/L2/Voltage", false}, {10, "system/0/Ac/Grid/L3/Voltage", false},
		{11, "system/0/Ac/Grid/L1/Current", false}, {12, "system/0/Ac/Grid/L2/Current", false}, {13, "system/0/Ac/Grid/L3/Current", false},
		{14, "system/0/Ac/Grid/L1/Frequency", false}, {17, "system/0/Ac/Grid/L1/Power", false},
		{18, "system/0/Ac/Grid/L2/Power", false}, {19, "system/0/Ac/Grid/L3/Power", false}, {35, "system/0/Ac/Grid/Available", false},
		{20, "system/0/Ac/Out/L1/Voltage", false}, {21, "system/0/Ac/Out/L2/Voltage", false}, {22, "system/0/Ac/Out/L3/Voltage", false},
		{26, "system/0/Ac/Out/L1/Frequency", false}, {29, "system/0/Ac/Out/L1/Power", false},
		{30, "system/0/Ac/Out/L2/Power", false}, {31, "system/0/Ac/Out/L3/Power", false},
		{131, "system/0/Ac/Consumption/L1/Power", false}, {132, "system/0/Ac/Consumption/L2/Power", false},
		{133, "system/0/Ac/Consumption/L3/Power", false},
		{306, "system/0/Relay/0/State", false}, {335, "system/0/Relay/1/State", false},
		{42, "vebus/257/Dc/0/Temperature", false}, {244, "battery/0/History/DischargedEnergy", false},
		{245, "battery/0/History/ChargedEnergy", false},
	}
	m := map[float64]vrmAttr{}
	for _, a := range list {
		if _, has := m[a.id]; !a.alt || !has {
			m[a.id] = vrmAttr{a.path, a.alt}
		}
	}
	return m
}()

var parseFloatRe = regexp.MustCompile(`^[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)`)

// jsParseFloat is parseFloat(v): the leading number of String(v) ("88%" → 88).
func jsParseFloat(v any) float64 {
	m := parseFloatRe.FindString(strings.TrimLeft(jsString(v), " \t\n\r\v\f\u00a0\ufeff"))
	if m == "" {
		return math.NaN()
	}
	switch strings.TrimLeft(m, "+") {
	case "Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	f, err := strconv.ParseFloat(m, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// ── config views ────────────────────────────────────────────────────────────

func section(cfg map[string]any, k string) map[string]any {
	m, _ := cfg[k].(map[string]any)
	if m == nil {
		m = map[string]any{}
	}
	return m
}

func str(m map[string]any, k string) string {
	if v, ok := m[k]; ok && !isNullish(v) {
		return jsString(v)
	}
	return ""
}

// ── MQTT ────────────────────────────────────────────────────────────────────

type victronMQTT struct {
	host     string
	port     int
	store    *Store
	onUp     func()
	onDown   func()
	client   mqtt.Client
	mu       sync.Mutex
	portalID string
	conn     bool
	stopKA   chan struct{}
	stopped  chan struct{}
}

func (m *victronMQTT) connected() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.conn
}

// start makes the first connection attempt; an error means "unreachable"
// (the caller falls back to VRM) — retries continue in the background.
func (m *victronMQTT) start(clientID string) error {
	url := fmt.Sprintf("tcp://%s:%d", m.host, m.port)
	log.Printf("[MQTT] Connecting to mqtt://%s:%d...", m.host, m.port)
	opts := mqtt.NewClientOptions().AddBroker(url).SetClientID(clientID).
		SetConnectTimeout(10 * time.Second).SetAutoReconnect(true).SetMaxReconnectInterval(mqttRetryEvery).
		SetCleanSession(true).SetOrderMatters(false)
	opts.SetOnConnectHandler(func(c mqtt.Client) {
		m.mu.Lock()
		m.conn = true
		m.mu.Unlock()
		log.Printf("[MQTT] Connected")
		m.onUp()
		go m.subscribe()
	})
	opts.SetConnectionLostHandler(func(_ mqtt.Client, err error) {
		m.mu.Lock()
		was := m.conn
		m.conn = false
		if m.stopKA != nil {
			close(m.stopKA)
			m.stopKA = nil
		}
		m.mu.Unlock()
		if was {
			log.Printf("[MQTT] Connection closed (%v)", err)
			m.onDown()
		}
	})
	opts.SetDefaultPublishHandler(func(_ mqtt.Client, msg mqtt.Message) { m.handle(msg.Topic(), msg.Payload()) })
	m.client = mqtt.NewClient(opts)
	m.stopped = make(chan struct{})

	tok := m.client.Connect()
	if !tok.WaitTimeout(mqttFirstTimeout) {
		go m.retry()
		return fmt.Errorf("MQTT timeout — cannot reach %s", m.host)
	}
	if err := tok.Error(); err != nil {
		go m.retry()
		return err
	}
	return nil
}

// retry keeps trying the first connection; after that paho's auto-reconnect
// takes over.
func (m *victronMQTT) retry() {
	for {
		select {
		case <-m.stopped:
			return
		case <-time.After(mqttRetryEvery):
		}
		if m.client.IsConnected() {
			return
		}
		if tok := m.client.Connect(); tok.WaitTimeout(mqttFirstTimeout) && tok.Error() == nil {
			return
		}
	}
}

func (m *victronMQTT) subscribe() {
	m.mu.Lock()
	pid := m.portalID
	m.mu.Unlock()
	if pid == "" {
		log.Printf("[MQTT] Discovering portal ID...")
		found := make(chan string, 1)
		re := regexp.MustCompile(`^N/([^/]+)/`)
		m.client.Subscribe("N/+/system/0/Serial", 0, func(_ mqtt.Client, msg mqtt.Message) {
			if mm := re.FindStringSubmatch(msg.Topic()); mm != nil {
				select {
				case found <- mm[1]:
				default:
				}
			}
		})
		select {
		case pid = <-found:
		case <-m.stopped:
			return
		}
		m.client.Unsubscribe("N/+/system/0/Serial")
		m.mu.Lock()
		m.portalID = pid
		m.mu.Unlock()
		log.Printf("[MQTT] Portal ID: %s", pid)
	}
	prefix := "N/" + pid
	if tok := m.client.Subscribe(prefix+"/#", 0, nil); tok.Wait() && tok.Error() != nil {
		log.Printf("[MQTT] Subscribe error: %v", tok.Error())
	} else {
		log.Printf("[MQTT] Subscribed to %s/#", prefix)
	}
	m.startKeepalive(pid)
}

func (m *victronMQTT) startKeepalive(pid string) {
	m.mu.Lock()
	if m.stopKA != nil {
		close(m.stopKA)
	}
	stop := make(chan struct{})
	m.stopKA = stop
	m.mu.Unlock()
	topic := "R/" + pid + "/keepalive"
	m.client.Publish(topic, 0, false, "")
	go func() {
		t := time.NewTicker(keepaliveEvery)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				if m.connected() {
					m.client.Publish(topic, 0, false, "")
				}
			case <-stop:
				return
			}
		}
	}()
}

func (m *victronMQTT) handle(topic string, payload []byte) {
	m.mu.Lock()
	prefix := "N/" + m.portalID + "/"
	known := m.portalID != ""
	m.mu.Unlock()
	if !known || !strings.HasPrefix(topic, prefix) {
		return
	}
	data, ok := rawOrdered(payload).(*OMap)
	if !ok {
		return
	}
	if v, has := data.Lookup("value"); has {
		m.store.Set(topic[len(prefix):], v)
	}
}

// writeRelay — silently nothing while offline or before the portal is known,
// as in Node.
func (m *victronMQTT) writeRelay(index float64, on bool) {
	m.mu.Lock()
	pid, conn := m.portalID, m.conn
	m.mu.Unlock()
	if !conn || pid == "" {
		return
	}
	v := 0
	if on {
		v = 1
	}
	m.client.Publish(fmt.Sprintf("W/%s/system/0/Relay/%s/State", pid, numberToString(index)), 0, false, fmt.Sprintf(`{"value":%d}`, v))
	log.Printf("[MQTT] Relay %s → %s", numberToString(index), map[bool]string{true: "ON", false: "OFF"}[on])
}

func (m *victronMQTT) stop() {
	select {
	case <-m.stopped:
	default:
		close(m.stopped)
	}
	m.mu.Lock()
	if m.stopKA != nil {
		close(m.stopKA)
		m.stopKA = nil
	}
	m.mu.Unlock()
	m.client.Disconnect(250)
}

// ── VRM ─────────────────────────────────────────────────────────────────────

type victronVRM struct {
	base                          string
	email, password, token, insID string
	store                         *Store
	http                          *http.Client
	mu                            sync.Mutex
	auth                          string
	conn                          bool
	stopCh                        chan struct{}
}

func (v *victronVRM) connected() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.conn
}

func (v *victronVRM) start() error {
	if v.insID == "" {
		return errors.New("VRM installationId not configured")
	}
	auth, err := v.resolveAuth()
	if err != nil {
		return err
	}
	v.mu.Lock()
	v.auth, v.conn = auth, true
	v.stopCh = make(chan struct{})
	stop := v.stopCh
	v.mu.Unlock()
	log.Printf("[VRM] Authenticated, starting poll")
	go func() {
		v.poll(true)
		t := time.NewTicker(vrmPollEvery)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				v.poll(true)
			case <-stop:
				return
			}
		}
	}()
	return nil
}

func (v *victronVRM) resolveAuth() (string, error) {
	if t := strings.TrimSpace(v.token); t != "" {
		log.Printf("[VRM] Using API token auth")
		return "Token " + t, nil
	}
	if v.email == "" || v.password == "" {
		return "", errors.New("VRM credentials not configured (need apiToken or email+password)")
	}
	body, _ := json.Marshal(map[string]string{"username": v.email, "password": v.password})
	res, err := v.http.Post(v.base+"/auth/login", "application/json", strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var data map[string]any
	if json.Unmarshal(raw, &data) != nil {
		s := string(raw)
		if len(s) > 120 {
			s = s[:120]
		}
		return "", fmt.Errorf("VRM returned non-JSON (HTTP %d): %s", res.StatusCode, s)
	}
	token, _ := data["token"].(string)
	if res.StatusCode >= 300 || token == "" {
		var e any = fmt.Sprintf("HTTP %d", res.StatusCode)
		for _, k := range []string{"errors", "error", "error_description"} {
			if x, ok := data[k]; ok && x != nil {
				e = x
				break
			}
		}
		msg, ok := e.(string)
		if !ok {
			b, _ := json.Marshal(e)
			msg = string(b)
		}
		return "", fmt.Errorf("VRM auth failed: %s", msg)
	}
	log.Printf("[VRM] Email/password auth successful")
	return "Bearer " + token, nil
}

func (v *victronVRM) poll(retryAuth bool) {
	v.mu.Lock()
	auth := v.auth
	v.mu.Unlock()
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/installations/%s/diagnostics?count=1000", v.base, v.insID), nil)
	req.Header.Set("x-authorization", auth)
	res, err := v.http.Do(req)
	if err != nil {
		log.Printf("[VRM] Poll error: %v", err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode == 401 && retryAuth {
		log.Printf("[VRM] Token expired — re-authenticating…")
		a, err := v.resolveAuth()
		if err != nil {
			log.Printf("[VRM] Poll error: %v", err)
			return
		}
		v.mu.Lock()
		v.auth = a
		v.mu.Unlock()
		v.poll(false)
		return
	}
	if res.StatusCode >= 300 {
		log.Printf("[VRM] Poll failed: HTTP %d", res.StatusCode)
		return
	}
	var data struct {
		Records []map[string]any `json:"records"`
	}
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil || data.Records == nil {
		log.Printf("[VRM] Unexpected diagnostics response")
		return
	}
	written := map[string]bool{}
	mapped := 0
	for _, rec := range data.Records {
		id, _ := rec["idDataAttribute"].(float64)
		a, ok := vrmAttrs[id]
		if !ok || (a.alt && written[a.path]) {
			continue
		}
		value := rec["rawValue"]
		if value == nil {
			value = rec["formattedValue"]
		}
		if value == nil {
			continue
		}
		if n := jsParseFloat(value); math.IsNaN(n) {
			v.store.Set(a.path, value)
		} else {
			v.store.Set(a.path, n)
		}
		written[a.path] = true
		mapped++
	}
	if mapped == 0 {
		log.Printf("[VRM] Poll returned %d records but none matched known attribute IDs", len(data.Records))
	} else {
		log.Printf("[VRM] Poll OK — %d values updated", mapped)
	}
}

// writeRelay is fire-and-forget, like the Node client.
func (v *victronVRM) writeRelay(index float64, on bool) {
	state := 0
	if on {
		state = 1
	}
	v.mu.Lock()
	auth := v.auth
	v.mu.Unlock()
	go func() {
		req, _ := http.NewRequest("POST", fmt.Sprintf("%s/installations/%s/relay/%s", v.base, v.insID, numberToString(index)), strings.NewReader(fmt.Sprintf(`{"state":%d}`, state)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-authorization", auth)
		res, err := v.http.Do(req)
		if err != nil {
			log.Printf("[VRM] Relay write error: %v", err)
			return
		}
		res.Body.Close()
		if res.StatusCode >= 300 {
			log.Printf("[VRM] Relay write failed: HTTP %d", res.StatusCode)
		} else {
			log.Printf("[VRM] Relay %s → %s", numberToString(index), map[bool]string{true: "ON", false: "OFF"}[on])
		}
	}()
}

func (v *victronVRM) stop() {
	v.mu.Lock()
	if v.stopCh != nil {
		close(v.stopCh)
		v.stopCh = nil
	}
	v.conn = false
	v.mu.Unlock()
	log.Printf("[VRM] Stopped")
}

// ── connection manager ──────────────────────────────────────────────────────

type Victron struct {
	cfg        map[string]any
	store      *Store
	ps         *PlatformStatus
	vrmBase    string
	httpClient *http.Client

	mu            sync.Mutex
	mqtt          *victronMQTT
	vrm           *victronVRM
	source        string // "mqtt" | "vrm" | ""
	fallbackTimer *time.Timer
	listeners     []func()
}

func NewVictron(cfg map[string]any, store *Store, ps *PlatformStatus) *Victron {
	return &Victron{cfg: cfg, store: store, ps: ps, vrmBase: defaultVrmBaseURL, httpClient: &http.Client{Timeout: 30 * time.Second}}
}

func (v *Victron) OnSourceChanged(fn func()) {
	v.mu.Lock()
	v.listeners = append(v.listeners, fn)
	v.mu.Unlock()
}

func (v *Victron) hasVrmCredentials() bool {
	vrm := section(v.cfg, "vrm")
	return str(vrm, "apiToken") != "" || (str(vrm, "email") != "" && str(vrm, "password") != "")
}

// Start runs the source selection in the background, so boot doesn't wait
// on an unreachable broker.
func (v *Victron) Start() {
	host := str(section(v.cfg, "mqtt"), "host")
	switch {
	case host != "":
		go v.startMQTT()
	case v.hasVrmCredentials():
		go v.startVRM("No MQTT host configured")
	default:
		log.Printf("[Connection] No data source configured — running without live Victron data.")
	}
}

func (v *Victron) startMQTT() {
	mc := section(v.cfg, "mqtt")
	port := int(jsNumber(mc["port"]))
	if port == 0 {
		port = 1883
	}
	m := &victronMQTT{host: str(mc, "host"), port: port, store: v.store, portalID: str(mc, "portalId")}
	m.onUp = func() {
		v.mu.Lock()
		if v.fallbackTimer != nil {
			v.fallbackTimer.Stop()
		}
		vrm := v.vrm
		wasVrm := v.source == "vrm"
		if wasVrm {
			v.vrm = nil
		}
		v.mu.Unlock()
		v.ps.Set("victron-mqtt", true)
		if wasVrm && vrm != nil {
			log.Printf("[Connection] MQTT back online — stopping VRM cloud polling")
			vrm.stop()
			v.ps.Set("victron-vrm", false)
		}
		v.setSource("mqtt")
	}
	m.onDown = func() {
		v.ps.Set("victron-mqtt", false)
		v.mu.Lock()
		defer v.mu.Unlock()
		if v.source != "mqtt" {
			return
		}
		log.Printf("[Connection] MQTT dropped — switching to VRM cloud in %ds…", int(fallbackDelay.Seconds()))
		v.fallbackTimer = time.AfterFunc(fallbackDelay, func() { v.startVRM("MQTT offline") })
	}
	v.mu.Lock()
	v.mqtt = m
	v.mu.Unlock()
	if err := m.start(fmt.Sprintf("lsh-go-%s", base36Now())); err != nil {
		log.Printf("[Connection] MQTT unreachable: %v", err)
		v.startVRM("MQTT unreachable")
	}
}

func (v *Victron) startVRM(reason string) {
	v.mu.Lock()
	if v.vrm != nil && v.vrm.connected() {
		v.mu.Unlock()
		return
	}
	v.mu.Unlock()
	if !v.hasVrmCredentials() {
		log.Printf("[Connection] %s — VRM not configured, running offline.", reason)
		v.setSource("")
		return
	}
	log.Printf("[Connection] %s → connecting via VRM cloud…", reason)
	vc := section(v.cfg, "vrm")
	c := &victronVRM{base: v.vrmBase, email: str(vc, "email"), password: str(vc, "password"), token: str(vc, "apiToken"),
		insID: str(vc, "installationId"), store: v.store, http: v.httpClient}
	if err := c.start(); err != nil {
		log.Printf("[Connection] VRM cloud failed: %v", err)
		v.ps.Set("victron-vrm", false)
		v.setSource("")
		return
	}
	v.mu.Lock()
	// MQTT may have come back while VRM was logging in
	if v.source == "mqtt" {
		v.mu.Unlock()
		c.stop()
		return
	}
	v.vrm = c
	v.mu.Unlock()
	v.ps.Set("victron-vrm", true)
	v.setSource("vrm")
}

func (v *Victron) setSource(source string) {
	v.mu.Lock()
	if v.source == source {
		v.mu.Unlock()
		return
	}
	prev := v.source
	v.source = source
	ls := v.listeners
	v.mu.Unlock()
	label := map[string]string{"mqtt": "MQTT (local)", "vrm": "VRM Cloud", "": "none"}[source]
	if prev == "" {
		prev = "none"
	}
	log.Printf("[Connection] Source: %s → %s", prev, label)
	for _, fn := range ls {
		fn()
	}
}

func (v *Victron) active() relayWriter {
	v.mu.Lock()
	defer v.mu.Unlock()
	switch v.source {
	case "mqtt":
		return v.mqtt
	case "vrm":
		if v.vrm != nil {
			return v.vrm
		}
	}
	return nil
}

func (v *Victron) Status() *OMap {
	v.mu.Lock()
	defer v.mu.Unlock()
	mc, vc := section(v.cfg, "mqtt"), section(v.cfg, "vrm")
	var source any
	if v.source != "" {
		source = v.source
	}
	var host any
	if h := str(mc, "host"); h != "" {
		host = h
	}
	return OM(
		"source", source,
		"mqtt", OM("configured", str(mc, "host") != "", "connected", v.mqtt != nil && v.mqtt.connected(), "host", host),
		"vrm", OM("configured", str(vc, "email") != "" && str(vc, "installationId") != "", "connected", v.vrm != nil && v.vrm.connected()),
	)
}

func (v *Victron) Stop() {
	v.mu.Lock()
	m, c := v.mqtt, v.vrm
	if v.fallbackTimer != nil {
		v.fallbackTimer.Stop()
	}
	v.mu.Unlock()
	if m != nil {
		m.stop()
	}
	if c != nil {
		c.stop()
	}
}

// ── relays ──────────────────────────────────────────────────────────────────

type Relays struct {
	cfg     func() map[string]any
	store   *Store
	victron *Victron
}

func (r *Relays) list() []map[string]any {
	var out []map[string]any
	for _, x := range arr(r.cfg()["relays"]) {
		if m, ok := x.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func (r *Relays) State(index any) bool {
	return r.store.Get(fmt.Sprintf("system/0/Relay/%s/State", jsString(index))) == 1.0
}

func (r *Relays) All() []*OMap {
	out := []*OMap{}
	for _, rel := range r.list() {
		idx, ok := rel["index"]
		if !ok {
			idx = Undefined
		}
		name, ok := rel["name"]
		if !ok {
			name = Undefined
		}
		out = append(out, OM("index", idx, "name", name, "on", r.State(idx)))
	}
	return out
}

// Configured reports whether config.relays has this index (strict ===).
func (r *Relays) Configured(index float64) bool {
	for _, rel := range r.list() {
		if f, ok := rel["index"].(float64); ok && f == index {
			return true
		}
	}
	return false
}

func (r *Relays) SetState(index float64, on bool) error {
	if r == nil || r.victron == nil {
		return errors.New("No data client connected")
	}
	w := r.victron.active()
	if w == nil {
		return errors.New("No data client connected")
	}
	w.writeRelay(index, on)
	return nil
}
