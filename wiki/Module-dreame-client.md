# `src/dreame-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~286 lines**

Controls **Dreame** robot vacuums and air purifiers via the **Xiaomi miio UDP protocol** (port 54321, AES-128-CBC with MD5-derived key). Polls device state every 15 s. Supports start/stop/pause/dock for vacuums and on/off/mode/fan-speed for air purifiers.

**Token acquisition:** Use [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor).

**Config:**
```json
"dreame": {
  "devices": [
    { "name": "Vacuum", "host": "192.168.1.x", "token": "32-hex-chars", "type": "vacuum" },
    { "name": "Purifier", "host": "192.168.1.x", "token": "32-hex-chars", "type": "air_purifier" }
  ]
}
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class MiioDevice`, `class DreameClient` |
| Config section(s) | `dreame` |
| Platform-status key | `dreame` |
| Registers devices | yes (via sensor-registry) |
| Poll interval(s) | 15 s |
| Internal deps | `platform-status` |
| Node built-ins | `dgram`, `crypto` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `dreame` section.

---

*Extracted from `src/dreame-client.js`. Source is authoritative — regenerate this page if the module changes.*
