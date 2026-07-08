# Quick Start & Requirements

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

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
