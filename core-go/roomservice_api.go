package main

// Room service — a hotel/rental ordering module.
//
// Guests reach a public, no-login ordering page at /order (optionally
// /order?room=101, which a per-room QR code encodes). The page loads the menu
// and places orders through the public /api/order/* endpoints. Staff see and
// acknowledge orders in the dashboard (admin /api/room-service/*), and the
// menu + options are edited in Settings.
//
// Payment is either "add to receipt" (charged to the room folio — the order is
// recorded unpaid for the front desk) or "pay now", which goes through Stripe:
// the browser's Payment Request button shows Apple Pay on Apple devices. Pay-now
// is inert until config.roomService.stripe is filled in and the domain verified.
//
// config.roomService = {
//   enabled, title, currency: "PLN", payToRoom: true,
//   stripe: { enabled, publishableKey, secretKey },
//   rooms: ["101", ...],            // for QR generation in Settings
//   menu: [ { id, category, name, desc, price, available } ] }
// config.hideHotelServices (top level) hides the hotel/rental UI in the dashboard.
//
// Orders persist to persist/room-service-orders.json (newest first, capped).

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const roomServiceMaxOrders = 200

var roomServiceMu sync.Mutex // guards the orders file (read-modify-write)

var stripeHTTP = &http.Client{Timeout: 20 * time.Second}

func (s *Server) rsConfig() *OMap {
	cfg := readConfigOrdered(s.configPath())
	return omap(cfg.Get("roomService"))
}

func (s *Server) ordersPath() string { return s.persistPath("room-service-orders.json") }

// loadOrders reads the orders file as ordered maps (newest first).
func (s *Server) loadOrders() []*OMap {
	out := []*OMap{}
	b, err := os.ReadFile(s.ordersPath())
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

func (s *Server) saveOrders(orders []*OMap) error {
	if len(orders) > roomServiceMaxOrders {
		orders = orders[:roomServiceMaxOrders]
	}
	b, err := json.MarshalIndent(orders, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.persistPath(""), 0o755); err != nil {
		return err
	}
	tmp := s.ordersPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.ordersPath())
}

// menuPublic returns the menu config a guest page needs — available items only,
// no secret key.
func (s *Server) menuPublic() *OMap {
	cfg := readConfigOrdered(s.configPath())
	rs := omap(cfg.Get("roomService"))
	st := omap(rs.Get("stripe"))
	currency := jsString(rs.Get("currency"))
	if currency == "" {
		currency = "PLN"
	}
	items := []any{}
	for _, it := range arr(rs.Get("menu")) {
		m := omap(it)
		if v := m.Get("available"); v != nil && v != true {
			continue
		}
		items = append(items, OM(
			"id", jsString(m.Get("id")),
			"category", jsString(m.Get("category")),
			"name", jsString(m.Get("name")),
			"desc", jsString(m.Get("desc")),
			"price", jsNumber(m.Get("price")),
		))
	}
	stripeEnabled := st.Get("enabled") == true && jsString(st.Get("publishableKey")) != ""
	return OM(
		"enabled", rs.Get("enabled") == true && s.lic().Limits.Hotel,
		"title", jsString(rs.Get("title")),
		"currency", currency,
		"payToRoom", rs.Get("payToRoom") != false, // default true
		"stripe", OM("enabled", stripeEnabled, "publishableKey", jsString(st.Get("publishableKey"))),
		"menu", items,
		"hideHotelServices", cfg.Get("hideHotelServices") == true,
	)
}

// priceItems validates the client's cart against the menu and returns the
// priced line items + total. The server never trusts a client-sent price.
func (s *Server) priceItems(cart any) (lines []any, total float64) {
	byID := map[string]*OMap{}
	for _, it := range arr(s.rsConfig().Get("menu")) {
		m := omap(it)
		if m.Get("available") != false {
			byID[jsString(m.Get("id"))] = m
		}
	}
	for _, ci := range arr(cart) {
		c := omap(ci)
		id := jsString(c.Get("id"))
		qty := int(jsNumber(c.Get("qty")))
		if qty < 1 || qty > 99 {
			continue
		}
		m := byID[id]
		if m == nil {
			continue
		}
		price := jsNumber(m.Get("price"))
		total += price * float64(qty)
		lines = append(lines, OM("id", id, "name", jsString(m.Get("name")), "price", price, "qty", qty))
	}
	return lines, math.Round(total*100) / 100
}

func (s *Server) roomServiceRoutes(api *http.ServeMux) {
	// ── Public guest endpoints (/api/order/* — see publicAPI) ──────────────

	// GET /api/order/menu — the menu + options for the guest page.
	api.HandleFunc("GET /api/order/menu", func(w http.ResponseWriter, r *http.Request) {
		m := s.menuPublic()
		if m.Get("enabled") != true {
			fail(w, 404, "Room service is not available")
			return
		}
		ok(w, m)
	})

	// POST /api/order/place — place an order.
	// { room, items:[{id,qty}], note, payment:"room"|"card", paymentIntentId? }
	api.HandleFunc("POST /api/order/place", func(w http.ResponseWriter, r *http.Request) {
		rs := s.rsConfig()
		if rs.Get("enabled") != true || !s.lic().Limits.Hotel {
			fail(w, 404, "Room service is not available")
			return
		}
		b := readBody(r)
		lines, total := s.priceItems(b.Get("items"))
		if len(lines) == 0 {
			fail(w, 400, "Your order is empty")
			return
		}
		room := strings.TrimSpace(jsString(b.Get("room")))
		payment := jsString(b.Get("payment"))
		if payment != "card" {
			payment = "room"
		}
		if payment == "room" && rs.Get("payToRoom") == false {
			fail(w, 400, "Charging to the room isn’t available — please pay now")
			return
		}
		currency := jsString(rs.Get("currency"))
		if currency == "" {
			currency = "PLN"
		}
		paid := false
		if payment == "card" {
			// Verify the Stripe PaymentIntent really succeeded for this amount.
			pi := jsString(b.Get("paymentIntentId"))
			okPaid, err := s.stripeVerify(pi, total, currency)
			if err != nil {
				fail(w, 502, "Couldn’t confirm the payment: "+err.Error())
				return
			}
			if !okPaid {
				fail(w, 402, "Payment not completed")
				return
			}
			paid = true
		}
		order := OM(
			"id", base36Now()+randSuffix(3),
			"at", time.Now().UnixMilli(),
			"room", room,
			"items", lines,
			"total", total,
			"currency", currency,
			"note", strings.TrimSpace(jsString(b.Get("note"))),
			"payment", payment,
			"paid", paid,
			"status", "new",
			"ackAt", 0,
		)
		roomServiceMu.Lock()
		orders := append([]*OMap{order}, s.loadOrders()...)
		err := s.saveOrders(orders)
		roomServiceMu.Unlock()
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		s.notifyOrder(order)
		ok(w, order)
	})

	// POST /api/order/pay — create a Stripe PaymentIntent for the cart.
	// { room, items:[{id,qty}] } → { clientSecret, publishableKey, paymentIntentId, amount, currency }
	api.HandleFunc("POST /api/order/pay", func(w http.ResponseWriter, r *http.Request) {
		rs := s.rsConfig()
		st := omap(rs.Get("stripe"))
		if rs.Get("enabled") != true || !s.lic().Limits.Hotel || st.Get("enabled") != true || jsString(st.Get("secretKey")) == "" {
			fail(w, 400, "Card payment isn’t enabled")
			return
		}
		b := readBody(r)
		_, total := s.priceItems(b.Get("items"))
		if total <= 0 {
			fail(w, 400, "Your order is empty")
			return
		}
		currency := jsString(rs.Get("currency"))
		if currency == "" {
			currency = "PLN"
		}
		pi, err := s.stripeCreateIntent(total, currency, jsString(b.Get("room")))
		if err != nil {
			fail(w, 502, "Payment setup failed: "+err.Error())
			return
		}
		ok(w, OM(
			"clientSecret", jsString(pi.Get("client_secret")),
			"paymentIntentId", jsString(pi.Get("id")),
			"publishableKey", jsString(st.Get("publishableKey")),
			"amount", jsNumber(pi.Get("amount")),
			"currency", currency,
		))
	})

	// ── Admin endpoints (/api/room-service/* — behind auth+admin) ──────────

	// GET /api/room-service — full config for Settings (secret masked).
	api.HandleFunc("GET /api/room-service", s.admin(func(w http.ResponseWriter, r *http.Request) {
		rs := s.rsConfig().Clone()
		st := omap(rs.Get("stripe")).Clone()
		if jsString(st.Get("secretKey")) != "" {
			st.Set("secretKey", bullets)
		}
		rs.Set("stripe", st)
		cfg := readConfigOrdered(s.configPath())
		ok(w, OM("roomService", rs, "hideHotelServices", cfg.Get("hideHotelServices") == true))
	}))

	// GET /api/room-service/orders — the live order list.
	api.HandleFunc("GET /api/room-service/orders", s.admin(func(w http.ResponseWriter, r *http.Request) {
		roomServiceMu.Lock()
		orders := s.loadOrders()
		roomServiceMu.Unlock()
		out := make([]any, len(orders))
		for i, o := range orders {
			out[i] = o
		}
		ok(w, out)
	}))

	// POST /api/room-service/orders/{id}/ack — acknowledge an order.
	api.HandleFunc("POST /api/room-service/orders/{id}/ack", s.admin(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		roomServiceMu.Lock()
		orders := s.loadOrders()
		var found *OMap
		for _, o := range orders {
			if jsString(o.Get("id")) == id {
				o.Set("status", "ack")
				o.Set("ackAt", time.Now().UnixMilli())
				found = o
				break
			}
		}
		var err error
		if found != nil {
			err = s.saveOrders(orders)
		}
		roomServiceMu.Unlock()
		if found == nil {
			fail(w, 404, "No such order")
			return
		}
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		s.sio.Emit("room-service", nil)
		ok(w, found)
	}))

	// DELETE /api/room-service/orders/{id} — remove one order, or all with id=all.
	api.HandleFunc("DELETE /api/room-service/orders/{id}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		roomServiceMu.Lock()
		var kept []*OMap
		if id != "all" {
			for _, o := range s.loadOrders() {
				if jsString(o.Get("id")) != id {
					kept = append(kept, o)
				}
			}
		}
		err := s.saveOrders(kept)
		roomServiceMu.Unlock()
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		s.sio.Emit("room-service", nil)
		ok(w, OM("success", true))
	}))

	// POST /api/settings/room-service — save the menu + options (admin).
	api.HandleFunc("POST /api/settings/room-service", s.admin(func(w http.ResponseWriter, r *http.Request) {
		b := readBody(r)
		cfg := readConfigOrdered(s.configPath())
		prev := omap(cfg.Get("roomService"))
		rs := omap(b.Get("roomService"))

		// keep the stored Stripe secret when the form sends back the mask
		st := omap(rs.Get("stripe"))
		if masked8(jsString(st.Get("secretKey"))) {
			st.Set("secretKey", jsString(omap(prev.Get("stripe")).Get("secretKey")))
			rs.Set("stripe", st)
		}
		cfg.Set("roomService", rs)
		if v := b.Get("hideHotelServices"); v != nil {
			cfg.Set("hideHotelServices", v == true)
		}
		if err := writeConfigFile(s.configPath(), cfg); err != nil {
			fail(w, 500, err.Error())
			return
		}
		ok(w, OM("success", true))
	}))
}

func (s *Server) notifyOrder(order *OMap) {
	room := jsString(order.Get("room"))
	if room == "" {
		room = "guest"
	}
	n := 0
	for _, it := range arr(order.Get("items")) {
		n += int(jsNumber(omap(it).Get("qty")))
	}
	pay := "→ room"
	if jsString(order.Get("payment")) == "card" {
		pay = "paid by card"
	}
	msg := fmt.Sprintf("Room service — %s: %d item(s), %.2f %s (%s)",
		room, n, jsNumber(order.Get("total")), jsString(order.Get("currency")), pay)
	if s.auto != nil {
		s.auto.Notify("info", msg, "room-service")
	}
	s.sio.Emit("room-service-order", order)
	s.sio.Emit("room-service", nil)
}

// ── Stripe (server side) ────────────────────────────────────────────────────

func (s *Server) stripeSecret() string {
	return jsString(omap(s.rsConfig().Get("stripe")).Get("secretKey"))
}

func (s *Server) stripeCreateIntent(total float64, currency, room string) (*OMap, error) {
	sk := s.stripeSecret()
	if sk == "" {
		return nil, fmt.Errorf("Stripe not configured")
	}
	amount := int64(math.Round(total * 100)) // smallest currency unit
	form := url.Values{}
	form.Set("amount", fmt.Sprintf("%d", amount))
	form.Set("currency", strings.ToLower(currency))
	form.Set("automatic_payment_methods[enabled]", "true")
	form.Set("description", "Room service")
	if room != "" {
		form.Set("metadata[room]", room)
	}
	return stripeCall(sk, "POST", "https://api.stripe.com/v1/payment_intents", form)
}

// stripeVerify confirms a PaymentIntent succeeded for (at least) the expected
// amount in the expected currency.
func (s *Server) stripeVerify(id string, total float64, currency string) (bool, error) {
	sk := s.stripeSecret()
	if sk == "" || id == "" {
		return false, fmt.Errorf("missing payment reference")
	}
	pi, err := stripeCall(sk, "GET", "https://api.stripe.com/v1/payment_intents/"+url.PathEscape(id), nil)
	if err != nil {
		return false, err
	}
	want := int64(math.Round(total * 100))
	return jsString(pi.Get("status")) == "succeeded" &&
		int64(jsNumber(pi.Get("amount_received"))) >= want &&
		strings.EqualFold(jsString(pi.Get("currency")), currency), nil
}

func stripeCall(secret, method, endpoint string, form url.Values) (*OMap, error) {
	var body *strings.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	} else {
		body = strings.NewReader("")
	}
	req, err := http.NewRequest(method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := stripeHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw := json.RawMessage{}
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	o, _ := rawOrdered(raw).(*OMap)
	if o == nil {
		o = NewOMap()
	}
	if resp.StatusCode >= 300 {
		if e := omap(o.Get("error")); e.Len() > 0 {
			return nil, fmt.Errorf("%s", jsString(e.Get("message")))
		}
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return o, nil
}
