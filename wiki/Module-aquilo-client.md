# `src/aquilo-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~228 lines**  ·  installable module `aquilo`

Aquilo (aquilo.pl) liquid-level sensors — septic tanks, rainwater tanks, wells. The microwave transmitter in the tank talks to a WiFi receiver (gateway) plugged in indoors; that gateway answers on the LAN, without login, at GET http://<gateway>/state (the endpoint Aquilo's own Home Assistant guide uses):

```
{ "sensors": [ { "id": "000000", "name": "TANK", "lvl": 125.6, "pct": 34,
                 "bat": 76, "lstRead": "2026-01-01T12:00:00+01:00",
                 "lstEmpty": "…", "daysLeft": 48, "lvlToFull": 121 } ],
  "from": "node-1" }
```

Older firmware sends only id / lvl / pct / lstRead — the other readings are added to a tank only once its gateway reports them. One gateway can carry several tanks; each becomes its own device (aquilo/<id>), and tanks that show up later are added on the next poll. The gateway just repeats the last transmission, so a tank whose lstRead stops moving is flagged stale.

```
config.aquilo = { gateways: [{ host, name? }], pollSeconds: 300,
                staleHours: 24, overflowPct: 90, exclude: ['<tank id>'],
                names: { '<tank id>': 'Septic tank' } }
```

---

| Aspect | Value |
|---|---|
| Config section(s) | `aquilo` |
| Enabled when | `config.aquilo?.gateways?.length` |
| Platform-status key | `aquilo` |
| Registers devices | `aquilo/…` |
| npm dependencies | none |
| Other files | — |
| Routes | `src/routes/aquilo.js` |
| Tests | `test/aquilo.test.js` `scripts/aquilo-simulator.js` |

*Extracted from the header of `src/aquilo-client.js`. Source is authoritative — regenerate this page if the module changes.*
