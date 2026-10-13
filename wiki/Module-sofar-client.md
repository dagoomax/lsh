# `src/sofar-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~294 lines**  ·  installable module `sofar`

Sofar Solar inverter client (K-TLX grid-tie string inverter line) via the Solarman/LSW-3 WiFi data-logger dongle.

The LSW-3 dongle listens on TCP :8899 and speaks the "Solarman V5" protocol: a thin proprietary frame (start/length/control/sequence/logger- serial header, a fixed padding block, then checksum+end) wrapping a standard Modbus RTU request/response addressed to the inverter behind it. No cloud account, no API key — just the dongle's IP and the serial number printed on its label.

Frame layout is ported from https://github.com/jmccrohan/pysolarmanv5 (the de-facto reference implementation, used by many Home Assistant integrations for Deye/Sofar/Growatt loggers). One detail from that library doesn't reconcile on paper — the embedded Modbus response is sliced at a fixed byte offset (25) that's one byte short of what the request's own 15-byte padding block would suggest — but it's kept as-is (not "corrected") because it was cross-checked against a real captured response frame published in https://github.com/MichaluxPL/Sofar_LSW3's README, which decodes perfectly at offset 25 (byte 26 lands mid-way through the Modbus byte-count field otherwise). That same capture is also what confirms Modbus function 0x03 (Read Holding Registers) is what this inverter family uses, not 0x04.

Register map (addresses, scaling, enums) ported from that same project's SOFARMap.xml. Covers registers 0x0000-0x0027 — status, PV1/PV2, grid output, temperatures, and production counters. Sofar's other lines (hybrid HYD-xK-ES, three-phase KTL) are known to use different register numbers and are NOT covered here.

NOT verified against a real inverter from this codebase — ported from a documented, real-hardware-tested wire protocol and register map, but nobody has run this specific file against real hardware yet.

---

| Aspect | Value |
|---|---|
| Config section(s) | `sofar` |
| Enabled when | `config.sofar?.host` |
| Platform-status key | `sofar` |
| Registers devices | `sofar/…` |
| npm dependencies | none |
| Other files | — |
| Routes | `src/routes/sofar.js` |
| Tests | — |

*Extracted from the header of `src/sofar-client.js`. Source is authoritative — regenerate this page if the module changes.*
