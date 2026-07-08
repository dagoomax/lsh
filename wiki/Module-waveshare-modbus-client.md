# `src/waveshare-modbus-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~282 lines**

Waveshare Modbus TCP relay board client.

Speaks raw Modbus TCP (RFC 1683) over a persistent TCP socket.
No external library required — frames are built and parsed manually.

Supported boards: any Waveshare Modbus relay module reachable via TCP/IP,
including boards connected through a serial-to-Ethernet converter.

Config:
"waveshare": {
"devices": [
{ "name": "Gate Controller", "host": "192.168.1.x", "port": 502, "slaveId": 1, "relayCount": 8 }
]
}

Each relay is registered in the sensor registry as a controllable toggle
sensor. Commands arrive via POST /api/device/:key/command.

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class ModbusDevice`, `class WaveshareModbusClient` |
| Config section(s) | `waveshare` |
| Registers devices | yes (via sensor-registry) |
| Poll interval(s) | 5 s, 3 s, 15 s |
| Internal deps | `platform-status` |
| Node built-ins | `net` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `waveshare` section.

---

*Extracted from `src/waveshare-modbus-client.js`. Source is authoritative — regenerate this page if the module changes.*
