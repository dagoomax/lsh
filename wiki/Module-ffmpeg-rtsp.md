# `src/ffmpeg-rtsp.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Media  ·  **~86 lines**

Runs a per-camera **FFmpeg RTSP proxy** so Loxone, VLC, or any RTSP client can connect to a stable local URL without needing access to the original camera credentials or stream format.

**How it works:**
1. For each camera entry in `config.cameras` that has a `url` (RTSP source), an FFmpeg process is spawned on `basePort + cameraIndex`
2. FFmpeg uses `-rtsp_flags listen` — it waits passively for a client to connect before opening the source stream (truly on-demand, no wasted bandwidth)
3. When the client disconnects FFmpeg exits; the module restarts it after 2 s so it's ready for the next connection
4. The proxy URL follows the pattern `rtsp://<server-ip>:<port>/<camera-slug>` where `slug` is the camera name lowercased and hyphenated

**Status:** The Settings page **Cameras → FFmpeg RTSP Proxy** table shows each camera's URL and whether the FFmpeg process is currently active (client connected) or waiting.

**Requires:** `ffmpeg` binary on `$PATH`, or set `ffmpegRtsp.ffmpegPath` to the absolute path.

**Config:** See [`ffmpegRtsp`](Configuration) config section (see [Configuration](Configuration)).

---

## At a glance

| Aspect | Value |
|---|---|
| Exports | `class FFmpegRTSP` |
| Config section(s) | `cameras`, `ffmpegRtsp` |
| Internal deps | — |
| Node built-ins | `child_process` |

See the [Configuration Reference](Configuration) for the `cameras` / `ffmpegRtsp` sections.

---

*Extracted from `src/ffmpeg-rtsp.js`. Source is authoritative — regenerate this page if the module changes.*
