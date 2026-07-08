# `src/sensor-registry.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Core  ·  **~101 lines**

Manages all non-Victron devices discovered by integration clients. Each device is registered with a key, label, icon, color, and a list of sensor descriptors. Supports sending commands back to devices via `sendCommand(deviceKey, sensorPath, value)`.

Integration clients call `registry.register(device)` to add a device and `registry.update(deviceKey, readings)` to push new values.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SensorRegistry` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `device-definitions`, `server-i18n` |
| Node built-ins | `events` |

## Related module pages

- [`device-definitions.js`](Module-device-definitions)
- [`server-i18n.js`](Module-server-i18n)

---

*Extracted from `src/sensor-registry.js`. Source is authoritative — regenerate this page if the module changes.*
