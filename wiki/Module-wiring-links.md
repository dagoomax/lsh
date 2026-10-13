# `src/wiring-links.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Support  ·  **~108 lines**

Links from the wiring emulator to real devices: which module (and which diagram) was installed, paired through which gateway, under which real id. Stored in persist/wiring-links.json (override with LSH_WIRING_LINKS).

realId: 'zwave:<homeId hex>:<nodeId>' — Z-Wave node in that network

```
       'mac:<AA:BB:…>'                — Wi-Fi / LAN device by MAC
       'host:<ip>'                    — LAN device whose MAC couldn't be read
       '<deviceKey>'                  — a device LSH already had (any gateway)
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
| Routes | `src/routes/wiring-pair.js` |
| Tests | `test/wiring-pair.test.js` |

*Extracted from the header of `src/wiring-links.js`. Source is authoritative — regenerate this page if the module changes.*
