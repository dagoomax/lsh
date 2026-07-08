# `src/vrm-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~220 lines**

Polls the Victron VRM cloud REST API for live metrics when local MQTT is unavailable. Authenticates with email/password or API token. Poll interval is 5 s.

Also used to send relay commands via the VRM API when MQTT is offline.

**Config keys used:** `vrm.email`, `vrm.password`, `vrm.apiToken`, `vrm.installationId`

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class VrmClient` |
| Config section(s) | `vrm` |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | — |

See the [Configuration Reference](Configuration) for the `vrm` section.

---

*Extracted from `src/vrm-client.js`. Source is authoritative — regenerate this page if the module changes.*
