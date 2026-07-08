# UniFi Door Station

‹ [Home](Home) · [Loxone Integration](Loxone-Integration) · [Cameras & SIP](Cameras-and-SIP) ›

> Polish version and a standalone HTML/print copy live in the repo under `docs/unifi-door-station.pl.md` and `docs/unifi-door-station.html`.

This manual covers the complete integration of a UniFi door station
(G4 Doorbell, G4 Doorbell Pro or UniFi Intercom) with the LSH server and a
Loxone Miniserver:

- **Video & events in LSH** — snapshots, doorbell ring and motion as dashboard
  devices and HomeKit accessories (contact + motion sensor).
- **Answering the door in the browser** — the LSH dashboard registers as a
  UniFi Talk softphone; press the doorbell → the dashboard rings → answer,
  talk, and unlock the door with a DTMF key.
- **Loxone integration** — ring and motion events are pushed instantly to
  Miniserver Virtual Inputs, so you can trigger chimes, lights, notifications
  or a Door Controller block.

## 1. Architecture

```
                 ┌────────────────────────── UniFi console (UDM, 192.168.1.1) ──┐
Door station ──► │  UniFi Protect  (camera, snapshots, ring/motion events)      │
                 │  UniFi Talk     (SIP PBX, wss://192.168.1.1:5443)            │
                 └───────┬──────────────────────────────┬──────────────────────-┘
                         │ HTTPS API (poll)             │ SIP over WebSocket
                         ▼                              ▼
                 LSH  unifi-protect-client      LSH dashboard softphone (ext 101)
                         │                              answer / talk / "#" unlock
        store keys: unifi/<camId>/doorbell (pulse), unifi/<camId>/motion
                         │
                         ▼
                 LSH  loxoneOut  ──► http://MINISERVER/dev/sps/io/<VI>/<value>
                                      VI_UnifiDoorbell, VI_UnifiDoorMotion
```

Two independent paths:

| Path | Purpose | Latency |
|---|---|---|
| Protect API poll | ring/motion → LSH → Loxone | ~`ringPollInterval` (default 3 s) |
| UniFi Talk SIP | live call + door unlock in the dashboard | instant (real call) |

## 2. Prerequisites

- Door station adopted in UniFi Protect on the console (UDM at `192.168.1.1`).
- UniFi Talk subscription/app active on the console (for the call path).
- LSH server running (this repo) — in this installation `192.168.1.229`,
  HTTP port `3001`, HTTPS `3443`.
- Loxone Miniserver reachable from the LSH server over HTTP.

## 3. UniFi console configuration

### 3.1 Protect — API access

Pick **one** of the two (API key is preferred — no session expiry):

- **API key:** UniFi console → *Settings → Control Plane → Integrations* →
  create an API key. Paste it into `unifi.apiKey` in `config.json`.
- **Local admin:** create a *local access only* admin with Protect **view**
  permission and fill `unifi.username` / `unifi.password` instead.

### 3.2 Talk — call routing to the dashboard

1. In UniFi Talk, the door station gets its own extension automatically when
   assigned to Talk.
2. Create (or reuse) extension **101** for the LSH dashboard — this must match
   `sip.username` in `config.json`. Note its SIP password → `sip.password`.
3. Set the door station's **call destination** to extension 101 (or a ring
   group that contains it) — this is what makes the dashboard ring when the
   button is pressed.
4. Configure the door lock relay in UniFi so that DTMF **`#`** during a call
   triggers the door release. `#` is the default `sip.dtmfUnlock`; change both
   sides together if you use a different key.

### 3.3 Optional — live RTSP video

Snapshots work out of the box through the LSH proxy. For **live video**
(dashboard stream / HomeKit live view):

1. Protect → doorbell camera → *Advanced* → enable an RTSPS stream (pick a
   resolution). Protect shows a URL like
   `rtsps://192.168.1.1:7441/AbCdEfGh?enableSrtp`.
2. Add it to `config.json`:

   ```json
   "cameras": [
     { "name": "Door Station", "url": "rtsps://192.168.1.1:7441/AbCdEfGh?enableSrtp" }
   ]
   ```

   The `ffmpegRtsp` re-streamer (already enabled, base port 8554) picks it up.

## 4. LSH server configuration

All settings live in `config.json` (server restart required after edits).

### 4.1 `unifi` — Protect client

```json
"unifi": {
  "host": "192.168.1.1",
  "username": "",
  "password": "",
  "apiKey": "PASTE_API_KEY",
  "ringPollInterval": 3
}
```

| Field | Meaning |
|---|---|
| `host` | UniFi console IP (Protect + API live here) |
| `apiKey` | API key from §3.1 — leave `username`/`password` empty when set |
| `username`/`password` | local admin credentials (alternative to `apiKey`) |
| `ringPollInterval` | seconds between doorbell ring polls (default 3). Regular sensors poll every 30 s regardless. |

### 4.2 `sip` — dashboard softphone (already configured)

```json
"sip": {
  "wsUrl": "wss://192.168.1.1:5443",
  "username": "101",
  "domain": "192.168.1.1",
  "password": "…",
  "displayName": "LSH Dashboard",
  "dtmfUnlock": "#",
  "relayIndex": null
}
```

| Field | Meaning |
|---|---|
| `wsUrl` | UniFi Talk SIP-over-WebSocket endpoint on the console |
| `username`/`password` | Talk extension of the dashboard (§3.2) |
| `dtmfUnlock` | DTMF key sent by the "unlock" button during a call |
| `relayIndex` | optional Victron relay to pulse on unlock; `null` = DTMF only |

These settings can also be edited at runtime in *Settings → SIP* in the
dashboard.

### 4.3 First start — find the camera ID

Restart LSH (`node server.js`). On startup you should see:

```
[UniFi Protect] Authenticated
[UniFi Protect] Doorbell "Front Door" — store keys unifi/66a1b2c3d4e5f6a7b8c9d0e1/doorbell, unifi/66a1b2c3d4e5f6a7b8c9d0e1/motion
[UniFi Protect] Started — 3 camera(s), 2 sensor(s)
```

The hex string is the **camera ID** — you need it for the `loxoneOut` mappings
(§5.3) and the snapshot URL (§5.6). It is also visible in
`GET /api/devices?token=…`.

### 4.4 What appears automatically

- **Dashboard:** a 🔔 device with *Doorbell* and *Motion* readings; all Protect
  cameras (snapshot view) on the cameras panel.
- **HomeKit:** the doorbell as a *contact sensor* (ring) + *motion sensor* —
  usable in Home-app automations.
- **Snapshot proxy:** `GET /api/unifi/snapshot/<cameraId>` — JPEG, credentials
  stay server-side (used by the dashboard and by Loxone in §5.6).

### 4.5 Ring semantics

On a button press the store key `unifi/<cameraId>/doorbell` goes to **`1` and
returns to `0` after 3 seconds** — a clean pulse, so edge-triggered logic in
Loxone and HomeKit works reliably. Motion follows Protect's
`isMotionDetected` and only emits on change.

## 5. Loxone integration

### 5.1 How it works

LSH's `loxoneOut` module listens to store changes and pushes mapped keys to
Miniserver **Virtual Inputs** via
`http://MINISERVER/dev/sps/io/<virtualInput>/<value>` (HTTP GET, Basic auth,
debounced 200 ms). This is push — no polling on the Loxone side, ring arrives
within ~`ringPollInterval` + a few hundred ms.

### 5.2 Miniserver user

Create a dedicated user (e.g. `lsh`) in Loxone Config with permission to use
the web API/app. Use its credentials in `loxoneOut`.

### 5.3 `loxoneOut` config

```json
"loxoneOut": {
  "host": "MINISERVER_IP",
  "port": 80,
  "username": "lsh",
  "password": "…",
  "mappings": [
    { "storeKey": "unifi/66a1b2c3d4e5f6a7b8c9d0e1/doorbell", "virtualInput": "VI_UnifiDoorbell" },
    { "storeKey": "unifi/66a1b2c3d4e5f6a7b8c9d0e1/motion",   "virtualInput": "VI_UnifiDoorMotion" }
  ]
}
```

Replace the camera ID with the one from §4.3. The module only starts when
`host` is non-empty and at least one mapping exists; startup log:
`[LoxoneOut] Started — 2 mapping(s) → MINISERVER_IP`.

### 5.4 Virtual Inputs in Loxone Config

1. In the periphery tree: *Virtual Inputs → right-click → New Virtual Input*.
2. Create a **digital** input and set its **name (connection) to exactly**
   `VI_UnifiDoorbell` — the URL LSH calls is
   `/dev/sps/io/VI_UnifiDoorbell/1`, and the Miniserver resolves it by that
   name. Repeat for `VI_UnifiDoorMotion` (optional).
3. Save into the Miniserver.

### 5.5 Example bell logic

Drag `VI_UnifiDoorbell` into a page and connect it to, for example:

- a **chime output** (relay/audio) directly — the 3 s pulse is a natural bell,
- a **Notification / Caller** block → push notification "Someone is at the
  door" to the Loxone app,
- the bell input of a **Door Controller (Intercom)** block if you model the
  door in Loxone,
- `VI_UnifiDoorMotion` → e.g. front-light logic at night.

### 5.6 Door station image in the Loxone app

Point an **Intercom / Webpage** block's image URL at the LSH snapshot proxy:

```
http://192.168.1.229:3001/api/unifi/snapshot/<cameraId>?token=YOUR_LSH_TOKEN
```

Create the API token in the LSH dashboard under *Settings → API Tokens* (or
`POST /api/auth/tokens`); tokens are stored in `persist/api-tokens.json`.
The image refreshes on each poll of the block.

### 5.7 Alternative: polling instead of push

If you prefer the pattern used by the other LSH↔Loxone templates
(`docs/loxone/`), the Miniserver can poll `/api/devices?token=…` with a
Virtual HTTP Input and extract `unifi/<cameraId>/doorbell` with a `Check`
pattern. Not recommended for the doorbell — with 5 s polling a 3 s pulse can
be missed; use the push path (§5.1) for ring events.

## 6. Test checklist

1. **Restart LSH** — expect the log lines from §4.3 plus
   `[LoxoneOut] Started — 2 mapping(s) → …`.
2. **Press the doorbell:**
   - log: `[UniFi Protect] 🔔 Ring: Front Door`,
   - Loxone Config live view: `VI_UnifiDoorbell` goes 1 → 0 after ~3 s,
   - the dashboard softphone rings — answer, talk, press the unlock button
     (sends `#`) → door opens,
   - Home app: contact sensor triggers.
3. **Walk in front of the camera:** `VI_UnifiDoorMotion` follows motion.

## 7. Troubleshooting

| Symptom | Check |
|---|---|
| `UniFi auth failed: HTTP 4xx` | API key valid? Local admin has Protect access? `host` right? |
| Doorbell not discovered | Is the device a doorbell in Protect? Discovery log line missing → check `/proxy/protect/api/cameras` reachability |
| Ring arrives late/never in Loxone | `loxoneOut.host` set? Mapping `storeKey` matches the logged key exactly? `[LoxoneOut] HTTP 401` → wrong Miniserver user; `HTTP 404` → VI name mismatch (§5.4) |
| Dashboard doesn't ring | `sip.password` = Talk password of ext 101? Door station call destination includes 101? Browser must be on HTTPS for microphone access |
| Unlock doesn't work | DTMF key in UniFi matches `sip.dtmfUnlock`? Relay configured on the door station? |
| Snapshot empty / 503 | `unifi` section configured and client started? Camera ID correct? |

## 8. Reference

| Item | Value |
|---|---|
| Store keys | `unifi/<cameraId>/doorbell` (pulse 1→0, 3 s), `unifi/<cameraId>/motion` |
| Snapshot proxy | `GET /api/unifi/snapshot/<cameraId>` |
| Device list | `GET /api/devices?token=…` |
| Loxone push URL | `http://<miniserver>/dev/sps/io/<VI>/<value>` (Basic auth) |
| Source | `src/unifi-protect-client.js`, `src/loxone-out-client.js`, `public/sip-phone.js` |
| Related docs | `docs/loxone/README.md` (Loxone XML templates for LSH devices) |
