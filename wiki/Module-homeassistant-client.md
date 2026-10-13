# `src/homeassistant-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~404 lines**  ·  installable module `homeassistant`

Home Assistant, both ways.

Import (HA → LSH): connects to HA's WebSocket API with a long-lived access token, mirrors the chosen entities as LSH devices (`ha/<entity_id>`), keeps them live from state_changed events and controls them via call_service.

Export (LSH → HA): publishes LSH devices to an MQTT broker using Home Assistant MQTT Discovery (`<prefix>/<component>/<node>/<object>/config`), so they appear in HA by themselves; states go to `<base>/<object>/state`, commands come back on `<base>/<object>/set`.

No loops: HA entities that are LSH's own exports (unique_id `<node>_…`) are never imported, and imported HA devices are never exported.

```
config.homeassistant = {
url: 'http://homeassistant.local:8123', token,
import: { enabled = true, domains = [light, switch, cover, climate, lock, fan,
          sensor, binary_sensor, input_boolean], entities: [] (empty = all in domains) },
export: { enabled = false, mqttUrl: 'mqtt://host:1883', username, password,
          prefix = 'homeassistant', base = 'lsh', node = 'lsh', types: [] (empty = all) },
}
```

Tested against scripts/homeassistant-simulator.js (test/homeassistant.test.js).

---

| Aspect | Value |
|---|---|
| Config section(s) | `homeassistant` |
| Enabled when | `(config.homeassistant?.url && config.homeassistant?.token) \|\| config.homeassistant?.export?.enabled` |
| Platform-status key | `homeassistant` |
| Registers devices | `ha/…` |
| npm dependencies | `ws` |
| Other files | — |
| Routes | `src/routes/cameras.js` `src/routes/homeassistant.js` |
| Tests | `test/homeassistant.test.js` `scripts/homeassistant-simulator.js` |

*Extracted from the header of `src/homeassistant-client.js`. Source is authoritative — regenerate this page if the module changes.*
