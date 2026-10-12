# `src/vclu-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~231 lines**

Integrates **[vCLU](https://github.com/Domktorymysli/vclu)** (Virtual CLU — Grenton CLU emulator with Lua automations, Satel, MQTT, HomeKit). No npm dependencies.

**Transport:** vCLU's **MCP endpoint** — `POST /mcp`, stateless Streamable HTTP, JSON-RPC `tools/call` (JSON or one-event SSE replies). vCLU's REST API can only read its registry; MCP is the supported way to control devices.

**Auth:** an **MCP bot token** from the vCLU web UI (**MCP → Add bot**), sent as `Authorization: Bearer …`. The bot's access profile in vCLU decides what LSH sees and may control; objects the bot may only read come in read-only.

**Tools used:** `vclu_devices` (polled every `pollInterval` s, default 5 — one call returns every exposed object with its state), `vclu_device_set`, `vclu_device_execute`, `vclu_scenes`, `vclu_scene_execute`.

**Devices:** each exposed object becomes `vclu/<path>` (`:` in a path becomes `_`) in its vCLU **area**:

| vCLU type | LSH readings / controls | HomeKit |
|---|---|---|
| `switch` | `switch` | Switch |
| `light`, `dimmer` | `switch`, `level` (dimmer 0..1 shown as %; `setBrightness` / `switchOn` / `switchOff` when the object has them) | Lightbulb |
| `cover` | `level` 0–100, `windowShade`, `stop` (if the object has `stop`) | Window covering |
| `lock`, `garage_door`, `number`, `fan` | lock / open / value / speed | Lock (for `lock`) |
| `temperature`, `humidity`, `illuminance`, `climate` | readings (`climate` = current temperature, read-only) | Temperature / humidity |
| `motion`, `sensor`, `binary_sensor` | `state` | Motion (for `motion`) |

Scenes become `vclu/scenes` (one trigger each). A set is reflected immediately from vCLU's `new_state` read-back.

**Settings:** Settings → Smart Home → **vCLU** (address, default port 8080; bot token; Test Connection / Save).

**Testing:** `node scripts/vclu-simulator.js 8891` (token `simbot`), `test/vclu.test.js`. Written from vCLU's MCP tool definitions (no vCLU code copied — vCLU is BSL 1.1) — not yet verified against a real vCLU.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class VcluClient` (extends `PollingClient`), `TYPES` |
| Config section(s) | `vclu` — `host`, `token`, `pollInterval` |
| Platform-status key | `vclu` |
| Registers devices | yes — `vclu/<path>`, `vclu/scenes` |
| Internal deps | `polling-client` |
| Routes | `src/routes/vclu.js` — `POST /api/settings/test-vclu`, `POST /api/settings/vclu` |

See the [Configuration Reference](Configuration) for the `vclu` section.

---

*Extracted from `src/vclu-client.js`. Source is authoritative — regenerate this page if the module changes.*
