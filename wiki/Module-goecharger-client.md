# `src/goecharger-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~139 lines**

Integrates **go-eCharger** EV chargers — local-only, no cloud account needed.

**Polling:** `GET http://<host>/api/status` every 10 s (go-eCharger API v2). `nrg[11]` (×100) → power in W, `wh` (÷1000) → session energy in kWh, `car` status enum → normalized `status` string, `amp` → current charge-current limit.

**Control:** `GET /api/set?frc=1|2` for force-off/force-on (the `charging` toggle), `GET /api/set?amp=<n>` for the `currentLimit` range sensor.

**Device shape:** registers with `category: 'ev-charger'` and the standard EV sensor set (`power`, `energy`, `status`, `charging`, `currentLimit`) shared across all five EV-charger integrations, so the dashboard's energy-flow diagram can sum charging power regardless of brand.

**Config:** See [`goecharger`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class GoEChargerClient` |
| Config section(s) | `goecharger` |
| Platform-status key | `goecharger` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (10 s) |
| Internal deps | `platform-status` |
| Node built-ins | `http` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`easee-client.js`](Module-easee-client), [`wallbox-client.js`](Module-wallbox-client), [`zaptec-client.js`](Module-zaptec-client), [`ocpp-server.js`](Module-ocpp-server) — sibling EV-charger integrations sharing the same device/sensor convention.

See the [Configuration Reference](Configuration) for the `goecharger` section.

---

*Extracted from `src/goecharger-client.js`. Source is authoritative — regenerate this page if the module changes.*
