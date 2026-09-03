# `src/wallbox-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~162 lines**

Integrates **Wallbox** (Pulsar/Commander/Copper) EV chargers via Wallbox's cloud API.

**Authentication:** `POST https://user-api.wall-box.com/users/signin` (HTTP Basic, email + password) → JWT. Re-authenticates automatically on a 401.

**Discovery:** `GET /v3/chargers/groups` on `api.wall-box.com` — registers every charger found across all groups.

**Polling:** `GET /chargers/status/{id}` every `pollInterval` seconds (default 30) → power, session energy, current limit and charging status.

**Control:** `POST /v3/chargers/{id}/remote-action` (resume/pause) for the `charging` toggle, `PUT /v2/charger/{id}` (`maxChargingCurrent`) for the `currentLimit` range.

Wallbox has no official public API — this follows endpoints reverse-engineered by the community (pywallbox / home-assistant-wallbox), not vendor documentation, and hasn't been run against real hardware. Treat it as best-effort.

**Config:** See [`wallbox`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class WallboxClient` |
| Config section(s) | `wallbox` |
| Platform-status key | `wallbox` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (config `pollInterval`, default 30s) |
| Internal deps | `platform-status` |
| Node built-ins | `https` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`goecharger-client.js`](Module-goecharger-client), [`easee-client.js`](Module-easee-client), [`zaptec-client.js`](Module-zaptec-client), [`ocpp-server.js`](Module-ocpp-server) — sibling EV-charger integrations sharing the same device/sensor convention.

See the [Configuration Reference](Configuration) for the `wallbox` section.

---

*Extracted from `src/wallbox-client.js`. Source is authoritative — regenerate this page if the module changes.*
