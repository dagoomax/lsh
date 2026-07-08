# `src/connection-manager.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Core  ·  **~138 lines**

Manages the primary Victron data connection. Tries local MQTT first; falls back to VRM cloud after 15 s if MQTT is unreachable. Automatically retries MQTT every 60 s and switches back once it reconnects.

**Events emitted** (extends `EventEmitter`):

| Event | Payload | When |
|---|---|---|
| `source-changed` | `{ source: 'mqtt' \| 'vrm' \| null }` | Active source switches |
| `data` | `{ key, value }` | New Victron metric received |
| `relay-state` | `{ index, on }` | Relay state update |

**Config keys used:** `mqtt`, `vrm`

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class ConnectionManager` |
| Config section(s) | `mqtt`, `vrm` |
| Poll interval(s) | 15 s, 60 s |
| Internal deps | `mqtt-client`, `vrm-client`, `platform-status` |
| Node built-ins | `events` |

## Related module pages

- [`mqtt-client.js`](Module-mqtt-client)
- [`vrm-client.js`](Module-vrm-client)
- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `mqtt` / `vrm` sections.

---

*Extracted from `src/connection-manager.js`. Source is authoritative — regenerate this page if the module changes.*
