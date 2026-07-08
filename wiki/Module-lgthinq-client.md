# `src/lgthinq-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~474 lines**

Integrates **LG ThinQ** appliances (air conditioners, washers, dryers, dishwashers, refrigerators, etc.) via the **LG v1 REST API** (`<country>.api.lge.com`).

**Authentication:** Token-based only. Tokens are loaded from `persist/lgthinq-tokens.json` at startup. If no tokens are present the client skips start silently. PATs (Personal Access Tokens, prefix `thinqpat_`) are treated as non-expiring; OAuth access tokens are refreshed automatically using the stored refresh token.

**Auth headers used:**
- `x-emp-token` — access token
- `x-thinq-user-no` — user number (required for all v1 API calls)

**Discovery:** `GET /v1/service/homes` returns all home groups. Falls back to `GET /v1/service/application/dashboard` if no homes are found. Each device is registered in the sensor registry. Device state is polled every 30 s via `GET /v1/service/devices/:id/status`.

**Supported device types:** AC (on/off, mode, target temperature, fan speed), washer, dryer, dishwasher, refrigerator. Commands are sent via `POST /v1/service/devices/:id/control`.

**One-time user number setup:** Use **Settings → Controllers → LG ThinQ → Fetch Tokens & User Number** with your LG email/password. The server runs the LG OAuth pre-login flow (`eu.m.lgaccount.com`), extracts the user number from the JWT `sub` claim, and stores everything in `persist/lgthinq-tokens.json`. Credentials are not stored.

**Config:** See [`lgthinq`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class LGThinQClient` |
| Config section(s) | `lgthinq` |
| Platform-status key | `lgthinq` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | `platform-status` |
| Node built-ins | `https`, `fs`, `path`, `crypto` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `lgthinq` section.

---

*Extracted from `src/lgthinq-client.js`. Source is authoritative — regenerate this page if the module changes.*
