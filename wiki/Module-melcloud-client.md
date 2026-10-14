# `src/melcloud-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~129 lines**  ·  installable module `melcloud`

Mitsubishi Electric air conditioners (air-to-air, "ATA") through MELCloud —
the cloud behind the MELCloud app and the MAC-5xx Wi-Fi interfaces. Not an
official public API (the one the app uses, as in pymelcloud); it can change.
MELCloud Home (the newer melcloudhome.com service some accounts were moved
to) is a different API and isn't covered.

```
  POST /Login/ClientLogin {Email, Password, …}   → LoginData.ContextKey
  GET  /User/ListDevices                          → buildings → floors / areas → devices,
       each with its current state in .Device (header X-MitsContextKey)
  GET  /Device/Get?id&buildingID                  → the full ATA state object
  POST /Device/SetAta  that object, changed + EffectiveFlags + HasPendingCommand
       flags: Power 0x1, OperationMode 0x2, SetTemperature 0x4, SetFanSpeed 0x8, VaneVertical 0x10
```

```
  OperationMode 1 heat, 2 dry, 3 cool, 7 fan, 8 auto
  fan 0 auto, 1…NumberOfFanSpeeds · VaneVertical 0 auto, 1–5, 7 swing
```

MELCloud throttles (HTTP 429) — keep pollInterval ≥ 60 s; the units
themselves report to the cloud about once a minute.

One LSH device per indoor unit, `melcloud/<DeviceID>`, with the shared AC
model of src/ac-common.js.

```
config.melcloud = { email, password, pollInterval = 60 (s) }   (apiBase overrides for tests)
```
Tested against scripts/melcloud-simulator.js (test/melcloud.test.js) — not
yet against a real account.

---

| Aspect | Value |
|---|---|
| Config section(s) | `melcloud` |
| Enabled when | `config.melcloud?.email && config.melcloud?.password` |
| Platform-status key | `melcloud` |
| Registers devices | `melcloud/…` |
| npm dependencies | none |
| Other files | `src/ac-common.js` `src/polling-client.js` |
| Routes | — |
| Tests | `test/melcloud.test.js` `scripts/melcloud-simulator.js` |

*Extracted from the header of `src/melcloud-client.js`. Source is authoritative — regenerate this page if the module changes.*
