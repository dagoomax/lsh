# Changelog

All notable changes to this project are documented here.

---

## [Unreleased]

### Added
- **PM2 process-manager support** — added [`ecosystem.config.js`](ecosystem.config.js) so the server can run as an always-on, auto-restarting service via [PM2](https://pm2.keymetrics.io/). Registered as `lsh` in single-instance fork mode (the server binds fixed HTTP(S)/HomeKit/RTSP ports and holds long-lived MQTT/WebSocket connections, so cluster mode is unsafe), with `autorestart` and a 300 MB `max_memory_restart` guard. PM2 stdout/stderr are captured to `logs/pm2-out.log` / `logs/pm2-error.log` alongside the app's existing category logs. Added `pm2:start`/`stop`/`restart`/`reload`/`delete`/`logs`/`status` npm scripts and a "Running as a service (PM2)" section to the README.

---

## 2026-08-05

### Added
- **Flow editor: Virtual device node** — a friendly device picker (drawn from `/api/devices`, filtered to `type === 'virtual'`) with a value control that adapts to the target device's type: an on/off dropdown for switches, a number field for dimmers/sensors, free text for text devices, and no field at all for buttons (a button fires regardless of value). Dispatches through the same `automation-engine.js` `sendCommand` path as the generic Device node, just scoped to a nicer UI — picking a device that's since been deleted shows a "⚠ not found — pick a replacement" state instead of silently rewiring the flow to an arbitrary other device.
- **Weather forecast: animated icons + day-tile detail popup** — each forecast icon now has a condition-appropriate CSS animation (sunbeam glow/rotate, drifting clouds, falling rain, lightning flicker, tumbling snow, breathing fog), with a `prefers-reduced-motion` override that disables all of them. Clicking a day tile opens a detail popup — feels-like temperature, precipitation probability, humidity, wind speed + 16-point compass direction, pressure, and cloudiness, all newly aggregated per-day from the same representative noon step already used for the day's condition/icon — styled with the same glass/gradient-border/glow-blob modal chrome as the main device modal (backdrop blur, spring entrance, Escape/backdrop-click to close).

### Fixed
- **OpenWeatherMap silently doing nothing when misconfigured** — `start()` now logs a clear `[OpenWeather] apiKey set but lat/lon missing` warning if an API key is set but latitude/longitude are missing, instead of returning early with no log output at all. The Settings card's Latitude/Longitude fields are marked "(required)" with `e.g.` placeholders so they no longer read as pre-filled defaults (they previously showed Warsaw's coordinates as the placeholder, easy to mistake for an already-filled value).

---

## 2026-08-04

### Added
- **OpenWeatherMap integration + 5-day forecast widget** ([`src/openweather-client.js`](src/openweather-client.js)) — current conditions (condition, temperature, feels-like, humidity, pressure, wind speed/direction, cloudiness, visibility, sunrise/sunset) via the free Current Weather Data API, polled on a configurable interval (minimum 60s). A new `GET /api/openweather/forecast` endpoint feeds a forecast strip on the dashboard from the free 5 Day/3 Hour Forecast API, aggregating the 40 three-hour steps into one representative entry per day (the step closest to local noon, to avoid overnight-clear-sky bias) — capped honestly at 5 days rather than padded to 7, since true 7-8 day coverage needs OpenWeatherMap's separate paid One Call subscription.
- **Virtual device module** ([`src/virtual-client.js`](src/virtual-client.js)) — switches, dimmers, sensors, text values, and buttons with no real hardware behind them: automation flags, manual overrides, or a landing spot for values pushed in from an external script/webhook via the normal `/api/device/<key>/set` endpoint. Buttons pulse to `1` then auto-reset to `0` after 800ms, the same pattern used elsewhere for momentary triggers. Managed from Settings → Virtual Devices; new/changed devices need a restart to register.
- **Custom CSS editor** (Settings → Interface) — a textarea saving to `config.ui.customCss`, served at a public `GET /custom.css` and referenced via a real `<link>` tag in both dashboards' `<head>` so it applies before first paint (no flash of unstyled content), read fresh from `config.json` on every request. The route deliberately lives outside `/api/` — the `.css`-extension public exemption in `auth.js`'s middleware explicitly excludes all `/api/*` paths, so `/api/custom.css` 401'd until the route was moved.
- **Dashboard editor** ([`react-dashboard/src/components/DashboardGrid.jsx`](react-dashboard/src/components/DashboardGrid.jsx), built on the new `react-grid-layout` dependency) — a Lovelace-style editor for the main "All" dashboard view: drag tiles to reposition, resize them, remove them (unpins from the dashboard, doesn't touch the device), and add any device via a picker. Layout persists to `localStorage` (same scoping as theme/language). Fully opt-in — `DeviceList.jsx` only switches into the custom grid once a layout has actually been saved; a "Customize Dashboard" button seeds one from whatever's currently visible so the transition isn't a blank canvas.
- **MiCasaVerde / Vera integration** ([`src/vera-client.js`](src/vera-client.js)) — polls a Vera controller's local LuaUPnP JSON API (`/data_request?id=sdata`) for switches, dimmers, thermostats, door locks, window coverings, security/binary sensors, humidity/temperature/light sensors, power meters, and battery levels, modeled on `zway-client.js` since Z-Way's API inherited its UPnP service-ID conventions from Vera. Commands go through `data_request?id=lu_action&serviceId=...&action=...`.
- **ONVIF network discovery + auto-fetch stream/snapshot URLs** — previously ONVIF support was PTZ-only and required a manually-typed RTSP/snapshot URL even with full credentials. New [`onvif-discovery.js`](src/onvif-discovery.js) runs a WS-Discovery multicast scan to find cameras on the LAN without knowing IPs up front (validated live, found 8 real devices), and new [`onvif-media.js`](src/onvif-media.js) calls `GetStreamUri`/`GetSnapshotUri` so `onvif:{host,user,pass}` alone is enough — no manual `url`/`snapshotUrl` needed. The shared SOAP/WS-Security plumbing was extracted into [`onvif-soap.js`](src/onvif-soap.js) (the existing PTZ-only code now just consumes it). Settings UI gained a "Discover ONVIF cameras" button and a per-camera "Fetch URLs" action.

### Changed
- **SIP doorbell: real two-way audio** (was signalling-only) — `sip-server.js` previously negotiated a fake `a=inactive` SDP and never touched RTP. It now negotiates a real PCMU/8000 sendrecv answer and bridges audio via two `ffmpeg` subprocesses ([`src/sip-audio-bridge.js`](src/sip-audio-bridge.js)): RTP-in → a live MP3 stream for the dashboard to play, and the dashboard's mic capture → RTP-out back to the caller (subprocess bridging rather than a WebRTC/DTLS-SRTP gateway, since the server has no such stack — the tradeoff is latency, not call quality). New routes `GET /api/sip/listen` (proxies the live MP3) and `POST /api/sip/talk` (mic chunks in); `IncomingCall.jsx` gained a hidden autoplay `<audio>` and a "Hold to talk" button.
- **SIP doorbell registered as a proper device** — `sip/doorbell` is now in the sensor registry (ring/inCall/caller read-only, `openDoor` as a controllable trigger), giving it a dashboard tile and making it reachable from the generic Loxone XML export. Added a fixed-name alias route, `/api/loxone/sipout.xml`, for the one real "output" this integration has (opening the door).
- **SIP doorbell state mirrored into the DataStore** — previously only reachable via the REST/WebSocket API; `_emitState()` now also updates `sip/doorbell/ring` (pulses 1 only while actually ringing, not for the whole call), `sip/doorbell/inCall`, and `sip/doorbell/caller`, so `loxoneOut` and other store-driven integrations can pick it up.

---

## 2026-08-03

### Added
- **Sony Bravia (Android TV / Google TV) integration** ([`src/sony-client.js`](src/sony-client.js)) — polls power/volume/mute/input over the TV's local PSK-authenticated REST API, with optional HDMI/app input switching.
- **Denon Now Playing** — surfaced in the device modal.
- **Landroid (Worx/Kress/Landxcape) Settings card** — mirrors the Roborock cloud pattern: brand/email/password/poll-interval fields with Test Login + Save.

### Changed
- **Landroid** — reads `dat.bt.c` from the Worx API to publish `batteryState`/`batteryCharging` sensors alongside the existing battery percentage, and exposes the mower to HomeKit via the `Fanv2` service (impersonating a vacuum/fan, the same trick already used for `fan-rw`) since HomeKit has no native robot-mower accessory type — this gives it a start/stop tile in the Home app.

### Fixed
- **Landroid** — the Worx OAuth endpoint (`id.eu.worx.com`) was dead; switched to the live one.

---

## 2026-08-02

### Added
- **Object detection: red bounding boxes drawn + persisted to MongoDB** — every kept detection gets a document in the `objectDetections` collection (camera, class, score, bbox, timestamp, annotated JPEG with red boxes drawn around each kept detection) with a 7-day TTL index so it doesn't grow unbounded; no-ops without `config.mongo.uri`.
- **Object detection: per-class significance weighting** — lets some classes (e.g. a person) count for more than others (e.g. a bird) when deciding whether a frame is worth keeping — plus a **lingering heuristic** that flags an object staying in frame for an unusual duration (e.g. a possible litter event).
- **Pet breed verification** — COCO-SSD only knows 4 coarse animal classes (cat/dog/bird/horse); a second model, MobileNet (ImageNet-1000, ~120 dog breeds plus cat/bird/misc.), now runs only on the cropped region COCO-SSD already flagged, keyword-matching its top-3 class names against a per-bucket breed list (since ImageNet's label text is inconsistent enough that substring matching is the pragmatic approach). Enriches the event log, box overlay, and Mongo record with the verified breed guess (or "unverified breed match"); `objectDetection.requirePetVerification` (opt-in, default off) can require this before a detection counts.
- **HomeKit Secure Video (HKSV) recording support** — opt-in per camera (`config.cameras[].hksv`). Adds the `CameraRecordingManagement`/`CameraOperatingMode` HAP services plus a built-in Motion sensor (required for the Home app to offer HKSV setup at all), and muxes H.264 + AAC-LC (ffmpeg's native `aac` encoder, avoiding the non-free `libfdk_aac` that AAC-ELD would need) into fragmented MP4 over a loopback TCP socket, following HAP-NodeJS's own reference technique. The motion trigger is driven by object-detection's new per-camera aggregate "anything in frame" signal (`objectdetect/<slug>/any/detected`), opted into via `config.cameras[].motionSource`.
- **HomeKit two-way audio (Talk)** — a minimal hand-rolled RTSP client (`rtsp-backchannel.js`) drives the camera's existing backchannel SDP endpoint, receiving HomeKit's outgoing SRTP/Opus audio, transcoding it to PCMU, and forwarding it as plain RTP to the camera. Enabled per-camera via `config.cameras[].twoWayAudio`. Manual RTSP cameras also gained a direct in-process snapshot path, avoiding an auth-middleware round trip.
- **Cameras (dashboard): live bounding-box overlay** for detected people/pets in the modal, **detection events shown in the popup** (including pets), **detection count stats** (today / 7 days), and a **detection timeline** — a thumbnail gallery, turned into an in-modal thumbnail browser with a class filter.

### Fixed
- **ffmpeg-rtsp relay/source port collision** — found via a real outage: `config.ffmpegRtsp.basePort` was set to the same port tipc's own RTSP server used (8554). `ffmpeg-rtsp.js` tried to bind a second listen-server on that port for the same camera, failed, and retried every 2s forever — and that retry churn itself disrupted tipc's real connections (continuous "Camera not found" / "Error peeking connection" errors), degrading every consumer of that camera's stream (snapshot proxy, object detection, HomeKit) for the whole session. Now detects a loopback source whose port matches the computed listen port and skips that camera once with a clear error instead of retrying forever.

---

## 2026-08-01

### Added
- **Bang & Olufsen network speaker integration** ([`src/beosound-client.js`](src/beosound-client.js), `beosound`) — polls the local "BeoPlay App" REST API (port 8080) for power, volume, mute, and source. This legacy REST surface is kept for backward compatibility on the current Mozart platform too (Beosound Balance/Level/Emerge, Beolab 8/28/50/90, Beoconnect Core), so one client covers both older BeoPlay products and current models. Source selection needs real per-device source IDs, supplied via `config.beosound.sources` as a friendly-name → id map.
- **Local object detection (TensorFlow.js COCO-SSD) for RTSP cameras** ([`src/object-detection.js`](src/object-detection.js), `config.objectDetection.cameras`) — the counterpart to Reolink's built-in AI detection, for cameras with no on-device AI of their own (e.g. the tipc/Tuya bridge). Grabs a JPEG frame per camera every `pollInterval` seconds via `rtsp-snapshot.js`'s ffmpeg grab, runs it through COCO-SSD, and mirrors Reolink's exact device pattern: one sub-device per camera+category, a `detected` boolean sensor exposed to HomeKit as motion, auto-clearing after two poll intervals with no sighting. Auto-creates a starter Flow (trigger → notify) the first time a camera+category pair is seen — left as a notify-only stub since what to actually do about a detection belongs in the Flows editor.
- **Dashboard: camera grid + modal** added to the React (Aurora) dashboard.
- **Denon/Marantz: sound mode, sleep timer, volume step, and Zone 2 controls** — sound/surround mode select (`MS` command, curated default list, overridable via `config.denon.soundModes`); sleep timer (`SLP`, 0-120 min, 0 = off); volume up/down step triggers (`MVUP`/`MVDOWN`); an optional Zone 2 device (`config.denon.zone2`) mirroring power/volume/mute/input via `Z2*` commands. Plus volume up/down buttons, an always-visible volume % in the tile's status line, and a full-width volume slider.

### Changed
- **Camera modal made 2x bigger** (760px → 1520px, capped at 96vw instead of 100% to keep a margin on small screens); the video area scales with it.
- **One-way cameras' audio unmuted in the modal** — video stayed muted unless a two-way mic track existed, so one-way cameras (like the Tuya bridge) had audio in the stream but no sound in the browser. Opening the modal is itself a user gesture, so unmuted autoplay is allowed regardless of two-way audio; only the Talk button (sending audio back) needs a mic track.
- **RTSP-only manual cameras now get auto-generated thumbnails** — a manual `cameras[]` entry with only an RTSP url (e.g. a WHEP-only source) had no `snapshotUrl`/`mjpegUrl`, so the grid card had nothing to render even though the live WebRTC view worked in the modal. New [`src/rtsp-snapshot.js`](src/rtsp-snapshot.js) (`grabFrame` — one JPEG frame via ffmpeg) and `GET /api/camera/snapshot/:idx`, cached 10s; `GET /api/cameras` now auto-assigns this as `snapshotUrl` for any manual camera lacking one.
- **Fine-detail polish pass on small controls** — small in-tile buttons (mute, volume ±, transport controls, temp ±, RTS up/my/down) and header icon buttons brought up to the same gradient/inset-highlight/hover-lift finish as the larger surfaces, via shared `.mini-btn`/`.header-icon-btn` classes. The toggle switch gained a gradient track + jewel-cut knob, and the header's connection dot now breathes gently while live instead of sitting static.
- Settings gained an on/off toggle for the Miele and Grenton local simulators (the backend `SimulatorManager`/`/api/simulators` already existed and defaulted to disabled; there was just no UI for it).

### Fixed
- **AuxAir tile showing "off" when the device was actually on** — `acOn` only matched `pwr === 1 || pwr === true`, unlike every other on/off check in the file, which also accepts the string forms. If AuxAir's API reports `pwr` as a string, the tile (and the mode/fan panel gated behind it) stayed hidden even though the unit was running.
- **HomeKit camera: broken video stream and snapshot for RTSP-only cameras** — two separate bugs, both surfacing as "no video" for a manual camera whose source exceeded the hardcoded encode settings (1920x1080 from the tipc/Tuya bridge, in this case). `_startStream` never used the width/height HomeKit actually negotiated, so ffmpeg always encoded the source's native resolution unscaled — combined with a hardcoded H.264 level of 3.1 (max ~720p worth of macroblocks), libx264 silently rejected every frame. Fixed by scaling to the negotiated resolution and raising the level to 4.0. Separately, `prepareStream` was calling its callback with one argument (`callback(response)`) when hap-nodejs expects `callback(error, response)` — with one argument, the response object was read as a truthy, message-less error, so `_startStream` never even ran.

---

## 2026-07-30/31

### Fixed
- **AuxAir crash from calling a nonexistent `registry.getDevice()`** — `SensorRegistry` only exposes `getDevices()` (plural); `registerDevice()` already no-ops if the key is present, so the guard being removed was both wrong and redundant.
- **AuxAir `ac_mode` numbering realigned to Loxone's 1-5 convention** — AuxAir's API reports/expects mode 0-4 while Loxone counts modes 1-5; now converted at the AuxAir HTTP boundary so LSH's stored value, dashboard range, and HomeKit all use 1-5 throughout.

---

## 2026-07-28

### Added
- **MOBOTIX camera / door-station module** — JPEG snapshots, RTSP feed, and controllable outputs/door relay via the `rcontrol` HTTP API.
- **Axis camera module (VAPIX)** — JPEG snapshots, RTSP feed, PTZ via continuous move, and relay/I/O outputs, with HTTP Digest auth implemented from the 401 challenge.
- **Viessmann ViCare heating module** — OAuth2 + PKCE against the Viessmann IAM; outside/supply/boiler/hot-water temps, burner state, heating mode, and a controllable hot-water target.
- **WLED module** — addressable-LED controllers over the local JSON HTTP API, sharing Hue's light-capability model (power, brightness, RGB colour wheel, plus a white-channel slider on RGBW strips).
- Settings cards for MOBOTIX, Axis, ViCare, WLED (with a live Test button), Grenton, and Thermomix.

### Changed
- **Hue: dimming + RGBW controls** — Hue lights already reported brightness/colour-temp/hue-saturation and the write path handled `switchLevel`/`colorControl`/`colorTemperature`, but the sensors were never marked controllable, so the tile/modal sliders and colour picker couldn't dispatch. `level` is now a controllable range, `colorTemperature` drives the Kelvin slider, and a new `color` capability adds an RGB colour wheel to the Hue tile, gated to Hue devices so SmartThings/TRADFRI keep their own pickers.
- **Loxone can now bridge RGB colour from a Loxone Lighting Controller** — the XML generator previously skipped color-type sensors (the `/set` endpoint only takes a scalar, but colour needs hue+saturation), so RGB lights (Hue, WLED, TRADFRI) could export on/off, brightness, and colour-temp to Loxone but not RGB. `sendCommand` now normalises a colour value: a dashboard `{hue,saturation}` object passes through, and a scalar is decoded as Loxone's composite RGB (`r + g*1000 + b*1000000`, each 0-100) or an `'h,s'`/`'r,g,b'` string — the composite also carries brightness, so a single Loxone colour output drives hue/saturation *and* the light's level. The generator emits the `color` sensor as an analog `VirtualOutCmd` (0..100100100).
- **MOBOTIX/Axis reachability polling switched to header-only requests** — the online-status poll was calling `fetchSnapshot()` every `pollInterval`, pulling a full-resolution JPEG (100 KB-2 MB) just to set a boolean — roughly 2,880 image downloads per camera per day. Both clients now probe by requesting the snapshot but destroying the socket the instant 2xx headers arrive, so the body is never downloaded (Axis additionally completes the Digest/Basic auth handshake head-only). `fetchSnapshot()` is kept for the actual snapshot proxy and the Settings Test button.
- Settings categories rebalanced for browsing.

### Fixed
- Settings page filter was silently broken due to a stale `settings.js` cache.
- **ViCare** — guarded against unbounded 401 recursion in the API client.
- `openapi.json` regenerated for the batch of new endpoints.

---

## 2026-07-27

### Added
- **CAN bus integration** ([`src/can-client.js`](src/can-client.js)) — reads/writes a CAN bus over SocketCAN (Linux) or SLCAN (serial USB-CAN adapter), with config-driven byte-layout signal decoding. Since NMEA 2000 / Victron VE.Can and CANopen are CAN underneath, the same mapping mechanism covers them too.
- **Thermomix (Cookidoo) module** ([`src/thermomix-client.js`](src/thermomix-client.js)) — integrates a Vorwerk Thermomix TM6/TM7 through the Cookidoo platform (the device has no public local API), reproducing the community-reverse-engineered CIAM cookie login.

### Changed
- **Loxone XML export auto-splits over 40 commands and serves a ZIP** — Loxone Config rejects a Virtual Input/Output import with too many command recognitions. `buildInputsXml`/`buildOutputsXml` now return an array chunked at 40 commands per block; the `/loxone/inputs.xml`/`outputs.xml` routes serve a single `.xml` when it fits, or a `.zip` of numbered importable files when it doesn't, via a new dependency-free [`src/zip.js`](src/zip.js) (STORE method + CRC32). Verified: 95 sensors → 3 files of ≤40 commands each.
- **Docker: `automations.json` now persists** (previously written to `/app` inside the container and lost on recreate — now mounted as a volume and excluded from the image via `.dockerignore`), plus a commented, ready-to-enable **MongoDB service** (bridge net, host-only 27017, named volume) matching the `mongo` config section.
- **Aurora energy: mixes data sources per metric across brands** — the Energy section can now pull each quantity (solar/battery/grid/loads) from a different integration, e.g. PV from a Victron MPPT but the battery bank from a SolarEdge inverter. A "Sources" gear in the Energy header opens a per-metric Victron/SolarEdge toggle, persisted in `localStorage`, and only surfaces when SolarEdge is actually reporting data.

### Fixed
- Flows editor showing an empty canvas due to a stale `flows.js` cache.
- `logo.svg` missing intrinsic width/height caused it to balloon in some contexts.
- **React shell now served with `no-store` to stop stale-shell blank pages** — Safari treated `no-cache` loosely and kept serving an old `/react/index.html` that referenced a deleted (rebuilt) bundle hash, so the JS 404'd and the dashboard rendered blank. `index.html`/`manifest.json` are now served with `no-store, no-cache, must-revalidate`; the hashed assets stay immutable-cacheable.

---

## 2026-07-26

### Added
- **Visual flow automation (Node-RED style)** — a new flow engine ([`src/automation-engine.js`](src/automation-engine.js)) runs node graphs stored in `automations.json`: a message `{ payload, key }` propagates along wires and each node transforms or routes it, depth-capped against loops and reusing the existing action runners. Node types: **trigger** (store-key change, edge-triggered), **time** (repeating interval), **mqttIn** (fires on an MQTT topic), **condition** (then/else routing), **device**, **relay**, **notify** (`{value}`/`{key}` substitution), **scene**, **delay**, **mqttOut** (publish), **http** (outbound request → response becomes the next payload), and **debug** (a sink that streams the message to a live panel). The engine gained the app config, a lazy shared MQTT client with subscription reconciliation, an outbound HTTP helper, and interval management. CRUD + test-run at `/api/automation/flows`.
- **Flow editor** ([`public/flows.html`](public/flows.html) / `flows.css` / `flows.js`) — a drag-and-wire canvas: draggable node cards with inline config, drag-from-port-to-port wiring, click-to-delete wires, store-key/device autocomplete, a **toggleable snap grid**, per-flow enable, and Deploy / Test run / Delete. A **live Debug panel** (over Socket.IO) shows each tapped message (`time · name · key = value`). Reachable from a "Flows" nav link.
- **Debug node + panel**, **Time / MQTT In / MQTT Out / HTTP nodes**, and the **snap grid toggle** (persisted in localStorage).

### Changed
- **Aurora (the React dashboard) is now the primary dashboard** — `/` and `/index.html` redirect to `/react/`, the classic home page is replaced, the classic sub-pages' "Dashboard" nav points at Aurora (the redundant "Aurora" link removed), and Aurora's header gained a "Flows" link. The old `index.html` is kept, unreferenced, for easy rollback.
- **Unified the classic pages with the Aurora look** — the Flows and Settings pages now render in the vivid "electric glass" palette (deep blue-violet ground, aurora + film grain, glassy pill header, accent-gradient buttons, glowing controls). The flow node cards, colour-coded glowing wires with a travelling-light animation, and specular tile sheen match the React design system. The palette + critical layout are inlined so these pages render correctly even when their external CSS is slow or cached-stale.
- **Home plan** — bigger, bolder accent-tinted room outlines (1.5px → 3px) with a glow, taller/more solid 3D walls (20px → 30px), and stronger hover/focus states.
- **Device modal toggle enlarged, Home-Assistant style** — the on/off switch grew from 52×58 to a large 116×58 pill with a power glyph on the thumb and a stronger on-state glow.

### Fixed
- **A failing flow node no longer crashes the server** — node execution is wrapped so a bad device key, unreachable MQTT broker, or failed HTTP request logs a warning and stops that branch instead of throwing an unhandled rejection.
- **Stale-CSS rendering on the classic pages** — bumped the asset cache-bust version (`?v=2` → `?v=3`) so browsers fetch fresh stylesheets, resolving the intermittent under-styled header / ballooning-logo caused by Safari serving cached CSS.

---

## 2026-07-25

### Added
- **Node-RED-style visual flow automation** — a flow engine in [`src/automation-engine.js`](src/automation-engine.js) executes node graphs (stored in `automations.json` alongside rules/scenes): a `trigger` node fires on a matching store-key change (edge-triggered) and a message `{ payload, key }` propagates along wires, with node types `trigger`, `condition` (then/else routing), `device`, `relay`, `notify` (`{value}`/`{key}` substitution), `scene`, and `delay`; depth-capped against loops and reusing the existing action runners. New visual editor ([`public/flows.html`](public/flows.html) / `flows.css` / `flows.js`) with draggable node cards, drag-to-wire ports, click-to-delete wires, store-key/device autocomplete, and Deploy / Test run / Delete. A **toggleable snap grid** (dots + lines, persisted in localStorage) snaps nodes to 22px. CRUD + test-run at `/api/automation/flows`; a "Flows" link added to the classic header nav.
- **Optional MongoDB persistence** for the DataStore — [`src/mongo.js`](src/mongo.js) plus a `mongo` config section (`MONGO_URI`/`MONGO_DB` env overrides). When set, the snapshot (values + history) is stored as one document in the `store` collection; the gzipped-JSON file stays as a synchronous, shutdown-safe fallback. Settings → MongoDB Storage card with masked URI + Test Connection.
- **Fibaro outbound push** ([`src/fibaro-out-client.js`](src/fibaro-out-client.js)) — the counterpart of the Fibaro client and of `loxoneOut`: pushes live store values (e.g. Satel zones) to Home Center global variables, exact `storeKey`→`variable` or bulk `storePrefix`→`variablePrefix`. Settings card with a structured mapping editor.
- **Settings → Interface** option to hide the MQTT / Logs links in the top navigation (`config.ui`, served via `/api/ui-prefs`).
- **"Aurora"** link in the classic header nav opening the React dashboard (`/react/`).

### Changed
- **UniFi Protect** migrated to the official **Integration API** (`/proxy/protect/integration/v1`, `X-API-Key`) with a real-time `/subscribe/events` WebSocket for doorbell rings, camera motion and sensor open/close (auto-reconnect with backoff); the legacy cookie-login + polling mode is kept as a fallback for consoles without an API key.
- **React dashboard vivid rebuild** — a saturated "electric glass" palette (deep blue-violet ground, brighter accents/status colours, colored glows), **per-category tile colours** (lighting amber, climate coral, security rose, media violet, sensors teal, Victron green…), and every hardcoded legacy accent literal moved to design tokens so a single change re-themes both light and dark.
- **Home plan** — bigger, bolder accent-tinted room outlines (1.5px → 3px) with a glow, taller/more solid 3D walls (20px → 30px), stronger hover/focus states.
- **Renamed the product to "Lightweight Smart Home"** (a backronym for LSH) across the web UIs, React dashboard + PWA, macOS client, OpenAPI title and docs; technical identifiers (package names, the PM2 app `lsh`, bundle id, `lsh-session` cookie, store keys, and the Loxone token client id) deliberately unchanged.

### Fixed
- Auth pages (`login.html`/`setup.html`) and the classic dashboard pages (`index`/`settings`/`logs`/`mqtt`) no longer render with a screen-filling logo when the browser serves stale/partial CSS: inline `width`/`height` on every SVG, cache-busted stylesheet links (`?v=2`), and a critical inline `<style>` that keeps the layout sane even if the external CSS fails to load.

---

## 2026-06-25 (3)

### Added
- **Suppla** (`src/suppla-client.js`) — REST API integration for the Suppla smart-home platform (cloud.supla.org or self-hosted). Discovers all channels via `GET /api/v2.4.0/channels` and groups them by physical ioDevice into one dashboard card per device. Supported channel types: `LIGHTSWITCH`/`POWERSWITCH` → toggle, `DIMMER`/`RGBLIGHTING` → brightness slider, `CONTROLLINGTHEROLLERSHUTTER` → position slider, `CONTROLLINGTHEGARAGEDOOR`/`GATEWAY` → open/close toggle, `THERMOMETER` → °C readout, `HUMIDITYANDTEMPERATURE` → combined temp+humidity pair, `OPENCLOSESENSOR` and binary types → read-only indicator, `ELECTRICITYMETER` → power + energy. Commands sent via PATCH `/channels/{id}` with appropriate action (`TURN_ON`, `SET_RGBW_PARAMETERS`, `OPEN`, `REVEAL_PARTIALLY`, etc.). Polled every 30 s (configurable). `SuplaIcon` added to React icon set. Test-connection endpoint probes `/api/v2.4.0/server-info`.

---

## 2026-06-25 (2)

### Added
- **Arduino / Generic MQTT** (`src/arduino-client.js`) — subscribe to any MQTT topic and map JSON fields to dashboard sensor readings or controllable outputs. Supports read-only sensors, toggle switches (with configurable `payloadOn`/`payloadOff`), and range sliders. Works with Arduino (PubSubClient), ESP32/ESP8266, Tasmota custom firmware, or any device publishing JSON over MQTT. Device-level JSON topic or per-sensor individual topics both supported. Commands published as raw payload (per-sensor topic) or JSON object (device-level topic). Settings card with broker connection fields and a JSON textarea for the device+sensor list. `ArduinoIcon` added to React icon set. Hardware docs updated with Arduino/ESP32 as the recommended sensor node platform.

---

## 2026-06-25

### Added
- **Sonos** (`src/sonos-client.js`) — UPnP/SOAP local control for Sonos speakers (port 1400). Auto-discovers all Zone Players via SSDP multicast (`M-SEARCH` → `ZonePlayer:1`); manual IPs also supported. Polls play state, volume, mute, and current track/artist from DIDL-Lite every 5 s. Commands: play/pause, previous, next, set volume, mute. Dashboard: Media category tile with play/pause button, ⏮/⏭ + mute row, volume slider, track + artist display. Room name taken from `/xml/device_description.xml`.
- **Denon AVR** (`src/denon-client.js`) — Telnet ASCII control for Denon and Marantz AV receivers (port 23). Connects on startup, parses unsolicited PW/MV/MU/SI pushes in real time, polls every 30 s. Reconnects in 15 s on disconnect. Supports power on/standby, master volume (including half-dB steps), mute, and input selection. `inputs[]` config drives interactive selection pills on the dashboard tile. Test-connection endpoint probes TCP and reports power state. Dashboard: Media category tile with power toggle, input pills (active highlighted), mute button, volume slider.
- **Settings → Sonos** card: IP list textarea, auto-discover checkbox, poll interval.
- **Settings → Denon AVR** card: host, display name, max volume, inputs textarea, Save + Test connection.
- **Media category** in React dashboard sidebar/pills for Sonos and Denon tiles.
- **`SpeakerIcon`** and **`DenonIcon`** added to icon set.

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
