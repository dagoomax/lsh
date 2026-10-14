# `src/lgthinq-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~290 lines**

Integrates **LG ThinQ** appliances (refrigerators, air conditioners, washers, dryers, dishwashers, air purifiers, …) through LG's official **ThinQ Connect API** (`api-eic` / `api-aic` / `api-kic.lgthinq.com`, by the account's country).

**Authentication:** a Personal Access Token from [connect-pat.lgthinq.com](https://connect-pat.lgthinq.com) (`thinqpat_…`, Bearer), saved in `persist/lgthinq-tokens.json` by **Settings → LG ThinQ** (*Check & save* verifies it with LG first). The account's real country goes in `x-country` — LG answers *Not supported country* for any other; an old config with a region code (`EU`, `US`…) gets the country detected once and written back to `config.json`.

**Discovery:** `GET /devices`, then each appliance's `GET /devices/{id}/profile`. Sensors are built from the profile — no per-model code: `<group>_<attribute>` (or `<group>_<location>_<attribute>` for parts such as `FRIDGE` / `FREEZER`). Writable ranges → `range`, booleans → `toggle`, `POWER_ON/POWER_OFF`-style options → `toggle`, other writable options → a 0…N `range` whose hint lists them, read-only options → `label`.

**Polling:** `GET /devices/{id}/state` every 60 s (`PollingClient`, backs off on errors). **Commands:** `POST /devices/{id}/control` with `{ group: { [locationName,] attribute: value } }` (`unit` added for temperatures when the device reports one), state re-read 3 s later.

Verified against a real account with a refrigerator (setpoints, express modes, door, eco mode). Other appliance types use the same profile format but haven't been tried on real hardware.

**Config:** `lgthinq: { country: "PL" }` (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class LGThinQClient` (+ `propertiesOf`, `sensorFor`, `valueOf`, `regionOf` for tests) |
| Config section(s) | `lgthinq` |
| Platform-status key | `lgthinq` |
| Registers devices | yes (via sensor-registry) |
| Polling | `PollingClient`, 60 s |
| Internal deps | `polling-client`, `config-file-cache` |
| Node built-ins | `fs`, `path`, `crypto` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `lgthinq` section.

---

*Extracted from `src/lgthinq-client.js`. Source is authoritative — regenerate this page if the module changes.*
