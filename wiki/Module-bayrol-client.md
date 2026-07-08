# `src/bayrol-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~230 lines**

Integrates **Bayrol Pool Manager Connect** pool chemistry monitors via cloud-brokered MQTT.

**Credential flow:** HTTP session login → pool discovery (`plants.php`) → per-pool access token exchange (`device.php` + `/api/?code=`) → MQTT WebSocket connection.

**MQTT:** Connects to `wss://www.bayrol-poolaccess.de:8083` using the per-pool `accessToken` as the MQTT username and `*` as password. Subscribes to `d02/<deviceSerial>/v/#` and publishes to `d02/<deviceSerial>/g/<uid>` to request initial values.

**Value transforms:**

| UID | Sensor | Transform |
|---|---|---|
| `4.78` | pH | raw ÷ 10 |
| `4.82` | ORP (mV) | as-is |
| `4.98` | Temperature (°C) | raw ÷ 10 |
| `4.100` | Salt (g/L) | raw ÷ 10 |

**Config:** See [`bayrol`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class BayrolClient` |
| Config section(s) | `bayrol` |
| Platform-status key | `bayrol` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | `mqtt` |
| Node built-ins | `https` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `bayrol` section.

---

*Extracted from `src/bayrol-client.js`. Source is authoritative — regenerate this page if the module changes.*
