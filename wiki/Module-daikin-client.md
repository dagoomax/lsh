# `src/daikin-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~171 lines**  ·  installable module `daikin`

Daikin air conditioners — local HTTP API of the Daikin Wi-Fi adapters
(the protocol of the "Daikin Online Controller" app, as used by pydaikin).

```
  BRP069A/B, BRP072A, built-in Wi-Fi of most 2015–2021 splits (Emura,
  Stylish, Perfera, Sensira, Comfora, Ururu Sarara…): plain HTTP.
  BRP072C (and units with it built in): HTTPS with a self-signed
  certificate; the 13-digit key printed on the adapter registers LSH once
  (GET /common/register_terminal?key=…, header X-Daikin-uuid).
```

```
  GET /common/basic_info        name (url-encoded), mac, ver
  GET /aircon/get_control_info  pow, mode, stemp, shum, f_rate, f_dir,
                                dt1…dt7 / dh1…dh7 (last temp / humidity per mode)
  GET /aircon/get_sensor_info   htemp (room), otemp (outdoor), hhum
  GET /aircon/set_control_info?pow&mode&stemp&shum&f_rate&f_dir   (all required)
  answers are "ret=OK,key=value,…"
```

```
  mode   0/1/7 auto, 2 dry, 3 cool, 4 heat, 6 fan
  f_rate A auto, B silent, 3–7 level 1–5;  f_dir 0 off, 1 vertical, 2 horizontal, 3 both
```

Newer units that only work with the Daikin Onecta app (cloud) have no local
API and aren't covered — use them through Home Assistant / Matter.

One LSH device per unit, `daikin/<mac>`, with the shared AC model of
src/ac-common.js (power, mode, set temperature, fan, swing, room / outdoor
temperature, humidity; HomeKit thermostat).

```
config.daikin = { devices: [{ host, key?, uuid?, name? }], pollInterval = 30 (s) }
  key  — BRP072C only: the 13-digit key on the adapter label (https is used then,
         unless host is given as an explicit http:// URL)
```
Tested against scripts/daikin-simulator.js (test/daikin.test.js) — not yet
against a real unit.

---

| Aspect | Value |
|---|---|
| Config section(s) | `daikin` |
| Enabled when | `config.daikin?.devices?.length` |
| Platform-status key | `daikin` |
| Registers devices | `daikin/…` |
| npm dependencies | none |
| Other files | `src/ac-common.js` `src/polling-client.js` |
| Routes | — |
| Tests | `test/daikin.test.js` `scripts/daikin-simulator.js` |

*Extracted from the header of `src/daikin-client.js`. Source is authoritative — regenerate this page if the module changes.*
