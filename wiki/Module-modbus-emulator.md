# `src/modbus-emulator.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~386 lines**  ·  installable module `modbus-emulator`

Modbus device emulator — LSH answers Modbus queries as a server (TCP) or slave (RTU on RS-485), so PLCs, SCADA, Loxone, inverters or anything else that polls Modbus can read LSH values as registers.

```
config.modbusEmu = { enabled, devices: [{
id, name, enabled = true,
transport: 'tcp' | 'rtu',
port = 1502, bindHost = '0.0.0.0',            (tcp; 502 needs root/CAP_NET_BIND_SERVICE)
serialPort, baud = 9600, parity = 'none',      (rtu; needs the serialport package)
unitId = 1,                                    (tcp: 0/255 also answered)
strict = false,  — true: reading an unmapped register → exception 2; false: reads as 0
registers: [{
  table: 'holding' | 'input' | 'coil' | 'discrete',
  address, type: 'u16'|'i16'|'u32'|'i32'|'f32'|'string'|'bool', length (string, registers),
  wordOrder: 'be' | 'le' (32-bit types: high word first = 'be'),
  source: '<store key>' | value: <constant>, scale = 1 (raw = value × scale),
  writable = false, command: '<deviceKey>/<sensorPath>' (optional),
  label,
}] }] }
```

Writes (FC 5/6/15/16) are refused (exception 2) unless the register is writable. A write lands in emulator memory, is published to the store as modbus-emu/<id>/<table>/<address>, and — when `command` is set — is sent to that LSH device sensor (value ÷ scale). Reads of a written register return the written value until its source updates.

---

| Aspect | Value |
|---|---|
| Config section(s) | `modbusEmu` |
| Enabled when | `config.modbusEmu?.enabled` |
| Platform-status key | `modbusEmu` |
| Registers devices | — |
| npm dependencies | `serialport` |
| Other files | — |
| Routes | `src/routes/modbus-emu.js` |
| Tests | `test/modbus-emulator.test.js` |

*Extracted from the header of `src/modbus-emulator.js`. Source is authoritative — regenerate this page if the module changes.*
