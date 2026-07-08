# `src/smartthings-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~318 lines**

Polls the **Samsung SmartThings cloud API** every 10 s. Discovers all devices (or the list in `deviceIds`) and maps capabilities to sensor descriptors. Supports control of switches, dimmers, thermostats, locks, covers, and color lights.

**Setup:** Generate a Personal Access Token at [account.smartthings.com/tokens](https://account.smartthings.com/tokens).

**Config:**
```json
"smartthings": { "token": "...", "deviceIds": [] }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SmartThingsClient` |
| Config section(s) | `smartthings` |
| Platform-status key | `smartthings` |
| Device key prefix | `smartthings/…` |
| Registers devices | yes (via sensor-registry) |
| Poll interval(s) | 30 s |
| Internal deps | `platform-status`, `camera-log` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`camera-log.js`](Module-camera-log)

See the [Configuration Reference](Configuration) for the `smartthings` section.

---

*Extracted from `src/smartthings-client.js`. Source is authoritative — regenerate this page if the module changes.*
