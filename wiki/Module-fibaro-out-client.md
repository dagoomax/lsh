# `src/fibaro-out-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~150 lines**

Forwards DataStore values to a **Fibaro Home Center 2/3** as **global variables** — the outbound counterpart of [`fibaro-client.js`](Module-fibaro-client), following the same pattern as [`loxone-out-client.js`](Module-loxone-out-client) for Loxone. HC scenes can then trigger on anything LSH knows: Satel zones/partitions, Victron battery state, UniFi doorbell, etc.

**How it works:** On `start()`, lists existing global variables (`GET /api/globalVariables`), pushes the current value of every mapped key, then subscribes to the DataStore `change` event. Watched keys are pushed within 200 ms (debounced). Missing variables are created automatically (`POST`), updates go via `PUT /api/globalVariables/<name>`. Booleans are sent as `1`/`0`; variable names are sanitized to `[A-Za-z0-9_]`. Uses Basic auth over HTTP.

**Mappings** (both forms mixable):

- `{ "storeKey": "satel/partition/1/armed", "variable": "LSH_SatelArmed" }` — one key → one variable
- `{ "storePrefix": "satel/zone/", "variablePrefix": "LSH_satel_zone_" }` — bulk rule: every key under the prefix maps to `variablePrefix` + remainder with `/` → `_` (`satel/zone/3/state` → `LSH_satel_zone_3_state`)

**Config:** See [`fibaroOut`](Configuration) config section.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class FibaroOutClient` |
| Config section(s) | `fibaroOut` |
| Platform-status key | `fibaroOut` |
| Internal deps | `platform-status` |
| Node built-ins | `http` |

## Related module pages

- [`fibaro-client.js`](Module-fibaro-client)
- [`loxone-out-client.js`](Module-loxone-out-client)
- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `fibaroOut` section.

---

*Extracted from `src/fibaro-out-client.js`. Source is authoritative — regenerate this page if the module changes.*
