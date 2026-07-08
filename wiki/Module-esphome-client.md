# `src/esphome-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~295 lines**

Integrates **ESPHome** ESP32/ESP8266 devices via their built-in **HTTP REST API** (the `web_server:` ESPHome component).

**Entity discovery:** On startup, connects to the SSE stream at `http://<host>/events` and collects all entity state events for 4 seconds. Each entity becomes a sensor in the registry. Discovery is re-run on every restart.

**Supported entity domains:**

| ESPHome domain | HomeKit service |
|---|---|
| `sensor` | Temperature / Humidity / Lux / CO₂ (auto-detected) |
| `binary_sensor` | Motion / Contact / generic switch |
| `switch` | Switch |
| `light` | Lightbulb |
| `climate` | Thermostat |
| `cover` | Window Covering |

**Polling:** Entity state is refreshed every 30 s via `GET /<domain>/<id>`.

**Commands:** Sent as HTTP POST to `/<domain>/<id>/turn_on`, `turn_off`, `open`, `close`, `set` (for climate/cover).

**Authentication:** Optional HTTP Basic auth — the ESPHome `web_server` password is sent as `:<password>` (empty username).

**Config:** See [`esphome`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class ESPHomeClient` |
| Config section(s) | `esphome` |
| Platform-status key | `esphome` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | `platform-status` |
| Node built-ins | `http` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `esphome` section.

---

*Extracted from `src/esphome-client.js`. Source is authoritative — regenerate this page if the module changes.*
