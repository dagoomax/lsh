# `src/miele-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~353 lines**

**Miele@home** appliances via the official Miele 3rd Party API (developer.miele.com, `api.mcs3.miele.com`). Auth is OAuth2: direct `grant_type=password` login when username/password are configured, otherwise a one-off `scripts/miele-auth.js` (authorization-code flow); tokens are persisted and auto-refreshed in `persist/miele-tokens.json`. Live updates come from the `/devices/all/events` SSE stream, with a periodic re-sync (`pollInterval`, default 300 s) that also picks up newly added appliances. Each appliance registers with `power` (controllable), `status`, `program`, `phase`, `remaining`, `temperature`/`target`, `door`, `failure` and `connected` sensors. `host`/`port` override the API endpoint — point them at `scripts/miele-simulator.js` for development without appliances.

**Config:**
```json
"miele": { "clientId": "", "clientSecret": "", "username": "you@example.com", "password": "", "country": "de-DE" }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class MieleClient` |
| Platform-status key | `miele` |
| Device key prefix | `miele/…` |
| Store keys written | `miele` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | — |
| Node built-ins | `https`, `http`, `fs`, `path` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/miele-client.js`. Source is authoritative — regenerate this page if the module changes.*
