# `src/zaptec-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~177 lines**

Integrates **Zaptec** EV chargers via Zaptec's cloud API (`api.zaptec.com`).

**Authentication:** `POST /oauth/token` (OAuth2 password grant) → access token. Re-authenticates automatically on a 401.

**Discovery:** `GET /api/chargers` — registers every charger on the account.

**Polling:** `GET /api/chargers/{id}/state` every `pollInterval` seconds (default 30). Zaptec's charger state is a list of numeric `ObservationId` → value pairs rather than flat fields (`TotalChargePower`, session energy, `ChargerOperationMode`, active current limit) — the ids used here are best-effort from Zaptec's published API and the community Home Assistant integration; verify against your own charger's actual `/api/chargers/{id}/state` response if a reading looks wrong.

**Control:** `POST /api/chargers/{id}/SendCommand/{507|506}` (start/stop) for the `charging` toggle, `POST /api/chargers/{id}/update` (`maxChargeCurrent`) for the `currentLimit` range.

Unverified against real hardware — treat the observation/command ids as best-effort.

**Config:** See [`zaptec`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class ZaptecClient` |
| Config section(s) | `zaptec` |
| Platform-status key | `zaptec` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (config `pollInterval`, default 30s) |
| Internal deps | `platform-status` |
| Node built-ins | `https` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`goecharger-client.js`](Module-goecharger-client), [`wallbox-client.js`](Module-wallbox-client), [`easee-client.js`](Module-easee-client), [`ocpp-server.js`](Module-ocpp-server) — sibling EV-charger integrations sharing the same device/sensor convention.

See the [Configuration Reference](Configuration) for the `zaptec` section.

---

*Extracted from `src/zaptec-client.js`. Source is authoritative — regenerate this page if the module changes.*
