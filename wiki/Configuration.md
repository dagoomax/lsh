# Configuration Reference

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

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
| `unifiAccess` | No | UniFi Access door controllers (lock/unlock, door status) |
| `shelly` | No | Shelly Gen1 / Gen2 devices |
| `boneio` | No | BoneIO relay boards (MQTT auto-discovery) |
| `dreame` | No | Dreame robot vacuums and air purifiers |
| `homey` | No | Homey Pro (local or cloud) |
| `dirigera` | No | IKEA Dirigera smart-home hub |
| `tradfri` | No | IKEA Tradfri gateway |
| `lgthinq` | No | LG ThinQ appliances (token-based auth, v1 API) |
| `esphome` | No | ESPHome ESP32/ESP8266 devices (HTTP REST API) |
| `knx` | No | KNX bus via KNXnet/IP gateway (group address mapping) |
| `fibaro` | No | Fibaro Home Center 2 / 3 (rooms, switches, dimmers, sensors) |
| `somfy` | No | Somfy TaHoma, local API or Overkiz cloud (roller shutters, awnings, gates) |
| `bayrol` | No | Bayrol Pool Manager Connect / Automatic Cl-pH / SALT (pH, ORP, temperature, dosing rates, salt via MQTT) |
| `auxair` | No | AUX Air (AC Freedom) — on/off, temperature, mode, fan speed via cloud API |
| `smarttub` | No | SmartTub hot tubs (Jacuzzi / Sundance / Watkins) — water/set temperature, heat mode, pumps, lights via cloud API |
| `zway` | No | Z-Way / RaZberry — Z-Wave switches, dimmers, thermostats, locks, sensors via ZAutomation REST API |
| `wirenboard` | No | Wiren Board controllers — relays, dimmers, inputs, climate sensors via MQTT Conventions |
| `sonos` | No | Sonos speakers — play/pause, prev/next, volume, mute via UPnP (port 1400) |
| `denon` | No | Denon / Marantz AV receivers — power, volume, mute, input via Telnet (port 23) |
| `arduino` | No | Arduino / ESP32 / generic MQTT — subscribe to JSON topics and map fields to sensor readings or controllable outputs |
| `suppla` | No | Suppla smart-home — cloud or self-hosted REST API; discovers switches, dimmers, thermometers, shutters, gates |
| `loxoneOut` | No | Loxone outbound push — forwards store values to Loxone Virtual Inputs in real time |
| `ffmpegRtsp` | No | FFmpeg RTSP proxy — re-streams cameras for Loxone / RTSP clients |
| `sip` | No | SIP softphone (WebSocket transport) |
| `cameras` | No | Manual camera list (RTSP, snapshot, MJPEG, WebRTC) |
| `reolink` | No | Reolink PoE cameras / NVR (proxied snapshots + RTSP + AI object detection) |
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

### `loxoneOut`

```json
"loxoneOut": {
  "host": "192.168.1.10",
  "port": 80,
  "username": "admin",
  "password": "secret",
  "mappings": [
    { "storeKey": "battery/soc", "virtualInput": "VI1" },
    { "storeKey": "solar/power",  "virtualInput": "VI2" }
  ]
}
```

Pushes live store values to **Loxone Virtual Inputs** via HTTP GET (`/dev/sps/io/<virtualInput>/<value>`) with Basic auth. Updates are sent within 200 ms of any store change, making it a low-latency alternative to polling.

- `storeKey` — the DataStore key to watch (e.g. `battery/soc`, `solar/power`)
- `virtualInput` — the name of the Loxone Virtual Input (as configured in Loxone Config)

### `satel`

```json
"satel": {
  "host": "192.168.1.100",
  "port": 7094,
  "armCode": "1234",
  "zoneCount": 64,
  "zoneNames": { "1": "Front Door", "2": "Back Door" },
  "zoneTypes": { "5": "motion", "8": "contact", "16": "none" },
  "partitions": [1],
  "partitionNames": { "1": "House" }
}
```

Zones are exposed to **HomeKit as motion or contact sensors**. The type is inferred from the zone name — `RUCH`/`PIR`/`MOTION` → motion sensor, `OKNO`/`DRZWI`/`DOOR`/`WINDOW`/`CONTACT`/`REED` → contact sensor — and can be overridden per zone with `zoneTypes` (`"motion"`, `"contact"`, or `"none"` to keep a zone out of HomeKit). Unmatched zones are not exposed to HomeKit by default. A zone's violation drives the sensor (motion detected / contact open).

Speaks the Satel INTEGRA binary TCP protocol. Zone, output, and partition **names are downloaded from the panel automatically** on connect (via the `0xEE` read-name command, decoded as CP1250 so Polish characters survive). The `zoneNames` / `outputNames` / `partitionNames` maps are therefore optional — set an entry only to **override** the name stored in the panel; anything you leave out falls back to the panel name, then to `Zone N` / `Output N` / `Partition N`.

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

### `unifiAccess`

```json
"unifiAccess": {
  "host": "192.168.1.1",
  "apiKey": ""
}
```

A separate product/token from `unifi` (Protect) above, even on the same console — its own local "Developer API" on fixed port `12445`, Bearer-token auth (generate one in the Access console: **Settings → Security → Advanced → API Token**). Only **unlock** is a real remote action; Access doors re-lock themselves, so there is no "lock now" call.

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

### `fibaro`

```json
"fibaro": {
  "host": "192.168.1.196",
  "port": 80,
  "username": "admin",
  "password": "your-password"
}
```

Connects to a **Fibaro Home Center 2 or 3** via its local REST API. Discovers all rooms and supported devices, groups them by room, and registers each room as a device tile on the dashboard.

**Supported device types:** binary switches, dimmers, roller shutters, temperature sensors, humidity sensors, light sensors, power meters, door/window sensors, motion sensors, smoke and flood sensors.

**Control:** Switches and dimmers are controllable from the dashboard. Roller shutters support position (0–100%).

**Live updates:** Uses Fibaro's long-poll `/api/refreshStates` endpoint — changes appear within 1 s of the physical event.

---

### `somfy`

```json
"somfy": {
  "mode": "local",
  "region": "europe",
  "host": "192.168.1.x",
  "port": 8443,
  "email": "you@example.com",
  "password": "your-password",
  "devices": [],
  "pollInterval": 30
}
```

Connects to a **Somfy TaHoma** installation and discovers roller shutters, awnings, gates, screens, pergolas, and blinds. Two connection modes:

- **`mode: "local"`** (default) — talks to the TaHoma box on the LAN via the local HTTPS API (port 8443, self-signed certificate). Authenticate with `email` + `password`, or a Developer-Mode `token`.
- **`mode: "cloud"`** — talks to the Somfy/Overkiz cloud, so it works when the box isn't reachable on the LAN. Set `region` (`europe`, `north_america`, or `oceania`) and authenticate with your Somfy account `email` + `password`. No Developer Mode or local `host` required; the client signs in via the Somfy SSO and refreshes its token automatically.

> **Local-mode prerequisite:** Enable **Developer Mode** in the TaHoma app (Settings → My Home → TaHoma box → Developer Mode) before connecting. Without it the local API returns `RESOURCE_ACCESS_DENIED`. Cloud mode does not need Developer Mode.

**`devices`** — optional name filter array. Leave empty to discover all. Example: `["Salon", "Bedroom"]`.

**Control:** Each device exposes `switch` (toggle: on=open/off=close), `level` (range 0–100 position), `stop` (momentary halt), and `my` (momentary — move to the stored **My** favourite position, Overkiz `my`). Trigger via `GET /api/device/<key>/set?sensor=my&value=1`.

---

### `bayrol`

```json
"bayrol": {
  "poolName": "My Pool",
  "username": "you@example.com",
  "password": "your-password",
  "pollInterval": 60,
  "pools": []
}
```

Connects to **Bayrol Pool Manager Connect** devices via the [bayrol-poolaccess.de](https://www.bayrol-poolaccess.de) cloud portal using **MQTT over WebSockets** (port 8083, TLS).

**Authentication flow:**
1. HTTP login to `bayrol-poolaccess.de` → session cookie
2. GET `/webview/p/plants.php` → discover pool CIDs
3. GET `/webview/p/device.php?c=<cid>` → extract MQTT access code from iframe
4. GET `/api/?code=<code>` → exchange for `accessToken` + `deviceSerial`
5. Connect MQTT to `wss://www.bayrol-poolaccess.de:8083` with `accessToken` as username

**Sensors:** pH (uid `4.78`, raw÷10), ORP/Redox (uid `4.82`, mV), Temperature (uid `4.98`, raw÷10 °C), pH dosing rate (uid `4.89`, %). Device-family extras detected from the serial: **Automatic Cl-pH (ACL)** adds Chlorine dosing rate (uid `4.90`, %); **Automatic SALT (ASE)** adds Salt (uid `4.100`, raw÷10 g/L) and electrolysis Production rate (uid `4.91`, %).

> Note: the Automatic Cl-pH has no free-chlorine (mg/l) probe — chlorine is regulated from the redox (ORP) reading; the dosing rate shows how actively chlorine is being added.

**`poolName`** — display name for the tile. If omitted, auto-named `Pool <cid>`.

#### Reading Bayrol measurements from Loxone Miniserver

The Bayrol Pool Manager Connect is **cloud-only** — it has no local Modbus or REST interface. Loxone cannot connect to it directly. The recommended approach is to let LSH read the cloud data and have Loxone poll LSH's REST API.

**Option A — Virtual HTTP Input (polling LSH)**

1. In **Loxone Config**, add a **Virtual HTTP Input** object.
2. Set the URL to `http://<lsh-ip>:3000/api/devices/bayrol/<your-cid>` (find `<cid>` in the LSH settings page).
3. Set a poll cycle (e.g. 60 s).
4. For each measurement, add a **Virtual HTTP Input Command** with a regex to extract the value:

| Sensor | Regex |
|---|---|
| pH | `"ph":\{"value":(\d+\.?\d*)` |
| ORP (mV) | `"orp":\{"value":(\d+\.?\d*)` |
| Temperature (°C) | `"temperature":\{"value":(\d+\.?\d*)` |
| Salt (g/L) | `"salt":\{"value":(\d+\.?\d*)` |

**Option B — Loxone push via `loxoneOut`**

Configure the [`loxoneOut`](#loxoneout) module in LSH to push values directly to Loxone Virtual Inputs whenever they change — no polling required. Example:

```json
"loxoneOut": {
  "host": "192.168.1.50",
  "username": "admin",
  "password": "your-password",
  "mappings": [
    { "storeKey": "bayrol/<cid>/ph",          "virtualInput": "VI1" },
    { "storeKey": "bayrol/<cid>/temperature",  "virtualInput": "VI2" },
    { "storeKey": "bayrol/<cid>/orp",          "virtualInput": "VI3" },
    { "storeKey": "bayrol/<cid>/salt",         "virtualInput": "VI4" }
  ]
}
```

Values are pushed to `http://<loxone-host>/dev/sps/io/<virtualInput>/<value>` within 200 ms of each change.

**Option C — Direct Modbus TCP (Pool Manager 5 only)**

If you have a **Bayrol Pool Manager 5** (PM5) — not the Pool Manager Connect — it supports Modbus TCP on port 502. In Loxone Config, add a **Modbus TCP Extension** pointing to the PM5 IP and map these holding registers (FC03):

| Register | Sensor | Scale |
|---|---|---|
| 1 | pH | ÷ 10 |
| 2 | ORP (mV) | × 1 |
| 3 | Temperature (°C) | ÷ 10 |
| 4 | Free chlorine | ÷ 100 |

This requires no LSH and works fully offline. Only the **PM5** model supports Modbus — the **Pool Manager Connect** is cloud-only.

### `auxair`

```json
"auxair": {
  "region": "eu",
  "email": "you@example.com",
  "password": "your-password",
  "pollInterval": 30
}
```

Connects to **AUX Air** (brand behind the **AC Freedom** app) via the SmartHomeCS cloud API. Supports full control: on/off, target temperature (16–30 °C), mode, and fan speed.

| Field | Default | Description |
|---|---|---|
| `region` | `eu` | Server region: `eu`, `usa`, `cn`, `rus` |
| `email` | — | AC Freedom account email |
| `password` | — | AC Freedom account password |
| `pollInterval` | `30` | State refresh interval in seconds |

**Dashboard tile:** Shows current room temperature, set temperature, and mode. When on: mode pills (Cool / Heat / Dry / Fan / Auto) and temperature +/− buttons are shown inline. Fan speed displayed as a label.

**`pools`** — optional array of `{ cid, name }` to pin specific pools. Leave empty for auto-discovery.

---

### `smarttub`

```json
"smarttub": {
  "email": "you@example.com",
  "password": "your-password",
  "pollInterval": 60
}
```

Connects to **SmartTub**-enabled hot tubs (Jacuzzi, Sundance, Watkins and other brands using the SmartTub app) via the `api.smarttub.io` cloud API. All spas on the account are auto-discovered and registered as dashboard tiles.

| Field | Default | Description |
|---|---|---|
| `email` | — | SmartTub account email |
| `password` | — | SmartTub account password |
| `pollInterval` | `60` | State refresh interval in seconds |

**Authentication flow:**
1. POST `https://api.smarttub.io/idp/signin` with `{ username, password }` → `access_token` + `id_token`
2. `account_id` is read from the `custom:account_id` claim of the `id_token` JWT
3. Subsequent requests use `Authorization: Bearer <access_token>` (there is no refresh endpoint — LSH re-authenticates with stored credentials when the token expires)

**Sensors & controls (per spa):**
- **Water** — current water temperature (°C, also bridged to HomeKit)
- **Set Temp** — target temperature (15–40 °C), adjustable — `PATCH spas/<id>/config` with `{ setTemperature }`
- **Heat Mode** — Economy / Day / Auto / Ready / Rest — `PATCH spas/<id>/config` with `{ heatMode }`
- **Heater** / **Online** — read-only status
- **Pumps** — jet/blower pumps as toggles (`POST spas/<id>/pumps/<pumpId>/toggle`); circulation pumps are read-only
- **Lights** — per-zone on/off (`PATCH spas/<id>/lights/<zone>`)

Temperatures are handled in **Celsius**; the API rejects set-points with more than one decimal place, so values are rounded to 0.1 °C.

---

### `zway`

```json
"zway": {
  "host": "192.168.1.x",
  "port": 8083,
  "username": "admin",
  "password": "your-password",
  "pollInterval": 10
}
```

Connects to **Z-Way** — the Z-Wave.Me controller software that runs on **RaZberry** boards, UZB sticks, or any Z-Way server — via the ZAutomation v1 REST API (`:8083`). Virtual devices are auto-discovered and grouped per physical Z-Wave node into one dashboard tile.

**Supported device types:** binary switches (on/off), multilevel switches / dimmers (0–99), thermostats (setpoint), door locks, buttons, binary sensors, multilevel sensors (temperature → HomeKit, humidity, lux, power…), battery levels.

Session auth (`ZWAYSession`) with automatic re-login on expiry. Commands go through `/ZAutomation/api/v1/devices/<vDev>/command/…`.

### `wirenboard`

```json
"wirenboard": {
  "host": "192.168.1.x",
  "port": 1883,
  "username": "",
  "password": "",
  "devices": []
}
```

Connects to a **Wiren Board** controller's MQTT broker and auto-discovers every device published under the [MQTT Conventions](https://github.com/wirenboard/conventions) (`/devices/<dev>/controls/<ctrl>` + retained `meta` topics).

**Control mapping:** `switch` → toggle, `range` → slider (respects `meta/max`), `pushbutton` → momentary, `temperature`/`rel_humidity`/`voltage`/`power`/… → read-only sensors with proper units; `readonly` meta respected. Temperature controls are bridged to HomeKit. Writes publish to `/devices/<dev>/controls/<ctrl>/on`.

**`devices`** — optional whitelist of WB device ids; empty = everything except system devices (`system`, `network`, `hwmon`, `power_status`, `buzzer`, `metrics`, `alarms`).

---

### `sonos`

```json
"sonos": {
  "hosts": ["192.168.1.50", "192.168.1.51"],
  "discover": true,
  "pollInterval": 5
}
```

Connects to **Sonos** speakers on the local network using the **UPnP/SOAP** control protocol over HTTP port 1400. No account or cloud dependency required.

| Field | Default | Description |
|---|---|---|
| `hosts` | `[]` | List of speaker IPs. Leave empty to rely on auto-discovery only |
| `discover` | `true` | Run SSDP multicast discovery on startup to find all Zone Players |
| `pollInterval` | `5` | State refresh interval in seconds (min 3) |

Auto-discovery sends a `M-SEARCH` UDP multicast to `239.255.255.250:1900` with `ST: urn:schemas-upnp-org:device:ZonePlayer:1` and registers all responding speakers. Manual `hosts` entries are added on top and are preferred for reliable setups with static IPs.

**Per-speaker sensors:** `playing` (play/pause toggle), `prev` / `next` (triggers), `volume` (0–100), `mute` (toggle), `track` (current title), `artist` (current artist).

**Dashboard tile** (Media category): play/pause button, ⏮/⏭ + mute row, volume slider, track title and artist display.

---

### `denon`

```json
"denon": {
  "host": "192.168.1.100",
  "port": 23,
  "name": "Denon AVR-X2800H",
  "maxVolume": 80,
  "inputs": ["CD", "BD", "NET", "BT", "GAME", "SAT/CBL"]
}
```

Connects to a **Denon** or **Marantz** AV receiver over the Telnet control protocol (port 23). Reconnects automatically after 15 s on drop.

| Field | Default | Description |
|---|---|---|
| `host` | — | Receiver IP address or hostname |
| `port` | `23` | Telnet control port (23 on all Denon/Marantz models) |
| `name` | `Denon <host>` | Display name on the dashboard |
| `maxVolume` | `80` | Maximum volume step. Use `80` for most models, `98` for newer flagship models |
| `inputs` | `[]` | Denon input codes to show as selection pills. Common values: `CD`, `BD`, `DVD`, `TV`, `SAT/CBL`, `GAME`, `NET`, `BT`, `AUX1`, `AUX2`, `TUNER`, `MPLAY` |

**Commands sent:** `PWON` / `PWSTANDBY`, `MV##` (zero-padded, e.g. `MV50`), `MUON` / `MUOFF`, `SI<INPUT>` (e.g. `SICD`, `SIBT`).

**Responses parsed:** `PWON`/`PWSTANDBY` → power; `MV##`/`MV##.5` → volume (half-dB steps handled); `MUON`/`MUOFF` → mute; `SI<INPUT>` → current input and selection-pill highlight.

**Dashboard tile** (Media category): power toggle, input selection pills (active highlighted), mute button + volume slider. Status shows current input · Muted / Standby.

---

### `arduino`

```json
"arduino": {
  "host": "192.168.1.100",
  "port": 1883,
  "username": "",
  "password": "",
  "devices": [
    {
      "name": "Sensor Board",
      "key": "sensor_board",
      "stateTopic": "arduino/board/state",
      "commandTopic": "arduino/board/cmd",
      "sensors": [
        { "path": "temperature", "label": "Temperature", "unit": "°C" },
        { "path": "humidity",    "label": "Humidity",    "unit": "%" },
        { "path": "relay0",      "label": "Relay 1",     "type": "toggle",
          "payloadOn": "1", "payloadOff": "0" }
      ]
    }
  ]
}
```

Subscribes to MQTT topics and maps incoming JSON payloads to dashboard sensor readings. Works with Arduino (PubSubClient library), ESP32/ESP8266, Tasmota custom firmware, or any device publishing JSON over MQTT.

**`host`/`port`** — MQTT broker. Defaults to the main `mqtt.host`/`mqtt.port` if omitted.

**Device fields:**

| Field | Description |
|---|---|
| `name` | Display name on the dashboard |
| `key` | Optional unique store key (auto-derived from name if omitted) |
| `stateTopic` | MQTT topic that receives JSON payloads with all sensor values |
| `commandTopic` | MQTT topic for device-level commands (JSON `{ sensorPath: value }`) |
| `sensors` | Array of sensor descriptors (see below) |

**Sensor descriptor fields:**

| Field | Default | Description |
|---|---|---|
| `path` | — | JSON key in the state payload (also used as the store key) |
| `label` | same as `path` | Display label |
| `unit` | `""` | Unit suffix (e.g. `°C`, `%`, `V`) |
| `type` | read-only | `"toggle"` for on/off switch, `"range"` for slider, omit for read-only |
| `payloadOn` / `payloadOff` | `"1"` / `"0"` | Published payload for toggle commands |
| `min` / `max` | `0` / `100` | Range sensor bounds |
| `stateTopic` | device `stateTopic` | Per-sensor topic (receives a single value, not JSON) |
| `commandTopic` | device `commandTopic` | Per-sensor command topic (publishes raw payload) |
| `jsonKey` | same as `path` | Override the JSON key when it differs from `path` |

**Payload coercion:** `1`/`true`/`on` → `1`, `0`/`false`/`off` → `0`, numeric strings → float, everything else kept as string.

**Arduino example sketch** (PubSubClient):
```cpp
void loop() {
  StaticJsonDocument<128> doc;
  doc["temperature"] = dht.readTemperature();
  doc["humidity"]    = dht.readHumidity();
  doc["relay0"]      = digitalRead(RELAY_PIN);
  char buf[128];
  serializeJson(doc, buf);
  client.publish("arduino/board/state", buf);
  delay(5000);
}
```

---

### `suppla`

```json
"suppla": {
  "token": "your-personal-access-token",
  "server": "https://cloud.supla.org",
  "pollInterval": 30
}
```

Connects to the **Suppla** cloud or a self-hosted Suppla server. All channels are discovered automatically.

| Field | Default | Description |
|---|---|---|
| `token` | — | Personal access token — create at Suppla Cloud → Security → Personal Access Tokens |
| `server` | `https://cloud.supla.org` | API base URL. For self-hosted: `https://your-server.com` or `http://...` |
| `pollInterval` | `30` | How often to refresh all channel states (seconds) |

**Channel types discovered:**

| Function | Dashboard control |
|---|---|
| `LIGHTSWITCH`, `POWERSWITCH`, `STAIRCASETIMER` | Toggle switch |
| `DIMMER`, `RGBLIGHTING`, `DIMMERANDRGBLIGHTING` | Brightness slider (0–100 %) |
| `CONTROLLINGTHEROLLERSHUTTER`, `CONTROLLINGTHEROOFWINDOW` | Position slider (0 = open, 100 = closed) |
| `CONTROLLINGTHEGARAGEDOOR`, `CONTROLLINGTHEGATEWAY` | Toggle (open/close) |
| `CONTROLLINGTHEDOORLOCK` | Toggle (open/lock) |
| `THERMOMETER` | Temperature readout (°C) |
| `HUMIDITY` | Humidity readout (%) |
| `HUMIDITYANDTEMPERATURE` | Temperature + humidity pair |
| `OPENCLOSESENSOR`, binary types | Read-only indicator |
| `ELECTRICITYMETER` | Power (W) + energy (kWh) |

Channels are grouped by **physical device** (ioDevice) into a single dashboard card. The card label uses the device comment field if set, otherwise the device name.

---

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

Priority order for the live preview: `webrtcUrl` → `mjpegUrl` → `snapshotUrl` (polled every 2 s). UniFi Protect and Reolink cameras are automatically added to this list.

### `reolink`

```json
"reolink": {
  "aiPollInterval": 5,
  "cameras": [
    { "name": "Driveway", "host": "192.168.1.50", "username": "admin", "password": "secret", "channel": 0, "stream": "main", "https": false, "port": 0, "webrtcUrl": "", "aiDetect": true }
  ]
}
```

Support for **Reolink PoE cameras and NVRs**. Each entry is one camera: a standalone PoE camera uses `channel: 0`; an NVR exposes several channels on the same `host` (one entry per channel). LSH pulls JPEG snapshots via Reolink's HTTP API (`cmd=Snap`) and proxies them at `/api/reolink/snapshot/<index>` so **the browser never sees the camera password**. The RTSP URL is built automatically as `rtsp://<user>:<pass>@<host>:554/h264Preview_<NN>_<main|sub>` for use with go2rtc / VLC / an NVR (set `webrtcUrl` to a go2rtc endpoint for in-dashboard live view).

- `channel` — 0 for a standalone camera, or the NVR channel index
- `stream` — `main` (full-res) or `sub` (low-res); default `main`
- `https` / `port` — override the snapshot transport (defaults: HTTP on port 80)

Configure cameras in **Settings → 📷 Cameras → Reolink** — add a row per camera, hit **Test** to pull a live snapshot, then **Save**. Changes apply **live, without a restart** (the client reads the camera list from config on demand). Passwords are stored server-side and returned **masked** to the browser.

> **Note:** The auto-built RTSP URL and any `webrtcUrl` carry the credentials; the proxied snapshot (`/api/reolink/snapshot/<index>`) does not.

**AI object detection:** cameras with onboard AI are polled every `aiPollInterval` seconds (default 5) via `cmd=GetAiState`. Every category a camera reports as supported — person, vehicle, pet, face, and anything newer models add — becomes its own device (`Driveway — Person`, etc.), each a HomeKit motion sensor, so different categories can drive different automations. Set `"aiDetect": false` on a camera to skip AI polling for it; unsupported categories on a given model are never registered.

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
