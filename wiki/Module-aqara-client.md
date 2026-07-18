# `src/aqara-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~280 lines**

**Aqara / Xiaomi Zigbee** devices via the gateway **LAN protocol** (UDP 9898, "developer mode" hubs: Xiaomi Gateway v2/v3, Aqara Hub v1, AC Partner). Child devices are auto-discovered through the hub (`get_id_list` → `read` per sid); live updates arrive via `report`/`heartbeat` multicasts on `224.0.0.50:9898` with a periodic re-read as safety net (automatic poll-only fallback if the multicast port is taken). Supported models: temp/humidity, weather, door/window contact, motion (+lux), water leak, buttons/cube, smart plugs (+power), 1/2-channel wall switches, and the gateway light/illumination. Writes (plug, wall switch, gateway light) are signed with the rotating gateway token AES-128-CBC-encrypted with the per-gateway LAN `password` — without the password the integration is read-only. `scripts/aqara-simulator.js` emulates a hub for hardware-free development.

**Config:**
```json
"aqara": { "pollInterval": 30, "gateways": [ { "host": "192.168.1.x", "port": 9898, "password": "16charLANkey0000" } ], "names": { "158d0001a2b3c4": "Czujnik salon" } }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class AqaraClient` |
| Platform-status key | `aqara` |
| Device key prefix | `aqara/…` |
| Store keys written | `aqara` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | — |
| Node built-ins | `dgram`, `crypto` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/aqara-client.js`. Source is authoritative — regenerate this page if the module changes.*
