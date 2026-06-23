# LSH — LoxoneSwaggerHelper

## Product Leaflet

[![Page 1](leaflet/pages/page1.png)](leaflet/lsh-leaflet.pdf)
[![Page 2](leaflet/pages/page2.png)](leaflet/lsh-leaflet.pdf)
[![Page 3](leaflet/pages/page3.png)](leaflet/lsh-leaflet.pdf)
[![Page 4 — SWOT](leaflet/pages/page4.png)](leaflet/lsh-leaflet.pdf)

📄 **[Download PDF](leaflet/lsh-leaflet.pdf)** — features, integrations &amp; REST API reference

---

## SWOT Analysis

### 💪 Strengths

| | |
|---|---|
| **Local-first, zero cloud dependency** | All data stays on LAN. MQTT runs directly to hardware — no relay server, no account, works during internet outages. Optional VRM cloud fallback only when needed. |
| **20+ integrations in a single process** | ~120 MB RAM footprint. No microservice sprawl, no Docker Compose with 12 containers — just `node server.js`. |
| **Victron Energy depth** | Solar MPPT, battery SoC, grid import/export, relay control — uniquely positioned for off-grid and solar installations. SolarEdge overlay included. |
| **Native Apple HomeKit bridge** | Every sensor, switch, camera, and relay auto-exposed. Unlimited accessories — bridge survives restarts without re-pairing. |
| **Protocol breadth** | MQTT, KNXnet/IP, Modbus TCP, REST, WebSocket, RTSP — standard protocols only, no proprietary SDKs required. |
| **On-demand RTSP proxy** | FFmpeg re-streams only when a client connects — zero idle bandwidth. Each camera gets its own port. Loxone Intercom compatible. |
| **Settings UI — no YAML required** | All integrations configured via browser forms with live connectivity tests. KNX group addresses, SmartBob topics, FFmpeg proxy — all point-and-click. |
| **MQTT Explorer built-in** | Live topic browser + publish/subscribe panel, no separate MQTT.fx or MQTT Explorer needed. |

### ⚠️ Weaknesses

| | |
|---|---|
| **Technical setup required** | No one-click installer or Docker Hub image. Requires Node.js, terminal comfort, and manual `config.json` editing for initial setup. |
| **No automation engine** | No built-in rule or scene builder. Users must rely on external tools (Node-RED, cron, HomeKit automations) for time or condition-based triggers. |
| **No persistent history / charting** | Live values only — no time-series database, no energy graphs over days or weeks. Historical data requires InfluxDB + Grafana sidecar. |
| **Single-node, no HA failover** | One server failure = no dashboard, no HomeKit bridge. No clustering or standby replication supported. |
| **Cloud API fragility** | SmartThings, LG ThinQ, and VRM integrations depend on vendor API stability. Unilateral breaking changes can silently disable features. |
| **Single maintainer bus factor** | Platform continuity depends on one developer. No community governance, contributor pipeline, or public issue tracker yet. |

### 🚀 Opportunities

| | |
|---|---|
| **Privacy-conscious market growth** | Users increasingly reject cloud-dependent hubs after outages (SmartThings 2022, Google Nest 2023). LSH's local-first story is a direct answer. |
| **Victron / solar / EV adoption rising** | Victron Energy is the dominant brand in off-grid solar. EV charger integration + battery relay control gives LSH a unique energy management angle no competitor covers. |
| **KNX building automation market** | KNX is the dominant bus in European commercial buildings. First-class KNXnet/IP support opens the professional integrator and architect market. |
| **Docker image + NAS packaging** | A published Docker Hub image and Synology/Unraid community package would unlock a large segment of homelab users who deploy from package managers. |
| **Commercial integrator channel** | KNX + Victron + Loxone overlap with professional AV and building automation installers — a channel underserved by Home Assistant's DIY-first positioning. |
| **Automation engine add-on** | Adding a visual flow builder or simple rule engine (`if sensor X > value → command Y`) would significantly expand the non-technical user segment. |

### 🔴 Threats

| | |
|---|---|
| **Home Assistant dominance** | Enormous ecosystem (3,000+ integrations), massive community, strong brand, and well-funded Nabu Casa behind it. Mindshare is very hard to displace. |
| **Vendor API changes** | SmartThings, LG ThinQ, and VRM can revoke or break APIs without notice. No contractual SLA between LSH and any vendor platform. |
| **Matter / Thread commoditisation** | If Matter becomes universal, Apple Home and Google Home absorb device control natively — reducing the differentiation of multi-protocol middleware like LSH. |
| **Security exposure at network edge** | Self-hosted dashboards port-forwarded to the internet are a common attack vector. Misconfigured TLS or weak passwords can expose the entire home network. |
| **Competing open platforms** | openHAB, Domoticz, ioBroker, and Gladys cover overlapping protocol breadth with established communities and package registries. |
| **HAP-nodejs / HomeKit spec changes** | The HAP bridge relies on a reverse-engineered Apple spec. Apple can introduce MFi restrictions or firmware changes that break the bridge without warning. |

---

A self-hosted home automation dashboard built on Node.js. Aggregates live data from Victron Energy, SolarEdge, Samsung SmartThings, Loxone, Satel, UniFi Protect, Shelly, BoneIO, Dreame, Homey, IKEA Dirigera, IKEA Tradfri, LG ThinQ, ESPHome (ESP32/ESP8266), and KNX into a single real-time web UI with relay control, HomeKit integration, SIP softphone, MQTT explorer, FFmpeg RTSP proxy, and multi-language support.

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

## Running as a service (PM2)

For unattended, always-on deployments use [PM2](https://pm2.keymetrics.io/) — it keeps the server running, restarts it on crash, and brings it back after a reboot. An [`ecosystem.config.js`](ecosystem.config.js) is included.

```bash
npm install -g pm2                # one-time, installs PM2 globally
pm2 start ecosystem.config.js     # start LSHServer (or: npm run pm2:start)
pm2 save                          # remember the process list
pm2 startup                       # print the command to enable boot-time start (run it once)
```

The app is registered under the name **`lsh`** in fork mode (single instance — the server binds fixed HTTP(S)/HomeKit/RTSP ports and holds long-lived MQTT/WebSocket connections, so cluster mode would create instances fighting over the same ports). It restarts automatically and is recycled if it exceeds 300 MB of RAM.

Convenience `npm` scripts wrap the common PM2 commands:

| Command | Action |
|---|---|
| `npm run pm2:start` | Start the server under PM2 |
| `npm run pm2:stop` | Stop the process |
| `npm run pm2:restart` | Hard restart |
| `npm run pm2:reload` | Zero-downtime reload |
| `npm run pm2:delete` | Remove from PM2 |
| `npm run pm2:logs` | Tail PM2 stdout/stderr |
| `npm run pm2:status` | Show process status |

PM2's own stdout/stderr are written to `logs/pm2-out.log` and `logs/pm2-error.log`; the server additionally writes structured per-category logs to `logs/*.log` (see [`src/logger.js`](src/logger.js)) and exposes them in the **Logs** page.

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
| `lgthinq` | No | LG ThinQ appliances (token-based auth, v1 API) |
| `esphome` | No | ESPHome ESP32/ESP8266 devices (HTTP REST API) |
| `knx` | No | KNX bus via KNXnet/IP gateway (group address mapping) |
| `ffmpegRtsp` | No | FFmpeg RTSP proxy — re-streams cameras for Loxone / RTSP clients |
| `sip` | No | SIP softphone (WebSocket transport) |
| `cameras` | No | Manual camera list (RTSP, snapshot, MJPEG, WebRTC) |
| `relays` | No | Victron relay index + display name |
| `homekit` | No | HomeKit bridge — requires `hap-nodejs` npm package |
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

### `lgthinq`

```json
"lgthinq": {
  "country": "EU",
  "lang": "en-US"
}
```

`country` and `lang` select the correct LG API regional host. Common country values: `EU`, `US`, `KR`.

Authentication uses tokens stored in `persist/lgthinq-tokens.json` — no credentials are kept in `config.json`. To authenticate:

1. Click **Fetch Tokens & User Number** in **Settings → Controllers → LG ThinQ**
2. Enter your LG account email and password once — they are used only to obtain an OAuth token and are never saved
3. The server extracts the user number from the JWT and saves the tokens to `persist/lgthinq-tokens.json`

Alternatively, paste a **Personal Access Token** (PAT — starts with `thinqpat_`) directly into the Manual Token field. PATs do not expire.

Token file schema (`persist/lgthinq-tokens.json`):
```json
{
  "access_token": "thinqpat_...",
  "refresh_token": "thinqpat_...",
  "user_number": "1234567890",
  "apiHost": "eu.api.lge.com",
  "empHost": "eu.m.lgaccount.com"
}
```

### `esphome`

```json
"esphome": {
  "devices": [
    { "name": "Living Room ESP32", "host": "192.168.1.80", "port": 80, "password": "optional" }
  ]
}
```

Each device must have `web_server:` enabled in its ESPHome YAML configuration. The `password` field is optional and matches the `web_server.auth.password` setting. Multiple devices are supported.

### `knx`

```json
"knx": {
  "host": "192.168.1.100",
  "port": 3671,
  "groupAddresses": [
    { "address": "1/1/1", "name": "Living Room Light", "dpt": "DPT1", "writable": true },
    { "address": "1/2/1", "name": "Room Temperature",  "dpt": "DPT9", "unit": "°C" },
    { "address": "1/3/1", "name": "Blinds",            "dpt": "DPT5", "writable": true, "homekitType": "WindowCovering" }
  ]
}
```

Connects to a KNXnet/IP gateway or IP router. Requires `npm install knx`.

**Group address fields:**

| Field | Required | Description |
|---|---|---|
| `address` | Yes | KNX group address in `x/y/z` format |
| `name` | Yes | Display name on the dashboard |
| `dpt` | Yes | Data point type: `DPT1`, `DPT5`, `DPT9`, `DPT14` |
| `unit` | No | Display unit (e.g. `°C`, `%`, `lx`) |
| `readable` | No | Issue read request on connect (default `true`) |
| `writable` | No | Allow write commands from the dashboard / HomeKit |
| `homekitType` | No | Override HomeKit service type (e.g. `Switch`, `TemperatureSensor`, `HumiditySensor`) |

**Supported DPT types:**

| DPT | Size | Range | Typical use |
|---|---|---|---|
| `DPT1` | 1 bit | `true` / `false` | Switch, on/off |
| `DPT5` | 1 byte | 0–255 | Dimmer, percentage, counter |
| `DPT9` | 2 bytes | KNX float | Temperature, humidity, lux |
| `DPT14` | 4 bytes | IEEE 754 float | Power, energy, general |

### `ffmpegRtsp`

```json
"ffmpegRtsp": {
  "enabled": true,
  "basePort": 8554,
  "ffmpegPath": "ffmpeg"
}
```

Re-streams each camera's RTSP URL through a built-in per-camera RTSP server so Loxone (or any other RTSP client) can connect to a stable local URL. Requires `ffmpeg` installed on the server.

- `basePort` — first port in the range; camera 0 → `basePort`, camera 1 → `basePort + 1`, etc.
- `ffmpegPath` — full path to the `ffmpeg` binary, or just `"ffmpeg"` if it is on `$PATH`
- Each camera stream is available at `rtsp://<host>:<port>/<camera-slug>`
- FFmpeg runs in listen mode per camera and restarts automatically after each client disconnects (truly on-demand)

The **Settings → Cameras → FFmpeg RTSP Proxy** section shows the ready-to-paste RTSP URLs for each camera.

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
  "enabled": true,
  "pin": "031-45-154",
  "port": 47128,
  "username": "CC:22:3D:E3:CE:F6"
}
```

`username` is the bridge MAC address — must be unique per HomeKit home. Generate a random MAC if running multiple instances.

The HomeKit bridge is **optional**. It requires the `hap-nodejs` npm package, which is not installed by default:

```bash
npm install hap-nodejs
```

If `hap-nodejs` is missing the bridge is silently skipped and a warning is logged. Set `"enabled": false` to disable HomeKit even when the package is installed.

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

### `src/homekit-bridge.js` *(optional — requires `hap-nodejs`)*

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

### `src/lgthinq-client.js`

Integrates **LG ThinQ** appliances (air conditioners, washers, dryers, dishwashers, refrigerators, etc.) via the **LG v1 REST API** (`<country>.api.lge.com`).

**Authentication:** Token-based only. Tokens are loaded from `persist/lgthinq-tokens.json` at startup. If no tokens are present the client skips start silently. PATs (Personal Access Tokens, prefix `thinqpat_`) are treated as non-expiring; OAuth access tokens are refreshed automatically using the stored refresh token.

**Auth headers used:**
- `x-emp-token` — access token
- `x-thinq-user-no` — user number (required for all v1 API calls)

**Discovery:** `GET /v1/service/homes` returns all home groups. Falls back to `GET /v1/service/application/dashboard` if no homes are found. Each device is registered in the sensor registry. Device state is polled every 30 s via `GET /v1/service/devices/:id/status`.

**Supported device types:** AC (on/off, mode, target temperature, fan speed), washer, dryer, dishwasher, refrigerator. Commands are sent via `POST /v1/service/devices/:id/control`.

**One-time user number setup:** Use **Settings → Controllers → LG ThinQ → Fetch Tokens & User Number** with your LG email/password. The server runs the LG OAuth pre-login flow (`eu.m.lgaccount.com`), extracts the user number from the JWT `sub` claim, and stores everything in `persist/lgthinq-tokens.json`. Credentials are not stored.

**Config:** See [`lgthinq`](#lgthinq) config section above.

---

### `src/esphome-client.js`

Integrates **ESPHome** ESP32/ESP8266 devices via their built-in **HTTP REST API** (the `web_server:` ESPHome component).

**Entity discovery:** On startup, connects to the SSE stream at `http://<host>/events` and collects all entity state events for 4 seconds. Each entity becomes a sensor in the registry. Discovery is re-run on every restart.

**Supported entity domains:**

| ESPHome domain | HomeKit service |
|---|---|
| `sensor` | Temperature / Humidity / Lux / CO₂ (auto-detected) |
| `binary_sensor` | Motion / Contact / generic switch |
| `switch` | Switch |
| `light` | Lightbulb |
| `climate` | Thermostat |
| `cover` | Window Covering |

**Polling:** Entity state is refreshed every 30 s via `GET /<domain>/<id>`.

**Commands:** Sent as HTTP POST to `/<domain>/<id>/turn_on`, `turn_off`, `open`, `close`, `set` (for climate/cover).

**Authentication:** Optional HTTP Basic auth — the ESPHome `web_server` password is sent as `:<password>` (empty username).

**Config:** See [`esphome`](#esphome) config section above.

---

### `src/knx-client.js`

Integrates **KNX** bus devices via a **KNXnet/IP gateway or IP router** over the local network.

**Protocol:** Uses the `knx` npm package (`npm install knx`) which connects to the gateway via KNXnet/IP UDP tunneling. The gateway host and port (`3671`) are configured in `config.json`.

**Group address lifecycle:**
1. On connect, issues a read request for every group address with `readable: true`
2. Listens for `GroupValue_Write` and `GroupValue_Response` telegrams from the bus
3. Decodes raw KNX bytes to JavaScript values using the configured DPT
4. Updates the sensor registry so values appear on the dashboard in real time

**DPT decoding:**
- `DPT1` — 1-bit boolean
- `DPT5` — 1-byte unsigned integer (0–255)
- `DPT9` — 2-byte KNX float (sign + 4-bit exponent + 11-bit mantissa, 0.01 resolution)
- `DPT14` — 4-byte IEEE 754 big-endian float

**Write commands:** Writable group addresses accept commands via `POST /api/device/knx%2F<host>/command`. Values are re-encoded to KNX wire format before sending.

**Config:** See [`knx`](#knx) config section above.

---

### `src/ffmpeg-rtsp.js`

Runs a per-camera **FFmpeg RTSP proxy** so Loxone, VLC, or any RTSP client can connect to a stable local URL without needing access to the original camera credentials or stream format.

**How it works:**
1. For each camera entry in `config.cameras` that has a `url` (RTSP source), an FFmpeg process is spawned on `basePort + cameraIndex`
2. FFmpeg uses `-rtsp_flags listen` — it waits passively for a client to connect before opening the source stream (truly on-demand, no wasted bandwidth)
3. When the client disconnects FFmpeg exits; the module restarts it after 2 s so it's ready for the next connection
4. The proxy URL follows the pattern `rtsp://<server-ip>:<port>/<camera-slug>` where `slug` is the camera name lowercased and hyphenated

**Status:** The Settings page **Cameras → FFmpeg RTSP Proxy** table shows each camera's URL and whether the FFmpeg process is currently active (client connected) or waiting.

**Requires:** `ffmpeg` binary on `$PATH`, or set `ffmpegRtsp.ffmpegPath` to the absolute path.

**Config:** See [`ffmpegRtsp`](#ffmpegrtsp) config section above.

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

> **Requirement:** `npm install hap-nodejs` — the package is optional and not bundled. The server starts normally without it (bridge silently disabled). Set `homekit.enabled: false` in `config.json` to disable it even when the package is present.

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

LSH exposes a JSON REST API at `/api/*`. This section is a developer reference — it covers authentication, the response envelope, every endpoint, example `curl` calls, and the real-time Socket.IO event stream.

### Authentication

Every endpoint requires authentication **except** `POST /api/auth/login` and `POST /api/auth/setup`.

Two methods are supported and can be used interchangeably:

#### 1 — Session cookie (browser / interactive)

```bash
# Log in — the server sets an HttpOnly cookie `lsh-session`
curl -c cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"secret"}'

# Use the cookie in subsequent requests
curl -b cookies.txt http://localhost:3001/api/relays
```

#### 2 — Bearer token (scripts / Home Assistant / automation)

Create a long-lived API token in **Settings → API Tokens** (or via the API itself). Tokens do not expire unless revoked.

```bash
# Create a token (requires an active session or another token)
curl -b cookies.txt -X POST http://localhost:3001/api/auth/tokens \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-script"}'
# → { "success": true, "data": { "id": "...", "token": "lsh_xxxx...", "name": "my-script" } }

# Use the token in any request
curl -H 'Authorization: Bearer lsh_xxxx...' http://localhost:3001/api/relays
```

### Response envelope

All responses follow the same shape:

```json
{ "success": true,  "data": { ... } }   // 2xx
{ "success": false, "error": "..." }    // 4xx / 5xx
```

---

### Live energy data

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | All live Victron metrics grouped by category |
| `GET` | `/api/battery` | Battery SOC, voltage, current, power, time-to-go |
| `GET` | `/api/solar` | PV power and daily yield |
| `GET` | `/api/grid` | Grid voltage, current, power, frequency, status |
| `GET` | `/api/loads` | AC and DC load power |
| `GET` | `/api/connection` | Active data source (`mqtt` / `vrm` / `null`) |

**Example — read battery state:**

```bash
curl -H 'Authorization: Bearer lsh_xxxx...' http://localhost:3001/api/battery
```

```json
{
  "success": true,
  "data": {
    "soc": 82,
    "voltage": 51.4,
    "current": -3.1,
    "power": -159,
    "timeToGo": 28800
  }
}
```

---

### Relays

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/relays` | — | List all relays with their current on/off state |
| `POST` | `/api/relay/:index/state` | `{ "on": true }` | Set relay on (`true`) or off (`false`) |

`:index` is the 0-based relay position defined in `config.json`.

**Example — turn relay 0 on:**

```bash
curl -X POST http://localhost:3001/api/relay/0/state \
  -H 'Authorization: Bearer lsh_xxxx...' \
  -H 'Content-Type: application/json' \
  -d '{"on": true}'
```

```json
{ "success": true, "data": { "index": 0, "on": true } }
```

**Example — read all relays:**

```bash
curl -H 'Authorization: Bearer lsh_xxxx...' http://localhost:3001/api/relays
```

```json
{
  "success": true,
  "data": [
    { "index": 0, "name": "Gate", "on": true },
    { "index": 1, "name": "Pool Pump", "on": false }
  ]
}
```

---

### Integration devices

Every device registered from any integration (SmartThings, Shelly, Loxone, Fibaro, LG ThinQ, etc.) is accessible here.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/devices` | All registered devices with live sensor readings |
| `GET` | `/api/devices/:key` | Single device by its key (e.g. `shelly/192.168.1.10`) |
| `POST` | `/api/device/:key/command` | Send a command to a device sensor |

The `:key` uses `/` separators — use the exact key returned by `GET /api/devices`.

**Device key format:**

| Integration | Key format | Example |
|---|---|---|
| Shelly | `shelly/<host>` | `shelly/192.168.1.10` |
| SmartThings | `smartthings/<deviceId>` | `smartthings/abc-123` |
| Loxone | `loxone/<uuid>` | `loxone/0f1e2d3c-...` |
| Fibaro | `fibaro/<room>/<id>` | `fibaro/Living Room/12` |
| LG ThinQ | `lgthinq/<deviceId>` | `lgthinq/ABC123456` |
| Homey | `homey/<id>` | `homey/de1a2b3c` |
| BoneIO | `boneio/<host>` | `boneio/boneio-1234` |
| Dirigera | `dirigera/<id>` | `dirigera/outlet_abc` |
| Waveshare | `waveshare/<host>` | `waveshare/192.168.1.50` |
| ESPHome | `esphome/<host>` | `esphome/192.168.1.80` |
| KNX | `knx/<host>` | `knx/192.168.1.100` |

**Example — list all devices:**

```bash
curl -H 'Authorization: Bearer lsh_xxxx...' http://localhost:3001/api/devices
```

```json
{
  "success": true,
  "data": [
    {
      "key": "shelly/192.168.1.10",
      "label": "Living Room Switch",
      "type": "shelly",
      "readings": { "relay0": true, "power0": 142.3 },
      "sensors": [
        { "path": "relay0", "name": "Relay 1", "type": "boolean", "controllable": true }
      ]
    }
  ]
}
```

**Example — read one device:**

```bash
curl -H 'Authorization: Bearer lsh_xxxx...' \
  'http://localhost:3001/api/devices/shelly%2F192.168.1.10'
```

**Command body format:**

```json
{ "sensor": "<sensor-path>", "value": <any> }
```

`sensor` is the `path` field from the sensor descriptor. `value` type depends on sensor type:

| Sensor type | Value |
|---|---|
| `boolean` (toggle/switch) | `true` or `false` |
| `range` (dimmer, thermostat, shutter) | number within `min`–`max` |
| `trigger` (BroadLink code, one-shot) | `true` |
| Color (RGB) | `{ hue, saturation, value }` |

**Example — toggle a Shelly relay:**

```bash
curl -X POST http://localhost:3001/api/device/shelly%2F192.168.1.10/command \
  -H 'Authorization: Bearer lsh_xxxx...' \
  -H 'Content-Type: application/json' \
  -d '{"sensor": "relay0", "value": true}'
```

**Example — set AC target temperature (LG ThinQ):**

```bash
curl -X POST 'http://localhost:3001/api/device/lgthinq%2FABC123/command' \
  -H 'Authorization: Bearer lsh_xxxx...' \
  -H 'Content-Type: application/json' \
  -d '{"sensor": "targetTemp", "value": 22}'
```

**Example — set dimmer level (Fibaro / Loxone):**

```bash
curl -X POST 'http://localhost:3001/api/device/fibaro%2FLiving%20Room%2F42/command' \
  -H 'Authorization: Bearer lsh_xxxx...' \
  -H 'Content-Type: application/json' \
  -d '{"sensor": "level", "value": 75}'
```

> **Note:** Forward slashes in device keys must be URL-encoded as `%2F`.

---

### Cameras

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cameras` | All cameras (manual config + UniFi Protect + SmartThings) |
| `GET` | `/api/camera-log` | Recent camera events (`?camera=Front+Door&limit=100`) |
| `POST` | `/api/camera-log` | Push a camera event `{ camera, type, detail }` |
| `GET` | `/api/smartthings-camera/:deviceId/snapshot` | Proxy the latest SmartThings snapshot image |
| `POST` | `/api/smartthings-camera/:deviceId/take` | Trigger a SmartThings `imageCapture.take` command |
| `GET` | `/api/unifi/snapshot/:cameraId` | Proxy a UniFi Protect snapshot |
| `POST` | `/api/webrtc/offer` | WHEP SDP offer proxy `{ url, sdp }` |

---

### MQTT Explorer

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/mqtt-explorer/topics` | Map of all seen topics → `{ value, ts, count }` |
| `GET` | `/api/mqtt-explorer/history?topic=…` | Ring-buffer of last 100 messages for a topic |
| `POST` | `/api/mqtt-explorer/publish` | Publish `{ topic, payload, retain }` to the broker |

---

### BroadLink IR/RF

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/broadlink/codes` | All learned codes (`?host=…` to filter by device) |
| `POST` | `/api/broadlink/learn/ir` | Start 20 s IR learn window — streams NDJSON status |
| `POST` | `/api/broadlink/learn/rf` | Start RF frequency sweep + learn — streams NDJSON status |
| `POST` | `/api/broadlink/send` | Send a named code `{ host, name }` |
| `DELETE` | `/api/broadlink/codes` | Delete a code `{ host, name }` |

---

### User & token management

| Method | Path | Body / Notes | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | `{ username, password }` | Log in — sets `lsh-session` cookie (public) |
| `POST` | `/api/auth/logout` | — | Clear session cookie |
| `POST` | `/api/auth/setup` | `{ adminUsername, adminPassword }` | First-run admin creation (public, errors if already set up) |
| `GET` | `/api/auth/me` | — | Current user `{ id, username, role }` |
| `POST` | `/api/auth/change-password` | `{ currentPassword, newPassword }` | Change own password (min 8 chars) |
| `GET` | `/api/auth/users` | admin only | List all users |
| `POST` | `/api/auth/users` | `{ username, password, role }` | Create user — role: `admin` or `viewer` |
| `DELETE` | `/api/auth/users/:id` | admin only | Delete a user |
| `GET` | `/api/auth/tokens` | — | List API tokens (secrets not returned after creation) |
| `POST` | `/api/auth/tokens` | `{ name }` | Create a named token — returns the token value once |
| `DELETE` | `/api/auth/tokens/:id` | — | Revoke a token |

**Example — create an API token:**

```bash
curl -b cookies.txt -X POST http://localhost:3001/api/auth/tokens \
  -H 'Content-Type: application/json' \
  -d '{"name":"home-assistant"}'
```

```json
{
  "success": true,
  "data": {
    "id": "tkn_abc123",
    "name": "home-assistant",
    "token": "lsh_xxxxxxxxxxxxxxxxxxxxxxxx",
    "createdAt": "2026-06-22T10:00:00.000Z"
  }
}
```

> Store the `token` value now — it is only returned at creation time.

---

### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | Full config with secrets masked |
| `POST` | `/api/settings` | Deep-merge a config patch and save |
| `GET` | `/api/settings/export` | Download raw `config.json` |
| `POST` | `/api/settings/import` | Restore config from a JSON file upload |
| `POST` | `/api/settings/test-knx` | Test TCP connectivity to KNX gateway `{ host, port }` |
| `POST` | `/api/settings/knx` | Save KNX gateway + group address list |
| `POST` | `/api/settings/test-esphome` | Test ESPHome device reachability `{ host, port, password }` |
| `POST` | `/api/settings/esphome` | Save ESPHome device list |
| `POST` | `/api/settings/lgthinq-login` | One-time LG OAuth flow — fetches tokens + user number (credentials not stored) |
| `POST` | `/api/settings/lgthinq` | Save LG ThinQ tokens to `persist/lgthinq-tokens.json` |
| `POST` | `/api/settings/ffmpeg-rtsp` | Save FFmpeg RTSP proxy settings (enabled, basePort, ffmpegPath) |
| `GET` | `/api/rtsp-proxy` | List RTSP proxy streams with per-camera port, slug, and active status |

`POST /api/settings` accepts a partial object — only keys present in the body are updated:

```bash
curl -X POST http://localhost:3001/api/settings \
  -H 'Authorization: Bearer lsh_xxxx...' \
  -H 'Content-Type: application/json' \
  -d '{"homekit": {"enabled": false}}'
```

---

### Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/logs` | List available log category names |
| `GET` | `/api/logs/:name` | Last N lines of a log file (`?lines=300`, default 200) |
| `DELETE` | `/api/logs/:name` | Clear a log file |
| `GET` | `/api/logs/:name/download` | Download the raw log file |

---

### Admin

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/homekit/setup-uri` | HomeKit `X-HM://` URI for QR code rendering |
| `POST` | `/api/admin/restart` | Restart the Node.js process (exit 0 — expects a process manager) |
| `POST` | `/api/admin/reset-config` | Erase `config.json` to factory defaults |

---

### Real-time events (Socket.IO)

The dashboard uses Socket.IO for push updates. Connect to the server root and listen for these events:

```javascript
import { io } from 'socket.io-client';
const socket = io('http://localhost:3001', {
  extraHeaders: { Authorization: 'Bearer lsh_xxxx...' },
});

socket.on('data-update',     (data) => { /* { key, value } — single sensor value changed */ });
socket.on('relay-state',     (data) => { /* { index, on, name } */ });
socket.on('source-changed',  (data) => { /* { source: 'mqtt'|'vrm'|null } */ });
socket.on('platform-status', (data) => { /* { [integrationKey]: true|false } */ });
socket.on('camera-event',    (data) => { /* { camera, type, detail, ts } */ });
socket.on('device-update',   (data) => { /* full device descriptor from sensorRegistry */ });
```

**`data-update` key format:** `system/0/Dc/Battery/Soc`, `shelly/192.168.1.10/relay0`, etc. — the same keys used by `GET /api/devices`.

---

### Home Assistant integration example

```yaml
# configuration.yaml — read battery SOC via REST sensor
sensor:
  - platform: rest
    name: LSH Battery SOC
    resource: http://192.168.1.50:3001/api/battery
    headers:
      Authorization: "Bearer lsh_xxxx..."
    value_template: "{{ value_json.data.soc }}"
    unit_of_measurement: "%"
    scan_interval: 30

# Switch — control a relay
switch:
  - platform: rest
    name: Gate
    resource: http://192.168.1.50:3001/api/relay/0/state
    headers:
      Authorization: "Bearer lsh_xxxx..."
      Content-Type: application/json
    body_on:  '{"on": true}'
    body_off: '{"on": false}'
    is_on_template: >
      {% set r = value_json.data %}
      {% if r is iterable %}{{ (r | selectattr('index','eq',0) | first).on }}{% endif %}
    scan_interval: 10
```

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
  - `knx` — KNX bus integration (`npm install knx`)
- Optional system tools (install separately):
  - `ffmpeg` — FFmpeg RTSP proxy for Loxone / RTSP clients
