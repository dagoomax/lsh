package main

// Media player routes — port of src/routes/media.js (started with the internet
// radio directory; the speaker/now-playing routes that need the media module
// come later). GET /api/media/radio proxies radio-browser.info (free,
// community-run), with the same 10-minute per-query cache.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var rbHosts = []string{"de1.api.radio-browser.info", "nl1.api.radio-browser.info", "at1.api.radio-browser.info"}
var urlRE = regexp.MustCompile(`(?i)^https?://[^\s]+$`)
var countryRE = regexp.MustCompile(`^[A-Za-z]{2}$`)
var radioHTTP = &http.Client{Timeout: 8 * time.Second}

type radioCacheEntry struct {
	at   time.Time
	data []any
}

var (
	radioCacheMu sync.Mutex
	radioCache   = map[string]radioCacheEntry{}
	radioOrder   []string // insertion order, for the 200-entry cap
)

// trunc cuts s to at most n runes (Node's String.slice is by code unit — close
// enough, and never splits a multi-byte rune).
func trunc(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func (s *Server) mediaRoutes(api *http.ServeMux) {
	// GET /api/media/radio?q=&country= — internet radio directory
	api.HandleFunc("GET /api/media/radio", func(w http.ResponseWriter, r *http.Request) {
		q := trunc(strings.TrimSpace(r.URL.Query().Get("q")), 80)
		country := r.URL.Query().Get("country")
		if countryRE.MatchString(country) {
			country = strings.ToUpper(country)
		} else {
			country = ""
		}
		data, err := radioSearch(q, country)
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		ok(w, data)
	})

	// POST /api/media/stations — save config.media.stations (cleaned)
	api.HandleFunc("POST /api/media/stations", s.admin(func(w http.ResponseWriter, r *http.Request) {
		stations := cleanStations(readBody(r).Get("stations"))
		cfg := readConfigOrdered(s.configPath())
		media := omap(cfg.Get("media")).Clone()
		media.Set("stations", stations)
		cfg.Set("media", media)
		if err := writeConfigFile(s.configPath(), cfg); err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, OM("success", true, "message", fmt.Sprintf("Saved %d", len(stations))))
	}))

	// GET /api/media/nowplaying?url= — the stream's ICY StreamTitle
	api.HandleFunc("GET /api/media/nowplaying", s.admin(func(w http.ResponseWriter, r *http.Request) {
		u := r.URL.Query().Get("url")
		if !urlRE.MatchString(u) {
			fail(w, 400, "url must be http(s)")
			return
		}
		ok(w, OM("title", streamTitle(u)))
	}))

	// GET /api/media/stream?url= — proxy an audio stream (for the dashboard player)
	api.HandleFunc("GET /api/media/stream", s.admin(func(w http.ResponseWriter, r *http.Request) {
		u := r.URL.Query().Get("url")
		if !urlRE.MatchString(u) {
			w.WriteHeader(400)
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), "GET", u, nil)
		if err != nil {
			w.WriteHeader(400)
			return
		}
		req.Header.Set("User-Agent", "LSH/1.0")
		if rng := r.Header.Get("Range"); rng != "" {
			req.Header.Set("Range", rng)
		}
		resp, err := streamHTTP.Do(req)
		if err != nil {
			w.WriteHeader(502)
			return
		}
		defer resp.Body.Close()
		if (resp.StatusCode != 200 && resp.StatusCode != 206) || !audioTypeRE.MatchString(resp.Header.Get("Content-Type")) {
			w.WriteHeader(415)
			return
		}
		for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "icy-name"} {
			if v := resp.Header.Get(h); v != "" {
				w.Header().Set(h, v)
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}))
}

// cleanStations — port of src/routes/media.js cleanStations: name (≤80) + http(s)
// url required, optional http(s) favicon under 500 chars, at most 50 stations.
func cleanStations(v any) []any {
	out := []any{}
	for _, x := range arr(v) {
		m := omap(x)
		name := ""
		if nv := m.Get("name"); nv != nil {
			name = trunc(strings.TrimSpace(jsString(nv)), 80)
		}
		u := ""
		if uv := m.Get("url"); uv != nil {
			u = strings.TrimSpace(jsString(uv))
		}
		if name == "" || !urlRE.MatchString(u) {
			continue
		}
		o := NewOMap()
		o.Set("name", name)
		o.Set("url", u)
		if iv := m.Get("favicon"); iv != nil {
			if icon := strings.TrimSpace(jsString(iv)); urlRE.MatchString(icon) && len(icon) < 500 {
				o.Set("favicon", icon)
			}
		}
		out = append(out, o)
		if len(out) == 50 {
			break
		}
	}
	return out
}

var audioTypeRE = regexp.MustCompile(`(?i)^(audio/|application/(ogg|octet-stream|x-mpegurl|vnd\.apple\.mpegurl)|video/mp2t)`)
var streamHTTP = &http.Client{} // no overall timeout: a stream stays open until the client leaves

// ── ICY StreamTitle (Icecast / Shoutcast) ──────────────────────────────────────
var streamTitleRE = regexp.MustCompile(`StreamTitle='(.*?)';`)

// ad-break markers and the like that aren't songs (port of media.js NOT_A_SONG)
var notASong = regexp.MustCompile(`(?i)^(?:[-–—\s.]*|(?:start|stop|begin|end)?_?ad_?(?:break|block)?(?:_(?:start|stop|begin|end))?|ad(?:vert(?:isement)?)?s?|commercials?|reklam[ay]?|[A-Z0-9]+(?:_[A-Z0-9]+)+)$`)

type titleEntry struct {
	at    time.Time
	title string
}

var (
	titleCacheMu sync.Mutex
	titleCache   = map[string]titleEntry{}
	titleOrder   []string
)

func streamTitle(u string) string {
	titleCacheMu.Lock()
	if hit, found := titleCache[u]; found && time.Since(hit.at) < 15*time.Second {
		t := hit.title
		titleCacheMu.Unlock()
		return t
	}
	titleCacheMu.Unlock()

	title := fetchICYTitle(u)
	if notASong.MatchString(title) {
		title = ""
	}
	titleCacheMu.Lock()
	titleCache[u] = titleEntry{at: time.Now(), title: title}
	titleOrder = append(titleOrder, u)
	if len(titleOrder) > 100 {
		delete(titleCache, titleOrder[0])
		titleOrder = titleOrder[1:]
	}
	titleCacheMu.Unlock()
	return title
}

func fetchICYTitle(u string) string {
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "LSH/1.0")
	req.Header.Set("Icy-MetaData", "1")
	resp, err := (&http.Client{Timeout: 6 * time.Second}).Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	metaint, _ := strconv.Atoi(resp.Header.Get("icy-metaint"))
	if resp.StatusCode != 200 || metaint <= 0 || metaint >= 1000000 {
		return ""
	}
	if _, err := io.CopyN(io.Discard, resp.Body, int64(metaint)); err != nil { // skip to the metadata block
		return ""
	}
	lenByte := make([]byte, 1)
	if _, err := io.ReadFull(resp.Body, lenByte); err != nil {
		return ""
	}
	metaLen := int(lenByte[0]) * 16
	if metaLen == 0 {
		return ""
	}
	meta := make([]byte, metaLen)
	if _, err := io.ReadFull(resp.Body, meta); err != nil {
		return ""
	}
	if m := streamTitleRE.FindSubmatch(meta); m != nil {
		return strings.TrimSpace(string(m[1]))
	}
	return ""
}

func radioSearch(q, country string) ([]any, error) {
	key := q + "|" + country
	radioCacheMu.Lock()
	if hit, found := radioCache[key]; found && time.Since(hit.at) < 10*time.Minute {
		radioCacheMu.Unlock()
		return hit.data, nil
	}
	radioCacheMu.Unlock()

	params := url.Values{}
	params.Set("limit", "40")
	params.Set("hidebroken", "true")
	params.Set("order", "clickcount")
	params.Set("reverse", "true")
	if q != "" {
		params.Set("name", q)
	}
	if country != "" {
		params.Set("countrycode", country)
	}

	var lastErr error
	for _, host := range rbHosts {
		data, err := radioFetch("https://"+host+"/json/stations/search?"+params.Encode())
		if err != nil {
			lastErr = err
			continue
		}
		radioCacheMu.Lock()
		radioCache[key] = radioCacheEntry{at: time.Now(), data: data}
		radioOrder = append(radioOrder, key)
		if len(radioOrder) > 200 {
			delete(radioCache, radioOrder[0])
			radioOrder = radioOrder[1:]
		}
		radioCacheMu.Unlock()
		return data, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no answer")
	}
	return nil, fmt.Errorf("Radio directory unreachable (%s)", lastErr.Error())
}

func radioFetch(u string) ([]any, error) {
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "LSH/1.0")
	resp, err := radioHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var raw []struct {
		Name        string `json:"name"`
		URLResolved string `json:"url_resolved"`
		Favicon     string `json:"favicon"`
		CountryCode string `json:"countrycode"`
		Codec       string `json:"codec"`
		Bitrate     int    `json:"bitrate"`
		HLS         int    `json:"hls"`
		Tags        string `json:"tags"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	out := []any{}
	for _, st := range raw {
		if !urlRE.MatchString(st.URLResolved) || seen[st.URLResolved] {
			continue
		}
		seen[st.URLResolved] = true
		name := trunc(strings.TrimSpace(st.Name), 80)
		if name == "" {
			continue
		}
		o := NewOMap()
		o.Set("name", name)
		o.Set("url", st.URLResolved)
		if urlRE.MatchString(st.Favicon) {
			o.Set("favicon", st.Favicon)
		}
		o.Set("country", st.CountryCode)
		o.Set("codec", st.Codec)
		o.Set("bitrate", st.Bitrate)
		o.Set("hls", st.HLS != 0)
		tags := []any{}
		for _, t := range strings.Split(st.Tags, ",") {
			if t = strings.TrimSpace(t); t != "" {
				tags = append(tags, t)
				if len(tags) == 3 {
					break
				}
			}
		}
		o.Set("tags", tags)
		out = append(out, o)
	}
	return out, nil
}
