# `src/dyson-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~242 lines**  ·  installable module `dyson`

Dyson connected fans/purifiers/humidifiers (Pure Cool, Pure Hot+Cool, Pure Humidify+Cool, …) — local MQTT, matching every WiFi-connected model in that line. Dyson's cordless vacuums (360 Eye/Heurist/Vis Nav) use a completely different AWS-IoT-based cloud protocol and are NOT covered here.

Cloud login (scripts/dyson-auth.js) happens once, offline, to obtain each device's serial/product type and its local MQTT password (shipped AES-encrypted by Dyson's API) — see persist/dyson-tokens.json. This client only ever talks to devices on the local network from then on; it never calls Dyson's cloud API itself.

Protocol reference: reimplemented from the reverse-engineered Dyson local MQTT protocol documented across several open-source projects (libdyson, ha-dyson, node-dyson-api) — Dyson publishes nothing official. Untested against real hardware in this repo (no Dyson device available here); field names/encodings below are the commonly-documented ones for the Pure Cool/Hot+Cool/Humidify+Cool family and may not match every model exactly.

---

| Aspect | Value |
|---|---|
| Config section(s) | `dyson` |
| Enabled when | `config.dyson?.enabled` |
| Platform-status key | `dyson` |
| Registers devices | `dyson/…` |
| npm dependencies | none |
| Other files | — |
| Routes | — |
| Tests | — |

*Extracted from the header of `src/dyson-client.js`. Source is authoritative — regenerate this page if the module changes.*
