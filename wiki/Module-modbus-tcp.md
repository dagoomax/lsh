# `src/modbus-tcp.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Support  ·  **~111 lines**  ·  shipped with `anker-solix` and `zehnder`

Minimal Modbus TCP client for integrations that talk to one device over
Modbus TCP (Anker SOLIX, Zehnder ComfoConnect Pro): one socket, one
request at a time (queued), reconnects on demand. No npm dependency.

A Modbus exception answer rejects with an Error whose `code` is the
exception number (a number); socket / timeout errors carry no numeric code
— test with `typeof err.code === 'number'`.

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
| Tests | `test/anker-solix.test.js` `test/zehnder.test.js` |

*Extracted from the header of `src/modbus-tcp.js`. Source is authoritative — regenerate this page if the module changes.*
