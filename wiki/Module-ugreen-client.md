# `src/ugreen-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~195 lines**  ·  installable module `ugreen`

UGREEN PowerRoam portable power stations — through UGREEN's cloud (hw-powerapi.ugpps.com, the "UGREEN" / PowerRoam app's backend). The units have no local network API (only an outbound connection to that cloud), so this needs the app account and internet. Reverse-engineered by the community (github.com/tanka8/ugreen-powerroam, MIT) — not an official API, it can change without notice.

Login: GET /app/v1/sa/encrypt/key → RSA public key + uuid; e-mail and password RSA (PKCS#1 v1.5) encrypted → POST /app/v1/login → token, userId. GET /app/v1/device/list → the account's units. Live telemetry: one WebSocket per unit (wss://…:8089/app/device/websocket/<userId>/<device>, header `token`), subscribed and kept alive by re-sending

```
{userId, content: "ugreenSocketConnection"} every 25 s; the server pushes a
```

flat JSON object every few seconds. Control: POST /app/v1/device/setDeviceInfo

```
{ deviceName, map: { switch_ac | switch_dc | usb_sw | lamp_sw: 0|1 } }.
```

One LSH device per unit, `ugreen/<sn>`: battery %, input / output power (total, AC, DC, USB), time to empty / full, temperatures, battery health, cycles, cell imbalance; AC / DC / USB outputs and the light as switches.

```
config.ugreen = { email, password }   (apiBase / wsBase override for tests)
```

Tested against scripts/ugreen-simulator.js (test/ugreen.test.js) — not yet against a real unit.

---

| Aspect | Value |
|---|---|
| Config section(s) | `ugreen` |
| Enabled when | `config.ugreen?.email && config.ugreen?.password` |
| Platform-status key | `ugreen` |
| Registers devices | `ugreen/…` |
| npm dependencies | `ws` |
| Other files | — |
| Routes | — |
| Tests | `test/ugreen.test.js` `scripts/ugreen-simulator.js` |

*Extracted from the header of `src/ugreen-client.js`. Source is authoritative — regenerate this page if the module changes.*
