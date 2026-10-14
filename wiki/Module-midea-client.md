# `src/midea-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~321 lines**  ·  installable module `midea`

Midea air conditioners — local LAN protocol (as used by msmart-ng and
midea-local). Covers the Midea-made units sold under Midea, Comfee,
Carrier, Toshiba (newer), Pioneer, Electrolux, Inventor, Qlima, Trotec,
Klimaire, Senville… on the Midea Air / NetHome Plus / SmartHome (MSmartHome)
apps.

TCP port 6444. Three layers:
```
  AA frame    the AC command: AA len AC 00 00 00 00 00 00 type | body | msgId crc8 | checksum
              query 0x41 → state 0xC0, set 0x40 (answered with a 0xC0 state)
  5A5A packet 40-byte header (device id, timestamp) + AES-128-ECB(frame,
              key md5(SIGN_KEY)) + md5(packet + SIGN_KEY)
  8370 (V3)   newer units (most since ~2019): a handshake with the unit's
              token (64 bytes) and key (32 bytes) gives a session key;
              5A5A packets then travel AES-256-CBC encrypted + sha256 signed.
              V2 units take the 5A5A packets as they are.
```

token / key come from the Midea cloud once — get them with
`pip install msmart-ng && msmart-ng discover <ip>` (prints id, token, key).

```
  state  power · mode 1 auto, 2 cool, 3 dry, 4 heat, 5 fan · target °C (0.5)
         fan 102 auto, 20 silent, 40 low, 60 medium, 80 high, 100 max
         swing 0 off, 0x0C vertical, 0x03 horizontal, 0x0F both
         indoor / outdoor temperature
```

One LSH device per unit, `midea/<id>`, with the shared AC model of
src/ac-common.js.

```
config.midea = { devices: [{ host, id, token?, key?, port = 6444, name?, beep = true }], pollInterval = 30 (s) }
```
Tested against scripts/midea-simulator.js (test/midea.test.js) — not yet
against a real unit.

---

| Aspect | Value |
|---|---|
| Config section(s) | `midea` |
| Enabled when | `config.midea?.devices?.length` |
| Platform-status key | `midea` |
| Registers devices | `midea/…` |
| npm dependencies | none |
| Other files | `src/ac-common.js` `src/polling-client.js` |
| Routes | — |
| Tests | `test/midea.test.js` `scripts/midea-simulator.js` |

*Extracted from the header of `src/midea-client.js`. Source is authoritative — regenerate this page if the module changes.*
