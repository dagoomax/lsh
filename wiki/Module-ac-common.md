# `src/ac-common.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Support  ·  **~117 lines**  ·  core helper, shipped with each AC module

Shared model for air conditioners (Daikin, Gree, Midea, MELCloud, Sensibo):
one LSH device per indoor unit with the same paths and controls whatever
the brand, so dashboards, automations, Loxone and HomeKit treat every AC
alike.

```
  power        on/off                      (toggle)
  mode         0 auto, 1 cool, 2 dry, 3 fan, 4 heat   (range; modeName = text)
  targetTemp   °C                          (range, brand limits)
  fan          0 auto, 1 quiet, 2 low, 3 medium, 4 high, 5 turbo
               (brands with fewer steps map to the nearest)
  swing        vertical swing on/off       (toggle, when supported)
  temperature  room °C, outdoorTemp, humidity  (when reported)
  online
```

HomeKit: a Thermostat (homekit-bridge.js 'thermostat') — it reads the
SmartThings-style mirror paths thermostatMode / thermostatOperatingState /
heatingSetpoint / coolingSetpoint kept here, and writes back through the
thermostatMode / thermostat*Setpoint capabilities handled by acWriter().

A client registers each unit with registerAc(), pushes readings with
publishAc(), and implements set(patch) where patch is any of
{ power: bool, mode: 'auto'|'cool'|'dry'|'fan'|'heat', targetTemp: °C,
```
  fan: 0–5, swing: bool }.
```

---

| Aspect | Value |
|---|---|
| Config section(s) | — |
| Enabled when | — |
| Platform-status key | — |
| Registers devices | — |
| npm dependencies | none |
| Other files | — |
| Routes | — |
| Tests | `test/ac-common.test.js` |

*Extracted from the header of `src/ac-common.js`. Source is authoritative — regenerate this page if the module changes.*
