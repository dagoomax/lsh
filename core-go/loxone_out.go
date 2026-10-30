package main

// Loxone Outbound Push — port of src/loxone-out-client.js. Mapped store keys
// go to Miniserver Virtual Inputs as they change:
// GET http://<miniserver>/dev/sps/io/<name>/<value> (Basic auth). Numbers go
// to a Virtual Input, text to a Virtual Text Input. Debounced 200 ms per key;
// only a value that differs from the last one sent goes out; a failed send is
// retried on the next change. On start every mapped key that has a value is
// sent once.

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"
)

const (
	loxoneDebounce = 200 * time.Millisecond
	loxoneMaxText  = 512
)

var loxoneCodeRe = regexp.MustCompile(`Code="(\d+)"`)

type LoxoneOut struct {
	host, user, pass string
	port             int
	store            *Store
	ps               *PlatformStatus
	http             *http.Client

	mu        sync.Mutex
	keyMap    map[string][]string // storeKey → virtual inputs
	timers    map[string]*time.Timer
	last      map[string]string // virtual input → last value sent
	stopped   bool
	unsub     func()
	LastError string
	Sent      int
}

func loxoneOutFrom(cfg map[string]any, store *Store, ps *PlatformStatus) *LoxoneOut {
	c := section(cfg, "loxoneOut")
	port := int(jsNumber(c["port"]))
	if port == 0 {
		port = 80
	}
	user := str(c, "username")
	if user == "" {
		user = "admin"
	}
	o := &LoxoneOut{host: str(c, "host"), port: port, user: user, pass: str(c, "password"), store: store, ps: ps,
		http: &http.Client{Timeout: 5 * time.Second}, keyMap: map[string][]string{}, timers: map[string]*time.Timer{}, last: map[string]string{}}
	for _, x := range arr(c["mappings"]) {
		m, _ := x.(map[string]any)
		k, vi := str(m, "storeKey"), str(m, "virtualInput")
		if k != "" && vi != "" {
			o.keyMap[k] = append(o.keyMap[k], vi)
		}
	}
	return o
}

// Start begins pushing; false when there's nothing configured.
func (o *LoxoneOut) Start(mappings int) bool {
	if o.host == "" || mappings == 0 {
		return false
	}
	o.unsub = o.store.OnChange(func(c Change) { o.onChange(c.Key, c.Value) })
	log.Printf("[LoxoneOut] Started — %d mapping(s) → %s", mappings, o.host)
	o.ps.Set("loxoneOut", true)
	o.mu.Lock()
	keys := make([]string, 0, len(o.keyMap))
	for k := range o.keyMap {
		keys = append(keys, k)
	}
	o.mu.Unlock()
	for _, k := range keys {
		if v := o.store.Get(k); v != nil {
			o.send(k, v)
		}
	}
	return true
}

func (o *LoxoneOut) onChange(key string, value any) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.stopped || o.keyMap[key] == nil {
		return
	}
	if t := o.timers[key]; t != nil {
		t.Stop()
	}
	o.timers[key] = time.AfterFunc(loxoneDebounce, func() { o.send(key, value) })
}

// Stop detaches it: Settings replaces the client with a new one on save.
func (o *LoxoneOut) Stop() {
	if o.unsub != nil {
		o.unsub()
	}
	o.mu.Lock()
	o.stopped = true
	for k, t := range o.timers {
		t.Stop()
		delete(o.timers, k)
	}
	o.mu.Unlock()
}

func loxoneValue(value any) any {
	switch v := value.(type) {
	case bool:
		if v {
			return 1.0
		}
		return 0.0
	case nil, undefinedT:
		return 0.0
	}
	return value
}

func (o *LoxoneOut) send(key string, value any) {
	v := jsString(loxoneValue(value))
	o.mu.Lock()
	if o.stopped {
		o.mu.Unlock()
		return
	}
	var todo []string
	for _, vi := range o.keyMap[key] {
		if last, ok := o.last[vi]; ok && last == v {
			continue
		}
		o.last[vi] = v
		todo = append(todo, vi)
	}
	o.mu.Unlock()
	for _, vi := range todo {
		go func(vi string) {
			if _, err := o.Push(vi, value); err != nil {
				o.mu.Lock()
				delete(o.last, vi) // failed: try again on the next change
				o.mu.Unlock()
			}
		}(vi)
	}
}

// Push sends one value now and returns the Miniserver's code.
func (o *LoxoneOut) Push(virtualInput string, value any) (int, error) {
	v := utf16Slice(jsString(loxoneValue(value)), loxoneMaxText)
	url := fmt.Sprintf("http://%s:%d/dev/sps/io/%s/%s", o.host, o.port, encodeURIComponent(virtualInput), encodeURIComponent(v))
	fail := func(msg string) (int, error) {
		o.mu.Lock()
		o.LastError = virtualInput + ": " + msg
		o.mu.Unlock()
		log.Printf("[LoxoneOut] %s: %s", virtualInput, msg)
		return 0, errors.New(msg)
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fail(err.Error())
	}
	req.SetBasicAuth(o.user, o.pass)
	res, err := o.http.Do(req)
	if err != nil {
		if isTimeout(err) {
			return fail("timed out")
		}
		return fail(err.Error())
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	code := res.StatusCode
	if m := loxoneCodeRe.FindSubmatch(body); m != nil {
		if n, _ := strconv.Atoi(string(m[1])); n != 0 {
			code = n
		}
	}
	if res.StatusCode == 401 {
		return fail("the Miniserver refused the user name / password (HTTP 401)")
	}
	if code >= 400 {
		return fail(fmt.Sprintf("no Virtual Input called “%s” on the Miniserver (%d)", virtualInput, code))
	}
	o.mu.Lock()
	o.Sent++
	o.LastError = ""
	o.mu.Unlock()
	return code, nil
}

func isTimeout(err error) bool {
	type timeout interface{ Timeout() bool }
	var t timeout
	return errors.As(err, &t) && t.Timeout()
}
