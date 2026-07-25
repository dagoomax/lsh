# `src/unifi-protect-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~420 lines**

Connects to **UniFi Protect**. Two API modes, selected by which credentials are configured:

- **`apiKey`** (preferred) — the official **Protect Integration API** (`/proxy/protect/integration/v1`, `X-API-Key` header; key created under Protect → Settings → Control Plane → Integrations, Protect 5.3+). Doorbell rings, camera motion, and sensor open/close arrive in real time over the `wss://…/subscribe/events` WebSocket (`ws` module, auto-reconnect with 5 s → 60 s backoff); a 30 s poll reconciles slow values (temperature/humidity/lux/battery).
- **`username`/`password`** (legacy fallback) — the private cookie-login API (`/proxy/protect/api`). Rings are detected by polling each doorbell's `lastRing` every `ringPollInterval` seconds (default 3).

Discovers all cameras (registered into the dashboard camera list with snapshot proxying) and Protect sensors. Doorbells get `doorbell` + `motion` store keys; a ring pulses `doorbell` to 1 for 3 s so Loxone virtual inputs see an edge.

**Config:**
```json
"unifi": { "host": "192.168.1.1", "apiKey": "", "username": "", "password": "", "ringPollInterval": 3 }
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
| Poll interval(s) | 30 s (+ `ringPollInterval` in legacy mode) |
| Real-time | Integration API event WebSocket (`/v1/subscribe/events`) |
| Internal deps | `platform-status` |
| Node built-ins | `https`, `events` |
| npm deps | `ws` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `unifi` section.

---

*Extracted from `src/unifi-protect-client.js`. Source is authoritative — regenerate this page if the module changes.*
