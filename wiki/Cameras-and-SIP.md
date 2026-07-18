# Cameras & SIP Softphone

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## SIP Softphone

A WebRTC-based SIP softphone is embedded in the dashboard. It supports:

- **Incoming calls** — ringtone, caller name/ID, auto-match camera snapshot by caller IP
- **Outgoing calls** — dial button in the header
- **In-call controls** — mute, DTMF tones, relay unlock (pulses the configured relay for 2.5 s)

**Requirements:** A SIP server with WebSocket transport (e.g., Asterisk, FreeSWITCH, Loxone Miniserver with SIP extension, Grandstream UCM). The `wsUrl` must be reachable from the browser.

**Config:**
```json
"sip": {
  "wsUrl":       "wss://pbx.local:5443",
  "username":    "101",
  "domain":      "pbx.local",
  "password":    "secret",
  "displayName": "Dashboard",
  "dtmfUnlock":  "#",
  "relayIndex":  0
}
```

---

## Cameras

Camera tiles appear on the dashboard. Click any tile to open the full-screen modal with event log. The list combines manual `cameras` entries with auto-added **UniFi Protect**, **Reolink**, **KENIK** and **SmartThings** cameras.

### Stream priorities

1. **WebRTC (WHEP)** — lowest latency; requires a WHEP-compatible server (go2rtc, MediaMTX, Frigate)
2. **MJPEG** — browser-native streaming; moderate latency
3. **Snapshot** — polled every 2 s (tile) / 2 s (modal); works with any IP camera

### Event log

Motion and snapshot events are stored in an in-memory ring buffer (500 entries) and shown in the camera modal. Events come from:
- UniFi Protect real-time WebSocket
- Loxone events (if configured)
- Manual push via `POST /api/camera-log`

### Manual camera entry

```json
{
  "name": "Gate",
  "url": "rtsp://nvr.local:8554/gate",
  "snapshotUrl": "http://192.168.1.x/snap.jpg",
  "mjpegUrl": "",
  "webrtcUrl": "http://go2rtc:1984/api/webrtc?src=gate"
}
```

---
