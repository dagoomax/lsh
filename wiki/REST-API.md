# REST API

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## Unified API

Your home runs on a dozen different protocols. Victron speaks MQTT. Loxone has its own WebSocket format. Fibaro uses REST. SmartThings is cloud-only. Bayrol is MQTT-over-WebSocket behind a proprietary auth flow. Somfy Developer Mode is HTTPS with Bearer tokens and event polling. AuxAir uses AES-128-CBC encrypted cloud requests. KNX speaks UDP datagrams. Sonos uses UPnP/SOAP over HTTP. Denon uses a plain-text Telnet protocol. None of them talk to each other.

LSH ingests all of them, normalises the data into a single live store, and exposes it through one consistent API. You query one endpoint and get everything. You send one command format to every device.

### Read — any device, any integration

```bash
GET /api/devices
Authorization: Bearer <token>
```

Returns every registered device — Victron inverter, SmartThings bulbs, Fibaro rooms, Bayrol pool chemistry, AuxAir climate unit, Somfy shutters, Sonos speakers, Denon AV receiver, KNX group addresses — in one response, with live sensor values included. No per-integration SDK, no per-vendor auth flow.

### Write — one command format

```bash
POST /api/device/:key/command
Content-Type: application/json

{ "sensor": "temp", "value": 22 }
```

The same endpoint and payload format works for:

| Action | Device key | Sensor | Value |
|---|---|---|---|
| Turn light on | `smartthings/abc-123` | `switch` | `true` |
| Set AC temperature | `auxair/12345` | `temp` | `22` |
| Open roller shutter | `somfy/io__...` | `switch` | `true` |
| Set shutter position | `somfy/io__...` | `level` | `50` |
| Dim a Fibaro light | `fibaro/Living Room/42` | `level` | `75` |
| Toggle Victron relay | `relay/0` | — | `{"on": true}` |
| Send KNX telegram | `knx/192.168.1.100` | `1/0/1` | `true` |
| Trigger BroadLink IR | `broadlink/...` | `tv-power` | `true` |
| Sonos play/pause | `sonos/192_168_1_50` | `playing` | `1` / `0` |
| Sonos set volume | `sonos/192_168_1_50` | `volume` | `65` |
| Denon power on | `denon/192_168_1_100` | `power` | `1` |
| Denon set input | `denon/192_168_1_100` | `input_idx` | `2` |

LSH routes each command to the correct protocol, handles auth, retries, and re-encoding, and returns `{ "success": true }`.

### Real-time push — one stream

```js
const socket = io('https://your-lsh-host', {
  auth: { token: 'Bearer <token>' }
})
socket.on('state', ({ key, value }) => {
  // fires on every live update — all integrations, one stream
})
```

One Socket.IO connection. Bayrol pH changes, Victron SOC ticks, SmartThings motion events, Somfy shutter movements — all arrive on the same `state` event. No polling, no per-vendor WebSocket.

### Why it matters

| Without LSH | With LSH |
|---|---|
| 15+ different APIs, auth flows, and protocols | 1 REST API + 1 WebSocket |
| Re-implement polling for each system | Subscribe once, get everything |
| Each client needs per-vendor credentials | One Bearer token |
| Home Assistant / Node-RED need per-vendor adapters | `POST /api/device/:key/command` |
| Cloud dependency for local devices | Local-first, cloud fallback |
| Devices unreachable when internet is down | MQTT + VRM automatic failover |

### Token

```bash
Authorization: Bearer <token>
```

One token, created in **Settings → API Tokens**. Works for Home Assistant REST integration, Node-RED HTTP nodes, shell scripts, and any HTTP client. Tokens do not expire unless revoked.

### Loxone Config XML templates (Miniserver 17.1)

LSH generates ready-to-import **Virtual Output** and **Virtual HTTP Input** templates for Loxone Config, so every LSH device can be wired into the Miniserver without hand-writing commands:

```
GET /api/loxone/outputs.xml   — VirtualOut: send commands to LSH devices
GET /api/loxone/inputs.xml    — VirtualInHttp: poll device states from LSH
```

**Query parameters:**

| Param | Default | Description |
|---|---|---|
| `token` | `YOUR_API_TOKEN` placeholder | API token embedded into the generated URLs — pass your real token so the file works as-is |
| `device` | all | Limit to one device key, e.g. `smarttub/abc123` |
| `type` | all | Limit to integrations, comma-separated: `type=satel,fibaro` |
| `named` | off | `named=1` skips devices with generic fallback labels (e.g. unnamed Satel zones "Zone 33") |
| `tokenId` | — | Alternative to `token`: an API-token id resolved to its value server-side (used by the Settings UI) |
| `host` | request host | LSH address embedded in the XML (set it if the Miniserver reaches LSH on a different IP) |
| `polling` | `5000` | VirtualInHttp poll interval in ms (inputs only) |

**Example — everything for one hot tub, downloaded in a browser:**

```
http://<lsh-ip>:3000/api/loxone/outputs.xml?type=smarttub&token=<token>
http://<lsh-ip>:3000/api/loxone/inputs.xml?type=smarttub&token=<token>
```

**Import into Loxone Config 17.1:**
1. Download both XML files (the endpoints send them as attachments)
2. In Loxone Config: **Virtual Outputs → Device templates → Import template from file** for `outputs.xml`; **Virtual HTTP Inputs → Import** for `inputs.xml` (or drop the files into `Documents\Loxone\Loxone Config\Templates\VirtualOut` / `…\VirtualIn` and restart Config)
3. All commands/readings appear pre-named after the LSH device labels — drag them into your page and connect

**How the generated templates work:**
- *Outputs*: digital sensors get `CmdOn`/`CmdOff` GET calls to `/api/device/<key>/set?sensor=…&value=1|0&token=…`; range sensors are analog with `<v>` substitution and the sensor's real min/max; trigger sensors are momentary (CmdOn only)
- *Inputs*: one `VirtualInHttpCmd` per sensor with a `Check` pattern that matches that sensor's unique JSON fragment in `/api/devices` and captures the value with `\v` (numeric values — all LSH integrations store booleans as 0/1)

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
| Somfy | `somfy/<deviceURL>` | `somfy/io__1234_5678` |
| Bayrol | `bayrol/<cid>` | `bayrol/19048` |
| AuxAir | `auxair/<endpointId>` | `auxair/12345` |
| Sonos | `sonos/<ip_with_underscores>` | `sonos/192_168_1_50` |
| Denon | `denon/<ip_with_underscores>` | `denon/192_168_1_100` |
| Arduino | `arduino/<name_or_key>` | `arduino/sensor_board` |
| Suppla | `suppla/<ioDeviceId>` | `suppla/12345` |

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

**Example — control Sonos (play, volume, next track):**

```bash
# Pause playback
curl -X POST 'http://localhost:3001/api/device/sonos%2F192_168_1_50/command' \
  -H 'Authorization: Bearer lsh_xxxx...' -H 'Content-Type: application/json' \
  -d '{"sensor": "playing", "value": 0}'

# Set volume to 60
curl -X POST 'http://localhost:3001/api/device/sonos%2F192_168_1_50/command' \
  -H 'Authorization: Bearer lsh_xxxx...' -H 'Content-Type: application/json' \
  -d '{"sensor": "volume", "value": 60}'

# Skip to next track
curl -X POST 'http://localhost:3001/api/device/sonos%2F192_168_1_50/command' \
  -H 'Authorization: Bearer lsh_xxxx...' -H 'Content-Type: application/json' \
  -d '{"sensor": "next", "value": true}'
```

**Example — control Denon AVR (power, input, volume):**

```bash
# Power on
curl -X POST 'http://localhost:3001/api/device/denon%2F192_168_1_100/command' \
  -H 'Authorization: Bearer lsh_xxxx...' -H 'Content-Type: application/json' \
  -d '{"sensor": "power", "value": 1}'

# Switch to Bluetooth (index 3 in your inputs list)
curl -X POST 'http://localhost:3001/api/device/denon%2F192_168_1_100/command' \
  -H 'Authorization: Bearer lsh_xxxx...' -H 'Content-Type: application/json' \
  -d '{"sensor": "input_idx", "value": 3}'

# Set master volume to 55
curl -X POST 'http://localhost:3001/api/device/denon%2F192_168_1_100/command' \
  -H 'Authorization: Bearer lsh_xxxx...' -H 'Content-Type: application/json' \
  -d '{"sensor": "volume", "value": 55}'
```

> **Note:** Forward slashes in device keys must be URL-encoded as `%2F`.

---

### Satel alarm

Live state and control for a Satel INTEGRA panel (see the [`satel`](#satel) integration). Zones, outputs and partitions are also exposed as generic [integration devices](#integration-devices) (`satel/zone/N`, `satel/output/N`, `satel/partition/N`); these endpoints are a convenience layer over them.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/satel/status` | Summary: input/output totals, open-input count, partition arm state |
| `GET` | `/api/satel/zones` | All inputs (zones) with `violation`, `tamper`, `alarm`, and `kind` (`motion` / `contact` / `other`) |
| `GET` | `/api/satel/outputs` | All outputs with `on` state |
| `GET` | `/api/satel/partitions` | All partitions with `armed`, `alarm`, `fireAlarm` |
| `POST` | `/api/satel/output/:num` | Set output `:num` — body `{ "state": true \| false }` |
| `POST` | `/api/satel/partition/:num/arm` | Arm partition `:num` |
| `POST` | `/api/satel/partition/:num/disarm` | Disarm partition `:num` |

Each zone/output/partition object also carries its `num`, `key`, and `label` (the name downloaded from the panel).

**Example — summary:**

```bash
curl -H 'Authorization: Bearer lsh_xxxx...' http://localhost:3000/api/satel/status
# → { "success": true, "data": {
#      "configured": true,
#      "zones":   { "total": 32, "open": 4 },
#      "outputs": { "total": 32, "on": 2 },
#      "partitions": [ { "num": 1, "label": "CZUJNIKI RUCHU", "armed": false, "alarm": false } ]
#    } }
```

**Example — list open inputs:**

```bash
curl -H 'Authorization: Bearer lsh_xxxx...' http://localhost:3000/api/satel/zones \
  | jq '.data[] | select(.violation) | {label, kind}'
```

**Example — turn an output on / arm a partition:**

```bash
curl -H 'Authorization: Bearer lsh_xxxx...' -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/api/satel/output/3 -d '{"state": true}'

curl -H 'Authorization: Bearer lsh_xxxx...' \
  -X POST http://localhost:3000/api/satel/partition/1/arm
```

> **Note:** Control endpoints act on the real panel — an output can be a gate or siren, and arming is live. Partition arm/disarm honours the configured `armCode`.

---

### Cameras

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cameras` | All cameras (manual config + UniFi Protect + Reolink + SmartThings) |
| `GET` | `/api/camera-log` | Recent camera events (`?camera=Front+Door&limit=100`) |
| `POST` | `/api/camera-log` | Push a camera event `{ camera, type, detail }` |
| `GET` | `/api/smartthings-camera/:deviceId/snapshot` | Proxy the latest SmartThings snapshot image |
| `POST` | `/api/smartthings-camera/:deviceId/take` | Trigger a SmartThings `imageCapture.take` command |
| `GET` | `/api/unifi/snapshot/:cameraId` | Proxy a UniFi Protect snapshot |
| `GET` | `/api/reolink/snapshot/:idx` | Proxy a Reolink snapshot (credentials stay server-side) |
| `POST` | `/api/settings/reolink` | Save the Reolink camera list `{ cameras: [...] }` (applies live) |
| `POST` | `/api/settings/test-reolink` | Pull one snapshot to test a camera `{ host, username, password, channel }` |
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

### Using LSH from Loxone

A Loxone Miniserver can read and control any LSH device through the REST API — useful for bringing cloud-only or otherwise incompatible gear (Fibaro, Satel, Somfy, Bayrol, SmartThings…) into Loxone. Loxone reads with a **Virtual HTTP Input** and controls with a **Virtual Output**.

Loxone's HTTP blocks can't easily set an `Authorization` header, so pass the token as the **`?token=`** query parameter (create a dedicated API token in **Settings → API Tokens**). `<lsh-ip>` is the LSH host as reachable from the Miniserver; the default port is `3000`.

> **Encoding:** device keys and sensor paths contain `/`, which must be URL-encoded as **`%2F`** in Loxone commands (e.g. key `fibaro/room_443` → `fibaro%2Froom_443`, sensor `71/value` → `71%2Fvalue`). Find every device's `key` and sensor `path` via `GET http://<lsh-ip>:3000/api/devices?token=<token>`.

**Control a device — Virtual Output**

Set the Virtual Output *Address* to `http://<lsh-ip>:3000`, then add a Virtual Output Command. This example sets a Fibaro dimmer (device `71` in room `443`) to the value `<v>` (0–99):

```
/api/device/fibaro%2Froom_443/set?sensor=71%2Fvalue&value=<v>&token=<token>
```

`<v>` is Loxone's value placeholder — wire an analog output (0–99) to it, or use fixed `value=99` / `value=0` commands for on/off. The `/set` endpoint is a GET-friendly control route made for exactly this (no request body needed).

**Read a value — Virtual HTTP Input**

- **URL:** `http://<lsh-ip>:3000/api/devices/fibaro%2Froom_443?token=<token>`
- **Command recognition** (`\v` marks the number to extract — the dimmer's current level):

```
"characteristic":"Brightness"},"value":\v
```

Anchor the recognition on something unique to the device if a room has several controllables (e.g. `Dimmer Biuro"…"value":\v`). Mark the input as analog with a 2–5 s poll interval.

The same two patterns work for **any** LSH device — swap in the target's `key` and sensor `path`: a Satel output (`satel/output/5`, `state`), a relay (`/api/relay/0/state`), a Somfy blind, etc.

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
