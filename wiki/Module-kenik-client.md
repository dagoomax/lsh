# `src/kenik-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~141 lines**

**KENIK** (Eltrox) cameras and DVR/XVR recorders. One config section covers a DVR (several `channels` on the same host) and standalone IP cameras (per-channel `host` override); channels are read fresh from `config.json` on every call, so Settings edits apply without a restart (same pattern as [`reolink-client.js`](Module-reolink-client)). KENIK shipped three RTSP URL generations, selectable via `urlStyle`: `kenik` (DVR/XVR, `mode=real&idc=<ch>&ids=<1|2>`), `xm` (older XiongMai path), `simple` (newer cameras, `:8554/ch<NN>`), plus a raw `urlTemplate` escape hatch. There is no uniform HTTP snapshot API, so snapshots are grabbed from the RTSP stream with **ffmpeg** (one frame, cached 10 s, honors `ffmpegRtsp.ffmpegPath`) and proxied through `GET /api/kenik/snapshot/:idx` so credentials never reach the browser. Cameras are merged into `GET /api/cameras` alongside UniFi/Reolink.

**Config:**
```json
"kenik": { "host": "192.168.1.90", "username": "admin", "password": "", "urlStyle": "kenik", "channels": [ { "name": "Podjazd", "channel": 1 } ] }
```

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class KenikClient`, `buildRtspUrl` |
| Platform-status key | — |
| Device key prefix | — (camera list only) |
| Store keys written | — |
| Registers devices | no (merged into `GET /api/cameras`) |
| Internal deps | — |
| npm packages | — |
| Node built-ins | `child_process`, `fs`, `path` |

## Related module pages

- [`reolink-client.js`](Module-reolink-client)
- [`ffmpeg-rtsp.js`](Module-ffmpeg-rtsp)

---

*Extracted from `src/kenik-client.js`. Source is authoritative — regenerate this page if the module changes.*
