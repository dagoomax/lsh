# `src/dirigera-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~318 lines**

Integrates with the **IKEA Dirigera** smart home hub. Discovers devices via REST (`GET /v1/devices`) and subscribes to live updates via WebSocket (`wss://<host>/v1`). Normalizes attribute names to match the SmartThings convention so existing HomeKit service builders are reused without modification.

**One-time pairing:**
```bash
node scripts/dirigera-auth.js 192.168.x.x
# Press the action button on the hub when prompted, then copy the printed token into config
```

**Config:**
```json
"dirigera": { "host": "192.168.x.x", "token": "..." }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class DirigeraClient` |
| Config section(s) | `dirigera` |
| Platform-status key | `dirigera` |
| Registers devices | yes (via sensor-registry) |
| Poll interval(s) | 30 s |
| Internal deps | `platform-status` |
| Node built-ins | `https` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `dirigera` section.

---

*Extracted from `src/dirigera-client.js`. Source is authoritative — regenerate this page if the module changes.*
