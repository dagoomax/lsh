package main

// Laundry — a hotel guest-laundry service, sibling of room service.
//
// Guests open a public, no-login page at /laundry (or /laundry?room=101, which
// a per-room QR code encodes), pick garments from the price list, choose
// standard or express service and a pickup slot. The charge goes on the room
// bill: the order is recorded unpaid for the front desk. Staff move each order
// through requested → collected → cleaning → ready → delivered in Settings →
// Laundry, and the guest page shows that progress.
//
// config.laundry = {
//   enabled, title, currency,        // currency falls back to roomService's
//   standardHours: 24, expressHours: 4,
//   express: true, expressSurchargePct: 50,
//   pickupSlots: ["As soon as possible", ...],
//   rooms: ["101", ...],             // falls back to roomService.rooms; a
//                                    // non-empty list is enforced on orders
//   publicUrl,                       // for the QR codes
//   items: [ { id, category, name, desc, price, available } ] }
//
// Guest endpoints sit under /api/order/laundry/* so the public /api/order/
// prefix covers them. Orders persist to persist/laundry-orders.json, newest
// first. n8n events: laundry.order, laundry.status, laundry.overdue,
// laundry.checkout-open.

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const laundryMaxOrders = 500

var laundryStatuses = []string{"requested", "collected", "cleaning", "ready", "delivered", "cancelled"}

var laundryDefaultSlots = []string{"As soon as possible", "Morning (8:00–10:00)", "Afternoon (14:00–16:00)", "Evening (18:00–20:00)"}

var laundryMu sync.Mutex // guards the orders file (read-modify-write)

// laundryStr is jsString for optional fields: a missing value is "", not "null".
func laundryStr(v any) string {
	switch v.(type) {
	case nil, undefinedT:
		return ""
	}
	return jsString(v)
}

func laundryOpen(o *OMap) bool {
	st := laundryStr(o.Get("status"))
	return st != "delivered" && st != "cancelled"
}

func (s *Server) laundryCfg() *OMap { return omap(readConfigOrdered(s.configPath()).Get("laundry")) }

func (s *Server) laundryOrdersPath() string { return s.persistPath("laundry-orders.json") }

func (s *Server) loadLaundryOrders() []*OMap {
	out := []*OMap{}
	b, err := os.ReadFile(s.laundryOrdersPath())
	if err != nil {
		return out
	}
	var raw []json.RawMessage
	if json.Unmarshal(b, &raw) != nil {
		return out
	}
	for _, m := range raw {
		if o, ok := rawOrdered(m).(*OMap); ok {
			out = append(out, o)
		}
	}
	return out
}

// trimLaundryOrders caps the list by dropping the oldest finished orders first,
// so the cap can never lose track of clothes the hotel is still holding.
func trimLaundryOrders(orders []*OMap) []*OMap {
	excess := len(orders) - laundryMaxOrders
	if excess <= 0 {
		return orders
	}
	drop := map[int]bool{}
	for i := len(orders) - 1; i >= 0 && excess > 0; i-- {
		if !laundryOpen(orders[i]) {
			drop[i] = true
			excess--
		}
	}
	kept := make([]*OMap, 0, len(orders))
	for i, o := range orders {
		if !drop[i] {
			kept = append(kept, o)
		}
	}
	if len(kept) > laundryMaxOrders {
		kept = kept[:laundryMaxOrders]
	}
	return kept
}

func (s *Server) saveLaundryOrders(orders []*OMap) error {
	orders = trimLaundryOrders(orders)
	if orders == nil {
		orders = []*OMap{}
	}
	b, err := json.MarshalIndent(orders, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.persistPath(""), 0o755); err != nil {
		return err
	}
	tmp := s.laundryOrdersPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.laundryOrdersPath())
}

func positiveOr(v any, def float64) float64 {
	if n := jsNumber(v); n > 0 {
		return n
	}
	return def
}

func (s *Server) laundryCurrency(l *OMap) string {
	if c := laundryStr(l.Get("currency")); c != "" {
		return c
	}
	if c := laundryStr(s.rsConfig().Get("currency")); c != "" {
		return c
	}
	return "PLN"
}

func laundrySlots(l *OMap) []string {
	out := []string{}
	for _, v := range arr(l.Get("pickupSlots")) {
		if t := strings.TrimSpace(laundryStr(v)); t != "" {
			out = append(out, t)
		}
	}
	if len(out) == 0 {
		return laundryDefaultSlots
	}
	return out
}

func laundrySurchargePct(l *OMap) float64 { return positiveOr(l.Get("expressSurchargePct"), 0) }

func laundryExpressOn(l *OMap) bool { return l.Get("express") != false }

// laundryRooms is the room list orders are checked against.
func (s *Server) laundryRooms(l *OMap) []string {
	list := arr(l.Get("rooms"))
	if len(list) == 0 {
		list = arr(s.rsConfig().Get("rooms"))
	}
	out := []string{}
	for _, v := range list {
		if t := strings.TrimSpace(laundryStr(v)); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// laundryPublic is what the guest page needs: available items, no room list.
func (s *Server) laundryPublic() *OMap {
	cfg := readConfigOrdered(s.configPath())
	l := omap(cfg.Get("laundry"))
	items := []any{}
	for _, it := range arr(l.Get("items")) {
		m := omap(it)
		if v := m.Get("available"); v != nil && v != true {
			continue
		}
		items = append(items, OM(
			"id", laundryStr(m.Get("id")),
			"category", laundryStr(m.Get("category")),
			"name", laundryStr(m.Get("name")),
			"desc", laundryStr(m.Get("desc")),
			"price", jsNumber(m.Get("price")),
		))
	}
	slots := []any{}
	for _, v := range laundrySlots(l) {
		slots = append(slots, v)
	}
	return OM(
		"enabled", l.Get("enabled") == true && s.lic().Limits.Hotel,
		"title", laundryStr(l.Get("title")),
		"currency", s.laundryCurrency(l),
		"standardHours", positiveOr(l.Get("standardHours"), 24),
		"express", OM("enabled", laundryExpressOn(l), "surchargePct", laundrySurchargePct(l), "hours", positiveOr(l.Get("expressHours"), 4)),
		"pickupSlots", slots,
		"items", items,
		"hideHotelServices", cfg.Get("hideHotelServices") == true,
	)
}

// laundryPrice validates a cart against the price list. The server never trusts
// a client-sent price.
func laundryPrice(l *OMap, cart any, express bool) (lines []any, subtotal, surcharge, total float64) {
	byID := map[string]*OMap{}
	for _, it := range arr(l.Get("items")) {
		m := omap(it)
		if m.Get("available") != false {
			byID[laundryStr(m.Get("id"))] = m
		}
	}
	for _, ci := range arr(cart) {
		c := omap(ci)
		id := laundryStr(c.Get("id"))
		qty := int(jsNumber(c.Get("qty")))
		m := byID[id]
		if qty < 1 || qty > 99 || m == nil {
			continue
		}
		price := jsNumber(m.Get("price"))
		subtotal += price * float64(qty)
		lines = append(lines, OM("id", id, "name", laundryStr(m.Get("name")), "price", price, "qty", qty))
	}
	subtotal = math.Round(subtotal*100) / 100
	if express {
		surcharge = math.Round(subtotal*laundrySurchargePct(l)) / 100
	}
	return lines, subtotal, surcharge, math.Round((subtotal+surcharge)*100) / 100
}

func clipRunes(v string, n int) string {
	r := []rune(strings.TrimSpace(v))
	if len(r) > n {
		r = r[:n]
	}
	return string(r)
}

func laundryDueAt(l *OMap, express bool, from int64) int64 {
	hours := positiveOr(l.Get("standardHours"), 24)
	if express {
		hours = positiveOr(l.Get("expressHours"), 4)
	}
	return from + int64(hours*3600000)
}

func (s *Server) laundryRoutes(api *http.ServeMux) {
	// ── Public guest endpoints (covered by the /api/order/ public prefix) ──

	api.HandleFunc("GET /api/order/laundry/menu", func(w http.ResponseWriter, r *http.Request) {
		m := s.laundryPublic()
		if m.Get("enabled") != true {
			fail(w, 404, "Laundry service is not available")
			return
		}
		ok(w, m)
	})

	// POST /api/order/laundry/place — { room, items:[{id,qty}], express, pickup, note }
	api.HandleFunc("POST /api/order/laundry/place", func(w http.ResponseWriter, r *http.Request) {
		l := s.laundryCfg()
		if l.Get("enabled") != true || !s.lic().Limits.Hotel {
			fail(w, 404, "Laundry service is not available")
			return
		}
		b := readBody(r)
		express := b.Get("express") == true && laundryExpressOn(l)
		lines, subtotal, surcharge, total := laundryPrice(l, b.Get("items"), express)
		if len(lines) == 0 {
			fail(w, 400, "Your laundry list is empty")
			return
		}
		room := clipRunes(laundryStr(b.Get("room")), 20)
		if room == "" {
			fail(w, 400, "Please enter your room number")
			return
		}
		if rooms := s.laundryRooms(l); len(rooms) > 0 {
			known := false
			for _, v := range rooms {
				known = known || v == room
			}
			if !known {
				fail(w, 400, "We don’t recognise that room number")
				return
			}
		}
		slots := laundrySlots(l)
		pickup := laundryStr(b.Get("pickup"))
		found := false
		for _, v := range slots {
			found = found || v == pickup
		}
		if !found {
			pickup = slots[0]
		}
		now := time.Now().UnixMilli()
		order := OM(
			"id", "l"+base36Now()+randSuffix(10),
			"at", now,
			"room", room,
			"items", lines,
			"express", express,
			"subtotal", subtotal,
			"surcharge", surcharge,
			"total", total,
			"currency", s.laundryCurrency(l),
			"pickup", pickup,
			"note", clipRunes(laundryStr(b.Get("note")), 500),
			"payment", "room",
			"paid", false,
			"status", "requested",
			"history", []any{OM("status", "requested", "at", now)},
			"dueAt", laundryDueAt(l, express, now),
		)
		laundryMu.Lock()
		err := s.saveLaundryOrders(append([]*OMap{order}, s.loadLaundryOrders()...))
		laundryMu.Unlock()
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		n := 0
		for _, it := range lines {
			n += int(jsNumber(omap(it).Get("qty")))
		}
		service := "standard"
		if express {
			service = "EXPRESS"
		}
		if s.auto != nil {
			s.auto.Notify("info", fmt.Sprintf("Laundry — room %s: %d item(s), %s, pickup: %s", room, n, service, pickup), "laundry")
		}
		if s.n8n != nil {
			s.n8n.emit("laundry.order", order)
		}
		ok(w, order)
	})

	// GET /api/order/laundry/status/{id} — progress for the guest's tracker.
	// The id is unguessable and the reply leaves out the room and the note.
	api.HandleFunc("GET /api/order/laundry/status/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		laundryMu.Lock()
		orders := s.loadLaundryOrders()
		laundryMu.Unlock()
		for _, o := range orders {
			if laundryStr(o.Get("id")) == id {
				ok(w, OM(
					"id", id, "at", o.Get("at"), "status", o.Get("status"), "history", o.Get("history"),
					"dueAt", o.Get("dueAt"), "express", o.Get("express"), "items", o.Get("items"),
					"total", o.Get("total"), "currency", o.Get("currency"), "pickup", o.Get("pickup"),
				))
				return
			}
		}
		fail(w, 404, "No such order")
	})

	// ── Admin endpoints ────────────────────────────────────────────────────

	api.HandleFunc("GET /api/laundry", s.admin(func(w http.ResponseWriter, r *http.Request) {
		cfg := readConfigOrdered(s.configPath())
		ok(w, OM("laundry", omap(cfg.Get("laundry")), "roomServiceRooms", s.rsConfig().Get("rooms"), "hideHotelServices", cfg.Get("hideHotelServices") == true))
	}))

	api.HandleFunc("GET /api/laundry/orders", s.admin(func(w http.ResponseWriter, r *http.Request) {
		laundryMu.Lock()
		orders := s.loadLaundryOrders()
		laundryMu.Unlock()
		out := make([]any, len(orders))
		for i, o := range orders {
			out[i] = o
		}
		ok(w, out)
	}))

	// POST /api/laundry/orders/{id}/status — { status }. Any status may be set,
	// so staff can undo a mis-tap. The turnaround clock restarts at collection.
	api.HandleFunc("POST /api/laundry/orders/{id}/status", s.admin(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		status := laundryStr(readBody(r).Get("status"))
		valid := false
		for _, v := range laundryStatuses {
			valid = valid || v == status
		}
		if !valid {
			fail(w, 400, "Unknown status")
			return
		}
		l := s.laundryCfg()
		laundryMu.Lock()
		orders := s.loadLaundryOrders()
		var found *OMap
		changed := false
		for _, o := range orders {
			if laundryStr(o.Get("id")) != id {
				continue
			}
			found = o
			if laundryStr(o.Get("status")) != status {
				changed = true
				now := time.Now().UnixMilli()
				o.Set("status", status)
				o.Set("history", append(arr(o.Get("history")), OM("status", status, "at", now)))
				if status == "collected" {
					o.Set("dueAt", laundryDueAt(l, o.Get("express") == true, now))
					o.Set("overdueN8n", false)
				}
			}
			break
		}
		var err error
		if changed {
			err = s.saveLaundryOrders(orders)
		}
		laundryMu.Unlock()
		if found == nil {
			fail(w, 404, "No such order")
			return
		}
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		if changed && s.n8n != nil {
			s.n8n.emit("laundry.status", found)
		}
		ok(w, found)
	}))

	// DELETE /api/laundry/orders/{id} — remove one order, or every delivered and
	// cancelled one with id=finished. An open order can't be deleted: cancel it
	// first, so nobody loses track of clothes by accident.
	api.HandleFunc("DELETE /api/laundry/orders/{id}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		laundryMu.Lock()
		defer laundryMu.Unlock()
		kept := []*OMap{}
		for _, o := range s.loadLaundryOrders() {
			if laundryOpen(o) {
				if laundryStr(o.Get("id")) == id {
					fail(w, 409, "Cancel the order before deleting it")
					return
				}
				kept = append(kept, o)
			} else if id != "finished" && laundryStr(o.Get("id")) != id {
				kept = append(kept, o)
			}
		}
		if err := s.saveLaundryOrders(kept); err != nil {
			fail(w, 500, err.Error())
			return
		}
		ok(w, OM("success", true))
	}))

	api.HandleFunc("POST /api/settings/laundry", s.admin(func(w http.ResponseWriter, r *http.Request) {
		cfg := readConfigOrdered(s.configPath())
		cfg.Set("laundry", omap(readBody(r).Get("laundry")))
		if err := writeConfigFile(s.configPath(), cfg); err != nil {
			fail(w, 500, err.Error())
			return
		}
		ok(w, OM("success", true))
	}))
}

// laundryOpenForRoom lists the room's unfinished orders, for the checkout warning.
func (s *Server) laundryOpenForRoom(room string) []any {
	laundryMu.Lock()
	orders := s.loadLaundryOrders()
	laundryMu.Unlock()
	out := []any{}
	for _, o := range orders {
		if laundryOpen(o) && laundryStr(o.Get("room")) == room {
			out = append(out, OM("id", o.Get("id"), "status", o.Get("status"), "dueAt", o.Get("dueAt"), "items", o.Get("items"), "total", o.Get("total")))
		}
	}
	return out
}

// checkLaundryOverdue emits laundry.overdue once for each open order past its
// due time; the order is flagged in the file so it isn't sent again.
func (n *N8n) checkLaundryOverdue() {
	now := time.Now().UnixMilli()
	laundryMu.Lock()
	orders := n.s.loadLaundryOrders()
	var late []*OMap
	for _, o := range orders {
		if laundryOpen(o) && o.Get("overdueN8n") != true && now > int64(jsNumber(o.Get("dueAt"))) {
			o.Set("overdueN8n", true)
			late = append(late, o)
		}
	}
	if len(late) > 0 {
		n.s.saveLaundryOrders(orders)
	}
	laundryMu.Unlock()
	for _, o := range late {
		n.emit("laundry.overdue", o)
		if n.s.auto != nil {
			n.s.auto.Notify("warning", "Laundry overdue — room "+laundryStr(o.Get("room")), "laundry")
		}
	}
}

// laundryDaily is the laundry part of hotel.daily-report: orders placed on the
// date (cancelled ones excluded) plus everything still open now.
func (s *Server) laundryDaily(date string) *OMap {
	laundryMu.Lock()
	orders := s.loadLaundryOrders()
	laundryMu.Unlock()
	count, open := 0, 0
	revenue := NewOMap()
	for _, o := range orders {
		if laundryOpen(o) {
			open++
		}
		if laundryStr(o.Get("status")) == "cancelled" || time.UnixMilli(int64(jsNumber(o.Get("at")))).Format("2006-01-02") != date {
			continue
		}
		count++
		cur := laundryStr(o.Get("currency"))
		revenue.Set(cur, math.Round((jsNumber(revenue.Get(cur))+jsNumber(o.Get("total")))*100)/100)
	}
	return OM("orders", count, "open", open, "revenue", revenue)
}

func (s *Server) serveLaundryPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.Write([]byte(laundryPageHTML))
}
