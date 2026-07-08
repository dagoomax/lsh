# `src/camera-log.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Support  ·  **~27 lines**

In-memory ring buffer (max 500 entries) for camera events (motion, sound, snapshots). Events are pushed by integration clients (UniFi Protect, Loxone) and streamed to connected browsers via Socket.IO `camera-event` events. Also exposed via `GET /api/camera-log`.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class CameraLog` |
| Internal deps | — |
| Node built-ins | `events` |

---

*Extracted from `src/camera-log.js`. Source is authoritative — regenerate this page if the module changes.*
