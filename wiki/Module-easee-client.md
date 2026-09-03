# `src/easee-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~157 lines**

Integrates **Easee** EV chargers via Easee's official documented cloud API (`api.easee.com`, `developer.easee.com`).

**Authentication:** `POST /api/accounts/login` (`userName` + `password`) → access token. Re-authenticates automatically on a 401.

**Discovery:** `GET /api/chargers` — registers every charger on the account.

**Polling:** `GET /api/chargers/{id}/state` every `pollInterval` seconds (default 30) → `totalPower`, `sessionEnergy`, `dynamicChargerCurrent`, `chargerOpMode` (mapped to the normalized `status` string).

**Control:** `POST /api/chargers/{id}/commands/start_charging` / `stop_charging` for the `charging` toggle, `POST /api/chargers/{id}/settings` (`dynamicChargerCurrent`) for the `currentLimit` range.

Best-documented of the cloud EV integrations in this repo (official API), but still unverified against a real charger.

**Config:** See [`easee`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class EaseeClient` |
| Config section(s) | `easee` |
| Platform-status key | `easee` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (config `pollInterval`, default 30s) |
| Internal deps | `platform-status` |
| Node built-ins | `https` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`goecharger-client.js`](Module-goecharger-client), [`wallbox-client.js`](Module-wallbox-client), [`zaptec-client.js`](Module-zaptec-client), [`ocpp-server.js`](Module-ocpp-server) — sibling EV-charger integrations sharing the same device/sensor convention.

See the [Configuration Reference](Configuration) for the `easee` section.

---

*Extracted from `src/easee-client.js`. Source is authoritative — regenerate this page if the module changes.*
