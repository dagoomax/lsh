# `src/landroid-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~226 lines**

**Worx Landroid** robot mower (and Kress / Landxcape sister brands) via the Worx cloud. Login is OAuth2 password grant; device state is read by polling the cloud REST API; commands are sent over the mower's AWS-IoT MQTT channel (best-effort — polling is the reliable core). The auth/API endpoints and MQTT flow are brand-specific and fully overridable via config (endpoints, clientId); defaults target Worx Landroid EU. Each mower registers with battery, status and error sensors keyed by serial.

**Config:**
```json
"landroid": { "brand": "worx", "email": "you@example.com", "password": "", "pollInterval": 60 }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class LandroidClient` |
| Platform-status key | `landroid` |
| Device key prefix | `landroid/…` |
| Store keys written | `landroid` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | `mqtt` (optional, for commands) |
| Node built-ins | `https` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/landroid-client.js`. Source is authoritative — regenerate this page if the module changes.*
