# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LSH ("Lightweight Smart Home") — a Node.js smart-home hub. It began as a Victron Energy dashboard and now integrates ~55 platforms (Victron, Loxone, KNX, Shelly, Sonos, IKEA, Roborock, UniFi Protect, SIP doorbells, …), exposing them through a web dashboard, REST API, Socket.IO, HomeKit, and Loxone virtual inputs/outputs.

Plain CommonJS Node — no build step, no transpiler, no linter; a small `node --test` suite (`npm test`, `test/`). The only compiled part is the React dashboard.

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

`config.json` is gitignored (copy from `config.example.json`). It is read at startup and **rewritten live by the Settings page**, so it may not match `config.example.json`'s shape. Server-side writes go through `writeConfigFile()` in `src/config-file-cache.js` (atomic temp+rename, keeps `config.json.bak`; `config.js` starts from the `.bak` if `config.json` is invalid JSON). `persist/` holds HomeKit pairing, users, API tokens, and the sensor-data snapshot — never delete it on a live install.

`npm test` covers a few units (`test/*.test.js`); beyond that, verify changes by running the server and watching `logs/*.log` (per-category structured logs — `src/logger.js` patches `console` and must stay the first require in `server.js`).

## Architecture

`server.js` is the composition root. It builds the core spine, then conditionally starts each integration client only if its `config.json` section exists (via `tryRequire`, so a missing optional dependency logs a warning instead of crashing).

### Core spine (everything flows through these)

- `config.js` — loads `config.json`, spreads it through, applies env-var overrides for curated keys (mqtt/vrm/solaredge/…)
- `src/data-store.js` — `DataStore`: central EventEmitter key→value store with a per-key history ring buffer (~6 h) and gzipped persistence to `persist/store-data.json.gz`. If `config.mongo.uri` is set it persists the snapshot to MongoDB instead (via `src/mongo.js`), keeping the gzip file as a synchronous shutdown-safe fallback. Every `set()`/`update()` emits `change` `{ key, value, changed }` — `changed` is false when a primitive value repeats the stored one (most polling traffic); listeners that push values out should skip repeats (`websocket.js` does) or dedupe per target (`loxone-out-client.js`, `fibaro-out-client.js`)
- `src/sensor-registry.js` — `SensorRegistry`: device catalog. Victron devices are auto-discovered from store keys via `device-definitions.js` (`KNOWN_SERVICES`); all other integrations call `registerDevice()` explicitly
- `src/connection-manager.js` — Victron data source with automatic MQTT (local Venus OS) → VRM (cloud) fallback; emits `source-changed`, which re-points `relay-controller.js` at the active client
- `src/api-routes.js` — builds the `/api` router: shared middleware (`requireAdmin`, …) and a `ctx` object, then registers `src/routes/*.js` in `ROUTE_GROUPS` order (Express matches in registration order — keep it). Each route file exports `register(router, ctx)`; shared helpers live in `src/routes/helpers.js`
- `src/websocket.js` — Socket.IO: auth on handshake, sends `snapshot`/`devices`/`platform-status` on connect, then batched `update` events debounced per tick
- `src/auth.js` — JWT cookie sessions + long-lived API bearer tokens; first run (no users) answers `/api` with 503 `{ setupRequired: true }` and the React app shows its SetupScreen; sign-in is the in-app LoginScreen

### Integration client pattern

Every `src/*-client.js` follows the same shape — copy an existing one (e.g. `shelly-client.js`) when adding a platform:

1. `constructor(config, store, sensorRegistry)`, `async start()`, `stop()`
2. Build a device descriptor `{ key: 'platform/id', label, icon, sensors: [...] }` and call `sensorRegistry.registerDevice(device)`
3. Push readings with `store.set('platform/id/Path', value)` — the websocket layer broadcasts changes automatically
4. For controllable sensors, mark them `controllable` and attach `device._writeCapability(capabilityId, command, args)` — `SensorRegistry.sendCommand()` (called by `POST /api/device/:key/command` and HomeKit) dispatches through it
5. Report health via `platform-status.js` (`platformStatus.set('platform', true)`) — shown in the UI platform bar
6. Wire it up: if it's just construct-and-start, add an entry to `src/integrations.js` (`file`, `label`, `when: (config) => …`, optional `expose` for an `apiClients` key); otherwise write it out inline in `server.js`. REST routes go in a new `src/routes/<name>.js` added to `ROUTE_GROUPS`
   - Polling clients should extend `src/polling-client.js` (`PollingClient`): it owns the schedule, overlap guard, backoff and `platformStatus` — implement `_pollImpl()` and throw when a poll didn't really return data
7. Run `node scripts/gen-modules-manifest.js` — regenerates `modules.json` and moves the client's npm deps out of `package.json` (then `npm install --package-lock-only`)

### Integration processes

Every entry in `src/integrations.js` without an `expose` runs in its own child process: `src/module-host.js` forks `src/module-worker.js` per module, and the worker constructs the client with stand-ins for the store and registry that forward over IPC (`store.set` → the real DataStore; `registerDevice` → the real SensorRegistry with a `_writeCapability` that calls back into the process; `platform-status` mirrored; store `change` events forwarded only once the client listens). A watchdog pings each process every 10 s and restarts one that exits, stops answering for 30 s, or exceeds `config.modules.memoryLimitMB` (default 512), with backoff. `GET /api/modules/processes` / `POST /api/modules/processes/:id/restart` (Settings → Integration Modules). Modules with `expose` stay in the server process because their REST routes call the client object directly. `config.modules.isolate: false` turns isolation off; `config.modules.inProcess: ['<file>' | '<label>']` keeps single modules in-process. A module that only works through the shared object (mutating another module's device, reading `sensorRegistry.getDevices()` for devices it didn't register) needs `inProcess` or an `expose`.

### Integration modules (on-demand install)

A fresh install (`scripts/install.sh`) ships only the core: the files in `modules.json` → `core` plus core npm deps. Every other integration is fetched from GitHub (`dagoomax/lsh`, tag `v<package.json version>`, falling back to `main`) by `src/module-manager.js` — automatically at startup when its `when` condition (the exact `if (…)` guard from `server.js`) matches `config.json`, or from Settings → Integration Modules (`GET /api/modules`, `POST /api/modules/:id/install`). Module npm deps are installed `--no-save`; the installed set is tracked in `persist/modules.json`. `config.modules.autoInstall: false` disables startup fetching; `config.modules.githubToken` / `GITHUB_TOKEN` raises the GitHub API rate limit.

### Frontend

`react-dashboard/` — Vite + React PWA served at `/react/`, the only UI. Talks to the REST API + Socket.IO (`src/hooks/useLSH.js`). Full-page views each have a URL (`/react/settings`, `/react/flows`, `/react/logs`, `/react/mqtt`, …; `VIEWS` in `App.jsx`); the old classic page URLs (`/settings.html`, `/login.html`, …) 301 to them. `public/` now only holds assets the React app references (logo, floor-plan SVGs) and the Swagger UI files for `/api-docs`.

Settings text is written in plain English and translated by its English wording: the Settings primitives (`SettingsCard`, `Field`, `Button`, …) pass text props through `tr()`, and other text is wrapped in `tr('…')` (`node react-dashboard/scripts/settings-phrases.mjs wrap --write` does it for bare JSX text). Translations live in `react-dashboard/src/i18n/settings/book-*.js` (English → pl, de, fr, es, it, uk; brand names in `SAME`), loaded only when Settings opens in another language. After adding Settings text, `node react-dashboard/scripts/settings-phrases.mjs missing` lists what needs translating, then `scripts/gen-settings-book-index.sh` if you add a part; `test/settings-i18n.test.js` fails on gaps.

### Loxone is bidirectional

`loxone-client.js` pulls data in from a Miniserver; `loxone-out-client.js` pushes LSH values out to Loxone virtual inputs via configured `loxoneOut.mappings`; `/api/loxone/inputs.xml|outputs.xml` serve Loxone-compatible templates. `fibaro-out-client.js` is the same pattern toward Fibaro Home Center: `fibaroOut.mappings` (exact `storeKey`→`variable` or bulk `storePrefix`→`variablePrefix`) push store values to HC global variables.

### HomeKit

`homekit-bridge.js` (hap-nodejs) exposes registry devices, relays, cameras (`homekit-camera.js` + `ffmpeg-rtsp.js`), and automation. Requires host networking / mDNS in Docker (`network_mode: host`).

## Documentation

- `README.md` — huge; the per-integration `config.json` reference lives there (one `###` section per platform)
- `wiki/` — architecture and per-module docs (`Module-*.md`)
- `docs/` — integration-specific notes (Loxone APIs, Satel, Somfy, UniFi door station)
- `scripts/` — one-off auth/token bootstrap helpers for cloud integrations (Dirigera, Roborock, Xiaomi, Somfy)
