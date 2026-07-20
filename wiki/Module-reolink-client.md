# `src/reolink-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~288 lines**

Adds **Reolink PoE cameras / NVRs** to the camera list and polls their **AI object detection** (person/vehicle/pet/face). Reads `reolink.cameras` from config on demand (so Settings edits apply without a restart), builds each camera's RTSP URL (`h264Preview_<NN>_<main|sub>`), and pulls JPEG snapshots via Reolink's HTTP API (`cmd=Snap`). Snapshots are proxied through `GET /api/reolink/snapshot/:idx` so credentials never reach the browser.

AI detection (`cmd=GetAiState`) is polled every `aiPollInterval` seconds (default 5). Each detected category becomes its **own sub-device** (`reolink/<idx>/<category>`, e.g. `reolink/0/person`) rather than multiple sensors on one device — HomeKit bridging only exposes the *first* sensor of a given `homekit` type per device (`homekit-bridge.js`), so three same-typed `motion` sensors on one device would silently drop two of them; separate sub-devices also let "person detected" and "vehicle detected" drive different HomeKit automations. Categories a camera doesn't support are never registered — no per-category config needed, only a per-camera opt-out (`"aiDetect": false`).

**Config:**
```json
"reolink": {
  "aiPollInterval": 5,
  "cameras": [
    { "name": "Driveway", "host": "192.168.1.50", "username": "admin", "password": "secret", "channel": 0, "aiDetect": true }
  ]
}
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class ReolinkClient` |
| Config section(s) | `reolink` |
| Platform-status key | `reolink` |
| Device key prefix | `reolink/<idx>/<category>` |
| Store keys written | `reolink` |
| Registers devices | yes (via sensor-registry, lazily per detected AI category) |
| Poll interval(s) | 5 s (AI state) — snapshots are on-demand, not polled |
| Internal deps | `platform-status` |
| Node built-ins | `http`, `https`, `fs`, `path` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `reolink` section.

---

*Extracted from `src/reolink-client.js`. Source is authoritative — regenerate this page if the module changes.*
