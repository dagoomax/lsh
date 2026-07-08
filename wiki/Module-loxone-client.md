# `src/loxone-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~474 lines**

Connects to a **Loxone Miniserver** via its WebSocket API with token-based authentication. Discovers all controls from the structure file and maps them to sensor descriptors. Supports read and write for switches, dimmers, jalousies, and temperature setpoints.

**Config:**
```json
"loxone": { "host": "192.168.1.10", "port": 80, "username": "admin", "password": "secret" }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class LoxoneClient` |
| Platform-status key | `loxone` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | `ws` |
| Node built-ins | `crypto`, `http`, `events` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/loxone-client.js`. Source is authoritative — regenerate this page if the module changes.*
