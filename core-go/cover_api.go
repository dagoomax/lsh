package main

// Cover art / station logo as a square JPEG — port of src/media-cover.js +
// the GET /api/loxone/cover/<device key>.jpg route from src/routes/loxone-xml.js.
// The image is whatever the device's `cover` reading points at (a station's
// logo, Spotify album art); it is fetched once, converted by ffmpeg to a
// 400×400 JPEG letterboxed on a dark square, and cached. Nothing to show → a
// plain dark square, so the block (or the dashboard's full-screen player) never
// shows a broken image. ffmpeg is already a core dependency (flow snapshots,
// RTSP), so this shells out to it exactly like the Node version rather than
// pulling image codecs into Go.

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	coverSize     = 400
	coverMaxBytes = 5 * 1024 * 1024
	coverCacheMax = 60
)

var (
	coverMu    sync.Mutex
	coverCache = map[string][]byte{}
	coverOrder []string
	coverPlace []byte

	coverJpegExt = regexp.MustCompile(`(?i)\.jpe?g$`)
	coverHTTPish = regexp.MustCompile(`(?i)^https?://\S+$`)
	coverImgType = regexp.MustCompile(`(?i)^image/|octet-stream`)
	coverSvgURL  = regexp.MustCompile(`(?i)\.svg(\?|$)`)
)

// small logos (favicons) are upscaled smoothly; a few pixels of padding keep
// them off the edges (matches media-cover.js FIT).
var coverFit = fmt.Sprintf(
	"scale=%d:%d:force_original_aspect_ratio=decrease:flags=lanczos,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=0x1c1c22,format=yuvj420p",
	coverSize, coverSize, coverSize, coverSize)

func ffmpegJpeg(args []string, input []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	full := append([]string{"-loglevel", "error"}, args...)
	full = append(full, "-frames:v", "1", "-q:v", "3", "-f", "mjpeg", "pipe:1")
	cmd := exec.CommandContext(ctx, "ffmpeg", full...)
	if input != nil {
		cmd.Stdin = bytes.NewReader(input)
	}
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	if err == nil && out.Len() > 0 {
		return out.Bytes(), nil
	}
	msg := strings.TrimSpace(errb.String())
	if i := strings.LastIndexByte(msg, '\n'); i >= 0 {
		msg = strings.TrimSpace(msg[i+1:])
	}
	if msg == "" {
		msg = fmt.Sprintf("ffmpeg: %v", err)
	}
	return nil, fmt.Errorf("%s", msg)
}

func coverFromURL(u string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "LSH/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if ct != "" && !coverImgType.MatchString(ct) {
		return nil, fmt.Errorf("not an image (%s)", ct)
	}
	if strings.Contains(strings.ToLower(ct), "svg") || coverSvgURL.MatchString(u) {
		return nil, fmt.Errorf("SVG logos can’t be converted")
	}
	buf, err := io.ReadAll(io.LimitReader(resp.Body, coverMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(buf) > coverMaxBytes {
		return nil, fmt.Errorf("image too large")
	}
	return ffmpegJpeg([]string{"-i", "pipe:0", "-vf", coverFit}, buf)
}

func coverPlaceholder() []byte {
	coverMu.Lock()
	defer coverMu.Unlock()
	if coverPlace != nil {
		return coverPlace
	}
	b, err := ffmpegJpeg([]string{"-f", "lavfi", "-i", fmt.Sprintf("color=c=0x1c1c22:s=%dx%d", coverSize, coverSize)}, nil)
	if err == nil {
		coverPlace = b
	}
	return b
}

// coverJpeg never errors: a bad or unreachable source falls back to the dark
// placeholder (a failed fetch isn't cached, so it retries next time).
func coverJpeg(u string) []byte {
	u = strings.TrimSpace(u)
	if !coverHTTPish.MatchString(u) {
		return coverPlaceholder()
	}
	coverMu.Lock()
	if b, ok := coverCache[u]; ok {
		coverMu.Unlock()
		return b
	}
	coverMu.Unlock()

	b, err := coverFromURL(u)
	if err != nil {
		log.Printf("[Cover] %s: %v", u, err)
		return coverPlaceholder()
	}
	coverMu.Lock()
	coverCache[u] = b
	coverOrder = append(coverOrder, u)
	if len(coverOrder) > coverCacheMax {
		delete(coverCache, coverOrder[0])
		coverOrder = coverOrder[1:]
	}
	coverMu.Unlock()
	return b
}

func (s *Server) coverRoutes(api *http.ServeMux) {
	// GET /api/loxone/cover/<device key>.jpg — e.g. spotify/player.jpg,
	// radio/airplay-salon2.jpg, radio/all.jpg (the first speaker playing).
	api.HandleFunc("GET /api/loxone/cover/{key...}", func(w http.ResponseWriter, r *http.Request) {
		key := coverJpegExt.ReplaceAllString(r.PathValue("key"), "")
		u := jsString(s.store.Get(key + "/cover"))
		if key == "radio/all" {
			u = ""
			for _, d := range s.reg.Devices() {
				dk := d.Str("key")
				if d.Str("type") != "radio" || dk == "radio/all" {
					continue
				}
				if jsNumber(s.store.Get(dk+"/playing")) == 1 {
					if cu := strings.TrimSpace(jsString(s.store.Get(dk + "/cover"))); cu != "" {
						u = cu
						break
					}
				}
			}
		}
		jpg := coverJpeg(u)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "image/jpeg")
		w.Write(jpg)
	})
}
