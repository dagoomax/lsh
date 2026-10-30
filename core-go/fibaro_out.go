package main

// Fibaro Home Center outbound — port of src/fibaro-out-client.js: live store
// values → HC2/HC3 global variables. Mappings, mixed freely:
//
//	{ "storeKey": "satel/partition/1/armed", "variable": "LSH_SatelArmed" }
//	{ "storePrefix": "satel/zone/", "variablePrefix": "LSH_satel_zone_" }
//
// A prefix rule maps every key under storePrefix, the remainder appended
// with non [A-Za-z0-9_] → _ (satel/zone/3/state → LSH_satel_zone_3_state).
// Missing variables are created (409 on create → it exists, update instead).
// Values are strings; booleans 1/0.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// fibaroSanitize is String(name).replace(/[^A-Za-z0-9_]/g, '_') — per UTF-16
// code unit, so an emoji becomes "__" as in Node.
func fibaroSanitize(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_':
			b.WriteRune(r)
		case r > 0xFFFF:
			b.WriteString("__")
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}

func fibaroString(v any) string {
	switch v {
	case true:
		return "1"
	case false:
		return "0"
	}
	return jsString(loxoneValue(v)) // value ?? 0
}

type fibaroPrefix struct{ storePrefix, variablePrefix string }

type httpStatusError struct {
	status int
	msg    string
}

func (e *httpStatusError) Error() string { return e.msg }

type FibaroOut struct {
	host, user, pass string
	port             int
	store            *Store
	ps               *PlatformStatus
	http             *http.Client

	mu       sync.Mutex
	keyMap   map[string]string
	prefixes []fibaroPrefix
	existing map[string]bool
	timers   map[string]*time.Timer
	last     map[string]string
	stopped  bool
	unsub    func()
}

func fibaroOutFrom(cfg map[string]any, store *Store, ps *PlatformStatus) *FibaroOut {
	c := section(cfg, "fibaroOut")
	port := int(jsNumber(c["port"]))
	if port == 0 {
		port = 80
	}
	user := str(c, "username")
	if user == "" {
		user = "admin"
	}
	f := &FibaroOut{host: str(c, "host"), port: port, user: user, pass: str(c, "password"), store: store, ps: ps,
		http: &http.Client{Timeout: 8 * time.Second}, keyMap: map[string]string{}, existing: map[string]bool{},
		timers: map[string]*time.Timer{}, last: map[string]string{}}
	for _, x := range arr(c["mappings"]) {
		m, _ := x.(map[string]any)
		if k, v := str(m, "storeKey"), str(m, "variable"); k != "" && v != "" {
			f.keyMap[k] = fibaroSanitize(v)
		} else if p, vp := str(m, "storePrefix"), str(m, "variablePrefix"); p != "" && vp != "" {
			f.prefixes = append(f.prefixes, fibaroPrefix{p, vp})
		}
	}
	return f
}

func (f *FibaroOut) Start(mappings int) bool {
	if f.host == "" || mappings == 0 {
		return false
	}
	var vars []map[string]any
	if err := f.request("GET", "/api/globalVariables", nil, &vars); err != nil {
		log.Printf("[FibaroOut] Cannot list global variables: %v", err)
		f.ps.Set("fibaroOut", false) // variables are also created on first push
	} else {
		f.mu.Lock()
		for _, v := range vars {
			if n, ok := v["name"].(string); ok {
				f.existing[n] = true
			}
		}
		f.mu.Unlock()
		f.ps.Set("fibaroOut", true)
	}
	for key, value := range f.store.GetAll() {
		if name := f.variableFor(key); name != "" {
			go f.push(name, value)
		}
	}
	f.unsub = f.store.OnChange(func(c Change) {
		name := f.variableFor(c.Key)
		if name == "" {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.stopped {
			return
		}
		if t := f.timers[c.Key]; t != nil {
			t.Stop()
		}
		v := c.Value
		f.timers[c.Key] = time.AfterFunc(200*time.Millisecond, func() { f.push(name, v) })
	})
	log.Printf("[FibaroOut] Started — %d mapping rule(s) → %s", len(f.keyMap)+len(f.prefixes), f.host)
	return true
}

func (f *FibaroOut) Stop() {
	if f.unsub != nil {
		f.unsub()
	}
	f.mu.Lock()
	f.stopped = true
	for k, t := range f.timers {
		t.Stop()
		delete(f.timers, k)
	}
	f.mu.Unlock()
}

func (f *FibaroOut) variableFor(key string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if n := f.keyMap[key]; n != "" {
		return n
	}
	for _, p := range f.prefixes {
		if strings.HasPrefix(key, p.storePrefix) {
			return fibaroSanitize(p.variablePrefix + key[len(p.storePrefix):])
		}
	}
	return ""
}

func (f *FibaroOut) push(name string, value any) {
	s := fibaroString(value)
	f.mu.Lock()
	if last, ok := f.last[name]; f.stopped || (ok && last == s) {
		f.mu.Unlock()
		return
	}
	f.last[name] = s
	exists := f.existing[name]
	f.mu.Unlock()
	body := map[string]string{"name": name, "value": s}
	var err error
	if !exists {
		if err = f.request("POST", "/api/globalVariables", body, nil); err == nil {
			f.mu.Lock()
			f.existing[name] = true
			f.mu.Unlock()
			log.Printf("[FibaroOut] Created global variable %s", name)
		}
	} else {
		err = f.request("PUT", "/api/globalVariables/"+encodeURIComponent(name), body, nil)
	}
	if err == nil {
		f.ps.Set("fibaroOut", true)
		return
	}
	f.mu.Lock()
	delete(f.last, name) // failed: try again on the next change
	var se *httpStatusError
	conflict := !exists && errorAs(err, &se) && se.status == 409
	if conflict {
		f.existing[name] = true // created since we listed — update instead
	}
	f.mu.Unlock()
	if conflict {
		f.push(name, value)
		return
	}
	log.Printf("[FibaroOut] %s=%s: %v", name, s, err)
	f.ps.Set("fibaroOut", false)
}

func (f *FibaroOut) request(method, path string, body any, into any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, fmt.Sprintf("http://%s:%d%s", f.host, f.port, path), rd)
	if err != nil {
		return err
	}
	req.SetBasicAuth(f.user, f.pass)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := f.http.Do(req)
	if err != nil {
		if isTimeout(err) {
			return fmt.Errorf("Timeout")
		}
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := fmt.Sprintf("HTTP %d", res.StatusCode)
		if len(raw) > 0 {
			msg += ": " + utf16Slice(string(raw), 120)
		}
		return &httpStatusError{res.StatusCode, msg}
	}
	if into != nil && len(raw) > 0 {
		json.Unmarshal(raw, into)
	}
	return nil
}
