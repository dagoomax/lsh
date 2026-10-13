# `src/karcher-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~697 lines**  ·  installable module `karcher`

Kärcher Home Robots cloud client (RCV5, RCV3, RCF5) — MQTT transport over 3iRobotix's cloud, not Kärcher's own servers. There is no local API for these robots; the official app itself goes through this same cloud, so an outage on 3iRobotix's end makes the robot unreachable here too — same tradeoff as roborock-cloud-client.js.

Protocol ported from the MIT-licensed python-karcher (github.com/lafriks/python-karcher — login/signing/encryption/property poll) and cross-checked against the karcher-rcv5-ha Home Assistant integration (github.com/vosadci/karcher-rcv5-ha) for the command set neither project's README documents on its own (start/pause/stop/dock/ locate/fan-speed — verified against real RCV5 hardware by that project).

Map: fetched over REST (storage-management getAccessUrl → signed download) and rendered server-side by karcher-map.js — see fetchMapPng below.

Not implemented (out of scope for v1): per-room/zone cleaning, mop-water level control. Whole-home clean + pause/stop/ dock/locate/fan-speed/cleaning-mode covers the common case; room selection would need its own UI (see roborock-cloud-client.js's rooms support for what that'd look like) and is a reasonable follow-up, not a blocker for a first working integration.

---

| Aspect | Value |
|---|---|
| Config section(s) | `karcher` |
| Enabled when | `config.karcher?.email` |
| Platform-status key | `karcher` |
| Registers devices | `karcher/…` |
| npm dependencies | `jpeg-js` |
| Other files | `src/karcher-map.js` `src/roborock-map.js` |
| Routes | `src/routes/cameras.js` `src/routes/roborock.js` |
| Tests | — |

*Extracted from the header of `src/karcher-client.js`. Source is authoritative — regenerate this page if the module changes.*
