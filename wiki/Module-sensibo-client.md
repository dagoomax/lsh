# `src/sensibo-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~117 lines**  ·  installable module `sensibo`

Sensibo Sky / Air / Air Pro / Elements — the official Sensibo cloud API
(home.sensibo.com/api/v2, API key from home.sensibo.com/me/api). A Sensibo
drives almost any IR-remote air conditioner, so this is also the way to
bring brands with no open API (Fujitsu, Panasonic, Toshiba, Hitachi,
Haier, Hisense, Sharp…) into LSH.

```
  GET  /users/me/pods?fields=id,room,acState,measurements,connectionStatus,remoteCapabilities
  POST /pods/<id>/acStates  { acState: { on, mode, targetTemperature, temperatureUnit, fanLevel, swing } }
```

```
  mode cool / heat / fan / dry / auto · fanLevel quiet, low, medium_low,
  medium, medium_high, high, strong, auto (what the remote has: remoteCapabilities)
  swing stopped / rangeFull / …
```

One LSH device per pod, `sensibo/<id>`, with the shared AC model of
src/ac-common.js; humidity from the pod's own sensor.

```
config.sensibo = { apiKey, pollInterval = 60 (s) }   (apiBase overrides for tests)
```
Tested against scripts/sensibo-simulator.js (test/sensibo.test.js) — not
yet against a real pod.

---

| Aspect | Value |
|---|---|
| Config section(s) | `sensibo` |
| Enabled when | `config.sensibo?.apiKey` |
| Platform-status key | `sensibo` |
| Registers devices | `sensibo/…` |
| npm dependencies | none |
| Other files | `src/ac-common.js` `src/polling-client.js` |
| Routes | — |
| Tests | `test/sensibo.test.js` `scripts/sensibo-simulator.js` |

*Extracted from the header of `src/sensibo-client.js`. Source is authoritative — regenerate this page if the module changes.*
