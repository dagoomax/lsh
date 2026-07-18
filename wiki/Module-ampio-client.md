# `src/ampio-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~191 lines**

**Ampio** smart home (CAN modules) via the MQTT broker on the **M-SERV** (same credentials as the Smart Home Manager app). States arrive on `ampio/from/<MAC>/state/<type>/<idx>` topics (`t` temperature, `i` binary input, `o` binary output, `a` analogue 0–255, `au` 8-bit level, `f` flags); commands are published to `ampio/to/<MAC>/<o|f>/<idx>/cmd` (`on`/`off`, 0–255, or 0=STOP / 1=DOWN / 2=UP for roller modules). There is no discovery API — devices are declared in `config.ampio.devices` by module MAC + input/output index. Device types: `light` / `switch` / `flag` / `dimmer` (controllable, HomeKit-exposed), `blind` (momentary up/down/stop), `temperature`, `contact` / `motion`, `sensor`. Per-device `stateType` / `stateTopic` / `commandTopic` overrides cover unusual layouts. `scripts/ampio-simulator.js` provides a self-contained broker + fake modules for hardware-free development.

**Config:**
```json
"ampio": { "host": "192.168.1.x", "port": 1883, "username": "", "password": "", "devices": [ { "name": "Lampa salon", "mac": "1C4A", "type": "light", "index": 1 } ] }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class AmpioClient` |
| Platform-status key | `ampio` |
| Device key prefix | `ampio/…` |
| Store keys written | `ampio` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | `mqtt` |
| Node built-ins | — |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/ampio-client.js`. Source is authoritative — regenerate this page if the module changes.*
