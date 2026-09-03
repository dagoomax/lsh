# `src/ocpp-server.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client (listener)  ·  **~267 lines**

Generic **OCPP 1.6-J Central System** for EV chargers. Unlike every other integration in this repo, charge points dial *into* LSH rather than LSH polling them — same category of pattern as the Grenton GATE HTTP listener. Any charger speaking standard OCPP 1.6-J works, regardless of brand.

**Transport:** a `ws` `WebSocket.Server` on `config.ocpp.port` (default 9000), negotiating the `ocpp1.6` subprotocol. Charge points connect to `ws://<lsh-host>:<port>/ocpp/<chargePointId>`; the `<chargePointId>` URL segment becomes the device key `ocpp/<chargePointId>`.

**Inbound (charge point → LSH):** `BootNotification` (auto-registers the device on first contact), `Heartbeat`, `StatusNotification` (→ `status`/`charging` sensors), `MeterValues` (→ `power`/`energy`), `Authorize` (always accepted — no auth backend for a home charger), `StartTransaction`/`StopTransaction` (session tracking).

**Outbound (LSH → charge point):** `RemoteStartTransaction`/`RemoteStopTransaction` for the `charging` toggle, `SetChargingProfile` (a `TxDefaultProfile` with an `Absolute` amp limit) for the `currentLimit` range — the spec-correct way to limit current in OCPP 1.6, unlike the vendor-specific tricks the other EV clients need.

Each connection tracks its own pending-call table (`Map<uniqueId, {resolve,reject}>`) so outbound Calls can await their `CallResult`/`CallError` with a 10 s timeout.

**Config:** See [`ocpp`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class OcppServer` |
| Config section(s) | `ocpp` |
| Platform-status key | `ocpp` |
| Registers devices | yes (via sensor-registry, on `BootNotification`) |
| Polling | none — event-driven over a persistent WebSocket |
| Internal deps | `platform-status` |
| npm deps | `ws` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`goecharger-client.js`](Module-goecharger-client), [`wallbox-client.js`](Module-wallbox-client), [`easee-client.js`](Module-easee-client), [`zaptec-client.js`](Module-zaptec-client) — sibling EV-charger integrations sharing the same device/sensor convention.

See the [Configuration Reference](Configuration) for the `ocpp` section.

---

*Extracted from `src/ocpp-server.js`. Source is authoritative — regenerate this page if the module changes.*
