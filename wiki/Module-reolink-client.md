# `src/reolink-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~110 lines**

Adds **Reolink PoE cameras / NVRs** to the camera list. Reads `reolink.cameras` from config on demand (so Settings edits apply without a restart), builds each camera's RTSP URL (`h264Preview_<NN>_<main|sub>`), and pulls JPEG snapshots via Reolink's HTTP API (`cmd=Snap`). Snapshots are proxied through `GET /api/reolink/snapshot/:idx` so credentials never reach the browser. No polling — snapshots are fetched on demand.

**Config:**
```json
"reolink": { "cameras": [ { "name": "Driveway", "host": "192.168.1.50", "username": "admin", "password": "secret", "channel": 0 } ] }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class ReolinkClient` |
| Config section(s) | `json` |
| Internal deps | — |
| Node built-ins | `http`, `https`, `fs`, `path` |

See the [Configuration Reference](Configuration) for the `json` section.

---

*Extracted from `src/reolink-client.js`. Source is authoritative — regenerate this page if the module changes.*
