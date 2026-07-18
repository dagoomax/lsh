# `src/roborock-cloud-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~836 lines**

**Roborock** vacuums via the Roborock cloud (no local token extraction needed). One-off login via `scripts/roborock-cloud-auth.js` (password or e-mail code); credentials and home/device data are persisted via `saveUserData`. Live state and commands flow over Roborock's cloud MQTT with the vendor's encrypted request/response protocol (AES/MD5 keys derived per session, gzip-packed payloads). Registers each vacuum with status, battery, cleaning and consumable-lifespan sensors (main/side brush, filter …) and dispatches commands (start/pause/dock, fan power) through the same channel. Map data is fetched and rendered to an image via [`roborock-map.js`].

**Config:**
```json
"roborock": { "cloud": { "email": "you@example.com" } }
```
*(session credentials and device data live in `persist/`, written by the auth script)*

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class RoborockCloudClient`, login/API helpers (`roborockLogin`, `passwordLogin`, `sendEmailCode`, `codeLogin`, `fetchHomeDevices`, `saveUserData`, `mqttParams`) |
| Platform-status key | `roborock` |
| Device key prefix | `roborock/…` |
| Store keys written | `roborock` |
| Registers devices | yes (via sensor-registry) |
| Internal deps | `platform-status`, `roborock-map` |
| npm packages | `mqtt` |
| Node built-ins | `crypto`, `https`, `zlib`, `fs`, `path` |

## Related module pages

- [`platform-status.js`](Module-platform-status)
- [`roborock-client.js`](Module-roborock-client)

---

*Extracted from `src/roborock-cloud-client.js`. Source is authoritative — regenerate this page if the module changes.*
