# `src/homekit-bridge.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** HomeKit  ·  **~1642 lines**

HAP-nodejs bridge. Registers HomeKit accessories for:

- **Relays** — as `Switch` services
- **Sensors** — temperature, humidity, motion, contact, smoke, CO, leak, occupancy, battery, lux, CO₂, thermostat, lock, cover, fan
- **Cameras** — via `homekit-camera.js` (streaming stubs)

Accessory state is driven by sensor registry updates. Commands from HomeKit (e.g. toggle a switch) are routed through `relay-controller.js` or `sensor-registry.js`.

**Bridge pool:** accessories are spread over as many bridges as needed (HAP's 150-accessory limit); HKSV cameras are published standalone.

**Keeping things out of HomeKit:** `homekit.exclude = { devices, types, cameras, scenes, relays }` — single devices (by key), whole integrations (device `type`), cameras (by name), scenes and GX relays. Settings → HomeKit → *Not in HomeKit*; applied live (accessories removed from / added back to the running bridge, no restart; standalone cameras on the next restart). A device that comes back is a new accessory — its Home-app room and name reset. API: `GET /api/homekit/accessories`, `POST /api/settings/homekit-exclude`; `test/homekit-exclude.test.js` runs an isolated loopback bridge (`LSH_HAP_DIR`).

**Config keys used:** `homekit.pin`, `homekit.port`, `homekit.username`, `homekit.setupID`, `homekit.exclude`, `homekit.advertiser`, `homekit.bind`

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
