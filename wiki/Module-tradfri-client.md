# `src/tradfri-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~226 lines**

Integrates with the **IKEA Tradfri** gateway via CoAP/DTLS using the `node-tradfri-client` package.

**First-run setup:** Set `securityCode` (from the sticker on the gateway). On startup the server prints generated `identity` and `psk` to the console — copy them into config and remove `securityCode` for all subsequent restarts.

```bash
npm install node-tradfri-client   # optional dependency
```

**Config:**
```json
"tradfri": {
  "host": "192.168.x.x",
  "securityCode": "XXXX-XXXX-XXXX",
  "identity": "",
  "psk": ""
}
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class TradfriWrapper` |
| Config section(s) | `tradfri` |
| Platform-status key | `tradfri` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status` |
| npm packages | `node-tradfri-client` |

## Related module pages

- [`platform-status.js`](Module-platform-status)

See the [Configuration Reference](Configuration) for the `tradfri` section.

---

*Extracted from `src/tradfri-client.js`. Source is authoritative — regenerate this page if the module changes.*
