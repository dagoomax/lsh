# `src/mqtt-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~142 lines**

Connects to the local Victron Venus OS / Cerbo GX MQTT broker. Subscribes to `N/<portalId>/#` for live metrics and publishes relay commands to `W/<portalId>/...`.

Auto-discovers the portal ID from the first retained message if not set in config. Emits a `keepalive` payload every 60 s to prevent the broker from going silent.

**Config keys used:** `mqtt.host`, `mqtt.port`, `mqtt.portalId`

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class MqttClient` |
| Config section(s) | `mqtt` |
| Polling | uses `setInterval` (interval from config/default) |
| Internal deps | — |
| npm packages | `mqtt` |
| Node built-ins | `events` |

See the [Configuration Reference](Configuration) for the `mqtt` section.

---

*Extracted from `src/mqtt-client.js`. Source is authoritative — regenerate this page if the module changes.*
