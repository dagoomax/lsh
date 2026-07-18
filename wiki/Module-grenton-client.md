# `src/grenton-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~201 lines**

**Grenton** smart home (CLU controllers) via the **GATE HTTP** module. LSH talks to a single HttpListener on the GATE running the companion Lua script (`docs/grenton-gate-lsh.lua`): `POST {cmd:'status'|'set'|'exec'}` JSON. Objects are addressed by their Object Manager names (e.g. `DOU8272`); there is no discovery API, so devices are declared in `config.grenton.devices`. Object states are polled every `pollInterval` seconds (default 5); after a command a quick re-poll (800 ms) makes the UI reflect the change immediately. Device types: `light` / `switch` / `dimmer` (controllable, HomeKit-exposed), `blind` (position + raw `commands` for up/down/stop), `temperature`, `sensor`. `scripts/grenton-simulator.js` emulates the listener protocol for hardware-free development.

**Config:**
```json
"grenton": { "host": "192.168.1.x", "port": 80, "path": "/lsh", "token": "", "pollInterval": 5, "devices": [ { "name": "Lampa salon", "object": "DOU8272", "type": "light" } ] }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class GrentonClient` |
| Platform-status key | `grenton` |
| Device key prefix | `grenton/…` |
| Store keys written | `grenton` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | — |
| Node built-ins | `http` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/grenton-client.js`. Source is authoritative — regenerate this page if the module changes.*
