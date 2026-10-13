# `src/dsc-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~365 lines**  ·  installable module `dsc`

DSC PowerSeries Neo alarm panels via a TL280 / TL2803G / 3G2080 IP communicator, over DSC's ITv2 integration protocol (src/dsc-itv2.js).

LSH is the "integration server": the panel dials IN to us (TCP 3072 by default) — nothing to poll, state changes are pushed. Program the panel once at the keypad ([*][8] + installer code), group 1 shown:

```
[851][422]  Integration ID (read-only, 12 digits — note it down)
[851][425]  Integration options: bits 3, 4, 5 on
[851][426]  Notifications: bit 3 only
[851][428]  Integration server IP = this LSH host
[851][429]  Integration server port, hex: 0C00 = 3072
[851][700]  Type 2 access key, 32 hex characters
```

(Settings → Security → DSC shows the same steps.)

```
config.dsc: { port = 3072, bindHost = '0.0.0.0', type2Key, type1Code?,
integrationId? (Type 1 only), userCode (arm/disarm), zoneTypes?: { n:
'motion'|'contact'|'none' }, allZones? (register every zone, not just
named/active ones) }
```

Protocol port verified byte-for-byte against the reference implementation (test/dsc-itv2.test.js). Real-panel behaviour is from that project's testing (HS2032 + TL280); see its docs for firmware quirks.

---

| Aspect | Value |
|---|---|
| Config section(s) | `dsc` |
| Enabled when | `config.dsc?.enabled && (config.dsc?.type2Key \|\| config.dsc?.type1Code)` |
| Platform-status key | `dsc` |
| Registers devices | `dsc/…` |
| npm dependencies | none |
| Other files | `src/dsc-itv2.js` |
| Routes | `src/routes/dsc.js` |
| Tests | `test/dsc-client.test.js` |

*Extracted from the header of `src/dsc-client.js`. Source is authoritative — regenerate this page if the module changes.*
