# `src/zendure-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~149 lines**  ·  installable module `zendure`

Zendure SolarFlow — official local API (zenSDK, github.com/Zendure/zenSDK). Each device runs an HTTP server on the LAN: GET /properties/report returns

```
{ sn, product, properties: {…}, packData: [{…}] }, POST /properties/write
```

takes { sn, properties: { name: value } }. Supported (per Zendure): SolarFlow 800 / 800 Plus / 800 Pro / 1600 AC+ / 2400 AC / AC+ / Pro and SmartMeter 3CT. Newer firmware (EN 18031) keeps HTTP off until a HEMS is added in the Zendure app — add one, then leave the HEMS screen to apply.

One LSH device per unit, `zendure/<sn>`: state of charge, PV / home / grid / battery power, remaining time, per-pack SOC and temperature, plus controls — AC mode (1 charge, 2 discharge), output and AC-charge limits (written with smartMode=1 so frequent changes don't wear the flash), target / minimum SOC.

```
config.zendure = { devices: [{ host, name? }], pollInterval = 10 (s) }
```

Tested against scripts/zendure-simulator.js (test/zendure.test.js) — not yet against a real unit.

---

| Aspect | Value |
|---|---|
| Config section(s) | `zendure` |
| Enabled when | `config.zendure?.devices?.length` |
| Platform-status key | — |
| Registers devices | `zendure/…` |
| npm dependencies | none |
| Other files | `src/polling-client.js` |
| Routes | — |
| Tests | `test/zendure.test.js` `scripts/zendure-simulator.js` |

*Extracted from the header of `src/zendure-client.js`. Source is authoritative — regenerate this page if the module changes.*
