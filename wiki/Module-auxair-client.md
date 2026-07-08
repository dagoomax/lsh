# `src/auxair-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~250 lines**

Integrates **AUX Air** conditioners via the **AC Freedom / SmartHomeCS** cloud API.

**Auth flow:** SHA-1 password hash → AES-128-CBC encrypted login body (zero-padding, hardcoded app key/IV) → per-session `loginsession` + `userid` tokens used in all subsequent request headers.

**Device discovery:** Family list → per-family endpoint list → cookie decoding for device control sessions.

**Control:** `POST /device/control/v2/sdkcontrol` with `act: "get"` for state or `act: "set"` for commands. Parameters:

| Param | Sensor | Notes |
|---|---|---|
| `pwr` | Power | 0 = off, 1 = on |
| `temp` | Set temperature | raw ÷ 10 (e.g. 240 = 24.0 °C) |
| `envtemp` | Room temperature | raw ÷ 10, read-only |
| `ac_mode` | Mode | 0=cool 1=heat 2=dry 3=fan 4=auto |
| `ac_mark` | Fan speed | 0=auto 1=low 2=med 3=high 4=turbo 5=mute |

After each command, state is refreshed automatically after 1.5 s.

**Config:** See [`auxair`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class AuxAirClient` |
| Config section(s) | `auxair` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | — |
| Node built-ins | `https`, `crypto` |

See the [Configuration Reference](Configuration) for the `auxair` section.

---

*Extracted from `src/auxair-client.js`. Source is authoritative — regenerate this page if the module changes.*
