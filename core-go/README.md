# LSH core in Go

A Go replacement for the Node core process: store, device registry, auth, core
REST routes, Socket.IO and the module host. **Integrations stay in Node,
unchanged**: each one runs as `src/module-worker.js` in its own process, as with
`modules.isolate` today. The Go host talks to the worker over Node's own IPC
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

Running it next to the Node core with `-modules all` polls every integration
twice. Some cloud logins don't allow that: OAuth refresh-token rotation,
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

`GET /api/core` reports the Go process's own memory and counts.

## Not yet in the Go core

Every other `/api/*` route answers `501 Not in the Go core yet`. Next steps, roughly in order:

- **Automation engine** (`automation-engine.js`: rules, scenes, flows). Scenes return `[]` for now.
- **Victron connection manager / relays** (MQTT → VRM fallback). Inline in `server.js`, not a module.
- **Integrations with `expose`** (tuya, shelly, lgthinq, …). They run here as plain workers: devices work, their REST routes don't.
- **Inline integrations from `server.js`**: Loxone in/out, Fibaro out, cameras, SIP, paging, HomeKit bridge. The plan is to run each as its own Node process, as with the modules.
- **Device customisation writes** (`setOverride`, rooms, plan decor): the overrides are read-only here.
- **Server-side label translation** (`server-i18n.js`): only matters when `config.language` is not English.
- **Settings, users and tokens administration, MCP, Mongo history.**
