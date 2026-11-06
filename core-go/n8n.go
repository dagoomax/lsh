package main

// n8n hotel automation bridge.
//
// LSH posts hotel domain events to n8n as signed JSON webhooks, so a hotel can
// wire up workflows without touching the codebase. Each "hook" is one n8n
// Webhook-node URL (or the community n8n-nodes-lsh Trigger) that subscribes to
// one or more event names. Deliveries are signed exactly like src/webhooks.js:
//   X-LSH-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed by secret>
// so the existing LSH Trigger node's verification still accepts them.
//
// config.n8n = {
//   enabled: true,
//   hooks: [ { id, name, url, secret, events: ["room-service.order", ...], enabled } ],
//   escalateAfterMinutes: 15,   // unacked order → room-service.escalation
//   dailyReportAt: "08:00" }    // local time → hotel.daily-report
//
// Events (the "skills"):
//   room-service.order        an order was placed              → alert staff
//   room-service.ack          an order was acknowledged        → notify guest / log
//   room-service.escalation   an order sat unacknowledged      → page / escalate
//   laundry.order             a laundry pickup was requested   → alert housekeeping
//   laundry.status            a laundry order changed status   → notify guest / log
//   laundry.overdue           an open order passed its due time→ page / escalate
//   laundry.checkout-open     a room checked out with laundry  → stop the guest leaving
//                             still in progress
//   hotel.checkin             a room was checked in            → arrival scene
//   hotel.checkout            a room was checked out           → departure scene
//   hotel.daily-report        once a day, a service digest     → email / Slack
//   test                      the Settings "Test" button
//
// Occupancy is kept in persist/hotel-rooms.json; delivery state is in-memory.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// The canonical event names, surfaced to the Settings UI and the n8n node.
var n8nEvents = []string{
	"room-service.order", "room-service.ack", "room-service.escalation",
	"laundry.order", "laundry.status", "laundry.overdue", "laundry.checkout-open",
	"hotel.checkin", "hotel.checkout", "hotel.daily-report",
}

type n8nDelivery struct {
	At     int64  `json:"at"`
	Status int    `json:"status"`
	Error  string `json:"error,omitempty"`
}

type N8n struct {
	s      *Server
	client *http.Client

	mu       sync.Mutex
	last     map[string]n8nDelivery // hook id → last delivery
	stop     chan struct{}
	stopOnce sync.Once
}

func NewN8n(s *Server) *N8n {
	return &N8n{
		s:      s,
		client: &http.Client{Timeout: 10 * time.Second},
		last:   map[string]n8nDelivery{},
		stop:   make(chan struct{}),
	}
}

// ── config ──────────────────────────────────────────────────────────────────

func (n *N8n) config() *OMap {
	cfg := readConfigOrdered(n.s.configPath())
	return omap(cfg.Get("n8n"))
}

func (n *N8n) enabled() bool { return n.config().Get("enabled") == true }

func (n *N8n) hooks() []*OMap {
	out := []*OMap{}
	for _, h := range arr(n.config().Get("hooks")) {
		if m := omap(h); m.Len() > 0 {
			out = append(out, m)
		}
	}
	return out
}

func (n *N8n) escalateAfter() time.Duration {
	m := int(jsNumber(n.config().Get("escalateAfterMinutes")))
	if m <= 0 {
		m = 15
	}
	return time.Duration(m) * time.Minute
}

func (n *N8n) dailyReportAt() (hh, mm int, ok bool) {
	v := strings.TrimSpace(jsString(n.config().Get("dailyReportAt")))
	if v == "" {
		return 0, 0, false
	}
	if _, err := fmt.Sscanf(v, "%d:%d", &hh, &mm); err != nil {
		return 0, 0, false
	}
	if hh < 0 || hh > 23 || mm < 0 || mm > 59 {
		return 0, 0, false
	}
	return hh, mm, true
}

// wants reports whether a hook subscribes to an event: an exact name, "*"/"**"
// for everything, or a "prefix.*" family (e.g. "room-service.*").
func hookWants(h *OMap, event string) bool {
	for _, e := range arr(h.Get("events")) {
		name := strings.TrimSpace(jsString(e))
		switch {
		case name == event, name == "*", name == "**":
			return true
		case strings.HasSuffix(name, ".*") && strings.HasPrefix(event, strings.TrimSuffix(name, "*")):
			return true
		}
	}
	return false
}

// ── delivery ────────────────────────────────────────────────────────────────

// emit delivers an event to every enabled hook subscribed to it. Non-blocking.
func (n *N8n) emit(event string, data any) {
	if !n.enabled() {
		return
	}
	for _, h := range n.hooks() {
		if h.Get("enabled") == false || !hookWants(h, event) {
			continue
		}
		url := strings.TrimSpace(jsString(h.Get("url")))
		if url == "" {
			continue
		}
		go n.deliver(jsString(h.Get("id")), url, jsString(h.Get("secret")), event, data)
	}
}

// emitTo delivers to one specific hook id (used by the Test button).
func (n *N8n) emitTo(id, event string, data any) (n8nDelivery, bool) {
	for _, h := range n.hooks() {
		if jsString(h.Get("id")) != id {
			continue
		}
		url := strings.TrimSpace(jsString(h.Get("url")))
		if url == "" {
			return n8nDelivery{At: time.Now().UnixMilli(), Error: "hook has no URL"}, true
		}
		return n.deliver(id, url, jsString(h.Get("secret")), event, data), true
	}
	return n8nDelivery{}, false
}

func (n *N8n) deliver(id, url, secret, event string, data any) n8nDelivery {
	body := OM(
		"event", event,
		"hub", n.siteName(),
		"sentAt", time.Now().UTC().Format(time.RFC3339),
		"data", data,
	)
	raw, err := json.Marshal(body)
	if err != nil {
		raw = []byte("{}")
	}
	d := n8nDelivery{At: time.Now().UnixMilli()}
	req, err := http.NewRequest("POST", url, strings.NewReader(string(raw)))
	if err != nil {
		d.Error = err.Error()
		n.record(id, d)
		return d
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "LSH-n8n/1")
	req.Header.Set("X-LSH-Event", event)
	if secret != "" {
		req.Header.Set("X-LSH-Signature", sign(secret, raw))
	}
	resp, err := n.client.Do(req)
	if err != nil {
		d.Error = err.Error()
		n.record(id, d)
		return d
	}
	defer resp.Body.Close()
	d.Status = resp.StatusCode
	if resp.StatusCode >= 300 {
		d.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	n.record(id, d)
	return d
}

func (n *N8n) record(id string, d n8nDelivery) {
	n.mu.Lock()
	n.last[id] = d
	n.mu.Unlock()
}

func (n *N8n) lastFor(id string) *OMap {
	n.mu.Lock()
	d, ok := n.last[id]
	n.mu.Unlock()
	if !ok {
		return nil
	}
	o := OM("at", d.At, "status", d.Status)
	if d.Error != "" {
		o.Set("error", d.Error)
	}
	return o
}

func sign(secret string, raw []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(raw)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func (n *N8n) siteName() string {
	cfg := readConfigOrdered(n.s.configPath())
	if v, ok := cfg.Get("siteName").(string); ok && v != "" {
		return v
	}
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return "LSH"
}

// ── background loops ────────────────────────────────────────────────────────

func (n *N8n) StartLoops() {
	go n.loop()
}

func (n *N8n) Stop() { n.stopOnce.Do(func() { close(n.stop) }) }

func (n *N8n) loop() {
	tick := time.NewTicker(60 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-n.stop:
			return
		case <-tick.C:
			if n.enabled() {
				n.checkEscalations()
				n.checkLaundryOverdue()
				n.checkDailyReport()
			}
		}
	}
}

// checkEscalations emits room-service.escalation once for each order that has
// stayed "new" past the threshold. The order is flagged in the file so it is
// not re-emitted.
func (n *N8n) checkEscalations() {
	threshold := n.escalateAfter()
	now := time.Now().UnixMilli()
	roomServiceMu.Lock()
	orders := n.s.loadOrders()
	changed := false
	type esc struct {
		order   *OMap
		waiting int64
	}
	var pending []esc
	for _, o := range orders {
		if jsString(o.Get("status")) != "new" || o.Get("escalatedN8n") == true {
			continue
		}
		age := now - int64(jsNumber(o.Get("at")))
		if age >= threshold.Milliseconds() {
			o.Set("escalatedN8n", true)
			changed = true
			pending = append(pending, esc{o, age / 60000})
		}
	}
	if changed {
		n.s.saveOrders(orders)
	}
	roomServiceMu.Unlock()
	for _, e := range pending {
		n.emit("room-service.escalation", OM("order", e.order, "waitingMinutes", e.waiting))
		if n.s.auto != nil {
			n.s.auto.Notify("warning",
				fmt.Sprintf("Room service unacknowledged %d min — room %s", e.waiting, jsString(e.order.Get("room"))),
				"n8n")
		}
	}
}

func (n *N8n) statePath() string { return n.s.persistPath("n8n-state.json") }

func (n *N8n) readState() *OMap {
	b, err := os.ReadFile(n.statePath())
	if err != nil {
		return NewOMap()
	}
	if o, ok := rawOrdered(json.RawMessage(b)).(*OMap); ok {
		return o
	}
	return NewOMap()
}

func (n *N8n) writeState(st *OMap) {
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return
	}
	os.MkdirAll(n.s.persistPath(""), 0o755)
	tmp := n.statePath() + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, n.statePath())
	}
}

func (n *N8n) checkDailyReport() {
	hh, mm, ok := n.dailyReportAt()
	if !ok {
		return
	}
	now := time.Now()
	today := now.Format("2006-01-02")
	st := n.readState()
	if jsString(st.Get("lastReportDate")) == today {
		return
	}
	if now.Hour() < hh || (now.Hour() == hh && now.Minute() < mm) {
		return
	}
	report := n.buildDailyReport(today)
	st.Set("lastReportDate", today)
	n.writeState(st)
	n.emit("hotel.daily-report", report)
}

// buildDailyReport summarises the orders placed on the given local date.
func (n *N8n) buildDailyReport(date string) *OMap {
	roomServiceMu.Lock()
	orders := n.s.loadOrders()
	roomServiceMu.Unlock()
	count, pending := 0, 0
	revenue := NewOMap()
	byRoom := map[string]int{}
	var roomOrder []string
	for _, o := range orders {
		at := time.UnixMilli(int64(jsNumber(o.Get("at")))).Format("2006-01-02")
		if at != date {
			continue
		}
		count++
		if jsString(o.Get("status")) == "new" {
			pending++
		}
		cur := jsString(o.Get("currency"))
		if cur == "" {
			cur = "PLN"
		}
		revenue.Set(cur, jsNumber(revenue.Get(cur))+jsNumber(o.Get("total")))
		room := jsString(o.Get("room"))
		if room == "" {
			room = "—"
		}
		if _, seen := byRoom[room]; !seen {
			roomOrder = append(roomOrder, room)
		}
		byRoom[room]++
	}
	rooms := []any{}
	for _, r := range roomOrder {
		rooms = append(rooms, OM("room", r, "orders", byRoom[r]))
	}
	return OM(
		"date", date,
		"orders", count,
		"pendingAcks", pending,
		"revenue", revenue,
		"byRoom", rooms,
		"laundry", n.s.laundryDaily(date),
	)
}

// ── occupancy (check-in / check-out) ────────────────────────────────────────

func (n *N8n) roomsPath() string { return n.s.persistPath("hotel-rooms.json") }

func (n *N8n) loadRooms() *OMap {
	b, err := os.ReadFile(n.roomsPath())
	if err != nil {
		return NewOMap()
	}
	if o, ok := rawOrdered(json.RawMessage(b)).(*OMap); ok {
		return o
	}
	return NewOMap()
}

func (n *N8n) saveRooms(rooms *OMap) error {
	b, err := json.MarshalIndent(rooms, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(n.s.persistPath(""), 0o755); err != nil {
		return err
	}
	tmp := n.roomsPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, n.roomsPath())
}

// ── routes ──────────────────────────────────────────────────────────────────

func (n *N8n) routes(api *http.ServeMux) {
	s := n.s

	// GET /api/n8n — config (secrets masked) + event catalog + delivery status.
	api.HandleFunc("GET /api/n8n", s.admin(func(w http.ResponseWriter, r *http.Request) {
		cfg := n.config().Clone()
		hooks := []any{}
		for _, h := range arr(cfg.Get("hooks")) {
			hv := omap(h).Clone()
			if jsString(hv.Get("secret")) != "" {
				hv.Set("secret", bullets)
			}
			if d := n.lastFor(jsString(hv.Get("id"))); d != nil {
				hv.Set("last", d)
			}
			hooks = append(hooks, hv)
		}
		cfg.Set("hooks", hooks)
		if cfg.Get("enabled") == nil {
			cfg.Set("enabled", false)
		}
		events := []any{}
		for _, e := range n8nEvents {
			events = append(events, e)
		}
		ok(w, OM("n8n", cfg, "events", events, "hotel", n.lic()))
	}))

	// POST /api/settings/n8n — save config (admin). Masked secrets are kept.
	api.HandleFunc("POST /api/settings/n8n", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		incoming := omap(b.Get("n8n"))
		cfg := readConfigOrdered(s.configPath())
		prevHooks := map[string]string{} // id → secret
		for _, h := range arr(omap(cfg.Get("n8n")).Get("hooks")) {
			m := omap(h)
			prevHooks[jsString(m.Get("id"))] = jsString(m.Get("secret"))
		}
		cleaned := []any{}
		for _, h := range arr(incoming.Get("hooks")) {
			hv := omap(h).Clone()
			id := jsString(hv.Get("id"))
			if id == "" {
				id = base36Now() + randSuffix(3)
				hv.Set("id", id)
			}
			sec := jsString(hv.Get("secret"))
			if masked8(sec) {
				sec = prevHooks[id]
			}
			if sec == "" {
				sec = base36Now() + randSuffix(8)
			}
			hv.Set("secret", sec)
			cleaned = append(cleaned, hv)
		}
		incoming.Set("hooks", cleaned)
		cfg.Set("n8n", incoming)
		if err := writeConfigFile(s.configPath(), cfg); err != nil {
			fail(w, 500, err.Error())
			return
		}
		ok(w, OM("success", true))
	}))

	// POST /api/n8n/test — send a test event to a hook. { hookId }
	api.HandleFunc("POST /api/n8n/test", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		id := jsString(b.Get("hookId"))
		d, found := n.emitTo(id, "test", OM("message", "LSH test event", "at", time.Now().UnixMilli()))
		if !found {
			fail(w, 404, "No such hook")
			return
		}
		if d.Error != "" {
			writeJSON(w, 502, OM("success", false, "error", d.Error, "status", d.Status))
			return
		}
		ok(w, OM("status", d.Status))
	}))

	// GET /api/hotel/rooms — current occupancy.
	api.HandleFunc("GET /api/hotel/rooms", s.admin(func(w http.ResponseWriter, r *http.Request) {
		rooms := n.loadRooms()
		out := []any{}
		for _, k := range rooms.Keys() {
			out = append(out, rooms.Get(k))
		}
		ok(w, out)
	}))

	// POST /api/hotel/checkin — { room, guest?, nights? } → record + emit.
	api.HandleFunc("POST /api/hotel/checkin", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		room := strings.TrimSpace(jsString(b.Get("room")))
		if room == "" {
			fail(w, 400, "room is required")
			return
		}
		rec := OM(
			"room", room,
			"guest", strings.TrimSpace(jsString(b.Get("guest"))),
			"nights", jsNumber(b.Get("nights")),
			"checkedInAt", time.Now().UnixMilli(),
		)
		rooms := n.loadRooms()
		rooms.Set(room, rec)
		if err := n.saveRooms(rooms); err != nil {
			fail(w, 500, err.Error())
			return
		}
		n.emit("hotel.checkin", rec)
		s.sio.Emit("hotel-rooms", nil)
		// On room entry, run the configured arrival scene (e.g. TV + lights on).
		// In-process, no credential needed. Non-blocking.
		if sceneID := strings.TrimSpace(jsString(n.config().Get("arrivalScene"))); sceneID != "" && s.auto != nil {
			go func() {
				if _, err := s.auto.RunScene(sceneID); err != nil {
					log.Printf("[n8n] arrival scene %q failed: %v", sceneID, err)
				} else {
					s.auto.Notify("info", "Arrival scene run for room "+room, "n8n")
				}
			}()
		}
		ok(w, rec)
	}))

	// POST /api/hotel/checkout — { room } → record + emit.
	api.HandleFunc("POST /api/hotel/checkout", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		room := strings.TrimSpace(jsString(b.Get("room")))
		if room == "" {
			fail(w, 400, "room is required")
			return
		}
		rooms := n.loadRooms()
		prev := omap(rooms.Get(room))
		rooms.Delete(room)
		if err := n.saveRooms(rooms); err != nil {
			fail(w, 500, err.Error())
			return
		}
		out := OM("room", room, "guest", jsString(prev.Get("guest")), "at", time.Now().UnixMilli())
		open := s.laundryOpenForRoom(room)
		out.Set("openLaundry", open)
		n.emit("hotel.checkout", out)
		if len(open) > 0 {
			n.emit("laundry.checkout-open", out)
			if s.auto != nil {
				s.auto.Notify("warning", fmt.Sprintf("Room %s checked out with %d laundry order(s) still open", room, len(open)), "laundry")
			}
		}
		s.sio.Emit("hotel-rooms", nil)
		ok(w, out)
	}))
}

// lic surfaces whether hotel features are licensed, for the Settings banner.
func (n *N8n) lic() *OMap {
	l := n.s.lic()
	return OM("tier", l.Tier, "hotel", l.Limits.Hotel)
}
