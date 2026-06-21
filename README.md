# LSH — LoxoneSwaggerHelper

A self-hosted home automation dashboard built on Node.js. Aggregates live data from Victron Energy, SolarEdge, Samsung SmartThings, Loxone, Satel, UniFi Protect, and Shelly into a single real-time web UI with relay control, HomeKit integration, and an MQTT explorer.

---

## Features

- **Live dashboard** — battery, solar, grid, AC/DC loads, relay control
- **Multi-source connection** — local MQTT (Victron Venus OS) with automatic VRM cloud fallback
- **Integrations** — SmartThings, SolarEdge, Loxone Miniserver, Satel INTEGRA, UniFi Protect, Shelly Gen1/Gen2
- **Camera support** — WebRTC (WHEP), MJPEG, and snapshot with live tile badges
- **SIP doorbell intercom** — VoIP doorbells ring a live call panel with the door camera, answer/decline, and one-tap door-open (relay pulse)
- **MQTT Explorer** — real-time topic browser, message history, publish
- **HomeKit bridge** — exposes relays and sensors as native HomeKit accessories
- **Logs viewer** — per-category log files with auto-refresh tabs
- **Dark / light mode** — toggle persisted in localStorage
- **Platform status bar** — colour-coded logos in the dashboard header, greyed out when disconnected

---

## Quick Start

```bash
cp config.example.json config.json   # copy and edit with your credentials
npm install
node server.js                        # or: npm start
```

Open `http://localhost:3000` (or the port set in config).

---

## Configuration

All settings are stored in `config.json` (gitignored). Copy `config.example.json` as a starting point. Every field can also be set via the **Settings** page in the UI — no manual file editing required after the first boot.

| Section | Required | Notes |
|---|---|---|
| `mqtt` | No | Local Victron Venus OS / Cerbo GX broker |
| `vrm` | No | Cloud fallback — email+password or API token |
| `solaredge` | No | Site ID + API key |
| `smartthings` | No | Personal Access Token |
| `loxone` | No | Miniserver host, port, username, password |
| `satel` | No | INTEGRA panel host + port + arm code |
| `unifi` | No | UniFi Protect host, API key or credentials |
| `shelly` | No | Array of device hosts |
| `cameras` | No | RTSP, snapshot, MJPEG, WebRTC URLs per camera |
| `sip` | No | SIP doorbell server: port, door camera name, door relay index |
| `relays` | Yes | Relay index + display name |
| `homekit` | Yes | PIN, port, username (MAC) |
| `server.port` | Yes | HTTP port (default 3000) |

---

## Pages

| URL | Description |
|---|---|
| `/` | Live dashboard |
| `/settings.html` | All integration settings, test buttons, restart |
| `/logs.html` | Per-category log viewer |
| `/mqtt.html` | MQTT topic explorer |

---

## Architecture

```
server.js
├── src/connection-manager.js   MQTT → VRM fallback
├── src/mqtt-client.js          Local MQTT (Victron topics)
├── src/vrm-client.js           Victron VRM cloud API
├── src/solaredge-client.js     SolarEdge polling
├── src/smartthings-client.js   SmartThings polling
├── src/loxone-client.js        Loxone WebSocket + token auth
├── src/satel-client.js         Satel INTEGRA TCP binary protocol
├── src/unifi-protect-client.js UniFi Protect HTTPS
├── src/shelly-client.js        Shelly HTTP Gen1/Gen2
├── src/mqtt-explorer.js        MQTT topic browser (subscribes to #)
├── src/sip-server.js           SIP doorbell intercom (UAS, door-open relay)
├── src/sensor-registry.js      Unified device store + commands
├── src/relay-controller.js     Relay commands via active connection
├── src/homekit-bridge.js       HAP-nodejs HomeKit bridge
├── src/platform-status.js      Live connected/disconnected state per integration
├── src/api-routes.js           REST API (/api/*)
├── src/websocket.js            Socket.IO push to browser
└── src/logger.js               Per-category file logger
```

Data flow: **MQTT/VRM → DataStore → Socket.IO → Browser**

All integrations report status to `platform-status.js`, which broadcasts `platform-status` events to connected browsers in real time.

---

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | All live data |
| GET | `/api/devices` | All registered sensors |
| POST | `/api/device/:key/command` | Send command to a device |
| POST | `/api/relay/:index/state` | Toggle relay `{ on: true/false }` |
| GET | `/api/cameras` | Camera list (config + UniFi) |
| GET | `/api/sip/status` | Current doorbell call state |
| POST | `/api/sip/answer` | Answer the active SIP call |
| POST | `/api/sip/reject` | Decline / hang up the active call |
| POST | `/api/sip/open-door` | Pulse the configured door relay |
| POST | `/api/webrtc/offer` | WHEP SDP proxy |
| GET | `/api/mqtt-explorer/topics` | All known MQTT topics |
| GET | `/api/mqtt-explorer/history?topic=…` | Message history |
| POST | `/api/mqtt-explorer/publish` | Publish a message |
| GET | `/api/logs/:name` | Tail a log file |
| GET | `/api/settings` | Current config (secrets masked) |
| POST | `/api/admin/restart` | Restart the server |
| POST | `/api/admin/reset-config` | Erase all configuration |

---

## Logs

Log files are written to `logs/` (gitignored), rotated at 2 MB. Categories: `mqtt`, `vrm`, `connection`, `smartthings`, `shelly`, `satel`, `unifi`, `sip`, `homekit`, `sensors`, `solaredge`, `websocket`, `server`.

---

## Requirements

- Node.js 18+
- Local MQTT broker or Victron VRM account (at least one recommended)
