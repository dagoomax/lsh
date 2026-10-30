# LSH core in Go

A Go replacement for the Node core process: store, device registry, auth, core
REST routes, Socket.IO and the module host. **Integrations stay in Node,
unchanged**: each one runs as `src/module-worker.js` in its own process, as with
`modules.isolate` today. `module-worker.js` gained one message, `call` (a public method of the client,
for routes that used to call the client object directly). Everything else
about it is as before. The Go host talks to the worker over Node's own IPC
channel (`NODE_CHANNEL_FD` + JSON serialization on a socketpair), so the worker
can't tell the difference.

```bash
cd core-go
go build -o lsh-core .
./lsh-core -root .. -port 3002                         # every configured integration
./lsh-core -root .. -modules none                      # core only
./lsh-core -root .. -modules sofar-client,miele-client # chosen ones
./lsh-core -root .. -modules testdata/fake-client.js   # test integration
go test ./...                                          # runs the real Node worker
```

It reads `config.json` (through `config.js`, via `node/integrations.js`, which
also evaluates the `when` predicates in `src/integrations.js`) and the `persist/`
files `users.json`, `api-tokens.json` and `device-overrides.json`. JWT sessions
are signed with `config.jwtSecret`, so a session from the Node core works here
too. The store snapshot goes to `core-go/data/`, seeded from
`persist/store-data.json.gz` on first start, so both cores can run side by side.

`victron_test.go` runs the Victron path against a fake Venus OS broker
(`testdata/fake-venus.js`, aedes) and a fake VRM API, covering portal
discovery, keepalive, relay writes, VRM login, re-auth after 401, attribute
mapping, and the switch MQTT → VRM → MQTT.

Loxone/Fibaro tests: `loxone_test.go` builds the XML exports with the real
`loxone-xml.js` / `zip.js` and the Go port and requires identical output: every
Victron device type plus odd sensor shapes, optionally a real `/api/devices`
dump via `LSH_XML_DEVICES=<file>`. It also runs Loxone Out and Fibaro Out against
fake servers: debounce, dedupe, retry after failure, 401/404, 409 on create,
`encodeURIComponent` / UTF-16 cuts checked against Node. `loxone_in_test.go`
runs the real `loxone-client.js` in a module process against a fake Miniserver:
token-auth hash, `LoxAPP3.json`, binary value events, commands.
`settings_test.go` checks a save keeps `config.json`'s order, masked password,
mode and `.bak`.

Running it next to the Node core gives the Victron connection a second MQTT
client, or a second VRM login polling every 15 s. Both are harmless. With
`-modules all` it also polls every integration twice. Some cloud logins don't allow that: OAuth refresh-token rotation,
single-session MQTT. Stop the Node core first, or choose modules.

## Ported

| Node | Go |
| --- | --- |
| `src/data-store.js` (values, 6 h history ring, gzip snapshot) | `store.go` |
| `src/sensor-registry.js` (devices, overrides, readings, sendCommand, colour normalisation) | `registry.go` |
| `src/platform-status.js` | `platform.go` |
| `src/auth.js` request path (users, API tokens, JWT cookie, login throttling, first-run setup) | `auth.go` |
| `src/websocket.js` (snapshot / devices / rooms / platform-status / batched update) | `socketio.go`, `api.go` |
| `src/module-host.js` (watchdog, memory limit, backoff, commands, change forwarding) | `modules.go` |
| routes: auth (setup/login/logout/me), status, connection, devices, device command/set, history, modules/processes | `api.go` |
| `/react/` dashboard, `public/` assets | `api.go` |
| `src/automation-engine.js`: rules, scenes, notifications, flows (all 22 node types), time/MQTT triggers | `automation.go` |
| `src/routes/automation.js` (rules / scenes / flows / notifications, flow snapshots, flow Loxone XML) | `automation_api.go` |
| `src/connection-manager.js`, `mqtt-client.js`, `vrm-client.js`, `relay-controller.js`: Venus MQTT with VRM cloud fallback and back, relays, `/api/connection`, `/api/relays`, `POST /api/relay/:index/state` | `victron.go` |
| Victron device auto-discovery from store keys (`device-definitions.js`, passed in by `node/integrations.js`) | `registry.go` |
| Loxone In (`src/loxone-client.js`) runs **unchanged as a module process**; started when `config.loxone.host` is set | `loxone_api.go` |
| SmartThings (`src/smartthings-client.js`) runs **unchanged as a module process**. Its routes (webhook, camera snapshot / image proxy / capture / presets, Settings test / save, token) and the 24 h OAuth token delivery are Go, calling the client's `getToken` / `handleWebhookEvent` through the module channel's `call` message | `smartthings_api.go` |
| `src/loxone-out-client.js`: store → Miniserver Virtual Inputs | `loxone_out.go` |
| `src/fibaro-out-client.js`: store → Home Center global variables | `fibaro_out.go` |
| `src/loxone-xml.js` + `src/zip.js`, and the routes `/api/loxone/inputs.xml`, `outputs.xml`, `sipout.xml`, `scenes.xml` | `loxone_xml.go`, `loxone_api.go` |
| Settings: `test-loxone`, `loxone`, `loxone-out` (+ `/test`, `/suggestions`), `fibaro-out`, `test-fibaro-out` — saves apply at once (Loxone In restarts, the out bridges are rebuilt) | `loxone_api.go` |
| `writeConfigFile()` (atomic, `.bak`, symlink-aware, mode kept, key order kept) | `configfile.go` |
| JSON key order (Loxone Virtual Input checks match `/api/devices` text) | `omap.go` |
| JS `Number()` / `String()` / `undefined` semantics used by flows | `jsval.go` |

The engine runs `-automations` (default `core-go/data/automations.json`, seeded
from the checkout's `automations.json`), so editing flows in the Go core doesn't
touch the Node core's file. `http` saveAs files and `loxoneXml` files go to
`core-go/data/flow-snapshots/` and `core-go/data/flow-loxone/`.

`automation_test.go` runs each scenario through the real Node engine
(`testdata/engine-harness.js`) and through the Go one and requires identical
traces: commands, notifications, store writes, debug taps, flow devices, saved
JSON, Loxone XML. That covers every comparison operator × 10 thresholds × 21
payload types. `roundtrip_test.go` checks the real `automations.json` saves back
byte for byte.

Known differences from the Node engine:

- `page` actions/nodes fail with a notification, because paging isn't in the
  Go core yet.
- `extract` uses Go's RE2 regex engine: no lookbehind, no backreferences.
  Patterns that use them fail with "Bad regex".
- `{value}` substitution is literal: JS `String.replace` would expand `$&` / `$1`
  inside a payload.
- `http` nodes: 10 s to connect and receive headers, 70 s for the whole
  response. Node used a 10 s idle timeout.
- `POST /api/settings/smartthings` keeps the OAuth fields (`clientId`,
  `clientSecret`). Node's save rebuilt the section from token / deviceIds /
  webhook fields only, which dropped them. The save also applies at once:
  the module restarts.
- SmartThings `take` doesn't write the camera event log yet (camera-log
  isn't ported).
- Loxone: the `cameras-discovered` event (VideoIntercom → HomeKit camera) has
  no listener until the HomeKit bridge is ported.
- `outputs.xml` with a string `min`/`max` on a range sensor works in Go. Node
  throws `toFixed is not a function` there and the export fails.
- `POST /api/automation/scenes/:id/homekit` isn't ported (no HomeKit bridge
  yet). `inHomekit` is always false.

`GET /api/core` reports the Go process's own memory and counts.

## Not yet in the Go core

Every other `/api/*` route answers `501 Not in the Go core yet`. Next steps, roughly in order:

- **Integrations with `expose`** (tuya, shelly, lgthinq, …). They run here as plain workers: devices work, their REST routes don't.
- **Inline integrations from `server.js`**: cameras, SIP, paging, HomeKit bridge, Loxone Weather. The plan is to run each as its own Node process, as with the modules.
- **The rest of the Settings routes**, including `GET /api/settings`: the Settings page can't load its forms from the Go core yet.
- **Device customisation writes** (`setOverride`, rooms, plan decor): the overrides are read-only here.
- **Server-side label translation** (`server-i18n.js`): only matters when `config.language` is not English.
- **Settings, users and tokens administration, MCP, Mongo history.**
