# LSH — LoxoneSwaggerHelper

## Product Leaflet

[![Page 1](leaflet/pages/page1.png)](leaflet/lsh-leaflet.pdf)
[![Page 2](leaflet/pages/page2.png)](leaflet/lsh-leaflet.pdf)
[![Page 3](leaflet/pages/page3.png)](leaflet/lsh-leaflet.pdf)
[![Page 4 — SWOT](leaflet/pages/page4.png)](leaflet/lsh-leaflet.pdf)

📄 **[Download PDF](leaflet/lsh-leaflet.pdf)** — features, integrations &amp; REST API reference

---

## Business Guide — Support-Driven Monetization

💰 **[Open Business Guide](leaflet/lsh-monetize-leaflet.html)** — how to build a support-driven business on LSH (free software, paid expertise model)

3-page A4 guide covering:
- The support flywheel: free deployment → setup fee → annual SLA → expand scope → referrals
- Three support tiers: Community (free), Professional (€300/yr), Managed (€80/mo)
- Full service catalogue with indicative pricing (onboarding, SLA, managed hosting, custom dev, training)
- 3-year revenue projection for a solo operator
- Why LSH's focused integration set is a moat vs Home Assistant's 3 000-integration community

---

## SWOT Analysis

### 💪 Strengths

| | |
|---|---|
| **Local-first, zero cloud dependency** | All data stays on LAN. MQTT runs directly to hardware — no relay server, no account, works during internet outages. Optional VRM cloud fallback only when needed. |
| **20+ integrations in a single process** | ~80–130 MB RAM. No microservice sprawl, no Docker Compose with 12 containers — just `node server.js`. Runs comfortably on a Raspberry Pi 2 or any spare ARM/x86 board. |
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

## LSH vs. Home Assistant — RAM & Server Footprint

Home Assistant is the most popular open home automation platform and has a huge ecosystem. LSH does not try to replace it — but if you are running both, or just need bridge-and-control without a full automation engine, the resource difference is significant.

| | **LSH** | **Home Assistant** |
|---|---|---|
| **Runtime** | Node.js single process | Python + systemd services (Core/Supervised/OS) |
| **RAM at idle** | ~80–130 MB | 300–600 MB (Core only, no add-ons) |
| **RAM with typical add-ons** | — (no add-ons; all integrations built-in) | 600 MB–1.5 GB (Mosquitto + Z-Wave + Zigbee2MQTT + HA cast) |
| **Minimum RAM recommended** | **256 MB** | **1 GB** (official minimum for HA OS / Supervised) |
| **Minimum sensible hardware** | Raspberry Pi 2 / 512 MB board | Raspberry Pi 3 (2 GB recommended by Nabu Casa) |
| **Startup time** | 2–4 s | 30–90 s |
| **Disk footprint** | ~60 MB (node\_modules included) | 8–32 GB (HA OS image alone is 2 GB) |
| **Containers / processes** | 1 | 5–15 (supervisor, core, DNS, mDNS, add-ons) |
| **Install method** | `npm install && node server.js` | Dedicated image, Docker, or VM |
| **Remote access cost** | Free (own TLS / reverse proxy) | €6.99 / month (Nabu Casa Cloud) or self-host |
| **Database** | None — live data only | SQLite (grows unbounded; recorder purge needed) |
| **Config format** | JSON + browser UI | YAML + browser UI |
| **25+ integration scope** | ✓ all built-in, one process | ✓ 3 000+ via separate integration packages |
| **HomeKit bridge** | ✓ native (hap-nodejs) | ✓ via HomeKit Controller add-on |
| **SIP softphone** | ✓ built-in | ✗ |
| **Victron MQTT depth** | ✓ first-class | Limited (community integration) |

### When to choose LSH

- You want a **bridge-and-control layer** on top of existing hardware without committing 1+ GB RAM to an automation platform.
- You run on a **Raspberry Pi 2, Orange Pi Zero, or any 256–512 MB board** that would thrash with HA.
- You care about **instant startup** — after a power blip LSH is live in under 5 seconds, HomeKit re-pairs in seconds.
- You are a **KNX / Victron / Loxone integrator** who needs a professional-grade API gateway, not a consumer hub.
- You want **zero cloud dependency by default** — no Nabu Casa account, no subscription, works 100% offline.

### When Home Assistant is the better choice

- You need **automations, scenes, and a visual rule builder** — HA's scripting engine has no equivalent in LSH.
- You rely on **Z-Wave, Zigbee, or Matter** devices — HA's native stack for these is far more mature.
- You want **historical charts and energy dashboards** — HA's Recorder + Statistics panels are built for this.
- You need **3 000+ vendor integrations** from the HA ecosystem.

> LSH and Home Assistant run well side-by-side: run LSH on a low-power board for bridging and relay control, and point Home Assistant at the LSH REST API for automations.

---

A self-hosted home automation dashboard built on Node.js. Aggregates live data from Victron Energy, SolarEdge, Samsung SmartThings, Loxone, Satel, UniFi Protect, Reolink, Shelly, BoneIO, Dreame, Homey, IKEA Dirigera, IKEA Tradfri, LG ThinQ, ESPHome (ESP32/ESP8266), KNX, Fibaro Home Center, Z-Way / RaZberry (Z-Wave), Wiren Board, Somfy TaHoma, Bayrol Pool Manager Connect, AUX Air (AC Freedom), SmartTub hot tubs (Jacuzzi / Sundance / Watkins), Sonos speakers, Denon / Marantz AV receivers, Arduino / generic MQTT devices, and Suppla smart-home into a single real-time web UI with relay control, HomeKit integration, SIP softphone, MQTT explorer, FFmpeg RTSP proxy, and multi-language support.

---

## Table of Contents

1. [LSH vs. Home Assistant — RAM & Server Footprint](#lsh-vs-home-assistant--ram--server-footprint)
2. [Quick Start](#quick-start)
3. [React Dashboard](#react-dashboard)
4. [Configuration](#configuration)
4. [Pages](#pages)
5. [Backend Modules](#backend-modules)
6. [Integration Modules](#integration-modules)
7. [Automation, Scenes & History](#automation-scenes--history)
7. [Security & Auth](#security--auth)
8. [HomeKit](#homekit)
9. [SIP Softphone](#sip-softphone)
10. [Cameras](#cameras)
11. [Multi-language (i18n)](#multi-language-i18n)
12. [HTTPS / TLS](#https--tls)
13. [REST API](#rest-api)
14. [Logs](#logs)
15. [Requirements](#requirements)

---

## React Dashboard

A Homey-style dark dashboard served at `/react/` — no separate port needed.

**URL:** `http://<server-ip>:3001/react/`

### Add to Home Screen (fullscreen PWA)

The dashboard ships as a Progressive Web App. When installed from the home screen it runs fullscreen with no browser chrome.

#### iPhone / iPad (Safari)

1. Open `http://<server-ip>:3001/react/` in **Safari**
2. Tap the **Share** button (box with arrow pointing up)
3. Scroll down and tap **Add to Home Screen**
4. Name it **LSH** → tap **Add**
5. Open the icon from your home screen — runs fullscreen, no address bar

> Safari is required on iOS. Chrome and Firefox on iOS cannot install PWAs.

#### Android (Chrome)

1. Open `http://<server-ip>:3001/react/` in **Chrome**
2. Tap the **⋮ menu** (three dots, top right)
3. Tap **Add to Home screen** → **Add**
4. Open the icon — runs as a standalone app

#### Desktop (Chrome / Edge)

1. Open `http://<server-ip>:3001/react/` in Chrome or Edge
2. Click the **install icon** (⊕) in the address bar
3. Click **Install**

### Features

- Live energy flow — solar, battery, grid, AC loads
- Device tile grid with one-tap toggle and brightness/colour-temp sliders
- Category filter (Lighting / Switches / Climate / Security / Sensors / Victron)
- Relay control panel
- Mobile: bottom tab bar switches between Devices and Energy views
- Auto-reconnects via Socket.IO; falls back to 15-second polling

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

### Docker

```bash
cp config.example.json config.json    # edit with your credentials
docker compose up -d --build
```

The image is a multi-stage build (Node 20, `ffmpeg` for the RTSP proxy, `tini` for signal handling). Three things are mounted so data survives rebuilds:

- **`config.json`** → `/app/config.json` — your configuration
- **`persist/`** → `/app/persist` — HomeKit pairing, API tokens, users (must persist)
- **`certs/`** → `/app/certs` — optional TLS / Let's Encrypt certificates

`docker-compose.yml` uses **`network_mode: host`** because HomeKit advertises over mDNS, which only reaches the LAN with host networking (this also exposes every port directly, so no port mapping is needed).

> **Note:** Host networking is **Linux-only** — on Docker Desktop (macOS/Windows) HomeKit/mDNS won't work; switch to bridge networking with explicit `ports:` (the commented block in the compose file) if you don't need HomeKit.

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
| `reolink` | No | Reolink PoE cameras / NVR (proxied snapshots + RTSP) |
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
  "clientId": "your-oauth-client-id",
  "clientSecret": "your-oauth-client-secret",
  "token": "",
  "deviceIds": []
}
```

Leave `deviceIds` empty to discover all devices. Or supply a list of device UUIDs to limit discovery.

**Auth — OAuth (recommended).** SmartThings Personal Access Tokens created after Dec 2024 expire every 24 hours, so LSH uses OAuth with automatic refresh instead:

1. One-time, create an OAuth app with the [SmartThings CLI](https://github.com/SmartThingsCommunity/smartthings-cli) (needs any valid PAT, a 24 h one is fine): `smartthings apps:create` → *OAuth-In App* → redirect URI `https://lsh-callback.invalid/callback` (SmartThings rejects localhost redirects; the auth script uses a paste-the-URL flow instead), scopes `r:devices:* x:devices:* r:locations:*`. Note the client id + secret.
2. Put `clientId`/`clientSecret` in `config.json` and run `node scripts/smartthings-auth.js` — it prints an authorization URL, catches the redirect, and saves the token pair to `persist/smartthings-oauth.json`.
3. Restart LSH. The client refreshes the access token automatically before expiry and persists the rotated refresh token, so no further manual steps. (The refresh token only dies after 30 days *unused* — i.e. if LSH is off that long — in which case re-run step 2.)

**Auth — PAT (legacy).** A `token` from [account.smartthings.com/tokens](https://account.smartthings.com/tokens) still works, but only pre-2025 tokens are long-lived.

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

### `hue`

```json
"hue": {
  "host": "192.168.1.x",
  "username": "",
  "pollInterval": 5
}
```

**Philips Hue** via the local bridge (CLIP v1 REST — works on every bridge generation). Pairing: press the round link button on the bridge, run `node scripts/hue-auth.js <bridge-ip>` within 30 s, and paste the printed `username`.

Lights, plugs and Zigbee accessories are **auto-discovered** and polled every `pollInterval` seconds (default 5). Color/white-ambiance lights expose brightness, color temperature and hue/saturation (HomeKit `light-rw`, full color control); smart plugs are switches; Hue motion sensors register as one device with motion + temperature + lux + battery; dimmer switches report their last `buttonevent` and battery.

For development without a bridge, run `node scripts/hue-simulator.js` (a fake bridge on port 8180 with a color light, dimmable light, plug, motion trio and a dimmer switch) and point the config at `"host": "127.0.0.1", "port": 8180, "username": "sim"`.

### `simulators`

```json
"simulators": {
  "grenton": false,
  "miele": false,
  "ampio": false,
  "aqara": false,
  "hue": { "enabled": true, "port": 8180 }
}
```

LSH can run the bundled hardware simulators (`scripts/*-simulator.js` — Grenton GATE, Miele API, Ampio M-SERV, Aqara gateway, Hue bridge) itself as child processes, so a development install doesn't need PM2 or extra terminals. Each entry is `true`/`false` or `{ "enabled": bool, "port": n }` (default ports: grenton 8199, miele 8299, ampio 1884, aqara 19898, hue 8180). Simulator output appears in the LSH log prefixed `[sim:<name>]`, and a crashed simulator restarts after 5 s while enabled.

Simulators can also be **enabled/disabled at runtime** — `GET /api/simulators` lists them with status, `POST /api/simulators/<name>` with `{ "enabled": false }` stops one and persists the choice back to `config.json` (Swagger UI at `/api-docs` under the *Simulators* tag).

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

### `homeConnect`

**Home Connect** appliances (dishwasher, oven, washer, dryer, coffee machine, fridge, hood, …) via the official cloud API. Covers all BSH brands on one account: **Bosch, Siemens, Gaggenau, Neff, Thermador, Balay, Constructa**.

```json
"homeConnect": {
  "clientId": "",
  "clientSecret": "",
  "simulator": false
}
```

Setup:

1. Register a (free) application at [developer.home-connect.com](https://developer.home-connect.com) — choose OAuth flow **Device Flow** — and paste its `clientId`/`clientSecret` here
2. Run `node scripts/homeconnect-auth.js`, open the printed URL, and enter the code to authorize
3. Restart the server — tokens live in `persist/homeconnect-tokens.json` and refresh automatically

Each appliance registers as a device with `power` (controllable on/off/standby), `operation` state, active `program`, `progress` %, `remaining` minutes, `door` contact, and `connected`. Live updates arrive over the account-wide SSE event stream (with a slow periodic re-sync, `pollInterval` seconds, default 21600 — the API allows only ~1000 requests/day, so the re-sync is rare by design). Set `"simulator": true` to develop against the [Home Connect appliance simulator](https://developer.home-connect.com/simulator) instead of real appliances.

### `miele`

**Miele@home** appliances (washer, dryer, dishwasher, oven, hob, hood, coffee system, fridge/freezer, wine unit, robot vacuum) via the official [Miele 3rd Party API](https://developer.miele.com).

```json
"miele": {
  "clientId": "",
  "clientSecret": "",
  "username": "you@example.com",
  "password": "",
  "country": "de-DE"
}
```

Setup:

1. Register a (free) application at [developer.miele.com](https://developer.miele.com) and paste its `clientId`/`clientSecret` here
2. Add your Miele account `username`/`password` (`country` is the account region, e.g. `de-DE`, `pl-PL`, `en-GB`) — the client logs in directly
3. If the password grant is rejected for your account, run `node scripts/miele-auth.js` once instead (browser login, paste the redirect URL)

For development without appliances, run `node scripts/miele-simulator.js` and point the client at it with `"host": "127.0.0.1", "port": 8299` (any credentials) — it simulates a running washer with countdown, a heating oven and a fridge over the same API including the SSE stream.

Tokens live in `persist/miele-tokens.json` and refresh automatically. Each appliance registers with `power` (controllable on/off), `status`, `program`, `phase`, `remaining` minutes, `temperature`/`target` °C, `door` contact, `failure` alarm, and `connected`. Live updates arrive over the `/devices/all/events` SSE stream; a periodic re-sync (`pollInterval` seconds, default 300) also picks up newly added appliances. Optional `language` sets the locale of status/program names.

### `grenton`

**Grenton** smart home (CLU controllers) via the **GATE HTTP** module. There is no discovery API — devices are declared explicitly, addressed by their Object Manager names.

```json
"grenton": {
  "host": "192.168.1.x",
  "port": 80,
  "path": "/lsh",
  "token": "",
  "pollInterval": 5,
  "devices": [
    { "name": "Lampa salon", "object": "DOU8272", "type": "light" },
    { "name": "Ściemniacz",  "object": "DIM1234", "type": "dimmer", "scale": 1 },
    { "name": "Roleta",      "object": "ROL4321", "type": "blind",
      "commands": { "up": "ROL4321:execute(0,0)", "down": "ROL4321:execute(1,0)", "stop": "ROL4321:execute(3,0)" } },
    { "name": "Temp. salon", "object": "PANELSENSTEMP1", "type": "temperature" }
  ]
}
```

Setup on the Grenton side (once, in Object Manager): add an **HttpListener** to your GATE HTTP with Path `/lsh`, attach the script from [`docs/grenton-gate-lsh.lua`](docs/grenton-gate-lsh.lua) to its OnRequest event, and send the config to the GATE. LSH then polls object states (`pollInterval` seconds) and sends commands through the same listener.

Device `type`: `light` / `switch` (on-off, HomeKit-exposed), `dimmer` (adds a brightness slider; `scale: 1` for Grenton's 0–1 DIM range), `blind` (position slider plus optional momentary `up`/`down`/`stop` buttons driven by the raw Grenton calls in `commands`), `temperature`, `sensor` (read-only value, optional `unit`). Optional per-device `getIndex`/`setIndex` select the object feature index (default 0), and `token` adds a shared secret checked by the listener script.

### `ampio`

**Ampio** smart home (CAN modules) via the MQTT broker on the **M-SERV** — enable it in Smart Home Konfigurator first; credentials are the same as for the Smart Home Manager app. There is no discovery API — devices are declared explicitly, addressed by the module MAC (as shown in the Konfigurator) and the input/output index.

```json
"ampio": {
  "host": "192.168.1.x",
  "port": 1883,
  "username": "",
  "password": "",
  "devices": [
    { "name": "Lampa salon",  "mac": "1C4A", "type": "light",       "index": 1 },
    { "name": "Ściemniacz",   "mac": "1C4A", "type": "dimmer",      "index": 2 },
    { "name": "Roleta",       "mac": "3910", "type": "blind",       "index": 1 },
    { "name": "Temp. salon",  "mac": "3910", "type": "temperature", "index": 1 },
    { "name": "Czujka ruchu", "mac": "3910", "type": "motion",      "index": 3 },
    { "name": "Jasność",      "mac": "3910", "type": "sensor", "index": 1, "stateType": "a", "unit": "lx" }
  ]
}
```

States arrive on `ampio/from/<MAC>/state/<type>/<idx>` topics; commands publish to `ampio/to/<MAC>/o|f/<idx>/cmd`.

Device `type`: `light` / `switch` (relay output `o`, on/off, HomeKit-exposed), `dimmer` (level from the 8-bit `au` state, 0–255 shown as %, on/off + brightness commands), `flag` (Ampio flag `f`, on/off), `blind` (momentary `up`/`down`/`stop` buttons — roller modules take 2/1/0 on the output command topic; position feedback would need raw CAN frames), `temperature` (`t` state), `contact` / `motion` (binary input `i`), `sensor` (read-only value, default analogue `a` state, optional `unit` and `scale` multiplier). Per-device `stateType` overrides the state-topic letter, and `stateTopic`/`commandTopic` override the full topics for anything unusual.

For development without hardware, run `node scripts/ampio-simulator.js` (a self-contained MQTT broker + fake modules `1C4A`/`3910` on port 1884) and point the config at `"host": "127.0.0.1", "port": 1884` with the example devices above.

### `aqara`

**Aqara / Xiaomi Zigbee** devices via the gateway **LAN protocol** (UDP 9898). Works with hubs that support "developer mode" / LAN protocol (Xiaomi Gateway v2/v3, Aqara Hub v1, AC Partner) — enable it in the Mi Home / Aqara app, which also reveals the 16-character LAN password needed for control.

```json
"aqara": {
  "pollInterval": 30,
  "gateways": [
    { "host": "192.168.1.x", "port": 9898, "password": "16charLANkey0000", "name": "Hub" }
  ],
  "names": { "158d0001a2b3c4": "Czujnik salon" }
}
```

Child devices are **auto-discovered** through the hub (`get_id_list` → `read` per device); live updates arrive via `report`/`heartbeat` multicasts on `224.0.0.50:9898`, with a periodic re-read (`pollInterval` seconds) as safety net. If the multicast port is taken LSH falls back to poll-only mode automatically. The optional `names` map assigns labels by Zigbee sid (otherwise devices are named by model + sid suffix).

Supported models: temperature/humidity (`sensor_ht`) and weather (`weather.v1`, adds pressure), door/window contact, motion (with lux), water leak, buttons/cube (last action), smart plugs (controllable, with power), 1/2-channel wall switches (controllable), and the gateway itself (illumination + light on/off). Battery sensors report an estimated percentage from cell voltage. Contact/motion/leak/temperature/humidity and switches are HomeKit-exposed. Writes are signed with the rotating gateway token encrypted with the LAN `password` — without it the integration is read-only.

For development without hardware, run `node scripts/aqara-simulator.js` (a fake hub on UDP 19898 with temp/contact/motion sensors and a plug) and point the config at `"host": "127.0.0.1", "port": 19898, "password": "abcdefghijklmnop"`.

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

**Control:** Each device exposes these sensors, controllable via `GET /api/device/<key>/set?sensor=<path>&value=<v>` (or `POST /api/device/<key>/command`):

| Sensor | Type | Command |
|---|---|---|
| `switch` | toggle | `on` = open, `off` = close |
| `level` | range 0–100 | position (0 = closed, 100 = open) |
| `stop` | momentary | any value halts the motor (`stop`) |
| `my` | momentary | move to the stored **"My"** favourite position (the Somfy remote's middle button) |

The `my` control is exposed when the cover advertises the Overkiz `my` command, or reports no command list (RTS motors). It requires a My position to be stored on the motor first (press-and-hold **My** on the physical remote).

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

Priority order for the live preview: `webrtcUrl` → `mjpegUrl` → `snapshotUrl` (polled every 2 s). UniFi Protect, Reolink and KENIK cameras are automatically added to this list.

Any manual camera with an `"onvif": { "host": "192.168.1.x", "port": 80, "username": "", "password": "" }` section gets a press-and-hold **PTZ pad** in the camera modal (pan/tilt/zoom over ONVIF `ContinuousMove`; also see `ptz: true` for Reolink and `onvif` per KENIK channel).

### `reolink`

```json
"reolink": {
  "cameras": [
    { "name": "Driveway", "host": "192.168.1.50", "username": "admin", "password": "secret", "channel": 0, "stream": "main", "https": false, "port": 0, "webrtcUrl": "" }
  ]
}
```

Support for **Reolink PoE cameras and NVRs**. Each entry is one camera: a standalone PoE camera uses `channel: 0`; an NVR exposes several channels on the same `host` (one entry per channel). LSH pulls JPEG snapshots via Reolink's HTTP API (`cmd=Snap`) and proxies them at `/api/reolink/snapshot/<index>` so **the browser never sees the camera password**. The RTSP URL is built automatically as `rtsp://<user>:<pass>@<host>:554/h264Preview_<NN>_<main|sub>` for use with go2rtc / VLC / an NVR (set `webrtcUrl` to a go2rtc endpoint for in-dashboard live view).

- `channel` — 0 for a standalone camera, or the NVR channel index
- `stream` — `main` (full-res) or `sub` (low-res); default `main`
- `https` / `port` — override the snapshot transport (defaults: HTTP on port 80)
- `ptz: true` — shows a PTZ pad in the camera modal, driven by Reolink's `PtzCtrl` API (press-and-hold arrows / zoom, released = stop)

### `kenik`

```json
"kenik": {
  "host": "192.168.1.90",
  "username": "admin",
  "password": "",
  "urlStyle": "kenik",
  "channels": [
    { "name": "Podjazd", "channel": 1 },
    { "name": "Ogród",  "channel": 2, "stream": "sub" },
    { "name": "Furtka", "host": "192.168.1.91", "urlStyle": "simple", "channel": 1 }
  ]
}
```

Support for **KENIK (Eltrox) cameras and DVR/XVR recorders**. The top-level `host`/`username`/`password`/`urlStyle`/`rtspPort` are defaults for every channel; a DVR is one `host` with one entry per `channel`, and standalone IP cameras override `host` per entry. Cameras appear in the dashboard camera list alongside UniFi/Reolink ones.

KENIK shipped several RTSP URL generations — pick the `urlStyle` that matches the device:

- `kenik` (default) — DVR/XVR recorders: `rtsp://user:pass@host:554/mode=real&idc=<ch>&ids=<1|2>` (`ids` 2 = sub stream)
- `xm` — older XiongMai-based devices: `rtsp://host:554/user=…&password=…&channel=<ch>&stream=<0|1>.sdp?real_stream`
- `simple` — newer cameras and doorphones: `rtsp://user:pass@host:8554/ch<NN>`
- or set `urlTemplate` per channel with `{host}` `{port}` `{user}` `{pass}` `{ch}` `{ch2}` placeholders for anything else

KENIK has no uniform HTTP snapshot API, so LSH grabs one frame from the RTSP stream with **ffmpeg** (requires ffmpeg installed; honors `ffmpegRtsp.ffmpegPath`), caches it for 10 s, and proxies it at `/api/kenik/snapshot/<index>` — **the browser never sees the camera password**. `stream: "sub"` is recommended for DVR channels used as dashboard tiles. Set `webrtcUrl` to a go2rtc endpoint for in-dashboard live view, and add the built RTSP URL to `ffmpegRtsp` / `cameras` if you want HomeKit exposure.

For PTZ cameras, add `"onvif": { "port": 80, "username": "", "password": "" }` to the channel (host/credentials default to the KENIK ones; `profileToken`/`ptzPath`/`mediaPath` override ONVIF specifics) — the camera modal then shows a press-and-hold PTZ pad driven over ONVIF `ContinuousMove`.

Configure cameras in **Settings → 📷 Cameras → Reolink** — add a row per camera, hit **Test** to pull a live snapshot, then **Save**. Changes apply **live, without a restart** (the client reads the camera list from config on demand). Passwords are stored server-side and returned **masked** to the browser.

> **Note:** The auto-built RTSP URL and any `webrtcUrl` carry the credentials; the proxied snapshot (`/api/reolink/snapshot/<index>`) does not.

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

**Setup:** OAuth via `scripts/smartthings-auth.js` (see the `smartthings` config reference above) — tokens then refresh automatically. A legacy Personal Access Token also works.

**Config:**
```json
"smartthings": { "clientId": "...", "clientSecret": "...", "deviceIds": [] }
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

**Discovery:** `GET .../setup/devices` — filters to controllable device classes (RollerShutter, Gate, Awning, Window, etc.). Each device gets a `switch` sensor (open/close toggle), a `level` sensor (0–100 position slider, inverted from the TaHoma `core:ClosureState` which uses 0 = open), a `stop` momentary, and a `my` momentary (favourite position, Overkiz `my` command — shown when advertised or when the device reports no command list, e.g. RTS motors).

**Polling:** `GET .../setup/devices/<url>/states` every `pollInterval` seconds. `core:ClosureState` → `level = 100 - closure`.

**Control:** `POST .../exec/apply` with a JSON action list — `open`/`close`/`stop`/`my`/`setPosition`/`setClosure`.

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

## Automation, Scenes & History

### Sensor history + charts

Every numeric (and boolean) store value is recorded in an in-memory ring buffer — up to 720 points per key, at most one point per 30 s (≈6 h of full-resolution history; fast-changing values update the latest point in place, so RAM stays bounded).

- **UI:** click any read-only sensor value on a device card to open a chart modal with 1h / 6h / All ranges and min/avg/max stats.
- **API:** `GET /api/history/<storeKey>` → `{ success, key, points: [[timestamp, value], …] }`

History is in-memory only — it resets on server restart.

### Automation rules

Rules are edge-triggered: a comparison rule fires once when the condition becomes true, and re-arms when it becomes false again. `changes` fires on every value change. An optional per-rule cooldown limits how often it can fire.

```json
{
  "name": "Spa overheating",
  "enabled": true,
  "trigger": { "key": "smarttub/<id>/water_temp", "op": ">", "value": 40 },
  "actions": [
    { "type": "notify", "level": "critical", "message": "Spa is {value}°C!" },
    { "type": "relay", "index": 1, "on": false }
  ],
  "cooldownSeconds": 300
}
```

**Trigger ops:** `>` `<` `>=` `<=` `==` `!=` `changes`

**Action types:**
| Type | Fields | Effect |
|---|---|---|
| `device` | `deviceKey`, `sensor`, `value` | Send a device command via the sensor registry |
| `relay` | `index`, `on` | Switch a Victron relay |
| `notify` | `level` (`info`/`warning`/`critical`), `message` | Add a notification + toast; `{value}` and `{key}` placeholders supported |
| `scene` | `sceneId` | Run a scene |

### Scenes

Named action groups run manually — one tap from the **scene strip** shown above all dashboard tabs, or from the Automation tab. Same action types as rules.

### Notifications

`notify` actions append to an in-memory log (last 200) shown on the Automation tab, push a real-time toast to all connected browsers (via the `notification` socket.io event), and log to the server console.

### Storage & API

Rules and scenes persist to `automations.json` in the project root (gitignored). Endpoints:

```
GET/POST  /api/automation/rules          DELETE /api/automation/rules/:id
GET/POST  /api/automation/scenes         DELETE /api/automation/scenes/:id
POST      /api/automation/scenes/:id/run
GET       /api/automation/notifications  DELETE /api/automation/notifications
```

`POST` creates or updates (include `id` to update). All endpoints require auth like the rest of the API.

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

## Requirements

### Hardware

| | Minimum | Comfortable |
|---|---|---|
| **RAM** | 128 MB | 256 MB+ |
| **CPU** | ARMv7 / single-core 700 MHz | Any modern single-board computer |
| **Disk** | 100 MB free | 500 MB (for logs + persisted state) |
| **Best pick — server** | Raspberry Pi 2 (512 MB) | Raspberry Pi 3/4, Orange Pi, any VPS |
| **Best pick — sensor nodes** | Arduino Uno/Nano + Ethernet shield | ESP32 / ESP8266 (Wi-Fi built-in, MQTT library) |

LSH runs comfortably on hardware that cannot run Home Assistant. The entire server — 25+ integrations active — typically uses **80–130 MB RAM** as a single Node.js process with no containers.

**Arduino / ESP32 as sensor nodes:** Flash your board with any MQTT library (PubSubClient for Arduino, built-in for ESP32), publish a JSON payload to a topic (e.g. `arduino/board/state`), and configure it in `config.json` under `arduino.devices`. Toggle relays or PWM outputs by subscribing to a command topic — no extra software needed on the board side.

### Software

- **Node.js** 18 or later
- **npm** packages: see `package.json`
- At least one of: local Victron MQTT broker or a Victron VRM account
- Optional npm packages (install separately if needed):
  - `acme-client` — Let's Encrypt support
  - `node-tradfri-client` — IKEA Tradfri gateway support
  - `knx` — KNX bus integration (`npm install knx`)
- Optional system tools (install separately):
  - `ffmpeg` — FFmpeg RTSP proxy for Loxone / RTSP clients
