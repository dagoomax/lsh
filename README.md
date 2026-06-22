# LSH — LoxoneSwaggerHelper

A self-hosted home automation dashboard built on Node.js. Aggregates live data from Victron Energy, SolarEdge, Samsung SmartThings, Loxone, Satel, UniFi Protect, Shelly, BoneIO, Dreame, Homey, IKEA Dirigera, and IKEA Tradfri into a single real-time web UI with relay control, HomeKit integration, SIP softphone, MQTT explorer, and multi-language support.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Configuration](#configuration)
3. [Pages](#pages)
4. [Backend Modules](#backend-modules)
5. [Integration Modules](#integration-modules)
6. [Security & Auth](#security--auth)
7. [HomeKit](#homekit)
8. [SIP Softphone](#sip-softphone)
9. [Cameras](#cameras)
10. [Multi-language (i18n)](#multi-language-i18n)
11. [HTTPS / TLS](#https--tls)
12. [REST API](#rest-api)
13. [Logs](#logs)
14. [Requirements](#requirements)

---

## Quick Start

```bash
git clone <repo>
cd lsh
npm install
cp config.example.json config.json   # edit with your credentials
node server.js                        # or: npm start
```

Open `http://localhost:3001` in your browser. On first run you will be redirected to `/setup.html` to create an admin account.

> **Tip:** Every setting is available in the **Settings** page inside the UI. You rarely need to edit `config.json` by hand after initial setup.

---

## Configuration

`config.json` (gitignored) is the single source of truth. Copy `config.example.json` as a starting point. The file is read on startup and rewritten by the Settings page.

### Top-level sections

| Section | Required | Purpose |
|---|---|---|
| `mqtt` | No | Local Victron Venus OS / Cerbo GX MQTT broker |
| `vrm` | No | Victron VRM cloud API (fallback when MQTT is unreachable) |
| `solaredge` | No | SolarEdge cloud data |
| `smartthings` | No | Samsung SmartThings devices |
| `loxone` | No | Loxone Miniserver local API |
| `satel` | No | Satel INTEGRA alarm panel |
| `unifi` | No | UniFi Protect cameras and NVR |
| `shelly` | No | Shelly Gen1 / Gen2 devices |
| `boneio` | No | BoneIO relay boards (MQTT auto-discovery) |
| `dreame` | No | Dreame robot vacuums and air purifiers |
| `homey` | No | Homey Pro (local or cloud) |
| `dirigera` | No | IKEA Dirigera smart-home hub |
| `tradfri` | No | IKEA Tradfri gateway |
| `sip` | No | SIP softphone (WebSocket transport) |
| `cameras` | No | Manual camera list (RTSP, snapshot, MJPEG, WebRTC) |
| `relays` | Yes | Victron relay index + display name |
| `homekit` | Yes | HomeKit bridge PIN, port, and MAC |
| `server` | Yes | HTTP port, HTTPS, and Let's Encrypt |

### `mqtt`

```json
"mqtt": {
  "host": "192.168.1.100",
  "port": 1883,
  "portalId": ""
}
```

`portalId` is the Victron installation ID visible in VRM. Leave blank to auto-detect from the first MQTT message.

### `vrm`

```json
"vrm": {
  "email": "you@example.com",
  "password": "secret",
  "installationId": 12345
}
```

Used as automatic fallback when local MQTT is unreachable. Alternatively set `apiToken` instead of `email`/`password`.

### `solaredge`

```json
"solaredge": {
  "siteId": "1234567",
  "apiKey": "ABCDEFG..."
}
```

Polls the SolarEdge cloud API every 15 minutes (API rate limit). Data appears on the **SolarEdge** dashboard card.

### `smartthings`

```json
"smartthings": {
  "token": "your-PAT",
  "deviceIds": []
}
```

Leave `deviceIds` empty to discover all devices. Or supply a list of device UUIDs to limit discovery.

### `loxone`

```json
"loxone": {
  "host": "192.168.1.10",
  "port": 80,
  "username": "admin",
  "password": "secret"
}
```

Connects via the Loxone WebSocket API. All controls appear as device cards on the dashboard.

### `satel`

```json
"satel": {
  "host": "192.168.1.100",
  "port": 7094,
  "armCode": "1234",
  "zoneCount": 32,
  "zoneNames": { "1": "Front Door", "2": "Back Door" },
  "partitions": [1],
  "partitionNames": { "1": "House" }
}
```

Speaks the Satel INTEGRA binary TCP protocol. Zone and partition names are optional display labels.

### `unifi`

```json
"unifi": {
  "host": "192.168.1.1",
  "username": "admin",
  "password": "secret",
  "apiKey": ""
}
```

`apiKey` takes precedence over `username`/`password` when set (UniFi Network 8+ API keys).

### `shelly`

```json
"shelly": {
  "devices": [
    { "name": "Living Room", "host": "192.168.1.50" }
  ]
}
```

Supports Shelly Gen1 (REST `/status`) and Gen2 (REST `/rpc/Shelly.GetStatus`). Auto-detected per device.

### `boneio`

```json
"boneio": {
  "host": "192.168.1.100",
  "port": 1883
}
```

Subscribes to `homeassistant/#` on the BoneIO board's local MQTT broker for HA auto-discovery config, then tracks live state via `boneIO/#` topics.

### `dreame`

```json
"dreame": {
  "devices": [
    { "name": "L10S Vacuum", "host": "192.168.1.x", "token": "32-hex-chars", "type": "vacuum" },
    { "name": "Air Purifier", "host": "192.168.1.x", "token": "32-hex-chars", "type": "air_purifier" }
  ]
}
```

Communicates via the Xiaomi miio UDP protocol (port 54321). `type` is `vacuum` or `air_purifier`. Get the token with [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor).

### `homey`

```json
"homey": {
  "mode": "local",
  "host": "192.168.1.x",
  "homeyId": "",
  "token": "",
  "pollInterval": 10
}
```

`mode` is `local` (Homey Pro 2023+, LAN API) or `cloud` (Homey Pro older / Homey Bridge, uses `homeyId`). Get a token at **Homey Developer Tools → Personal Access Tokens**. `pollInterval` is in seconds.

### `dirigera`

```json
"dirigera": {
  "host": "192.168.x.x",
  "token": "..."
}
```

One-time pairing: press the action button on the hub, then immediately run `node scripts/dirigera-auth.js <host>`. Copy the printed token into config.

### `tradfri`

```json
"tradfri": {
  "host": "192.168.x.x",
  "securityCode": "XXXX-XXXX-XXXX",
  "identity": "",
  "psk": ""
}
```

First run: set `securityCode` from the sticker on the gateway back. The server generates and logs `identity` and `psk` — copy those back into config and remove `securityCode`.

### `sip`

```json
"sip": {
  "wsUrl":       "wss://192.168.1.1:5443",
  "username":    "101",
  "domain":      "192.168.1.1",
  "password":    "secret",
  "displayName": "LSH Dashboard",
  "dtmfUnlock":  "#",
  "relayIndex":  0
}
```

WebSocket SIP. `dtmfUnlock` is the DTMF tone sent when the **Unlock** button is pressed during a call. `relayIndex` is the Victron relay to pulse for 2.5 s on Unlock.

### `cameras`

```json
"cameras": [
  {
    "name": "Front Door",
    "url": "rtsp://localhost:8554/FrontDoor",
    "snapshotUrl": "http://192.168.1.x/snapshot.jpg",
    "mjpegUrl": "",
    "webrtcUrl": "http://go2rtc:1984/api/webrtc?src=FrontDoor"
  }
]
```

Priority order for the live preview: `webrtcUrl` → `mjpegUrl` → `snapshotUrl` (polled every 2 s). UniFi Protect cameras are automatically added to this list.

### `relays`

```json
"relays": [
  { "index": 0, "name": "Gate" },
  { "index": 1, "name": "Boiler" }
]
```

`index` corresponds to Victron relay positions (0-based). Names are display-only.

### `homekit`

```json
"homekit": {
  "pin": "031-45-154",
  "port": 47128,
  "username": "CC:22:3D:E3:CE:F6"
}
```

`username` is the bridge MAC address — must be unique per HomeKit home. Generate a random MAC if running multiple instances.

### `server`

```json
"server": {
  "port": 3001,
  "https": {
    "enabled": false,
    "port": 3443,
    "certFile": "./certs/cert.pem",
    "keyFile":  "./certs/key.pem"
  },
  "letsEncrypt": {
    "enabled":  false,
    "domain":   "dashboard.example.com",
    "email":    "admin@example.com",
    "port":     443,
    "certsDir": "./certs",
    "staging":  false
  }
}
```

---

## Pages

| URL | Description |
|---|---|
| `/` | Live dashboard — energy flow, battery, solar, grid, relays, device cards, cameras |
| `/settings.html` | All integration settings, test buttons, HomeKit QR, backup/restore |
| `/logs.html` | Per-category log viewer with auto-refresh and download |
| `/mqtt.html` | Real-time MQTT topic explorer with message history |
| `/login.html` | Sign-in page |
| `/setup.html` | First-run admin account creation |

---

## Backend Modules

### `server.js`

Entry point. Wires all modules together, creates the Express + Socket.IO server, and starts HTTPS / Let's Encrypt if configured.

Start sequence:
1. Install global logger (`logger.install()`)
2. Load config (`config.js`)
3. Create `DataStore`, `SensorRegistry`, `CameraLog`, `RelayController`
4. Start `ConnectionManager` (MQTT → VRM)
5. Start all optional integration clients
6. Mount REST API (`api-routes.js`)
7. Start Socket.IO (`websocket.js`)
8. Start HomeKit bridge
9. Start HTTP (and optionally HTTPS) servers

---

### `src/connection-manager.js`

Manages the primary Victron data connection. Tries local MQTT first; falls back to VRM cloud after 15 s if MQTT is unreachable. Automatically retries MQTT every 60 s and switches back once it reconnects.

**Events emitted** (extends `EventEmitter`):

| Event | Payload | When |
|---|---|---|
| `source-changed` | `{ source: 'mqtt' \| 'vrm' \| null }` | Active source switches |
| `data` | `{ key, value }` | New Victron metric received |
| `relay-state` | `{ index, on }` | Relay state update |

**Config keys used:** `mqtt`, `vrm`

---

### `src/mqtt-client.js`

Connects to the local Victron Venus OS / Cerbo GX MQTT broker. Subscribes to `N/<portalId>/#` for live metrics and publishes relay commands to `W/<portalId>/...`.

Auto-discovers the portal ID from the first retained message if not set in config. Emits a `keepalive` payload every 60 s to prevent the broker from going silent.

**Config keys used:** `mqtt.host`, `mqtt.port`, `mqtt.portalId`

---

### `src/vrm-client.js`

Polls the Victron VRM cloud REST API for live metrics when local MQTT is unavailable. Authenticates with email/password or API token. Poll interval is 5 s.

Also used to send relay commands via the VRM API when MQTT is offline.

**Config keys used:** `vrm.email`, `vrm.password`, `vrm.apiToken`, `vrm.installationId`

---

### `src/data-store.js`

Central in-memory key-value store for all live Victron metrics. Keys mirror the MQTT topic structure (e.g., `system/0/Dc/Battery/Soc`). Provides snapshot access so new Socket.IO clients receive the full current state on connect.

---

### `src/sensor-registry.js`

Manages all non-Victron devices discovered by integration clients. Each device is registered with a key, label, icon, color, and a list of sensor descriptors. Supports sending commands back to devices via `sendCommand(deviceKey, sensorPath, value)`.

Integration clients call `registry.register(device)` to add a device and `registry.update(deviceKey, readings)` to push new values.

---

### `src/relay-controller.js`

Sends relay on/off commands via whichever connection is currently active (MQTT or VRM). Called by the REST API and the SIP unlock button.

---

### `src/api-routes.js`

Mounts all REST endpoints under `/api/`. See [REST API](#rest-api) for the full list.

---

### `src/websocket.js`

Sets up Socket.IO. Authenticates each connection via the session cookie. On connect, emits a full snapshot of all current data. Broadcasts `update` events for each new Victron metric, `devices` for the full device list, `platform-status` for integration connection states, and `camera-event` for motion/snapshot alerts.

---

### `src/data-store.js`

Singleton in-memory store. The `ConnectionManager` writes to it; `api-routes.js` and `websocket.js` read from it.

---

### `src/platform-status.js`

Singleton `EventEmitter`. Each integration client calls `platformStatus.set(name, connected)` when its connection state changes. The websocket module forwards `change` events to all browsers as `platform-status` events, driving the colour-coded logo bar in the dashboard header.

---

### `src/logger.js`

Wraps `console.log/warn/error` and mirrors output to per-category log files in `logs/`. Files are rotated at 2 MB (previous file saved as `<name>.1.log`).

Category is inferred from the `[PREFIX]` at the start of each log message.

**Categories:** `app`, `mqtt`, `vrm`, `connection`, `smartthings`, `shelly`, `satel`, `unifi`, `homekit`, `server`, `sensors`, `solaredge`, `websocket`

**API:**

```js
logger.categories()      // → ['app', 'mqtt', ...]
logger.tail(name, 300)   // → string[]  (last N lines)
logger.clear(name)       // truncates the file
```

---

### `src/auth.js`

Full authentication system: user accounts, JWT session cookies, and static API bearer tokens.

- **Users** — stored in `persist/users.json` (bcrypt-hashed passwords, roles: `admin` / `viewer`)
- **Sessions** — JWT in an `httpOnly` cookie (`lsh-session`), 7-day TTL, auto-signed with a secret persisted in `config.json`
- **API tokens** — random 32-byte hex strings stored in `persist/api-tokens.json`; sent as `Authorization: Bearer <token>` header

**Public paths** (no auth required): `/login.html`, `/setup.html`, `/login.js`, `/setup.js`, `/theme.js`, `/common.js`, `/i18n.js`, `/i18n/*.json`, all `.css`, `.svg`, `.ico`, `/api/auth/login`, `/api/auth/setup`

---

### `src/acme.js`

Obtains and auto-renews Let's Encrypt TLS certificates via the HTTP-01 ACME challenge. Temporarily binds to port 80 during initial issuance, then hands off to a permanent HTTP→HTTPS redirect server. Certificates are written to `certsDir` and renewed automatically when fewer than 30 days remain.

Requires the `acme-client` npm package. If not installed, ACME is silently disabled.

**Config keys used:** `server.letsEncrypt.*`

---

### `src/camera-log.js`

In-memory ring buffer (max 500 entries) for camera events (motion, sound, snapshots). Events are pushed by integration clients (UniFi Protect, Loxone) and streamed to connected browsers via Socket.IO `camera-event` events. Also exposed via `GET /api/camera-log`.

---

### `src/mqtt-explorer.js`

Subscribes to `#` on the same MQTT broker as `mqtt-client.js`. Maintains a map of all topics with their last value, timestamp, and a ring-buffer history (last 100 messages per topic). Serves the MQTT Explorer page and exposes publish via `POST /api/mqtt-explorer/publish`.

---

### `src/homekit-bridge.js`

HAP-nodejs bridge. Registers HomeKit accessories for:

- **Relays** — as `Switch` services
- **Sensors** — temperature, humidity, motion, contact, smoke, CO, leak, occupancy, battery, lux, CO₂, thermostat, lock, cover, fan
- **Cameras** — via `homekit-camera.js` (streaming stubs)

Accessory state is driven by sensor registry updates. Commands from HomeKit (e.g. toggle a switch) are routed through `relay-controller.js` or `sensor-registry.js`.

**Config keys used:** `homekit.pin`, `homekit.port`, `homekit.username`

---

### `src/homekit-camera.js`

Registers camera accessories in the HomeKit bridge using the `CameraController` API. Provides still image snapshots via `snapshotUrl`. Video streaming requires a native RTSP-capable accessory (e.g., a dedicated camera bridge); this module provides the HomeKit pairing stub.

---

### `src/homekit-uri.js`

Generates the `X-HM://` setup URI from the HomeKit PIN and category. Used by the Settings page to display a scannable QR code via the `qrcodejs` library.

---

### `src/device-definitions.js`

Static lookup tables mapping Victron MQTT topic patterns to human-readable device types, icons, colors, and sensor descriptors. Used by `sensor-registry.js` to auto-classify discovered Victron devices (inverters, chargers, tanks, GPS trackers, etc.).

---

### `config.js`

Loads and saves `config.json`. Provides `config.load()` and `config.save(patch)`. A deep-merge is used so partial patches from the Settings API don't overwrite unrelated keys.

---

## Integration Modules

### `src/solaredge-client.js`

Polls the **SolarEdge Monitoring API** (`monitoringapi.solaredge.com`) every 15 minutes (enforced by the free-tier rate limit). Fetches site overview, power flow, and energy totals. Registers a single `solaredge` device with sensors for current power, today's yield, and grid import/export.

**Setup:** Create an API key in the SolarEdge monitoring portal under Admin → Site Access.

**Config:**
```json
"solaredge": { "siteId": "1234567", "apiKey": "ABCDEF..." }
```

---

### `src/smartthings-client.js`

Polls the **Samsung SmartThings cloud API** every 10 s. Discovers all devices (or the list in `deviceIds`) and maps capabilities to sensor descriptors. Supports control of switches, dimmers, thermostats, locks, covers, and color lights.

**Setup:** Generate a Personal Access Token at [account.smartthings.com/tokens](https://account.smartthings.com/tokens).

**Config:**
```json
"smartthings": { "token": "...", "deviceIds": [] }
```

---

### `src/loxone-client.js`

Connects to a **Loxone Miniserver** via its WebSocket API with token-based authentication. Discovers all controls from the structure file and maps them to sensor descriptors. Supports read and write for switches, dimmers, jalousies, and temperature setpoints.

**Config:**
```json
"loxone": { "host": "192.168.1.10", "port": 80, "username": "admin", "password": "secret" }
```

---

### `src/satel-client.js`

Speaks the **Satel INTEGRA binary TCP protocol** (default port 7094). Polls zone states and partition arm status every 10 s. Zone and partition names are set in config for display purposes.

Wire protocol uses CRC-16 with `0xFE` byte-stuffing. Reconnects automatically after 30 s on connection loss.

**Config:**
```json
"satel": {
  "host": "192.168.1.100", "port": 7094, "armCode": "1234",
  "zoneCount": 32,
  "zoneNames": { "1": "Front Door" },
  "partitions": [1], "partitionNames": { "1": "House" }
}
```

---

### `src/unifi-protect-client.js`

Connects to **UniFi Protect** via its local HTTPS API. Authenticates with API key (UniFi Network 8+) or username/password. Discovers all cameras and registers them into the camera list so they appear in the dashboard. Subscribes to the real-time event WebSocket for motion and smart detection alerts, which are forwarded to `camera-log.js`.

**Config:**
```json
"unifi": { "host": "192.168.1.1", "username": "admin", "password": "secret", "apiKey": "" }
```

---

### `src/shelly-client.js`

Polls **Shelly** devices every 15 s. Auto-detects Gen1 (REST `/status`) vs Gen2 (REST `/rpc/Shelly.GetStatus`). Registers sensors for power, voltage, current, and relay state. Supports toggling relays via `POST /api/device/:key/command`.

**Config:**
```json
"shelly": { "devices": [{ "name": "Living Room", "host": "192.168.1.50" }] }
```

---

### `src/boneio-client.js`

Discovers **BoneIO** relay board entities via **Home Assistant MQTT auto-discovery** (`homeassistant/<component>/boneio_*/config` retained topics). Groups all entities from the same board into a single dashboard device card. Tracks live relay and sensor state via `boneIO/<board>/<type>/<id>/state` topics. Commands are published back to the board's MQTT broker.

**Config:**
```json
"boneio": { "host": "192.168.1.100", "port": 1883 }
```

---

### `src/dreame-client.js`

Controls **Dreame** robot vacuums and air purifiers via the **Xiaomi miio UDP protocol** (port 54321, AES-128-CBC with MD5-derived key). Polls device state every 15 s. Supports start/stop/pause/dock for vacuums and on/off/mode/fan-speed for air purifiers.

**Token acquisition:** Use [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor).

**Config:**
```json
"dreame": {
  "devices": [
    { "name": "Vacuum", "host": "192.168.1.x", "token": "32-hex-chars", "type": "vacuum" },
    { "name": "Purifier", "host": "192.168.1.x", "token": "32-hex-chars", "type": "air_purifier" }
  ]
}
```

---

### `src/homey-client.js`

Integrates with **Homey Pro** in two modes:

- **`local`** (Homey Pro 2023+) — polls the local LAN REST API every `pollInterval` seconds. No cloud dependency.
- **`cloud`** — polls the Homey cloud API using `homeyId` and token.

Maps 30+ Homey capability types to sensor descriptors. Supports control of switches, dimmers, thermostats, locks, covers, and volume. Color lights are supported via hue/saturation.

**Token:** Homey Developer Tools → Personal Access Tokens → add new token with full scope.

**Config:**
```json
"homey": { "mode": "local", "host": "192.168.1.x", "token": "...", "pollInterval": 10 }
```

---

### `src/dirigera-client.js`

Integrates with the **IKEA Dirigera** smart home hub. Discovers devices via REST (`GET /v1/devices`) and subscribes to live updates via WebSocket (`wss://<host>/v1`). Normalizes attribute names to match the SmartThings convention so existing HomeKit service builders are reused without modification.

**One-time pairing:**
```bash
node scripts/dirigera-auth.js 192.168.x.x
# Press the action button on the hub when prompted, then copy the printed token into config
```

**Config:**
```json
"dirigera": { "host": "192.168.x.x", "token": "..." }
```

---

### `src/tradfri-client.js`

Integrates with the **IKEA Tradfri** gateway via CoAP/DTLS using the `node-tradfri-client` package.

**First-run setup:** Set `securityCode` (from the sticker on the gateway). On startup the server prints generated `identity` and `psk` to the console — copy them into config and remove `securityCode` for all subsequent restarts.

```bash
npm install node-tradfri-client   # optional dependency
```

**Config:**
```json
"tradfri": {
  "host": "192.168.x.x",
  "securityCode": "XXXX-XXXX-XXXX",
  "identity": "",
  "psk": ""
}
```

---

## Security & Auth

### User Accounts

- Create the admin account on first run at `/setup.html`
- Additional users (admin or viewer role) can be added in **Settings → Security → Users**
- Passwords are bcrypt-hashed with 12 salt rounds and stored in `persist/users.json`
- Sessions use JWT cookies (`lsh-session`, 7-day TTL, `httpOnly`, `sameSite: strict`)

### API Tokens

Static bearer tokens for script / Home Assistant integration:

```http
Authorization: Bearer <token>
```

Create tokens in **Settings → Security → API Tokens**. Tokens are stored as plain hex in `persist/api-tokens.json` — treat them like passwords.

### Role Permissions

| Role | Dashboard | Settings | Relay control |
|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ |
| `viewer` | ✓ | ✗ | ✗ |

---

## HomeKit

The HomeKit bridge exposes all relays and integration sensors as native HomeKit accessories. Scan the QR code shown in **Settings → HomeKit** with the **Home** app, or enter the PIN manually.

**Supported service types:**

| HomeKit service | Triggered by |
|---|---|
| Switch | Relay, SmartThings switch, Homey `onoff`, Shelly relay |
| Temperature Sensor | SmartThings temperature, Homey `measure_temperature`, Loxone temp |
| Humidity Sensor | SmartThings humidity, Homey `measure_humidity` |
| Motion Sensor | SmartThings motion, Homey `alarm_motion`, BoneIO motion |
| Contact Sensor | SmartThings contact, BoneIO door sensor |
| Smoke Sensor | Homey `alarm_smoke` |
| CO Sensor | Homey `alarm_co` |
| Leak Sensor | Homey `alarm_water` |
| Occupancy Sensor | SmartThings presence, Homey `alarm_presence` |
| Battery Service | SmartThings battery, Homey `measure_battery` |
| Lightbulb (dimmer) | SmartThings dimmer, Homey `dim` |
| Lightbulb (color) | SmartThings color, Homey color capabilities |
| Thermostat | SmartThings thermostat, Homey `target_temperature` |
| Lock | SmartThings lock, Homey `locked` |
| Window Covering | Homey `window_coverings_set` |
| Lux Sensor | Homey `measure_luminance` |
| CO₂ Sensor | Homey `measure_co2` |
| Fan | Homey `fan_speed` |
| Air Quality Sensor | Dreame air purifier sensors |
| Tank Level | Victron tank sensors |
| Camera (stub) | Manual camera entries |

---

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

Camera tiles appear on the dashboard. Click any tile to open the full-screen modal with event log.

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

## Multi-language (i18n)

The dashboard supports **English, Polish, French, and German**. Language is stored in `localStorage` (`lsh-lang`) and falls back to the browser's preferred language.

### How it works

- `public/i18n.js` — client-side engine loaded as the first script on every page
- `public/i18n/{en,pl,fr,de}.json` — translation files (served without auth so login/setup pages translate too)
- DOM elements are annotated with `data-i18n="key"` attributes; `applyDOM()` replaces `textContent` after the JSON loads
- Additional attributes: `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-html`, `data-i18n-aria-label`
- A language switcher (EN / PL / FR / DE buttons) is injected into the header on every page

### Adding a new language

1. Copy `public/i18n/en.json` → `public/i18n/xx.json`
2. Translate all values
3. Add `'xx'` to the `SUPPORTED` array and `LABELS` object in `public/i18n.js`

---

## HTTPS / TLS

### Custom certificate

```json
"server": {
  "https": {
    "enabled": true,
    "port": 3443,
    "certFile": "./certs/cert.pem",
    "keyFile":  "./certs/key.pem"
  }
}
```

Both HTTP (port `server.port`) and HTTPS run simultaneously. HTTP does not redirect to HTTPS unless Let's Encrypt is also enabled.

### Let's Encrypt (automatic)

```json
"server": {
  "letsEncrypt": {
    "enabled":  true,
    "domain":   "dashboard.example.com",
    "email":    "admin@example.com",
    "port":     443,
    "certsDir": "./certs",
    "staging":  false
  }
}
```

**Requirements:**
- Port 80 must be reachable from the internet (HTTP-01 challenge)
- `domain` must resolve to the machine's public IP
- Set `staging: true` first to test without hitting rate limits

Certificates are auto-renewed when fewer than 30 days remain. Requires `npm install acme-client`.

---

## REST API

All endpoints require authentication (cookie or `Authorization: Bearer <token>`) unless listed as public.

### Data

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | All live Victron metrics |
| `GET` | `/api/devices` | All registered sensor devices |
| `POST` | `/api/device/:key/command` | Send command `{ sensor, value }` to a device |
| `GET` | `/api/sources` | Active data source (`mqtt` / `vrm` / `null`) |

### Relays

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/relays` | Relay list with current state |
| `POST` | `/api/relay/:index/state` | Toggle relay `{ on: true \| false }` |

### Cameras

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cameras` | Camera list (manual + UniFi) |
| `POST` | `/api/webrtc/offer` | WHEP SDP proxy `{ url, sdp }` |
| `GET` | `/api/camera-log` | Recent camera events `?camera=name&limit=100` |
| `POST` | `/api/camera-log` | Push a camera event `{ camera, type, detail }` |

### MQTT Explorer

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/mqtt-explorer/topics` | All known topics with last value and timestamp |
| `GET` | `/api/mqtt-explorer/history?topic=…` | Message ring-buffer for a topic |
| `POST` | `/api/mqtt-explorer/publish` | Publish `{ topic, payload, retain }` |

### Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/logs` | List available log categories |
| `GET` | `/api/logs/:name` | Last N lines `?lines=300` |
| `DELETE` | `/api/logs/:name` | Clear a log file |
| `GET` | `/api/logs/:name/download` | Download raw log file |

### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | Current config (secrets masked) |
| `POST` | `/api/settings` | Save config patch |
| `GET` | `/api/settings/export` | Download full `config.json` |
| `POST` | `/api/settings/import` | Restore from uploaded config |

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | `{ username, password }` → sets session cookie |
| `POST` | `/api/auth/logout` | Clears session cookie |
| `POST` | `/api/auth/setup` | First-run admin creation `{ username, password }` |
| `GET` | `/api/auth/me` | Current user info |
| `POST` | `/api/auth/change-password` | `{ currentPassword, newPassword }` |
| `GET` | `/api/auth/users` | List users (admin only) |
| `POST` | `/api/auth/users` | Create user `{ username, password, role }` |
| `DELETE` | `/api/auth/users/:id` | Delete user |
| `GET` | `/api/auth/tokens` | List API tokens |
| `POST` | `/api/auth/tokens` | Create token `{ name }` |
| `DELETE` | `/api/auth/tokens/:id` | Revoke token |

### Admin

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/restart` | Restart the Node.js process |
| `POST` | `/api/admin/reset-config` | Erase config and restart |
| `GET` | `/api/admin/homekit-uri` | HomeKit setup URI for QR generation |

### Integration test endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/test/mqtt` | Test MQTT connection with supplied credentials |
| `POST` | `/api/test/vrm` | Test VRM login |
| `POST` | `/api/test/vrm-live` | Fetch one live data point from VRM |
| `POST` | `/api/test/solaredge` | Test SolarEdge API key |
| `POST` | `/api/test/smartthings` | Test SmartThings token |
| `POST` | `/api/test/homey` | Test Homey credentials |
| `POST` | `/api/test/unifi` | Test UniFi credentials |
| `POST` | `/api/test/satel` | Test Satel TCP connection |
| `POST` | `/api/test/loxone` | Test Loxone credentials |
| `POST` | `/api/test/shelly` | Test Shelly device HTTP |
| `POST` | `/api/test/sip` | Validate SIP config structure |

---

## Logs

Log files are written to `logs/` (gitignored). Each category has its own file plus a combined `app.log`. Files are rotated at 2 MB (one backup kept as `<name>.1.log`).

| File | Contents |
|---|---|
| `app.log` | Everything |
| `mqtt.log` | MQTT connect/disconnect, topic errors |
| `vrm.log` | VRM auth and poll events |
| `connection.log` | Source-switch events |
| `smartthings.log` | SmartThings API calls and errors |
| `shelly.log` | Shelly poll errors |
| `satel.log` | Satel TCP protocol messages |
| `unifi.log` | UniFi Protect events |
| `homekit.log` | HomeKit bridge events |
| `solaredge.log` | SolarEdge API calls |
| `sensors.log` | Device registration and command errors |
| `websocket.log` | Socket.IO connection events |
| `server.log` | HTTP server and config events |

---

## Requirements

- **Node.js** 18 or later
- **npm** packages: see `package.json`
- At least one of: local Victron MQTT broker or a Victron VRM account
- Optional npm packages (install separately if needed):
  - `acme-client` — Let's Encrypt support
  - `node-tradfri-client` — IKEA Tradfri gateway support
