# `src/homey-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~232 lines**

Integrates with **Homey Pro** in two modes:

- **`local`** (Homey Pro 2023+) — polls the local LAN REST API every `pollInterval` seconds. No cloud dependency.
- **`cloud`** — polls the Homey cloud API using `homeyId` and token.

Maps 30+ Homey capability types to sensor descriptors. Supports control of switches, dimmers, thermostats, locks, covers, and volume. Color lights are supported via hue/saturation.

**Token:** Homey Developer Tools → Personal Access Tokens → add new token with full scope.

**Config:**
```json
"homey": { "mode": "local", "host": "192.168.1.x", "token": "...", "pollInterval": 10 }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class HomeyClient` |
| Config section(s) | `homey` |
| Platform-status key | `homey` |
| Device key prefix | `homey/…` |
| Registers devices | yes (via sensor-registry) |
| Poll interval(s) | 10 s |
| Internal deps | `platform-status` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `homey` section.

---

*Extracted from `src/homey-client.js`. Source is authoritative — regenerate this page if the module changes.*
