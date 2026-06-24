# Changelog

All notable changes to this project are documented here.

---

## [Unreleased]

---

## 2026-06-24/25

### Added
- **AuxAir / AC Freedom** — full cloud control for AUX air conditioners via the SmartHomeCS API. Supports on/off, set temperature (16–30 °C), mode (cool/heat/dry/fan/auto), and fan speed. Dashboard tile shows room temperature, set temperature, mode pills (inline), and +/− temperature buttons. Auth uses AES-128-CBC encrypted login (app-hardcoded key/IV), SHA-1 password hashing, and per-session Bearer tokens.
- **Loxone Outbound Push** (`src/loxone-out-client.js`) — pushes DataStore values to Loxone Virtual Inputs via HTTP GET (`/dev/sps/io/<input>/<value>`) on every store change, debounced 200 ms. Mappings configured as `storeKey = VirtualInputName` in the settings UI.
- **Somfy Bearer token auth** — TaHoma Developer Mode token supported as an alternative to email + password. When set, skips session login entirely and sends `Authorization: Bearer <token>` on all requests.
- **Bayrol Pool Manager Connect** — cloud-brokered MQTT integration (WebSocket, port 8083, TLS) for pH, ORP, temperature, and salt readings. Pool name configurable per tile.
- **Fibaro Home Center** — room-based device tiles with per-sensor toggles, temperature display, and real-time long-poll updates via `/api/refreshStates`.
- **Somfy TaHoma** — local HTTPS API integration for roller shutters, screens, venetian blinds, awnings, and gates.
- **Satel zones only** — partition polling removed; module now returns zone violations only.
- **React dashboard** — Homey-style PWA with SVG icons, mobile-responsive layout, spring card entrance, glow blobs, and gradient borders. Installable as Add to Home Screen.
- Pool tile shows pH, ORP, temperature, and salt inline. Fibaro tile shows switch count, temperature, and per-device toggle rows.

### Fixed
- **Fibaro** — `store.update` used instead of `store.set`; `homekit: []` added to device registration (prevented HomeKit bridge crash).
- **Bayrol** — complete rewrite: was calling wrong `/webservice/p.php` endpoints; now uses correct MQTT over WebSocket credential exchange flow.
- **Somfy** — `store.set` → `store.update`; server startup now accepts token-only config.
- **Config** — `bayrol`, `somfy`, `fibaro`, `loxoneOut`, `auxair` keys added to config whitelist (were returning `undefined`, preventing modules from starting).

---

## 2026-06-22 (7)

### Added
- **LG ThinQ support** — cloud API integration using LG's ThinQ v2 protocol (same as the official LG ThinQ app). Authenticates via LG account email + password, persists OAuth tokens in `persist/lgthinq-tokens.json` with automatic refresh. Discovers all appliances from the LG account and creates one dashboard card per device. Supported types: air conditioners (power toggle + target temperature slider + current temperature), air purifiers (power + PM1/PM2.5/PM10), washing machines/dryers (state + remaining time), dishwashers (state), refrigerators (fridge and freezer temperatures), humidifiers/dehumidifiers (power + humidity). State changes polled every 30 s. Settings card with country selector (US/EU/KR/AU/CA/JP) and a test button that probes the LG gateway. Platform badge added to the dashboard header. Translated in all 7 languages.

---

## 2026-06-22 (6)

### Added
- **Fibaro Home Center support** — local REST API integration for Home Center 2 and Home Center 3 (Lite). Devices are auto-discovered and grouped by room into dashboard cards. Supported types: binary switches (controllable toggles), dimmers (range 0–99), roller shutters via FGRM/FGR (range 0–100), plus read-only sensors: temperature, humidity, light (lux), power/energy, door, window, motion, smoke, and flood. Live state delivered via long-polling `/api/refreshStates`. Settings card with host, port, username, and password; Test Connection probes `/api/loginStatus`. Platform badge in the dashboard header. Translated in all 7 languages.

---

## 2026-06-22 (5)

### Added
- **BroadLink RM4 IR/RF support** — pure Node.js UDP protocol client for BroadLink RM4 Pro, RM4 Mini, and RM4C Mini devices. Supports IR code learning (20 s window), RF code learning (frequency sweep + learn), and named code storage in `persist/broadlink-codes.json`. Learned codes appear as trigger buttons on device cards in the dashboard. Settings page includes device management (host, MAC) and a live code library per device with Learn IR, Learn RF, Test Send, and Delete. Streaming NDJSON responses give real-time status during learning. All translated in 7 languages.
- **`trigger` sensor type** — new dashboard sensor variant: renders as a "▶ Send" button instead of a toggle. Clicking fires a command with `value: true` and shows brief ✓/✗ feedback. Used by BroadLink codes; available for any future push-type sensor.

---

## 2026-06-22 (4)

### Added
- **Waveshare Modbus TCP relay board support** — pure Node.js Modbus TCP client (no external library). Connects to Waveshare relay boards over TCP port 502. Multiple boards supported, each appears as a device card with individual relay toggles. Auto-reconnects after 15 s on connection loss, polls relay states every 5 s. Relay control via standard dashboard toggle or `POST /api/device/:key/command`. Settings card with per-board host, port, slave ID, and relay count. Test connection button sends FC01 to probe the slave. Translated in all 7 languages.

---

## 2026-06-22 (3)

### Added
- **Ukrainian language (UA)** — full translation of all UI strings.
- **Italian language (IT)** — full translation of all UI strings.

---

## 2026-06-22 (2)

### Added
- **Spanish language (ES)** — full translation of all UI strings across dashboard, settings, logs, MQTT explorer, login, and setup pages.

---

## 2026-06-22

### Added
- **Multi-language support (EN / PL / FR / DE)** — client-side i18n engine (`public/i18n.js`) with language switcher injected into every page header. JSON translation files served from `/i18n/` without authentication so login and setup pages translate correctly. All six pages annotated with `data-i18n` attributes. Dynamic relay ON/OFF and connection status in `app.js` use `window.t()`.
- **Dreame robot vacuum and air purifier support** — miio UDP protocol (AES-128-CBC, port 54321). Supports start/stop/pause/dock for vacuums and on/off/mode/fan-speed for air purifiers.
- **Homey Pro 2023+ integration** — local LAN REST API (`mode: local`) and Homey cloud API (`mode: cloud`). Maps 30+ Homey capability types to sensor descriptors with full HomeKit service support.
- **Comprehensive module manual** — README rewritten as a full reference covering every backend module, every integration client, full config key reference, complete REST API table, HomeKit service mapping, SIP softphone setup, camera streaming guide, i18n instructions, and log file index.

### Changed
- **Settings page** — auth design language applied to all integration cards (gradient borders, glow blobs, consistent card style).
- **Login and setup pages** — polished UI with animated logo, spring card entrance, and consistent auth design system.
- **Integration modules** — all optional integrations are now lazy-loaded; missing `npm` packages no longer crash the server at startup.

### Fixed
- `/i18n/` path and `/i18n.js` added to the auth middleware public whitelist so translation files load on unauthenticated pages.

---

## 2026-06-21

### Added
- **Auth system** — JWT session cookies, first-run admin setup (`/setup.html`), role-based access (admin / viewer), API bearer tokens for Home Assistant and scripts, and HTTPS / Let's Encrypt support.
- **SIP softphone** — WebRTC-based SIP client embedded in the dashboard. Supports incoming and outgoing calls, ringtone, caller-matched camera snapshot, DTMF unlock, and relay pulse on unlock. Powered by JsSIP over WebSocket transport.
- **Camera snapshot scanner and event log** — in-memory ring buffer for motion, sound, and snapshot events. Events shown in the camera modal and streamed to browsers via Socket.IO.
- **Aeotec 360 camera support** — RTSP preview labels and settings section in the UI.
- **IKEA Dirigera integration** — REST device discovery + live WebSocket updates. One-time OAuth pairing via `scripts/dirigera-auth.js`.
- **IKEA Tradfri integration** — CoAP/DTLS via `node-tradfri-client`. First-run security code pairing with generated identity/psk.
- **Air quality sensors** — PM2.5, PM10, VOC, AQI, CO₂ sensor types added to device definitions and HomeKit bridge.
- **BoneIO integration** — Home Assistant MQTT auto-discovery (`homeassistant/#`) for relay boards; live state via `boneIO/#` topics. All entities from the same board grouped into one device card.
- **Satel zone and partition name editors** — editable name maps per zone index and partition index in the settings UI.
- **SolarEdge live data card** — dedicated card on the dashboard with current power and today's energy yield.
- **LSH logo** — SVG logo added to all pages (header, login, setup, auth card).

### Changed
- **Dashboard redesign** — energy flow diagram with animated connectors, SVG card icons, source badge (Local MQTT / VRM Cloud), grid import/export badge, and platform status logo bar.

---

## 2026-06-20

### Added
- **HomeKit camera support** — snapshot and stub live-streaming accessories via HAP-nodejs `CameraController`. Loxone VideoIntercom controls exposed as HomeKit cameras.
- **Extended HomeKit services** — Lightbulb (dimmer + color), Lock, WindowCovering, Door, Fan, LightSensor, Thermostat (SmartThings).
- **Dark / light mode toggle** — persisted in `localStorage`; applied before first paint to prevent flash.
- **Platform status logo bar** — colour-coded integration logos in the dashboard header, greyed out when disconnected.
- **Erase Config button** — destructive reset endpoint (`POST /api/admin/reset-config`) with confirmation in the UI.
- **README** — initial project documentation.

### Changed
- **VRM made optional** — server starts and serves the dashboard even with no MQTT and no VRM credentials configured.

### Initial release — `cac0804`

Full home automation dashboard including:
- Live Victron Energy data via local MQTT (Venus OS / Cerbo GX) with automatic VRM cloud fallback
- Battery, solar, grid, AC/DC load metrics
- Relay control (dashboard toggles + HomeKit)
- SmartThings, SolarEdge, Loxone Miniserver, Satel INTEGRA, UniFi Protect, Shelly Gen1/Gen2 integrations
- MQTT Explorer (real-time topic browser with publish)
- HomeKit bridge (relays + sensors)
- Logs viewer (per-category files, auto-refresh, download)
- REST API (`/api/*`)
- Socket.IO real-time push to browser
