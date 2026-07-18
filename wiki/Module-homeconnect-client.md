# `src/homeconnect-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~353 lines**

**Home Connect** cloud (developer.home-connect.com) — all BSH appliance brands: Bosch, Siemens, Gaggenau, Neff, Thermador, Balay, Constructa. Auth is the OAuth2 **device flow** — run `node scripts/homeconnect-auth.js` once; tokens are persisted and auto-refreshed in `persist/`. Live updates come from the account-wide SSE event stream, with a slow periodic re-sync as a safety net — the API budget is ~1000 requests/day, and the client is written to respect it. Each appliance registers with power, status, program, door and remaining-time sensors.

**Config:**
```json
"homeConnect": { "clientId": "", "clientSecret": "" }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class HomeConnectClient` |
| Platform-status key | `homeconnect` |
| Device key prefix | `homeconnect/…` |
| Store keys written | `homeconnect` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | — |
| Node built-ins | `https`, `fs`, `path` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/homeconnect-client.js`. Source is authoritative — regenerate this page if the module changes.*
