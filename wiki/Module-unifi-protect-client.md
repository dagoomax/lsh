# `src/unifi-protect-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~312 lines**

Connects to **UniFi Protect** via its local HTTPS API. Authenticates with API key (UniFi Network 8+) or username/password. Discovers all cameras and registers them into the camera list so they appear in the dashboard. Subscribes to the real-time event WebSocket for motion and smart detection alerts, which are forwarded to `camera-log.js`.

**Config:**
```json
"unifi": { "host": "192.168.1.1", "username": "admin", "password": "secret", "apiKey": "" }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class UnifiProtectClient` |
| Config section(s) | `unifi` |
| Platform-status key | `unifi` |
| Device key prefix | `unifi/…` |
| Store keys written | `unifi` |
| Registers devices | yes (via sensor-registry) |
| Poll interval(s) | 30 s |
| Internal deps | `platform-status` |
| Node built-ins | `https`, `events` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `unifi` section.

---

*Extracted from `src/unifi-protect-client.js`. Source is authoritative — regenerate this page if the module changes.*
