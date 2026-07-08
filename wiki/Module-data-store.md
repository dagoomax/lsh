# `src/data-store.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Core  ·  **~175 lines**

Singleton in-memory store. The `ConnectionManager` writes to it; `api-routes.js` and `websocket.js` read from it.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class DataStore` |
| Poll interval(s) | 30 s |
| Internal deps | — |
| Node built-ins | `events`, `fs`, `path`, `zlib` |

---

*Extracted from `src/data-store.js`. Source is authoritative — regenerate this page if the module changes.*
