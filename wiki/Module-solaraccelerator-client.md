# `src/solaraccelerator-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~601 lines**  ·  installable module `solaraccelerator`

Solar Accelerator Connect gateway client (Deye-family hybrid inverters).

The SA Connect gateway is an ESP32 on the local network that speaks Modbus RTU to the inverter and exposes a flat HTTP snapshot — no cloud, no API key. Wire format, register map, and retry/tolerance behavior are ported from https://github.com/aLAN-LDZ/solaraccelerator_connect_ha (a Home Assistant custom_component for this same gateway), not guessed — register addresses/bit masks there are stated as confirmed against real hardware (a Deye SUN-12K-SG04LP3).

Untested against a real gateway from this codebase — ported faithfully from that reference implementation's documented wire protocol, but nobody has run this specific file against real hardware yet.

---

| Aspect | Value |
|---|---|
| Config section(s) | `solaraccelerator` |
| Enabled when | `config.solaraccelerator?.host` |
| Platform-status key | `solaraccelerator` |
| Registers devices | `solaraccelerator/…` |
| npm dependencies | none |
| Other files | — |
| Routes | — |
| Tests | `scripts/solaraccelerator-simulator.js` |

*Extracted from the header of `src/solaraccelerator-client.js`. Source is authoritative — regenerate this page if the module changes.*
