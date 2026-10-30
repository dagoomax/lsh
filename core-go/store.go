package main

// DataStore — Go port of src/data-store.js: key → {value, timestamp}, a
// per-key history ring buffer for numeric/boolean values, and the same
// gzipped snapshot format (persist/store-data.json.gz) so either core can
// restore the other's file.

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"log"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	historyMaxPoints   = 720
	historyMinInterval = 30_000 // ms
	persistInterval    = 5 * time.Minute
	persistMaxAge      = 48 * 3600_000 // ms
)

type Entry struct {
	Value     any   `json:"value"`
	Timestamp int64 `json:"timestamp"`
}

// Change mirrors the 'change' event: Changed is false when a primitive value
// repeats the stored one.
type Change struct {
	Key     string
	Value   any
	Changed bool
	From    any // module that set it (nil = core), so it isn't echoed back
}

type Store struct {
	mu        sync.RWMutex
	data      map[string]Entry
	history   map[string][][2]float64
	listeners []func(Change)
	file      string
}

func NewStore(file string) *Store {
	return &Store{data: map[string]Entry{}, history: map[string][][2]float64{}, file: file}
}

func nowMs() int64 { return time.Now().UnixMilli() }

// OnChange registers a listener; listeners run synchronously, outside the lock.
func (s *Store) OnChange(fn func(Change)) {
	s.mu.Lock()
	s.listeners = append(s.listeners, fn)
	s.mu.Unlock()
}

func (s *Store) Set(key string, value any) { s.SetFrom(key, value, nil) }

func (s *Store) SetFrom(key string, value any, from any) {
	s.mu.Lock()
	prev, had := s.data[key]
	s.data[key] = Entry{Value: value, Timestamp: nowMs()}
	s.record(key, value)
	listeners := s.listeners
	s.mu.Unlock()
	ch := Change{Key: key, Value: value, Changed: !had || !samePrimitive(prev.Value, value), From: from}
	for _, fn := range listeners {
		fn(ch)
	}
}

// Objects and arrays always count as changed (a client may mutate one in
// place and set it again) — same rule as the JS store.
func samePrimitive(a, b any) bool {
	switch av := a.(type) {
	case nil:
		return b == nil
	case bool:
		bv, ok := b.(bool)
		return ok && av == bv
	case float64:
		bv, ok := b.(float64)
		return ok && (av == bv || (math.IsNaN(av) && math.IsNaN(bv)))
	case string:
		bv, ok := b.(string)
		return ok && av == bv
	}
	return false
}

func (s *Store) record(key string, value any) {
	var v float64
	switch x := value.(type) {
	case bool:
		if x {
			v = 1
		}
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return
		}
		v = x
	default:
		return
	}
	now := float64(nowMs())
	buf := s.history[key]
	if n := len(buf); n > 0 && now-buf[n-1][0] < historyMinInterval {
		buf[n-1][1] = v
		return
	}
	buf = append(buf, [2]float64{now, v})
	if len(buf) > historyMaxPoints {
		buf = buf[len(buf)-historyMaxPoints:]
	}
	s.history[key] = buf
}

func (s *Store) Get(key string) any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data[key].Value
}

func (s *Store) Timestamp(key string) any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if e, ok := s.data[key]; ok {
		return e.Timestamp
	}
	return nil
}

func (s *Store) GetAll() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]any, len(s.data))
	for k, e := range s.data {
		out[k] = e.Value
	}
	return out
}

// Snapshot is what a module process gets in its init message (store.data).
func (s *Store) Snapshot() map[string]Entry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]Entry, len(s.data))
	for k, e := range s.data {
		out[k] = e
	}
	return out
}

func (s *Store) History(key string) [][2]float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	h := s.history[key]
	out := make([][2]float64, len(h))
	copy(out, h)
	return out
}

// ── Persistence ─────────────────────────────────────────────────────────

type persisted struct {
	SavedAt int64             `json:"savedAt"`
	Data    map[string]Entry  `json:"data"`
	History []json.RawMessage `json:"history"` // [key, [[t, v], …]]
}

// Load restores values and history without emitting changes. seedFrom is
// tried when this core has no file of its own yet (e.g. the Node core's).
func (s *Store) Load(seedFrom string) {
	path := s.file
	if _, err := os.Stat(path); err != nil && seedFrom != "" {
		path = seedFrom
	}
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		log.Printf("[Store] Restore failed: %v", err)
		return
	}
	var raw persisted
	if err := json.NewDecoder(zr).Decode(&raw); err != nil {
		log.Printf("[Store] Restore failed: %v", err)
		return
	}
	cutoff := float64(nowMs() - persistMaxAge)
	points := 0
	s.mu.Lock()
	for _, item := range raw.History {
		var pair [2]json.RawMessage
		var key string
		var pts [][2]float64
		if json.Unmarshal(item, &pair) != nil || json.Unmarshal(pair[0], &key) != nil || json.Unmarshal(pair[1], &pts) != nil {
			continue
		}
		kept := pts[:0]
		for _, p := range pts {
			if p[0] >= cutoff {
				kept = append(kept, p)
			}
		}
		if len(kept) > 0 {
			s.history[key] = kept
			points += len(kept)
		}
	}
	for k, e := range raw.Data {
		if _, ok := s.data[k]; !ok {
			s.data[k] = e
		}
	}
	series := len(s.history)
	s.mu.Unlock()
	log.Printf("[Store] Restored %d series / %d points from %s (saved %d min ago)", series, points, path, (nowMs()-raw.SavedAt)/60000)
}

func (s *Store) Persist() (int, error) {
	s.mu.RLock()
	hist := make([][2]any, 0, len(s.history))
	for k, v := range s.history {
		hist = append(hist, [2]any{k, v})
	}
	payload, err := json.Marshal(map[string]any{"savedAt": nowMs(), "data": s.data, "history": hist})
	s.mu.RUnlock()
	if err != nil {
		return 0, err
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(payload)
	zw.Close()
	if err := os.MkdirAll(filepath.Dir(s.file), 0o755); err != nil {
		return 0, err
	}
	tmp := s.file + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return 0, err
	}
	return buf.Len(), os.Rename(tmp, s.file)
}

func (s *Store) StartPersistence() {
	go func() {
		for range time.Tick(persistInterval) {
			if _, err := s.Persist(); err != nil {
				log.Printf("[Store] Persist failed: %v", err)
			}
		}
	}()
}
