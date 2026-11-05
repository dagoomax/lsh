package main

// In-memory per-category log buffer — the Go core logs to one stream (stderr),
// unlike Node's logger.js which writes a file per category. To serve
// GET /api/logs and /api/logs/:name without that file layout, this wraps the
// log output: every line is filed under the category in its "[Category]"
// prefix (lower-cased, sanitized to [a-z0-9_-] like the route does), keeping
// the last N lines each. It mirrors logger.categories()/tail()/clear().

import (
	"regexp"
	"sort"
	"strings"
	"sync"
)

type logBuffer struct {
	mu   sync.Mutex
	max  int
	cats map[string][]string
}

var logBuf = &logBuffer{max: 500, cats: map[string][]string{}}

var logCatRe = regexp.MustCompile(`\[([^\]]+)\]`)

// sanitizeLogCat matches the route's name scrub: lowercase, keep [a-z0-9_-].
func sanitizeLogCat(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Write is the io.Writer the standard logger feeds. It also passes through to
// the real stderr via the MultiWriter set up in main.
func (lb *logBuffer) Write(p []byte) (int, error) {
	for _, line := range strings.Split(strings.TrimRight(string(p), "\n"), "\n") {
		if line == "" {
			continue
		}
		cat := "app"
		if m := logCatRe.FindStringSubmatch(line); m != nil {
			if c := sanitizeLogCat(m[1]); c != "" {
				cat = c
			}
		}
		lb.mu.Lock()
		buf := append(lb.cats[cat], line)
		if len(buf) > lb.max {
			buf = buf[len(buf)-lb.max:]
		}
		lb.cats[cat] = buf
		lb.mu.Unlock()
	}
	return len(p), nil
}

func (lb *logBuffer) categories() []string {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	out := make([]string, 0, len(lb.cats))
	for k := range lb.cats {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i] == "app" {
			return true
		}
		if out[j] == "app" {
			return false
		}
		return out[i] < out[j]
	})
	return out
}

func (lb *logBuffer) tail(name string, limit int) []string {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	buf := lb.cats[name]
	if limit > 0 && len(buf) > limit {
		buf = buf[len(buf)-limit:]
	}
	out := make([]string, len(buf))
	copy(out, buf)
	return out
}

func (lb *logBuffer) clear(name string) {
	lb.mu.Lock()
	delete(lb.cats, name)
	lb.mu.Unlock()
}
