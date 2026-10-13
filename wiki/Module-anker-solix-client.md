# `src/anker-solix-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~278 lines**  ·  installable module `anker-solix`

Anker SOLIX — official local Modbus TCP (the protocol Anker's own Home Assistant integration uses, github.com/anker-charging/ha-anker-solix-official, MIT). Turn it on in the Anker app: device → Settings → Three-Party Control Settings → Modbus TCP (note the IP shown there). Port 502, unit id 1.

Register maps: src/anker-solix-maps.json, converted from that integration's YAML configs — Solarbank Max / Max AC, Solarbank 4 E5000 Pro, XE / XE AC, Smart Meter Gen 2, Smart Plug Gen 2. The model is recognised from the product code inside the serial number (characters 4–6 or 4–7).

One LSH device per unit, `anker/<sn>`, its sensors built from the map: battery SOC, PV / load / grid import & export / AC output power, battery charging & discharging (one signed register split in two), lifetime energy, status; meter phases; plug power and switch. Controls: operating mode (0 self-consumption, 1 time-of-use, 3 third-party control, 4 custom, 5 socket overlay, 6 smart, 7 dynamic pricing), battery power setpoint (signed: negative charges, positive discharges — only acts in mode 3), charge / discharge-limit / backup-reserve SOC, plug on/off.

```
config.ankerSolix = { devices: [{ host, port = 502, unitId = 1, name? }], pollInterval = 10 }
```

Tested against scripts/anker-solix-simulator.js (test/anker-solix.test.js) — not yet against a real unit.

---

| Aspect | Value |
|---|---|
| Config section(s) | `ankerSolix` |
| Enabled when | `config.ankerSolix?.devices?.length` |
| Platform-status key | — |
| Registers devices | `anker/…` |
| npm dependencies | none |
| Other files | `src/anker-solix-maps.json` `src/polling-client.js` |
| Routes | — |
| Tests | `test/anker-solix.test.js` `scripts/anker-solix-simulator.js` |

*Extracted from the header of `src/anker-solix-client.js`. Source is authoritative — regenerate this page if the module changes.*
