# `src/zehnder-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~222 lines**  ·  installable module `zehnder`

Zehnder heat-recovery ventilation (rekuperacja) — one LSH device per unit, whichever way it's reached:

```
type 'lanc'  ComfoAir Q / Flex via ComfoConnect LAN C (src/zehnder/lanc.js)
type 'pro'   ComfoAir Q via ComfoConnect Pro, Modbus TCP (src/zehnder/pro.js)
type 'ca350' ComfoAir 350 / 550 (WHR930…) via RS232 (src/zehnder/ca350.js)

config.zehnder = { units: [{ type, host, name?, port?, pin?, uuid?, unitId?,
serialPort?, rs232Mode?, pollSeconds? }], boostMinutes: 60, awayHours: 0 (= until cancelled) }
```

Common paths (each unit gets the ones its interface provides): speed 0–3 (away / low / medium / high), auto, boost, away, profile (0 normal, 1 cool, 2 warm), bypassMode (0 auto, 1 open, 2 closed), targetTemp, temperatures / humidities of the four air streams, flows, fan duty / rpm, power, energy, filter days / alarm, errors. For HomeKit the unit is a fan: on = not away, rotation speed = level (33 / 67 / 100 %).

---

| Aspect | Value |
|---|---|
| Config section(s) | `zehnder` |
| Enabled when | `(config.zehnder?.units \|\| config.zehnder?.devices)?.length` |
| Platform-status key | `zehnder` |
| Registers devices | `zehnder/…` |
| npm dependencies | none |
| Other files | `src/zehnder/ca350.js` `src/zehnder/lanc.js` `src/zehnder/pro.js` |
| Routes | `src/routes/zehnder.js` |
| Tests | `test/zehnder.test.js` `scripts/zehnder-simulator.js` |

*Extracted from the header of `src/zehnder-client.js`. Source is authoritative — regenerate this page if the module changes.*
