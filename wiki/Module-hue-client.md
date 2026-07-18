# `src/hue-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~215 lines**

**Philips Hue** via the local bridge (CLIP v1 REST API — supported by every bridge generation). Lights, plugs and Zigbee accessories are auto-discovered and polled every `pollInterval` seconds (default 5). Color/white-ambiance lights expose brightness, color temperature and hue/saturation with full HomeKit color control (`light-rw`); plugs are switches; the three v1 sensors of a Hue motion sensor (presence / temperature / light level) are grouped by Zigbee MAC into one device with motion, °C, lux and battery; dimmer switches report their last `buttonevent`. Values are normalized to LSH conventions (0–100 scales, Kelvin, °C, lux). One-off pairing via `scripts/hue-auth.js` (link button); `scripts/hue-simulator.js` emulates a bridge for hardware-free development.

**Config:**
```json
"hue": { "host": "192.168.1.x", "username": "", "pollInterval": 5 }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class HueClient` |
| Platform-status key | `hue` |
| Device key prefix | `hue/…` |
| Store keys written | `hue` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | — |
| Node built-ins | `http` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

---

*Extracted from `src/hue-client.js`. Source is authoritative — regenerate this page if the module changes.*
