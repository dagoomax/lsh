# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LSH ("LoxoneSwaggerHelper") — a Node.js smart-home hub. It began as a Victron Energy dashboard and now integrates ~40 platforms (Victron, Loxone, KNX, Shelly, Sonos, IKEA, Roborock, UniFi Protect, SIP doorbells, …), exposing them through a web dashboard, REST API, Socket.IO, HomeKit, and Loxone virtual inputs/outputs.

Plain CommonJS Node — no build step, no transpiler, **no tests, no linter**. The only compiled part is the React dashboard.

## Commands

```bash
npm start                  # run server (node server.js), default port 3001
npm run openapi            # regenerate public/openapi.json after changing API routes (Swagger UI at /api-docs)
npm run pm2:restart        # production restart (PM2 app name: "lsh")
npm run pm2:logs           # tail production logs

cd react-dashboard
npm run dev                # Vite dev server for the React dashboard
npm run build              # build to dist/
```

**`react-dashboard/dist/` is committed** — the server serves it directly at `/react/`. After changing React code, run `npm run build` and commit the dist output.

`config.json` is gitignored (copy from `config.example.json`). It is read at startup and **rewritten live by the Settings page**, so it may not match `config.example.json`'s shape. `persist/` holds HomeKit pairing, users, API tokens, and the sensor-data snapshot — never delete it on a live install.

There is no automated test suite; verify changes by running the server and watching `logs/*.log` (per-category structured logs — `src/logger.js` patches `console` and must stay the first require in `server.js`).

## Architecture

`server.js` is the composition root. It builds the core spine, then conditionally starts each integration client only if its `config.json` section exists (via `tryRequire`, so a missing optional dependency logs a warning instead of crashing).

### Core spine (everything flows through these)

- `config.js` — loads `config.json`, spreads it through, applies env-var overrides for curated keys (mqtt/vrm/solaredge/…)
- `src/data-store.js` — `DataStore`: central EventEmitter key→value store with a per-key history ring buffer (~6 h) and gzipped persistence to `persist/store-data.json.gz`
- `src/sensor-registry.js` — `SensorRegistry`: device catalog. Victron devices are auto-discovered from store keys via `device-definitions.js` (`KNOWN_SERVICES`); all other integrations call `registerDevice()` explicitly
- `src/connection-manager.js` — Victron data source with automatic MQTT (local Venus OS) → VRM (cloud) fallback; emits `source-changed`, which re-points `relay-controller.js` at the active client
- `src/api-routes.js` — all REST endpoints under `/api`
- `src/websocket.js` — Socket.IO: auth on handshake, sends `snapshot`/`devices`/`platform-status` on connect, then batched `update` events debounced per tick
- `src/auth.js` — JWT cookie sessions + long-lived API bearer tokens; first run redirects to `/setup.html`

### Integration client pattern

Every `src/*-client.js` follows the same shape — copy an existing one (e.g. `shelly-client.js`) when adding a platform:

1. `constructor(config, store, sensorRegistry)`, `async start()`, `stop()`
2. Build a device descriptor `{ key: 'platform/id', label, icon, sensors: [...] }` and call `sensorRegistry.registerDevice(device)`
3. Push readings with `store.set('platform/id/Path', value)` — the websocket layer broadcasts changes automatically
4. For controllable sensors, mark them `controllable` and attach `device._writeCapability(capabilityId, command, args)` — `SensorRegistry.sendCommand()` (called by `POST /api/device/:key/command` and HomeKit) dispatches through it
5. Report health via `platform-status.js` (`platformStatus.set('platform', true)`) — shown in the UI platform bar
6. Wire it into `server.js` gated on its config section; clients needing REST routes get added to the `apiClients` object passed to `createApiRoutes`

### Frontends (two of them)

- `public/` — vanilla JS pages: classic dashboard (`index.html`/`app.js`), Settings (edits config.json live), Logs, MQTT explorer, login/setup
- `react-dashboard/` — Vite + React PWA served at `/react/`; talks to the same REST API + Socket.IO (`src/hooks/useLSH.js`, `useSocket.js`)

### Loxone is bidirectional

`loxone-client.js` pulls data in from a Miniserver; `loxone-out-client.js` pushes LSH values out to Loxone virtual inputs via configured `loxoneOut.mappings`; `/api/loxone/inputs.xml|outputs.xml` serve Loxone-compatible templates.

### HomeKit

`homekit-bridge.js` (hap-nodejs) exposes registry devices, relays, cameras (`homekit-camera.js` + `ffmpeg-rtsp.js`), and automation. Requires host networking / mDNS in Docker (`network_mode: host`).

## Documentation

- `README.md` — huge; the per-integration `config.json` reference lives there (one `###` section per platform)
- `wiki/` — architecture and per-module docs (`Module-*.md`)
- `docs/` — integration-specific notes (Loxone APIs, Satel, Somfy, UniFi door station)
- `scripts/` — one-off auth/token bootstrap helpers for cloud integrations (Dirigera, Roborock, Xiaomi, Somfy)
