# `src/logger.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Support  ·  **~131 lines**

Wraps `console.log/warn/error` and mirrors output to per-category log files in `logs/`. Files are rotated at 2 MB (previous file saved as `<name>.1.log`).

Category is inferred from the `[PREFIX]` at the start of each log message.

**Categories:** `app`, `mqtt`, `vrm`, `connection`, `smartthings`, `shelly`, `satel`, `unifi`, `homekit`, `server`, `sensors`, `solaredge`, `websocket`

**API:**

```js
logger.categories()      // → ['app', 'mqtt', ...]
logger.tail(name, 300)   // → string[]  (last N lines)
logger.clear(name)       // truncates the file
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class Logger` |
| Internal deps | — |
| Node built-ins | `fs`, `path` |

---

*Extracted from `src/logger.js`. Source is authoritative — regenerate this page if the module changes.*
