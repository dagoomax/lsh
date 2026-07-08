# `src/homekit-camera.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** HomeKit  ·  **~181 lines**

Registers camera accessories in the HomeKit bridge using the `CameraController` API. Provides still image snapshots via `snapshotUrl`. Video streaming requires a native RTSP-capable accessory (e.g., a dedicated camera bridge); this module provides the HomeKit pairing stub.

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class CameraDelegate` |
| Internal deps | — |
| npm packages | `hap-nodejs` |
| Node built-ins | `child_process` |

---

*Extracted from `src/homekit-camera.js`. Source is authoritative — regenerate this page if the module changes.*
