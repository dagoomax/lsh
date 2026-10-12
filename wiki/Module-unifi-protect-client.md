# `src/unifi-protect-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~420 lines**

Connects to **UniFi Protect**. Two API modes, selected by which credentials are configured:

- **`apiKey`** (preferred) — the official **Protect Integration API** (`/proxy/protect/integration/v1`, `X-API-Key` header; key created under Protect → Settings → Control Plane → Integrations, Protect 5.3+). Doorbell rings, camera motion, and sensor open/close arrive in real time over the `wss://…/subscribe/events` WebSocket (`ws` module, auto-reconnect with 5 s → 60 s backoff); a 30 s poll reconciles slow values (temperature/humidity/lux/battery).
- **`username`/`password`** (legacy fallback) — the private cookie-login API (`/proxy/protect/api`). Rings are detected by polling each doorbell's `lastRing` every `ringPollInterval` seconds (default 3).

Discovers all cameras (registered into the dashboard camera list with snapshot proxying) and Protect sensors. Doorbells get `doorbell` + `motion` store keys; a ring pulses `doorbell` to 1 for 3 s so Loxone virtual inputs see an edge.

**Config:**
```json
"unifi": { "host": "192.168.1.1", "apiKey": "", "username": "", "password": "", "ringPollInterval": 3 }
```


With an **`apiKey`** LSH also uses the rest of the Protect 6.x public API (`src/unifi-protect-client.js`):

| Feature | What LSH does |
|---|---|
| **Live video** | Reads each camera's RTSPS stream (`/cameras/{id}/rtsps-stream`) and gives it to HomeKit and the RTSP proxy — UniFi cameras get live view, not just snapshots. A missing stream is created on the console (quality `streamQuality`, default `high`); `"createStreams": false` never changes the console. Protect's `?enableSrtp` suffix is dropped for ffmpeg. |
| **Live device state** | `/subscribe/devices` WebSocket: sensor temperature / humidity / light / battery / open-close, floodlight and siren state update immediately (the 30 s poll stays as a safety net). Both WebSockets send a ping every 3 min — the console's proxy drops idle tunnels after 10 min. |
| **Smart detections** | `smartDetectZone` / `smartDetectLine` events → per-camera `person`, `vehicle`, `animal`, `package` sensors (for each type the camera supports), back to 0 when the event ends (or after 60 s). |
| **Floodlights** | `/lights` → device with `switch` (forces the light on / off) and PIR `motion`; HomeKit light + motion sensor. |
| **Sirens** | `/sirens` → `siren` toggle (play for `sirenDuration` s — 5, 10, 20 or 30, default 10 — / stop). |
| **Relays** | `/relays` → one toggle per output (`output<n>`). |
| **Alarm Manager** | `POST /api/unifi/alarm/<triggerId>` fires a Protect Alarm Manager webhook trigger (for flows / Loxone). |

Sirens and relays are marked **sensitive**: MCP bots can only switch them with *Allow locks, alarm, gates and doors*. Tested against `node scripts/unifi-protect-simulator.js 7443` (`"host": "127.0.0.1:7443", "apiKey": "simkey"`; `test/unifi-protect.test.js`) — not yet against a real console.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class UnifiProtectClient` |
| Config section(s) | `unifi` |
| Platform-status key | `unifi` |
| Device key prefix | `unifi/…` |
| Store keys written | `unifi` |
| Registers devices | yes (via sensor-registry) |
| Poll interval(s) | 30 s (+ `ringPollInterval` in legacy mode) |
| Real-time | Integration API WebSockets (`/v1/subscribe/events`, `/v1/subscribe/devices`) |
| Internal deps | `platform-status` |
| Node built-ins | `https`, `events` |
| npm deps | `ws` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `unifi` section.

---

*Extracted from `src/unifi-protect-client.js`. Source is authoritative — regenerate this page if the module changes.*
