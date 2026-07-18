# `src/vents-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~183 lines**

**VENTS / Blauberg** decentralised HRV units (e.g. VENTS A21, TwinFresh Expert, Vento Expert) over the local UDP protocol on port 4000. Implements the documented binary framing (`FD FD | 02 | id | password | func | data | checksum`) with read (0x01) and write (0x03) functions. Registers one device with fan speed / mode / boost controls and temperature, humidity and filter sensors; the polled parameter registers are overridable via `config.vents.params` for units that map registers differently.

**Config:**
```json
"vents": { "host": "192.168.1.x", "port": 4000, "deviceId": "0123456789ABCDEF", "password": "1111", "name": "Ventilation", "pollInterval": 30 }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class VentsClient` |
| Platform-status key | `vents` |
| Device key prefix | `vents/…` |
| Store keys written | `vents` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | — |
| Node built-ins | `dgram` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/vents-client.js`. Source is authoritative — regenerate this page if the module changes.*
