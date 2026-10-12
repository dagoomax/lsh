# LSH REST API — endpoint reference

Full HTTP method + URL for every LSH dashboard API route. Host shown as `http://<lsh-host>:3001` — use `http://localhost:3001` on-box, or your LSH server's address.

**Auth:** every `/api/*` route requires authentication except the bootstrap `POST /api/auth/setup` and `POST /api/auth/login`. Authenticate with any of:
- Query param: `?token=<API_TOKEN>`
- Header: `Authorization: Bearer <API_TOKEN>` (API token or session JWT)
- Session cookie (browser login)

API tokens are created under Settings → API Tokens (`POST /api/auth/tokens`). `:param` = path variable; `:deviceKey(*)` captures a slashed key such as `somfy/io___2028-5589-5601_11600128`.

Regenerate the machine-readable spec with `node scripts/gen-openapi.js` → `public/openapi.json` (served at `/openapi.json`).

**Total routes: 166**

## Auth

```
POST   http://<lsh-host>:3001/api/auth/setup
POST   http://<lsh-host>:3001/api/auth/login
POST   http://<lsh-host>:3001/api/auth/logout
GET    http://<lsh-host>:3001/api/auth/me
POST   http://<lsh-host>:3001/api/auth/change-password
GET    http://<lsh-host>:3001/api/auth/users
POST   http://<lsh-host>:3001/api/auth/users
DELETE http://<lsh-host>:3001/api/auth/users/:id
GET    http://<lsh-host>:3001/api/auth/tokens
POST   http://<lsh-host>:3001/api/auth/tokens
DELETE http://<lsh-host>:3001/api/auth/tokens/:id
GET    http://<lsh-host>:3001/api/connection
GET    http://<lsh-host>:3001/api/status
GET    http://<lsh-host>:3001/api/battery
GET    http://<lsh-host>:3001/api/solar
GET    http://<lsh-host>:3001/api/grid
GET    http://<lsh-host>:3001/api/loads
GET    http://<lsh-host>:3001/api/relays
POST   http://<lsh-host>:3001/api/relay/:index/state
```

## Devices / Sensors

```
GET    http://<lsh-host>:3001/api/devices
GET    http://<lsh-host>:3001/api/devices/:deviceKey(*)
POST   http://<lsh-host>:3001/api/device/:deviceKey(*)/command
GET    http://<lsh-host>:3001/api/device/:deviceKey(*)/set
```

## History

```
GET    http://<lsh-host>:3001/api/history/:key(*)          # ?hours=N — beyond 6h, only Mongo-backed if configured (see `mongo` config)
GET    http://<lsh-host>:3001/api/history-status           # { mongoEnabled, retentionDays, bufferHours }
```

## Loxone Config XML templates

```
GET    http://<lsh-host>:3001/api/loxone/inputs.xml
GET    http://<lsh-host>:3001/api/loxone/outputs.xml
```

## Automation (rules / scenes / notifications)

```
GET    http://<lsh-host>:3001/api/automation/rules
POST   http://<lsh-host>:3001/api/automation/rules
DELETE http://<lsh-host>:3001/api/automation/rules/:id
GET    http://<lsh-host>:3001/api/automation/scenes
POST   http://<lsh-host>:3001/api/automation/scenes
DELETE http://<lsh-host>:3001/api/automation/scenes/:id
POST   http://<lsh-host>:3001/api/automation/scenes/:id/run
GET    http://<lsh-host>:3001/api/automation/notifications
POST   http://<lsh-host>:3001/api/automation/notifications
DELETE http://<lsh-host>:3001/api/automation/notifications
```

## Satel INTEGRA

```
GET    http://<lsh-host>:3001/api/satel/zones
GET    http://<lsh-host>:3001/api/satel/outputs
GET    http://<lsh-host>:3001/api/satel/partitions
GET    http://<lsh-host>:3001/api/satel/status
POST   http://<lsh-host>:3001/api/satel/output/:num
POST   http://<lsh-host>:3001/api/satel/partition/:num/:action(arm|disarm)
```

## Cameras

```
GET    http://<lsh-host>:3001/api/cameras
```

## Local object detection (COCO-SSD) model selection

```
GET    http://<lsh-host>:3001/api/settings/object-detection/model   # { base, loading, loaded, error, options: [{id, label}] }
POST   http://<lsh-host>:3001/api/settings/object-detection/model   # { model: lite_mobilenet_v2|mobilenet_v2|mobilenet_v1 } — downloads + validates before persisting
```

GET always succeeds (shows `base: null` if not running); POST 503s unless `objectDetection.cameras` has at least one entry — the client (and its model) only load when there's a camera to run it against.

## Camera PTZ

`:backend` is one of `reolink` | `axis` | `kenik` | `camera` (the last is manual `cameras` entries with an `onvif` section). Continuous move needs `cam.ptz: true` (Reolink/Axis) or an `onvif` block (KENIK/manual); presets ride on the same gate. IR, patrol, siren, and floodlight are per-camera opt-in flags (`ir`/`floodlight`/`siren` — patrol needs no separate flag, it rides on `ptz`) since they don't apply to every camera on a backend.

```
POST   http://<lsh-host>:3001/api/:backend/ptz/:idx                 # { op: left|right|up|down|zoomin|zoomout|stop, speed? }

GET    http://<lsh-host>:3001/api/:backend/preset/:idx              # [{ id, name }], writable: bool
POST   http://<lsh-host>:3001/api/:backend/preset/:idx              # { name? } — save current position (writable backends only: axis, kenik, camera)
POST   http://<lsh-host>:3001/api/:backend/preset/:idx/:id/goto
DELETE http://<lsh-host>:3001/api/:backend/preset/:idx/:id          # writable backends only

POST   http://<lsh-host>:3001/api/reolink/patrol/:idx               # { action: start|stop, id? } — best-effort, model/firmware-dependent

GET    http://<lsh-host>:3001/api/:backend/ir/:idx                  # { mode: on|off|auto } — backend ∈ reolink|axis|kenik|camera
POST   http://<lsh-host>:3001/api/:backend/ir/:idx                  # { mode: on|off|auto }

POST   http://<lsh-host>:3001/api/reolink/siren/:idx                # { times? } — manual trigger, no persistent state
GET    http://<lsh-host>:3001/api/reolink/floodlight/:idx           # { on, brightness }
POST   http://<lsh-host>:3001/api/reolink/floodlight/:idx           # { on: bool }
```

Reolink presets are list + goto only — the CGI API has no documented "save" call, so presets must be created via the Reolink app/NVR UI first.

## SIP doorbell intercom

```
GET    http://<lsh-host>:3001/api/sip/status
POST   http://<lsh-host>:3001/api/sip/answer
POST   http://<lsh-host>:3001/api/sip/reject
POST   http://<lsh-host>:3001/api/sip/hangup
POST   http://<lsh-host>:3001/api/sip/open-door
```

## Sonos: URL playback + TTS announcements

```
GET    http://<lsh-host>:3001/api/sonos/players
POST   http://<lsh-host>:3001/api/sonos/announce
GET    http://<lsh-host>:3001/api/sonos/announce
POST   http://<lsh-host>:3001/api/sonos/play-url
GET    http://<lsh-host>:3001/api/sonos/play-url
GET    http://<lsh-host>:3001/api/smartthings-camera/:deviceId/snapshot
POST   http://<lsh-host>:3001/api/smartthings-camera/:deviceId/take
GET    http://<lsh-host>:3001/api/camera-log
GET    http://<lsh-host>:3001/api/unifi/snapshot/:cameraId
GET    http://<lsh-host>:3001/api/reolink/snapshot/:idx
POST   http://<lsh-host>:3001/api/settings/cameras
```

## Reolink PoE cameras

```
POST   http://<lsh-host>:3001/api/settings/reolink
POST   http://<lsh-host>:3001/api/settings/test-reolink
```

## SolarEdge

```
GET    http://<lsh-host>:3001/api/solaredge
POST   http://<lsh-host>:3001/api/settings/test-solaredge
POST   http://<lsh-host>:3001/api/settings/solaredge
```

## SmartThings

```
POST   http://<lsh-host>:3001/api/settings/test-smartthings
POST   http://<lsh-host>:3001/api/settings/smartthings
GET    http://<lsh-host>:3001/api/settings/smartthings-token    # current bearer token, refreshed + written to disk every 24h
```

## Satel

```
POST   http://<lsh-host>:3001/api/settings/test-satel
POST   http://<lsh-host>:3001/api/settings/satel
```

## UniFi Protect

```
POST   http://<lsh-host>:3001/api/settings/test-unifi
POST   http://<lsh-host>:3001/api/settings/unifi
```

## VRM test + partial save

```
POST   http://<lsh-host>:3001/api/settings/test-vrm
POST   http://<lsh-host>:3001/api/settings/test-vrm-live
POST   http://<lsh-host>:3001/api/settings/vrm
```

## Config backup / restore

```
GET    http://<lsh-host>:3001/api/settings/export
POST   http://<lsh-host>:3001/api/settings/import
```

## HomeKit QR

```
GET    http://<lsh-host>:3001/api/homekit/setup-uri
```

## Settings

```
GET    http://<lsh-host>:3001/api/settings
POST   http://<lsh-host>:3001/api/settings
POST   http://<lsh-host>:3001/api/settings/test-mqtt
```

## Dreame

```
POST   http://<lsh-host>:3001/api/settings/test-dreame
POST   http://<lsh-host>:3001/api/settings/dreame
```

## MC6 Thermostats

```
POST   http://<lsh-host>:3001/api/settings/mc6

GET    http://<lsh-host>:3001/api/mc6/:mac/schedule       # { countdown, daily[] }
POST   http://<lsh-host>:3001/api/mc6/:mac/timer          # { minutes, action: 'on'|'off' } — one-shot countdown
DELETE http://<lsh-host>:3001/api/mc6/:mac/timer          # cancel the countdown
POST   http://<lsh-host>:3001/api/mc6/:mac/schedule       # { time: 'HH:MM', action: 'on'|'off', days?: [0-6], enabled? } — recurring daily entry
DELETE http://<lsh-host>:3001/api/mc6/:mac/schedule/:id   # remove a daily entry
```

## Roborock

```
POST   http://<lsh-host>:3001/api/settings/test-roborock
POST   http://<lsh-host>:3001/api/settings/roborock
```

## Homey

```
POST   http://<lsh-host>:3001/api/settings/test-homey
POST   http://<lsh-host>:3001/api/settings/homey
```

## Somfy

```
POST   http://<lsh-host>:3001/api/settings/test-somfy
POST   http://<lsh-host>:3001/api/settings/somfy
```

## Bayrol

```
POST   http://<lsh-host>:3001/api/settings/test-bayrol
POST   http://<lsh-host>:3001/api/settings/bayrol
```

## Loxone

```
POST   http://<lsh-host>:3001/api/settings/test-loxone
POST   http://<lsh-host>:3001/api/settings/loxone
POST   http://<lsh-host>:3001/api/settings/loxone-out
POST   http://<lsh-host>:3001/api/settings/auxair
POST   http://<lsh-host>:3001/api/settings/denon
POST   http://<lsh-host>:3001/api/settings/test-denon
POST   http://<lsh-host>:3001/api/settings/sonos
POST   http://<lsh-host>:3001/api/settings/test-boneio
POST   http://<lsh-host>:3001/api/settings/boneio
POST   http://<lsh-host>:3001/api/settings/sip
POST   http://<lsh-host>:3001/api/settings/test-aeotec
POST   http://<lsh-host>:3001/api/settings/scan-snapshot
POST   http://<lsh-host>:3001/api/settings/test-dirigera
POST   http://<lsh-host>:3001/api/settings/dirigera
POST   http://<lsh-host>:3001/api/settings/sip
POST   http://<lsh-host>:3001/api/settings/tradfri
POST   http://<lsh-host>:3001/api/settings/test-shelly
POST   http://<lsh-host>:3001/api/settings/shelly
```

## Waveshare Modbus TCP

```
POST   http://<lsh-host>:3001/api/settings/test-waveshare
POST   http://<lsh-host>:3001/api/settings/waveshare
```

## BroadLink IR/RF

```
GET    http://<lsh-host>:3001/api/broadlink/codes
POST   http://<lsh-host>:3001/api/broadlink/learn/ir
POST   http://<lsh-host>:3001/api/broadlink/learn/rf
POST   http://<lsh-host>:3001/api/broadlink/send
DELETE http://<lsh-host>:3001/api/broadlink/codes
POST   http://<lsh-host>:3001/api/settings/test-broadlink
POST   http://<lsh-host>:3001/api/settings/broadlink
```

## ESPHome

```
POST   http://<lsh-host>:3001/api/settings/test-esphome
POST   http://<lsh-host>:3001/api/settings/esphome
```

## LG ThinQ

```
POST   http://<lsh-host>:3001/api/settings/lgthinq-login
POST   http://<lsh-host>:3001/api/settings/test-lgthinq
POST   http://<lsh-host>:3001/api/settings/lgthinq
```

## Fibaro Home Center

```
POST   http://<lsh-host>:3001/api/settings/test-fibaro
POST   http://<lsh-host>:3001/api/settings/fibaro
```

## WebRTC WHEP proxy

```
POST   http://<lsh-host>:3001/api/webrtc/offer
```

## SmartBob

```
POST   http://<lsh-host>:3001/api/settings/test-smartbob
POST   http://<lsh-host>:3001/api/settings/smartbob
```

## Arduino MQTT

```
POST   http://<lsh-host>:3001/api/settings/arduino
```

## Suppla

```
POST   http://<lsh-host>:3001/api/settings/test-suppla
POST   http://<lsh-host>:3001/api/settings/suppla
```

## KNX

```
POST   http://<lsh-host>:3001/api/settings/test-knx
POST   http://<lsh-host>:3001/api/settings/knx
```

## FFmpeg RTSP proxy

```
GET    http://<lsh-host>:3001/api/rtsp-proxy
POST   http://<lsh-host>:3001/api/settings/ffmpeg-rtsp
```

## Logs

```
GET    http://<lsh-host>:3001/api/logs
GET    http://<lsh-host>:3001/api/logs/:name
DELETE http://<lsh-host>:3001/api/logs/:name
POST   http://<lsh-host>:3001/api/admin/restart
POST   http://<lsh-host>:3001/api/admin/reset-config
```

## MQTT Explorer

```
GET    http://<lsh-host>:3001/api/mqtt-explorer/topics
GET    http://<lsh-host>:3001/api/mqtt-explorer/history
POST   http://<lsh-host>:3001/api/mqtt-explorer/publish
POST   http://<lsh-host>:3001/api/mqtt-explorer/subscribe
POST   http://<lsh-host>:3001/api/mqtt-explorer/clear
```

## HTTPS / TLS settings

```
POST   http://<lsh-host>:3001/api/settings/https
```
---

## Somfy cover control — worked examples

Somfy covers are exposed through the generic device routes. Device key format:
`somfy/<proto>___2028-5589-5601_<id>` (`:`/`/` → `_`). See
[`somfy-devices-casablanca.md`](somfy-devices-casablanca.md) for the full device list.

**Sensors per cover:** `switch` (`on`/`off` = open/close) · `level` (0–100 % open
position) · `tilt` (0–100 % open slats — io venetian blinds only) · `stop` (momentary)
· `my` (momentary favourite).

```bash
T=<API_TOKEN>
B=http://<lsh-host>:3001

# Read one cover's readings / a single sensor
curl "$B/api/devices/somfy/io___2028-5589-5601_11600128?token=$T"
curl "$B/api/devices/somfy/io___2028-5589-5601_11600128?sensor=level&token=$T"

# Position — open Blanka to 60 %
curl "$B/api/device/somfy/io___2028-5589-5601_9534217/set?sensor=level&value=60&token=$T"

# Tilt — set Ogród front praw slats to 40 % (POST)
curl -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  "$B/api/device/somfy/io___2028-5589-5601_12851042/command" \
  -d '{"sensor":"tilt","value":40}'

# Open / close / stop / my
curl "$B/api/device/somfy/io___2028-5589-5601_3073581/set?sensor=switch&value=on&token=$T"
curl "$B/api/device/somfy/io___2028-5589-5601_3073581/set?sensor=switch&value=off&token=$T"
curl "$B/api/device/somfy/io___2028-5589-5601_3073581/set?sensor=stop&value=1&token=$T"
curl "$B/api/device/somfy/io___2028-5589-5601_3073581/set?sensor=my&value=1&token=$T"
```
