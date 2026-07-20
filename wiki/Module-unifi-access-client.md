# `src/unifi-access-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~142 lines**

Connects to **UniFi Access** — a separate product/token from `unifi-protect-client.js` even when hosted on the same console. Uses Access's local "Developer API" on a fixed port (`12445`), authenticated with a single Bearer token (no session/cookie handshake). Discovers every door and registers it with a `contact` sensor (door position) and a controllable `lock` sensor exposed to HomeKit as a lock. Polls every 30 s.

Only **unlock** is a real remote action — Access doors re-lock themselves on their own configured schedule/timeout, and the Developer API has no "lock now" call. Sending `lock` is a deliberate no-op (logged); the next poll reconciles the store back to the door's true state.

**Config:**
```json
"unifiAccess": { "host": "192.168.1.1", "apiKey": "" }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class UnifiAccessClient` |
| Config section(s) | `unifiAccess` |
| Platform-status key | `unifiAccess` |
| Device key prefix | `unifiAccess/…` |
| Store keys written | `unifiAccess` |
| Registers devices | yes (via sensor-registry) |
| Poll interval(s) | 30 s |
| Internal deps | `platform-status` |
| Node built-ins | `https`, `events` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`unifi-protect-client.js`](Module-unifi-protect-client) — the other UniFi product this repo integrates, on the same console but a different local API/port/token

See the [Configuration Reference](Configuration) for the `unifiAccess` section.

---

*Extracted from `src/unifi-access-client.js`. Source is authoritative — regenerate this page if the module changes.*
