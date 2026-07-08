# `src/platform-status.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Support  ·  **~21 lines**

Singleton `EventEmitter`. Each integration client calls `platformStatus.set(name, connected)` when its connection state changes. The websocket module forwards `change` events to all browsers as `platform-status` events, driving the colour-coded logo bar in the dashboard header.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class PlatformStatus` |
| Internal deps | — |
| Node built-ins | `events` |

---

*Extracted from `src/platform-status.js`. Source is authoritative — regenerate this page if the module changes.*
