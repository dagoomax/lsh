# Architecture & Modules

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

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

Speaks the **Satel INTEGRA binary TCP protocol** (default port 7094). Uses the `new_data` (`0x7F`) command in a self-scheduling loop (~300 ms, no overlapping requests) so zone/output/partition state changes surface within a fraction of a second. Zone, output, and partition names are downloaded from the panel on connect (`0xEE`, CP1250-decoded); config `*Names` maps override them.

Wire protocol uses CRC-16 with `0xFE` byte-stuffing. Reconnects automatically after 30 s on connection loss.

**Config:**
```json
"satel": {
  "host": "192.168.1.100", "port": 7094, "armCode": "1234",
  "zoneCount": 64,
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

### `src/reolink-client.js`

Adds **Reolink PoE cameras / NVRs** to the camera list. Reads `reolink.cameras` from config on demand (so Settings edits apply without a restart), builds each camera's RTSP URL (`h264Preview_<NN>_<main|sub>`), and pulls JPEG snapshots via Reolink's HTTP API (`cmd=Snap`). Snapshots are proxied through `GET /api/reolink/snapshot/:idx` so credentials never reach the browser. No polling — snapshots are fetched on demand.

**Config:**
```json
"reolink": { "cameras": [ { "name": "Driveway", "host": "192.168.1.50", "username": "admin", "password": "secret", "channel": 0 } ] }
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

### `src/fibaro-client.js`

Integrates **Fibaro Home Center 2 / 3** via its local REST API.

**Discovery:** Fetches `/api/rooms` and `/api/devices` in parallel, groups supported devices by room, and registers each room as a dashboard tile with one sensor entry per device. Sensor paths use the Fibaro device ID (e.g. `42/value`) so write commands can target individual devices.

**Live updates:** Calls `/api/refreshStates?last=<timestamp>` in a continuous long-poll loop (55 s timeout). The `last` cursor is advanced on each response so only changes since the previous poll are processed.

**Write path:** `POST /api/devices/<id>/action/<action>` — `turnOn`, `turnOff`, or `setValue`.

**Config:** See [`fibaro`](#fibaro) config section above.

---

### `src/somfy-client.js`

Integrates **Somfy TaHoma** roller shutters and covers via the local HTTPS API (port 8443).

**Authentication:** `POST /enduser-mobile-web/1/enduserAPI/login` with email + password → `JSESSIONID` cookie. Session is refreshed automatically on 401.

**Discovery:** `GET .../setup/devices` — filters to controllable device classes (RollerShutter, Gate, Awning, Window, etc.). Each device gets a `switch` sensor (open/close toggle) and a `level` sensor (0–100 position slider, inverted from the TaHoma `core:ClosureState` which uses 0 = open).

**Polling:** `GET .../setup/devices/<url>/states` every `pollInterval` seconds. `core:ClosureState` → `level = 100 - closure`.

**Control:** `POST .../exec/apply` with a JSON action list.

**Config:** See [`somfy`](#somfy) config section above.

---

### `src/bayrol-client.js`

Integrates **Bayrol Pool Manager Connect** pool chemistry monitors via cloud-brokered MQTT.

**Credential flow:** HTTP session login → pool discovery (`plants.php`) → per-pool access token exchange (`device.php` + `/api/?code=`) → MQTT WebSocket connection.

**MQTT:** Connects to `wss://www.bayrol-poolaccess.de:8083` using the per-pool `accessToken` as the MQTT username and `*` as password. Subscribes to `d02/<deviceSerial>/v/#` and publishes to `d02/<deviceSerial>/g/<uid>` to request initial values.

**Value transforms:**

| UID | Sensor | Transform |
|---|---|---|
| `4.78` | pH | raw ÷ 10 |
| `4.82` | ORP (mV) | as-is |
| `4.98` | Temperature (°C) | raw ÷ 10 |
| `4.100` | Salt (g/L) | raw ÷ 10 |

**Config:** See [`bayrol`](#bayrol) config section above.

---

### `src/auxair-client.js`

Integrates **AUX Air** conditioners via the **AC Freedom / SmartHomeCS** cloud API.

**Auth flow:** SHA-1 password hash → AES-128-CBC encrypted login body (zero-padding, hardcoded app key/IV) → per-session `loginsession` + `userid` tokens used in all subsequent request headers.

**Device discovery:** Family list → per-family endpoint list → cookie decoding for device control sessions.

**Control:** `POST /device/control/v2/sdkcontrol` with `act: "get"` for state or `act: "set"` for commands. Parameters:

| Param | Sensor | Notes |
|---|---|---|
| `pwr` | Power | 0 = off, 1 = on |
| `temp` | Set temperature | raw ÷ 10 (e.g. 240 = 24.0 °C) |
| `envtemp` | Room temperature | raw ÷ 10, read-only |
| `ac_mode` | Mode | 0=cool 1=heat 2=dry 3=fan 4=auto |
| `ac_mark` | Fan speed | 0=auto 1=low 2=med 3=high 4=turbo 5=mute |

After each command, state is refreshed automatically after 1.5 s.

**Config:** See [`auxair`](#auxair) config section above.

---

### `src/loxone-out-client.js`

Forwards DataStore values to a **Loxone Miniserver** via HTTP GET to Virtual Input endpoints — no Loxone polling required.

**How it works:** On `start()`, subscribes to the DataStore `change` event. When a watched key changes, the new value is sent to the configured Virtual Input within 200 ms (debounced to absorb rapid bursts). Uses Basic auth over HTTP.

**Endpoint:** `GET http://<host>/dev/sps/io/<virtualInput>/<value>` — standard Loxone Virtual Input HTTP command interface.

**Config:** See [`loxoneOut`](#loxoneout) config section above.

---

### `src/sonos-client.js`

Integrates **Sonos** speakers via the **UPnP/SOAP** control protocol over HTTP port 1400. No external npm packages required — uses only `http`, `dgram`, and `net` from Node.js stdlib.

**Discovery:** On startup, sends a UDP `M-SEARCH` multicast to `239.255.255.250:1900` targeting `urn:schemas-upnp-org:device:ZonePlayer:1`. Responses are validated by checking for `ZonePlayer` or `RINCON` in the response body and the IP is taken from `rinfo.address` (not the LOCATION header, which can be `0.0.0.0` on some networks). Discovered IPs are merged with any manually configured `hosts`.

**Room name:** Fetched from each speaker's `/xml/device_description.xml` (`<roomName>` tag) so the dashboard shows "Living Room", "Kitchen" etc. instead of raw IPs.

**State polling:** Every `pollInterval` seconds (default 5 s), fires four parallel SOAP calls:

| SOAP action | Service | Used for |
|---|---|---|
| `GetTransportInfo` | AVTransport | Play / Paused / Stopped state |
| `GetVolume` | RenderingControl | Master volume (0–100) |
| `GetMute` | RenderingControl | Mute on/off |
| `GetPositionInfo` | AVTransport | Current track metadata (DIDL-Lite) |

Track title and artist are extracted from the HTML-entity-encoded DIDL-Lite XML in `TrackMetaData` (`dc:title`, `dc:creator`).

**Commands:** `Play` / `Pause` (AVTransport), `Previous` / `Next` (AVTransport), `SetVolume` / `SetMute` (RenderingControl). State is refreshed 700 ms after each command.

**Config:** See [`sonos`](#sonos) config section above.

---

### `src/denon-client.js`

Integrates **Denon** and **Marantz** AV receivers via the **Telnet ASCII control protocol** (TCP port 23). No external npm packages.

**Connection lifecycle:** `net.createConnection` with 35 s socket timeout used as a keepalive heartbeat (a query is sent on timeout to reset it). Reconnects in 15 s on `close`. On connect, immediately queries `PW?`, `MV?`, `MU?`, `SI?` and starts a 30 s polling interval.

**Response parser:** Lines are CR-terminated (`\r`). Parsed prefixes:

| Prefix | Example | Meaning |
|---|---|---|
| `PW` | `PWON`, `PWSTANDBY` | Power state |
| `MV` | `MV50`, `MV505`, `MVMAX80` | Volume (half-dB steps; `MVMAX` ignored) |
| `MU` | `MUON`, `MUOFF` | Mute state |
| `SI` | `SICD`, `SIBT`, `SISAT/CBL` | Active input |

The receiver pushes unsolicited updates whenever state changes (e.g. when the user presses the physical remote), so the dashboard stays in sync without aggressive polling.

**Input selection:** When `inputs` are configured, an `input_idx` range sensor is registered carrying an `inputNames` array in its descriptor. The dashboard reads this array to render input selection pills. Clicking a pill sends `SI<INPUT>` (e.g. `SIBT` for Bluetooth).

**Commands sent:** `PWON` / `PWSTANDBY`, `MV##` (zero-padded), `MUON` / `MUOFF`, `SI<INPUT>`.

**Config:** See [`denon`](#denon) config section above.

---

### `src/arduino-client.js`

Generic **MQTT subscriber** for Arduino, ESP32, ESP8266, and any microcontroller publishing JSON over MQTT. No external npm packages (uses the `mqtt` package already required by the project).

**Subscription strategy:**
- **Device-level topic** (`stateTopic` on the device): receives a single JSON object; each key matching a sensor's `path` (or `jsonKey`) updates that sensor's value in the DataStore.
- **Per-sensor topic** (`stateTopic` on a sensor): receives a raw single-value payload; the value is coerced and stored directly.

**Payload coercion:** `"1"` / `"true"` / `"on"` → `1` (numeric), `"0"` / `"false"` / `"off"` → `0`, numeric strings → float, everything else kept as string.

**Command dispatch:**
- Toggle sensors with a per-sensor `commandTopic` → publishes the raw `payloadOn` / `payloadOff` string.
- Toggle sensors using the device `commandTopic` → publishes `{ sensorPath: payloadOn/Off }` as JSON.
- Range sensors → publishes the numeric value as a string.

**Sensor types:**
| `type` | Dashboard control | Command payload |
|---|---|---|
| _(omitted)_ | Read-only value display | — |
| `"toggle"` | On/Off toggle switch | `payloadOn` or `payloadOff` |
| `"range"` | Slider (`min`–`max`) | Numeric string |

**Config:** See [`arduino`](#arduino) config section above.

---

### `src/suppla-client.js`

Integrates **Suppla** smart-home devices via the **Suppla Cloud REST API** (`api/v2.4.0`) or a self-hosted Suppla server. No external npm packages (uses Node.js built-in `https`/`http`).

**Discovery flow:**
1. `GET /channels?include[]=state,iodevice,connected` — fetches all channels with their current state and parent ioDevice info.
2. Channels are grouped by `iodevice.id` → one dashboard card per physical device.
3. Each channel's `functionName` determines the sensor type: read-only, toggle, range slider, or compound (e.g. temperature + humidity from one channel).
4. Initial state is applied immediately; polling refreshes state every `pollInterval` seconds.

**Channel ↔ sensor mapping:**

| Suppla function | `path` key | Notes |
|---|---|---|
| `LIGHTSWITCH` / `POWERSWITCH` | `ch_<id>` | Toggle; 0/1 |
| `DIMMER` / `RGBLIGHTING` | `ch_<id>` | Range 0–100 |
| `CONTROLLINGTHEROLLERSHUTTER` | `ch_<id>` | Range 0–100; 0=open |
| `CONTROLLINGTHEGARAGEDOOR` / `GATEWAY` | `ch_<id>` | Toggle; open/close |
| `THERMOMETER` | `ch_<id>` | Float °C |
| `HUMIDITYANDTEMPERATURE` | `ch_<id>_temp` + `ch_<id>_hum` | Two sensors per channel |
| `ELECTRICITYMETER` | `ch_<id>_power` + `ch_<id>_energy` | W + kWh from phase array |

**Commands:** PATCH `/channels/{id}` with `{ action }`. Switch → `TURN_ON`/`TURN_OFF`; dimmer → `SET_RGBW_PARAMETERS` with `brightness`; gate → `OPEN`/`CLOSE`; shutter → `REVEAL`/`SHUT`/`REVEAL_PARTIALLY`.

**Config:** See [`suppla`](#suppla) config section above.

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

## Server-side translation

Set `"language"` in `config.json` (`en`, `pl`, `de`, `fr`, `es`, `it`, `ua`) and LSH translates device and sensor labels **once, centrally, in the sensor registry** — so every consumer gets localized names: the REST API, Socket.IO events, both dashboards, **HomeKit accessories (Siri speaks your language)**, generated Loxone XML templates, and Node-RED. Fallback labels are localized too (`Zone 33` → `Wejście 33`, `Output 5` → `Wyjście 5`). Unknown terms and user-defined names (panel zone names, room names) pass through unchanged. Polish has full coverage; other languages cover the core vocabulary and fall back to English. Requires a restart to change.

---
