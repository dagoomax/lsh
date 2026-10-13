# `src/wled-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~209 lines**  ·  installable module `wled`

WLED addressable-LED controllers (ESP8266/ESP32) via the local JSON HTTP API.

Each configured controller is polled on /json (state + info) and registered as a dashboard light with power, brightness, RGB colour and — on RGBW strips — a separate white channel. Control is a POST to /json/state.

```
config.wled = { pollInterval: 5, devices: [ { name, host, port } ] }
```

Devices are read from config.json on every poll, so Settings-page edits apply without a restart (same live-config pattern as the camera clients).

---

| Aspect | Value |
|---|---|
| Config section(s) | `wled` |
| Enabled when | `config.wled?.devices?.length` |
| Platform-status key | `wled` |
| Registers devices | `wled/…` |
| npm dependencies | none |
| Other files | — |
| Routes | `src/routes/wled.js` |
| Tests | — |

*Extracted from the header of `src/wled-client.js`. Source is authoritative — regenerate this page if the module changes.*
