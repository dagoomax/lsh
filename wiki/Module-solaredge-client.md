# `src/solaredge-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~119 lines**

Polls the **SolarEdge Monitoring API** (`monitoringapi.solaredge.com`) every 15 minutes (enforced by the free-tier rate limit). Fetches site overview, power flow, and energy totals. Registers a single `solaredge` device with sensors for current power, today's yield, and grid import/export.

**Setup:** Create an API key in the SolarEdge monitoring portal under Admin → Site Access.

**Config:**
```json
"solaredge": { "siteId": "1234567", "apiKey": "ABCDEF..." }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class SolarEdgeClient` |
| Config section(s) | `solaredge` |
| Platform-status key | `solaredge` |
| Store keys written | `solaredge/currentPower`, `solaredge/dailyEnergy`, `solaredge/lifetimeEnergy`, `solaredge/loadPower`, `solaredge/gridPower`, `solaredge/batteryPower`, `solaredge/batteryLevel` |
| Poll interval(s) | 30 s |
| Internal deps | `platform-status` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `solaredge` section.

---

*Extracted from `src/solaredge-client.js`. Source is authoritative — regenerate this page if the module changes.*
