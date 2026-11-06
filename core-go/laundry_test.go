package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func laundryServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "persist"), 0o755)
	cfg := `{"laundry":{"enabled":true,"currency":"EUR","expressSurchargePct":50,"standardHours":24,"expressHours":4,"rooms":["101"],
	  "items":[{"id":"shirt","name":"Shirt","price":25},{"id":"coat","name":"Coat","price":90.5},{"id":"hidden","name":"Hidden","price":1,"available":false}]}}`
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &Server{root: root, license: &LicenseInfo{Tier: "hotel", Limits: licenseTiers["hotel"]}}
	api := http.NewServeMux()
	s.laundryRoutes(api)
	ts := httptest.NewServer(api)
	t.Cleanup(ts.Close)
	return s, ts
}

func laundryPost(t *testing.T, url, body string) (int, map[string]any) {
	t.Helper()
	r, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var out map[string]any
	json.NewDecoder(r.Body).Decode(&out)
	data, _ := out["data"].(map[string]any)
	return r.StatusCode, data
}

func TestLaundryPricingAndValidation(t *testing.T) {
	_, ts := laundryServer(t)
	place := ts.URL + "/api/order/laundry/place"

	code, o := laundryPost(t, place, `{"room":"101","express":true,"items":[{"id":"shirt","qty":2,"price":0},{"id":"coat","qty":1},{"id":"hidden","qty":5},{"id":"nope","qty":1},{"id":"shirt","qty":100}]}`)
	if code != 200 {
		t.Fatalf("place: %d", code)
	}
	if len(o["items"].([]any)) != 2 || o["subtotal"] != 140.5 || o["surcharge"] != 70.25 || o["total"] != 210.75 {
		t.Fatalf("pricing wrong: %v", o)
	}
	if o["payment"] != "room" || o["paid"] != false || o["status"] != "requested" || o["pickup"] != "As soon as possible" {
		t.Fatalf("defaults wrong: %v", o)
	}
	if d := o["dueAt"].(float64) - o["at"].(float64); d != 4*3600000 {
		t.Fatalf("express due wrong: %v", d)
	}
	for _, body := range []string{
		`{"room":"","items":[{"id":"shirt","qty":1}]}`,
		`{"room":"999","items":[{"id":"shirt","qty":1}]}`,
		`{"room":"101","items":[]}`,
	} {
		if code, _ := laundryPost(t, place, body); code != 400 {
			t.Fatalf("%s: want 400, got %d", body, code)
		}
	}
}

// Optional fields left out of a request must not become the string "null".
func TestLaundryMissingFieldsStayEmpty(t *testing.T) {
	s, ts := laundryServer(t)
	place := ts.URL + "/api/order/laundry/place"
	if code, _ := laundryPost(t, place, `{"items":[{"id":"shirt","qty":1}]}`); code != 400 {
		t.Fatalf("a missing room must be refused, got %d", code)
	}
	_, o := laundryPost(t, place, `{"room":"101","items":[{"id":"shirt","qty":1}]}`)
	if o["note"] != "" {
		t.Fatalf("note = %q", o["note"])
	}
	cfg := readConfigOrdered(s.configPath())
	l := omap(cfg.Get("laundry"))
	l.Delete("currency")
	cfg.Set("laundry", l)
	if err := writeConfigFile(s.configPath(), cfg); err != nil {
		t.Fatal(err)
	}
	m := s.laundryPublic()
	if m.Get("currency") != "PLN" || m.Get("title") != "" {
		t.Fatalf("currency %q, title %q", m.Get("currency"), m.Get("title"))
	}
}

func TestLaundryLicenseGate(t *testing.T) {
	s, ts := laundryServer(t)
	s.license = &LicenseInfo{Tier: "free", Limits: licenseTiers["free"]}
	if code, _ := laundryPost(t, ts.URL+"/api/order/laundry/place", `{"room":"101","items":[{"id":"shirt","qty":1}]}`); code != 404 {
		t.Fatalf("want 404 without the hotel plan, got %d", code)
	}
}

func TestLaundryTrackerHidesRoomAndNote(t *testing.T) {
	_, ts := laundryServer(t)
	_, o := laundryPost(t, ts.URL+"/api/order/laundry/place", `{"room":"101","note":"Silk","items":[{"id":"shirt","qty":1}]}`)
	r, err := http.Get(ts.URL + "/api/order/laundry/status/" + o["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var out struct{ Data map[string]any }
	json.NewDecoder(r.Body).Decode(&out)
	if out.Data["status"] != "requested" || out.Data["room"] != nil || out.Data["note"] != nil {
		t.Fatalf("tracker reply wrong: %v", out.Data)
	}
}

func TestLaundryTrimKeepsOpenOrders(t *testing.T) {
	orders := []*OMap{}
	for i := 0; i < laundryMaxOrders; i++ {
		orders = append(orders, OM("id", i, "status", "delivered"))
	}
	open := OM("id", "old-open", "status", "cleaning")
	kept := trimLaundryOrders(append(orders, open))
	if len(kept) != laundryMaxOrders || kept[len(kept)-1] != open {
		t.Fatalf("open order dropped: %d", len(kept))
	}
}

func TestLaundryOverdueFlagsOnce(t *testing.T) {
	s, _ := laundryServer(t)
	past := time.Now().Add(-time.Hour).UnixMilli()
	if err := s.saveLaundryOrders([]*OMap{
		OM("id", "late", "room", "101", "status", "cleaning", "dueAt", past),
		OM("id", "done", "room", "101", "status", "delivered", "dueAt", past),
	}); err != nil {
		t.Fatal(err)
	}
	NewN8n(s).checkLaundryOverdue()
	got := s.loadLaundryOrders()
	if got[0].Get("overdueN8n") != true || got[1].Get("overdueN8n") == true {
		t.Fatalf("flags wrong: %v %v", got[0].Get("overdueN8n"), got[1].Get("overdueN8n"))
	}
}
