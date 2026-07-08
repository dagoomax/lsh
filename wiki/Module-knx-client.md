# `src/knx-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~169 lines**

Integrates **KNX** bus devices via a **KNXnet/IP gateway or IP router** over the local network.

**Protocol:** Uses the `knx` npm package (`npm install knx`) which connects to the gateway via KNXnet/IP UDP tunneling. The gateway host and port (`3671`) are configured in `config.json`.

**Group address lifecycle:**
1. On connect, issues a read request for every group address with `readable: true`
2. Listens for `GroupValue_Write` and `GroupValue_Response` telegrams from the bus
3. Decodes raw KNX bytes to JavaScript values using the configured DPT
4. Updates the sensor registry so values appear on the dashboard in real time

**DPT decoding:**
- `DPT1` — 1-bit boolean
- `DPT5` — 1-byte unsigned integer (0–255)
- `DPT9` — 2-byte KNX float (sign + 4-bit exponent + 11-bit mantissa, 0.01 resolution)
- `DPT14` — 4-byte IEEE 754 big-endian float

**Write commands:** Writable group addresses accept commands via `POST /api/device/knx%2F<host>/command`. Values are re-encoded to KNX wire format before sending.

**Config:** See [`knx`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class KNXClient` |
| Config section(s) | `knx` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | — |
| npm packages | `knx` |
| Node built-ins | `events` |

See the [Configuration Reference](Configuration) for the `knx` section.

---

*Extracted from `src/knx-client.js`. Source is authoritative — regenerate this page if the module changes.*
