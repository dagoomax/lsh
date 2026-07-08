# `src/server-i18n.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Support  ·  **~142 lines**

Server-side translation of device and sensor labels.

Applied once, centrally, in the sensor registry — so every consumer gets
translated names: REST API, Socket.IO, both dashboards, HomeKit (Siri!),
Loxone XML templates, Node-RED. Selected via `language` in config.json
("en" or unset = pass-through). Unknown terms fall back to English.

## At a glance

| Aspect | Value |
|---|---|
| Exports | `translate`, `translateDevice`, `LANGUAGES` |
| Config section(s) | `json` |
| Internal deps | — |

See the [Configuration Reference](Configuration) for the `json` section.

---

*Extracted from `src/server-i18n.js`. Source is authoritative — regenerate this page if the module changes.*
