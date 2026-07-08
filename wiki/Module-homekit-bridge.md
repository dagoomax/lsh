# `src/homekit-bridge.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** HomeKit  ·  **~1135 lines**

HAP-nodejs bridge. Registers HomeKit accessories for:

- **Relays** — as `Switch` services
- **Sensors** — temperature, humidity, motion, contact, smoke, CO, leak, occupancy, battery, lux, CO₂, thermostat, lock, cover, fan
- **Cameras** — via `homekit-camera.js` (streaming stubs)

Accessory state is driven by sensor registry updates. Commands from HomeKit (e.g. toggle a switch) are routed through `relay-controller.js` or `sensor-registry.js`.

**Config keys used:** `homekit.pin`, `homekit.port`, `homekit.username`

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `startHomekitBridge` |
| Config section(s) | `relays`, `cameras`, `homekit` |
| Internal deps | `homekit-uri`, `homekit-camera` |
| npm packages | `hap-nodejs` |

## Related module pages

- [`homekit-uri.js`](Module-homekit-uri)
- [`homekit-camera.js`](Module-homekit-camera)

See the [Configuration Reference](Configuration) for the `relays` / `cameras` / `homekit` sections.

---

*Extracted from `src/homekit-bridge.js`. Source is authoritative — regenerate this page if the module changes.*
