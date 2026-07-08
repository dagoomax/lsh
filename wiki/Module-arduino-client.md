# `src/arduino-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~200 lines**

Generic **MQTT subscriber** for Arduino, ESP32, ESP8266, and any microcontroller publishing JSON over MQTT. No external npm packages (uses the `mqtt` package already required by the project).

**Subscription strategy:**
- **Device-level topic** (`stateTopic` on the device): receives a single JSON object; each key matching a sensor's `path` (or `jsonKey`) updates that sensor's value in the DataStore.
- **Per-sensor topic** (`stateTopic` on a sensor): receives a raw single-value payload; the value is coerced and stored directly.

**Payload coercion:** `"1"` / `"true"` / `"on"` → `1` (numeric), `"0"` / `"false"` / `"off"` → `0`, numeric strings → float, everything else kept as string.

**Command dispatch:**
- Toggle sensors with a per-sensor `commandTopic` → publishes the raw `payloadOn` / `payloadOff` string.
- Toggle sensors using the device `commandTopic` → publishes `{ sensorPath: payloadOn/Off }` as JSON.
- Range sensors → publishes the numeric value as a string.

**Sensor types:**
| `type` | Dashboard control | Command payload |
|---|---|---|
| _(omitted)_ | Read-only value display | — |
| `"toggle"` | On/Off toggle switch | `payloadOn` or `payloadOff` |
| `"range"` | Slider (`min`–`max`) | Numeric string |

**Config:** See [`arduino`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class ArduinoClient` |
| Config section(s) | `arduino`, `mqtt` |
| Platform-status key | `arduino` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | `mqtt` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `arduino` / `mqtt` sections.

---

*Extracted from `src/arduino-client.js`. Source is authoritative — regenerate this page if the module changes.*
