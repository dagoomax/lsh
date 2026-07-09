# `src/somfy-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~460 lines**

Integrates **Somfy TaHoma** roller shutters and covers via the local HTTPS API (port 8443).

**Authentication:** `POST /enduser-mobile-web/1/enduserAPI/login` with email + password → `JSESSIONID` cookie. Session is refreshed automatically on 401.

**Discovery:** `GET .../setup/devices` — filters to controllable device classes (RollerShutter, Gate, Awning, Window, etc.). Each device gets a `switch` sensor (open/close toggle), a `level` sensor (0–100 position slider, inverted from the TaHoma `core:ClosureState` which uses 0 = open), a `stop` momentary, a `my` momentary (favourite position via the Overkiz `my` command — shown when advertised or when the device reports no command list, e.g. RTS motors), and — on covers that advertise `setOrientation` (the io venetian blinds) — a `tilt` sensor (0–100 slat angle slider, "% open", inverted from `core:SlateOrientationState`).

**Polling:** `GET .../setup/devices/<url>/states` every `pollInterval` seconds. `core:ClosureState` → `level = 100 - closure`; `core:SlateOrientationState` → `tilt = 100 - orientation`.

**Control:** `POST .../exec/apply` with a JSON action list. Position uses `setPosition`/`setClosure`, tilt uses `setOrientation` (both inverted to the "% open" convention).

**HomeKit:** tilt-capable io venetian blinds are bridged as a `WindowCovering` accessory (device `homekit: ['somfy-cover']`) exposing position **and** a horizontal slat-tilt characteristic; other covers stay dashboard-only.

**Config:** See [`somfy`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SomfyClient` |
| Config section(s) | `somfy` |
| Platform-status key | `somfy` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | `platform-status` |
| Node built-ins | `https` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `somfy` section.

---

*Extracted from `src/somfy-client.js`. Source is authoritative — regenerate this page if the module changes.*
