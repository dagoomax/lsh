# `src/mqtt-explorer.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Victron / MQTT  ·  **~115 lines**

Subscribes to `#` on the same MQTT broker as `mqtt-client.js`. Maintains a map of all topics with their last value, timestamp, and a ring-buffer history (last 100 messages per topic). Serves the MQTT Explorer page and exposes publish via `POST /api/mqtt-explorer/publish`.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class MqttExplorer` |
| Config section(s) | `mqtt` |
| Internal deps | `platform-status` |
| npm packages | `mqtt` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `mqtt` section.

---

*Extracted from `src/mqtt-explorer.js`. Source is authoritative — regenerate this page if the module changes.*
