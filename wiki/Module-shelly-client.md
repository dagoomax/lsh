# `src/shelly-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~327 lines**

Polls **Shelly** devices every 15 s. Auto-detects Gen1 (REST `/status`) vs Gen2 (REST `/rpc/Shelly.GetStatus`). Registers sensors for power, voltage, current, and relay state. Supports toggling relays via `POST /api/device/:key/command`.

**Config:**
```json
"shelly": { "devices": [{ "name": "Living Room", "host": "192.168.1.50" }] }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class ShellyClient` |
| Config section(s) | `shelly` |
| Platform-status key | `shelly` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | `platform-status` |
| Node built-ins | `http` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `shelly` section.

---

*Extracted from `src/shelly-client.js`. Source is authoritative — regenerate this page if the module changes.*
