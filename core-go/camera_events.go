package main

// Camera event log and live detection boxes — ports of src/camera-log.js
// and src/detection-boxes.js. Module processes (object detection,
// SmartThings, the recorder) send their entries over the module channel;
// the dashboard gets them as 'camera-event' / 'detection-boxes' and reads
// GET /api/camera-log, GET /api/detection-boxes.

import (
	"math"
	"net/http"
	"sync"
	"time"
)

const cameraLogMax = 500

type CameraEvents struct {
	mu      sync.Mutex
	entries []*OMap // newest first
	boxes   map[string]*OMap
	emit    func(event string, data any)
}

func NewCameraEvents(emit func(string, any)) *CameraEvents {
	return &CameraEvents{boxes: map[string]*OMap{}, emit: emit}
}

func (c *CameraEvents) Push(entry *OMap) {
	c.mu.Lock()
	c.entries = append([]*OMap{entry}, c.entries...)
	if len(c.entries) > cameraLogMax {
		c.entries = c.entries[:cameraLogMax]
	}
	c.mu.Unlock()
	c.emit("camera-event", entry)
}

// Log is cameraLog.push(camera, type, detail) for the core's own routes.
func (c *CameraEvents) Log(camera, typ, detail string) {
	c.Push(OM("ts", float64(time.Now().UnixMilli()), "camera", camera, "type", typ, "detail", detail))
}

func (c *CameraEvents) Recent(n int, camera string) []*OMap {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := []*OMap{}
	for _, e := range c.entries {
		if camera != "" && e.Get("camera") != camera {
			continue
		}
		if len(out) == n {
			break
		}
		out = append(out, e)
	}
	return out
}

func (c *CameraEvents) SetBoxes(entry *OMap) {
	c.mu.Lock()
	c.boxes[jsString(entry.Get("camera"))] = entry
	c.mu.Unlock()
	c.emit("detection-boxes", entry)
}

func (c *CameraEvents) Boxes(camera string) *OMap {
	c.mu.Lock()
	defer c.mu.Unlock()
	if b := c.boxes[camera]; b != nil {
		return b
	}
	return OM("camera", camera, "items", []any{}, "imgWidth", 0.0, "imgHeight", 0.0, "ts", 0.0)
}

func (s *Server) cameraEventRoutes(api *http.ServeMux) {
	api.HandleFunc("GET /api/camera-log", func(w http.ResponseWriter, r *http.Request) {
		limit := 100.0 // Math.min(parseInt(limit) || 100, 500)
		if n := jsNumber(leadingInt(r.URL.Query().Get("limit"))); !math.IsNaN(n) && n != 0 && r.URL.Query().Get("limit") != "" {
			limit = n
		}
		ok(w, s.camera.Recent(int(math.Min(limit, cameraLogMax)), r.URL.Query().Get("camera")))
	})
	api.HandleFunc("GET /api/detection-boxes", func(w http.ResponseWriter, r *http.Request) {
		ok(w, s.camera.Boxes(r.URL.Query().Get("camera")))
	})
}
