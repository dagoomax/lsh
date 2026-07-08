# `src/fibaro-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~259 lines**

Integrates **Fibaro Home Center 2 / 3** via its local REST API.

**Discovery:** Fetches `/api/rooms` and `/api/devices` in parallel, groups supported devices by room, and registers each room as a dashboard tile with one sensor entry per device. Sensor paths use the Fibaro device ID (e.g. `42/value`) so write commands can target individual devices.

**Live updates:** Calls `/api/refreshStates?last=<timestamp>` in a continuous long-poll loop (55 s timeout). The `last` cursor is advanced on each response so only changes since the previous poll are processed.

**Write path:** `POST /api/devices/<id>/action/<action>` — `turnOn`, `turnOff`, or `setValue`.

**Config:** See [`fibaro`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class FibaroClient` |
| Config section(s) | `fibaro` |
| Platform-status key | `fibaro` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| Node built-ins | `http` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `fibaro` section.

---

*Extracted from `src/fibaro-client.js`. Source is authoritative — regenerate this page if the module changes.*
