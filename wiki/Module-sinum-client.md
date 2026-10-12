# `src/sinum-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~294 lines**

Integrates a **TECH Sterowniki Sinum** central unit (EH-01) through its local REST API ([apidocs.sinum.tech](https://apidocs.sinum.tech/)). No cloud, no npm dependencies.

**Auth:** an **API token** created in the Sinum web panel (recommended — never expires), or a local user's `username` + `password` (`POST /api/v1/login` → JWT `session`, logged in again on a 401). All responses are wrapped in `{ data }`.

**Discovery & polling:** every `pollInterval` s (default 10) the buses `virtual`, `wtp` (TECH Wireless), `sbus`, `slink`, `lora`, `modbus` are read one after another (the hub's firmware handles parallel requests badly); a bus the hub doesn't have (404) is dropped. `408` (bus busy) is retried once after 1 s. Rooms and scenes are re-read every ~5 min.

**Devices:** one LSH device per Sinum device, key `sinum/<bus>-<id>`, placed in its Sinum room:

| Sinum type | LSH readings / controls | HomeKit |
|---|---|---|
| `thermostat`, `temperature_regulator` | `temperature`, `heatingSetpoint` (5–35 °C), `humidity`, mode, state | Thermostat |
| `relay`, `relay_integrator` | `switch` | Switch |
| `dimmer`, `rgb_controller`, `dimmer_rgb_*` | `switch`, `level` (0–100) | Lightbulb |
| `blind_controller(_integrator)` | `level`, `windowShade` open/close, `stop` | Window covering |
| `gate` / `wicket` | `state`; `open` / `close` / `stop` / `unlock` triggers | — |
| temperature, humidity, motion, opening, flood, smoke, two-state input sensors | readings | matching sensors |
| anything else | its numeric / on-off fields, read-only | — |

Temperatures and humidity arrive ×10 (`220` = 22.0 °C). Scenes become `sinum/scenes` (one trigger each, `POST /api/v1/scenes/<id>/activate`).

**Write path:** `PATCH /api/v1/devices/<bus>/<id>` — e.g. `{ "target_temperature": 235 }`, `{ "state": true, "brightness": 40 }`, `{ "command": "open", "opening_percentage": 30 }`, `{ "command": "full_open" }`. The PATCH response is applied immediately.

**Settings:** Settings → Smart Home → **TECH Sinum** (Test Connection / Save; token and password masked). First setup starts the client at once; changing a running hub needs a restart.

**Testing:** `node scripts/sinum-simulator.js 8890` (token `simtoken`, or admin / admin), `test/sinum.test.js`. Built from the Sinum API docs — not yet verified against a real hub.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SinumClient` (extends `PollingClient`), `TYPES` |
| Config section(s) | `sinum` — `host`, `token` \| `username` + `password`, `pollInterval`, `buses` |
| Platform-status key | `sinum` |
| Registers devices | yes — `sinum/<bus>-<id>`, `sinum/scenes` |
| Internal deps | `polling-client` |
| Routes | `src/routes/sinum.js` — `POST /api/settings/test-sinum`, `POST /api/settings/sinum` |

See the [Configuration Reference](Configuration) for the `sinum` section.

---

*Extracted from `src/sinum-client.js`. Source is authoritative — regenerate this page if the module changes.*
