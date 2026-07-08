# `src/denon-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~213 lines**

Integrates **Denon** and **Marantz** AV receivers via the **Telnet ASCII control protocol** (TCP port 23). No external npm packages.

**Connection lifecycle:** `net.createConnection` with 35 s socket timeout used as a keepalive heartbeat (a query is sent on timeout to reset it). Reconnects in 15 s on `close`. On connect, immediately queries `PW?`, `MV?`, `MU?`, `SI?` and starts a 30 s polling interval.

**Response parser:** Lines are CR-terminated (`\r`). Parsed prefixes:

| Prefix | Example | Meaning |
|---|---|---|
| `PW` | `PWON`, `PWSTANDBY` | Power state |
| `MV` | `MV50`, `MV505`, `MVMAX80` | Volume (half-dB steps; `MVMAX` ignored) |
| `MU` | `MUON`, `MUOFF` | Mute state |
| `SI` | `SICD`, `SIBT`, `SISAT/CBL` | Active input |

The receiver pushes unsolicited updates whenever state changes (e.g. when the user presses the physical remote), so the dashboard stays in sync without aggressive polling.

**Input selection:** When `inputs` are configured, an `input_idx` range sensor is registered carrying an `inputNames` array in its descriptor. The dashboard reads this array to render input selection pills. Clicking a pill sends `SI<INPUT>` (e.g. `SIBT` for Bluetooth).

**Commands sent:** `PWON` / `PWSTANDBY`, `MV##` (zero-padded), `MUON` / `MUOFF`, `SI<INPUT>`.

**Config:** See [`denon`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class DenonClient` |
| Config section(s) | `denon` |
| Platform-status key | `denon` |
| Registers devices | yes (via sensor-registry) |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | `platform-status` |
| Node built-ins | `net` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `denon` section.

---

*Extracted from `src/denon-client.js`. Source is authoritative — regenerate this page if the module changes.*
