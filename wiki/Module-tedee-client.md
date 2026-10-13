# `src/tedee-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~185 lines**  ·  installable module `tedee`

Tedee Bridge client (Tedee smart locks) via the Bridge's own local REST API — no cloud round-trip needed for lock control once "API" is switched on for the Bridge in the Tedee mobile app (Bridge -> Settings -> API), which is also where the `apiToken` used below is shown.

Protocol reference: https://docs.tedee.com/bridge-api — base URL `http://<bridge-ip>/v1.0`, every request authenticated via an `api_token` header. Endpoint shapes and the lock-state/doorState/jammed enums are taken from Tedee's own published OpenAPI spec and webhook event-schema docs (github.com/tedee-com/tedee-documentation, bridge-api/spec.json and bridge-api/webhooks/events.md), not guessed.

One config entry is one physical Bridge; a Bridge can have several locks paired to it — `GET /lock` returns all of them in a single call, and each becomes its own device in the sensor registry.

Untested against real hardware from this codebase — ported faithfully from Tedee's documented wire protocol, but nobody has run this specific file against a real Bridge yet.

---

| Aspect | Value |
|---|---|
| Config section(s) | `tedee` |
| Enabled when | `config.tedee?.devices?.length` |
| Platform-status key | `tedee-` |
| Registers devices | `tedee/…` |
| npm dependencies | none |
| Other files | — |
| Routes | `src/routes/tedee.js` |
| Tests | — |

*Extracted from the header of `src/tedee-client.js`. Source is authoritative — regenerate this page if the module changes.*
