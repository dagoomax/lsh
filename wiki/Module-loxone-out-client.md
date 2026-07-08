# `src/loxone-out-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~61 lines**

Forwards DataStore values to a **Loxone Miniserver** via HTTP GET to Virtual Input endpoints — no Loxone polling required.

**How it works:** On `start()`, subscribes to the DataStore `change` event. When a watched key changes, the new value is sent to the configured Virtual Input within 200 ms (debounced to absorb rapid bursts). Uses Basic auth over HTTP.

**Endpoint:** `GET http://<host>/dev/sps/io/<virtualInput>/<value>` — standard Loxone Virtual Input HTTP command interface.

**Config:** See [`loxoneOut`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class LoxoneOutClient` |
| Config section(s) | `loxoneOut` |
| Platform-status key | `loxoneOut` |
| Internal deps | `platform-status` |
| Node built-ins | `http` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `loxoneOut` section.

---

*Extracted from `src/loxone-out-client.js`. Source is authoritative — regenerate this page if the module changes.*
