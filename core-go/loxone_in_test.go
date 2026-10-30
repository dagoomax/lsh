package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
)

// A fake Miniserver: token auth over the WebSocket (the client's hash is
// checked), LoxAPP3.json, binary value-state events, HTTP commands.
type miniserver struct {
	mu       sync.Mutex
	commands []string
	authOK   bool
	wmu      sync.Mutex // one writer at a time on ws
	ws       *websocket.Conn
}

const (
	lxCtrl  = "1a2b3c4d-0001-0002-0102030405060708"
	lxState = "1a2b3c4d-0001-0003-1112131415161718"
	lxKey   = "41424344"
	lxSalt  = "s4lt"
)

func lxUUID(s string) []byte {
	p := strings.Split(s, "-")
	b := make([]byte, 16)
	var a uint64
	fmt.Sscanf(p[0], "%x", &a)
	binary.LittleEndian.PutUint32(b[0:], uint32(a))
	fmt.Sscanf(p[1], "%x", &a)
	binary.LittleEndian.PutUint16(b[4:], uint16(a))
	fmt.Sscanf(p[2], "%x", &a)
	binary.LittleEndian.PutUint16(b[6:], uint16(a))
	raw, _ := hex.DecodeString(p[3])
	copy(b[8:], raw)
	return b
}

func (m *miniserver) send(typ byte, payload []byte, text bool) {
	m.wmu.Lock()
	defer m.wmu.Unlock()
	hdr := []byte{0x03, typ, 0, 0, 0, 0, 0, 0}
	binary.LittleEndian.PutUint32(hdr[4:], uint32(len(payload)))
	m.ws.WriteMessage(websocket.BinaryMessage, hdr)
	kind := websocket.BinaryMessage
	if text {
		kind = websocket.TextMessage
	}
	m.ws.WriteMessage(kind, payload)
}

func (m *miniserver) value(v float64) {
	p := append(lxUUID(lxState), make([]byte, 8)...)
	binary.LittleEndian.PutUint64(p[16:], math.Float64bits(v))
	m.send(2, p, false)
}

func (m *miniserver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/ws/rfc6455":
		up := websocket.Upgrader{}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		m.wmu.Lock()
		m.ws = c
		m.wmu.Unlock()
		for {
			_, msg, err := c.ReadMessage()
			if err != nil {
				return
			}
			cmd := string(msg)
			switch {
			case cmd == "jdev/sys/getkey2/admin":
				m.send(0, []byte(fmt.Sprintf(`{"LL":{"control":"%s","value":{"key":"%s","salt":"%s","hashAlg":"SHA256"},"Code":"200"}}`, cmd, lxKey, lxSalt)), true)
			case strings.HasPrefix(cmd, "jdev/sys/gettoken/"):
				pw := sha256.Sum256([]byte("pw:" + lxSalt))
				key, _ := hex.DecodeString(lxKey)
				mac := hmac.New(sha256.New, key)
				mac.Write([]byte("admin:" + strings.ToUpper(hex.EncodeToString(pw[:]))))
				want := hex.EncodeToString(mac.Sum(nil))
				m.mu.Lock()
				m.authOK = strings.Split(cmd, "/")[3] == want
				m.mu.Unlock()
				m.send(0, []byte(`{"LL":{"control":"`+cmd+`","value":{"token":"tok"},"Code":"200"}}`), true)
			case cmd == "jdev/sps/enablebinstatusupdate":
				m.value(1)
			}
		}
	case r.URL.Path == "/data/LoxAPP3.json":
		w.Write([]byte(`{"rooms":{"r1":{"name":"Salon"}},"controls":{"` + lxCtrl + `":{"type":"Switch","name":"Lampa","room":"r1","states":{"active":"` + lxState + `"}},"x":{"type":"NoSuchType"}}}`))
	case strings.HasPrefix(r.URL.Path, "/jdev/sps/io/"):
		u, p, _ := r.BasicAuth()
		m.mu.Lock()
		m.commands = append(m.commands, u+":"+p+" "+r.URL.Path)
		m.mu.Unlock()
	}
}

func TestLoxoneInModuleProcess(t *testing.T) {
	ms := &miniserver{}
	srv := httptest.NewServer(ms)
	defer srv.Close()
	host, port := hostPort(srv.URL)
	cfg := map[string]any{"loxone": map[string]any{"host": host, "port": port, "username": "admin", "password": "pw"}}

	root, _ := filepath.Abs("..")
	store := NewStore("")
	reg := NewRegistry(store, "")
	ps := NewPlatformStatus()
	mh := NewModuleHost(root, "node", store, reg, ps, func() (map[string]any, error) { return cfg, nil }, 512)
	t.Cleanup(mh.StopAll)
	it := loxoneInModule(cfg, root)
	if !it.On || !it.Installed {
		t.Fatalf("%+v", it)
	}
	mh.Add(it)

	key := "loxone/" + lxCtrl
	waitFor(t, "device", func() bool { return reg.Has(key) })
	waitFor(t, "value", func() bool { return store.Get(key+"/active") == true })
	ms.mu.Lock()
	ok := ms.authOK
	ms.mu.Unlock()
	if !ok {
		t.Fatal("client's token hash didn't match")
	}
	if l := reg.Device(key).Get("label"); l != "Lampa (Salon)" {
		t.Fatalf("label %v", l)
	}
	if !ps.All()["loxone"] {
		t.Fatalf("platform %v", ps.All())
	}

	// a value event from the Miniserver, and a command back to it
	ms.value(0)
	waitFor(t, "off event", func() bool { return store.Get(key+"/active") == false })
	if err := reg.SendCommand(key, "active", "on"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "command", func() bool {
		ms.mu.Lock()
		defer ms.mu.Unlock()
		return len(ms.commands) == 1 && ms.commands[0] == "admin:pw /jdev/sps/io/"+lxCtrl+"/On"
	})
}
