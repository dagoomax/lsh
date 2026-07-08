# `src/websocket.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Interface  ·  **~88 lines**

Sets up Socket.IO. Authenticates each connection via the session cookie. On connect, emits a full snapshot of all current data. Broadcasts `update` events for each new Victron metric, `devices` for the full device list, `platform-status` for integration connection states, and `camera-event` for motion/snapshot alerts.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `setupWebSocket` |
| Internal deps | `platform-status`, `camera-log` |
| npm packages | `socket.io` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`camera-log.js`](Module-camera-log)

---

*Extracted from `src/websocket.js`. Source is authoritative — regenerate this page if the module changes.*
