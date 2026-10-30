package main

// Minimal Socket.IO v4 server (Engine.IO protocol 4, websocket transport
// only) — enough for the dashboard, whose client connects with
// transports: ['websocket', 'polling'] and only listens for server events.
//
//   engine.io: "0{sid,…}" open, "2"/"3" ping/pong (server pings), "4…" message
//   socket.io: "40" connect (→ "40{sid}"), "42[event, data]" event,
//              "44{message}" connect error, "41" disconnect

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	sioPingInterval = 25 * time.Second
	sioPingTimeout  = 20 * time.Second
)

type SioClient struct {
	id   string
	conn *websocket.Conn
	out  chan []byte
	done chan struct{}
	once sync.Once
}

type SocketIO struct {
	mu        sync.Mutex
	clients   map[*SioClient]bool
	authorize func(r *http.Request, auth map[string]any) bool
	onConnect func(emit func(event string, data any))
	upgrader  websocket.Upgrader
}

func NewSocketIO(authorize func(*http.Request, map[string]any) bool, onConnect func(emit func(string, any))) *SocketIO {
	return &SocketIO{
		clients: map[*SioClient]bool{}, authorize: authorize, onConnect: onConnect,
		upgrader: websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 64 * 1024, CheckOrigin: func(*http.Request) bool { return true }},
	}
}

func sid() string {
	b := make([]byte, 15)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func eventPacket(event string, data any) []byte {
	b, err := json.Marshal([]any{event, data})
	if err != nil {
		return nil
	}
	return append([]byte("2"), b...) // socket.io EVENT; writeLoop adds the engine "4"
}

func (s *SocketIO) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("EIO") != "4" || q.Get("transport") != "websocket" {
		// No long-polling: the client then upgrades straight to websocket.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"code":0,"message":"Transport unknown"}`))
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &SioClient{id: sid(), conn: conn, out: make(chan []byte, 256), done: make(chan struct{})}
	open, _ := json.Marshal(map[string]any{"sid": c.id, "upgrades": []string{}, "pingInterval": sioPingInterval.Milliseconds(), "pingTimeout": sioPingTimeout.Milliseconds(), "maxPayload": 1000000})
	conn.WriteMessage(websocket.TextMessage, append([]byte("0"), open...))
	go s.writeLoop(c)
	s.readLoop(c, r)
}

func (s *SocketIO) close(c *SioClient) {
	c.once.Do(func() {
		close(c.done)
		c.conn.Close()
		s.mu.Lock()
		was := s.clients[c]
		delete(s.clients, c)
		s.mu.Unlock()
		if was {
			log.Printf("[WS] Client disconnected (%s)", c.id)
		}
	})
}

func (c *SioClient) send(p []byte) {
	select {
	case c.out <- p:
	case <-c.done:
	default: // a browser that can't keep up misses a batch; the 15 s REST refresh catches it up
	}
}

func (s *SocketIO) writeLoop(c *SioClient) {
	ping := time.NewTicker(sioPingInterval)
	defer ping.Stop()
	for {
		select {
		case p := <-c.out:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if c.conn.WriteMessage(websocket.TextMessage, append([]byte("4"), p...)) != nil {
				s.close(c)
				return
			}
		case <-ping.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if c.conn.WriteMessage(websocket.TextMessage, []byte("2")) != nil {
				s.close(c)
				return
			}
		case <-c.done:
			return
		}
	}
}

func (s *SocketIO) readLoop(c *SioClient, r *http.Request) {
	defer s.close(c)
	c.conn.SetReadLimit(1 << 20)
	for {
		c.conn.SetReadDeadline(time.Now().Add(sioPingInterval + sioPingTimeout))
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		m := string(msg)
		switch {
		case m == "3": // pong
		case m == "1": // engine close
			return
		case strings.HasPrefix(m, "40"): // socket.io CONNECT, optional {auth}
			var auth map[string]any
			if len(m) > 2 {
				json.Unmarshal([]byte(m[2:]), &auth)
			}
			if s.authorize != nil && !s.authorize(r, auth) {
				c.send([]byte(`4{"message":"Unauthorized"}`))
				continue
			}
			ack, _ := json.Marshal(map[string]string{"sid": sid()})
			c.send(append([]byte("0"), ack...))
			s.mu.Lock()
			s.clients[c] = true
			s.mu.Unlock()
			log.Printf("[WS] Client connected (%s)", c.id)
			if s.onConnect != nil {
				s.onConnect(func(event string, data any) {
					if p := eventPacket(event, data); p != nil {
						c.send(p)
					}
				})
			}
		case strings.HasPrefix(m, "41"):
			return
		}
		// "42…" client events: the dashboard core view sends none we handle yet
	}
}

// Emit broadcasts an event to every connected socket.
func (s *SocketIO) Emit(event string, data any) {
	p := eventPacket(event, data)
	if p == nil {
		return
	}
	s.mu.Lock()
	cs := make([]*SioClient, 0, len(s.clients))
	for c := range s.clients {
		cs = append(cs, c)
	}
	s.mu.Unlock()
	for _, c := range cs {
		c.send(p)
	}
}

func (s *SocketIO) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients)
}
