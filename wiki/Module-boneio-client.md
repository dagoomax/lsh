# `src/boneio-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~255 lines**

Discovers **BoneIO** relay board entities via **Home Assistant MQTT auto-discovery** (`homeassistant/<component>/boneio_*/config` retained topics). Groups all entities from the same board into a single dashboard device card. Tracks live relay and sensor state via `boneIO/<board>/<type>/<id>/state` topics. Commands are published back to the board's MQTT broker.

**Config:**
```json
"boneio": { "host": "192.168.1.100", "port": 1883 }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class BoneIOClient` |
| Platform-status key | `boneio` |
| Device key prefix | `boneio/…` |
| Store keys written | `boneio` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | `mqtt` |
| Node built-ins | `events` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/boneio-client.js`. Source is authoritative — regenerate this page if the module changes.*
