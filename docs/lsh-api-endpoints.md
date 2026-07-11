# LSH REST API — endpoint reference

Full HTTP method + URL for every LSH dashboard API route. Host shown as `http://192.168.1.229:3001` (casablanca / LSH); use `http://localhost:3001` on-box or your own host.

**Auth:** every `/api/*` route requires authentication except the bootstrap `POST /api/auth/setup` and `POST /api/auth/login`. Authenticate with any of:
- Query param: `?token=<API_TOKEN>`
- Header: `Authorization: Bearer <API_TOKEN>` (API token or session JWT)
- Session cookie (browser login)

API tokens are created under Settings → API Tokens (`POST /api/auth/tokens`). `:param` = path variable; `:deviceKey(*)` captures a slashed key such as `somfy/io___2028-5589-5601_11600128`.

Regenerate the machine-readable spec with `node scripts/gen-openapi.js` → `public/openapi.json` (served at `/openapi.json`).

**Total routes: 145**

## Auth

```
POST   http://192.168.1.229:3001/api/auth/setup
POST   http://192.168.1.229:3001/api/auth/login
POST   http://192.168.1.229:3001/api/auth/logout
GET    http://192.168.1.229:3001/api/auth/me
POST   http://192.168.1.229:3001/api/auth/change-password
GET    http://192.168.1.229:3001/api/auth/users
POST   http://192.168.1.229:3001/api/auth/users
DELETE http://192.168.1.229:3001/api/auth/users/:id
GET    http://192.168.1.229:3001/api/auth/tokens
POST   http://192.168.1.229:3001/api/auth/tokens
DELETE http://192.168.1.229:3001/api/auth/tokens/:id
GET    http://192.168.1.229:3001/api/connection
GET    http://192.168.1.229:3001/api/status
GET    http://192.168.1.229:3001/api/battery
GET    http://192.168.1.229:3001/api/solar
GET    http://192.168.1.229:3001/api/grid
GET    http://192.168.1.229:3001/api/loads
GET    http://192.168.1.229:3001/api/relays
POST   http://192.168.1.229:3001/api/relay/:index/state
```

## Devices / Sensors

```
GET    http://192.168.1.229:3001/api/devices
GET    http://192.168.1.229:3001/api/devices/:deviceKey(*)
POST   http://192.168.1.229:3001/api/device/:deviceKey(*)/command
GET    http://192.168.1.229:3001/api/device/:deviceKey(*)/set
```

## History

```
GET    http://192.168.1.229:3001/api/history/:key(*)
```

## Loxone Config XML templates

```
GET    http://192.168.1.229:3001/api/loxone/inputs.xml
GET    http://192.168.1.229:3001/api/loxone/outputs.xml
```

## Automation (rules / scenes / notifications)

```
GET    http://192.168.1.229:3001/api/automation/rules
POST   http://192.168.1.229:3001/api/automation/rules
DELETE http://192.168.1.229:3001/api/automation/rules/:id
GET    http://192.168.1.229:3001/api/automation/scenes
POST   http://192.168.1.229:3001/api/automation/scenes
DELETE http://192.168.1.229:3001/api/automation/scenes/:id
POST   http://192.168.1.229:3001/api/automation/scenes/:id/run
GET    http://192.168.1.229:3001/api/automation/notifications
POST   http://192.168.1.229:3001/api/automation/notifications
DELETE http://192.168.1.229:3001/api/automation/notifications
```

## Satel INTEGRA

```
GET    http://192.168.1.229:3001/api/satel/zones
GET    http://192.168.1.229:3001/api/satel/outputs
GET    http://192.168.1.229:3001/api/satel/partitions
GET    http://192.168.1.229:3001/api/satel/status
POST   http://192.168.1.229:3001/api/satel/output/:num
POST   http://192.168.1.229:3001/api/satel/partition/:num/:action(arm|disarm)
```

## Cameras

```
GET    http://192.168.1.229:3001/api/cameras
```

## SIP doorbell intercom

```
GET    http://192.168.1.229:3001/api/sip/status
POST   http://192.168.1.229:3001/api/sip/answer
POST   http://192.168.1.229:3001/api/sip/reject
POST   http://192.168.1.229:3001/api/sip/hangup
POST   http://192.168.1.229:3001/api/sip/open-door
```

## Sonos: URL playback + TTS announcements

```
GET    http://192.168.1.229:3001/api/sonos/players
POST   http://192.168.1.229:3001/api/sonos/announce
GET    http://192.168.1.229:3001/api/sonos/announce
POST   http://192.168.1.229:3001/api/sonos/play-url
GET    http://192.168.1.229:3001/api/sonos/play-url
GET    http://192.168.1.229:3001/api/smartthings-camera/:deviceId/snapshot
POST   http://192.168.1.229:3001/api/smartthings-camera/:deviceId/take
GET    http://192.168.1.229:3001/api/camera-log
GET    http://192.168.1.229:3001/api/unifi/snapshot/:cameraId
GET    http://192.168.1.229:3001/api/reolink/snapshot/:idx
POST   http://192.168.1.229:3001/api/settings/cameras
```

## Reolink PoE cameras

```
POST   http://192.168.1.229:3001/api/settings/reolink
POST   http://192.168.1.229:3001/api/settings/test-reolink
```

## SolarEdge

```
GET    http://192.168.1.229:3001/api/solaredge
POST   http://192.168.1.229:3001/api/settings/test-solaredge
POST   http://192.168.1.229:3001/api/settings/solaredge
```

## SmartThings

```
POST   http://192.168.1.229:3001/api/settings/test-smartthings
POST   http://192.168.1.229:3001/api/settings/smartthings
```

## Satel

```
POST   http://192.168.1.229:3001/api/settings/test-satel
POST   http://192.168.1.229:3001/api/settings/satel
```

## UniFi Protect

```
POST   http://192.168.1.229:3001/api/settings/test-unifi
POST   http://192.168.1.229:3001/api/settings/unifi
```

## VRM test + partial save

```
POST   http://192.168.1.229:3001/api/settings/test-vrm
POST   http://192.168.1.229:3001/api/settings/test-vrm-live
POST   http://192.168.1.229:3001/api/settings/vrm
```

## Config backup / restore

```
GET    http://192.168.1.229:3001/api/settings/export
POST   http://192.168.1.229:3001/api/settings/import
```

## HomeKit QR

```
GET    http://192.168.1.229:3001/api/homekit/setup-uri
```

## Settings

```
GET    http://192.168.1.229:3001/api/settings
POST   http://192.168.1.229:3001/api/settings
POST   http://192.168.1.229:3001/api/settings/test-mqtt
```

## Dreame

```
POST   http://192.168.1.229:3001/api/settings/test-dreame
POST   http://192.168.1.229:3001/api/settings/dreame
```

## MC6 Thermostats

```
POST   http://192.168.1.229:3001/api/settings/mc6
```

## Roborock

```
POST   http://192.168.1.229:3001/api/settings/test-roborock
POST   http://192.168.1.229:3001/api/settings/roborock
```

## Homey

```
POST   http://192.168.1.229:3001/api/settings/test-homey
POST   http://192.168.1.229:3001/api/settings/homey
```

## Somfy

```
POST   http://192.168.1.229:3001/api/settings/test-somfy
POST   http://192.168.1.229:3001/api/settings/somfy
```

## Bayrol

```
POST   http://192.168.1.229:3001/api/settings/test-bayrol
POST   http://192.168.1.229:3001/api/settings/bayrol
```

## Loxone

```
POST   http://192.168.1.229:3001/api/settings/test-loxone
POST   http://192.168.1.229:3001/api/settings/loxone
POST   http://192.168.1.229:3001/api/settings/loxone-out
POST   http://192.168.1.229:3001/api/settings/auxair
POST   http://192.168.1.229:3001/api/settings/denon
POST   http://192.168.1.229:3001/api/settings/test-denon
POST   http://192.168.1.229:3001/api/settings/sonos
POST   http://192.168.1.229:3001/api/settings/test-boneio
POST   http://192.168.1.229:3001/api/settings/boneio
POST   http://192.168.1.229:3001/api/settings/sip
POST   http://192.168.1.229:3001/api/settings/test-aeotec
POST   http://192.168.1.229:3001/api/settings/scan-snapshot
POST   http://192.168.1.229:3001/api/settings/test-dirigera
POST   http://192.168.1.229:3001/api/settings/dirigera
POST   http://192.168.1.229:3001/api/settings/sip
POST   http://192.168.1.229:3001/api/settings/tradfri
POST   http://192.168.1.229:3001/api/settings/test-shelly
POST   http://192.168.1.229:3001/api/settings/shelly
```

## Waveshare Modbus TCP

```
POST   http://192.168.1.229:3001/api/settings/test-waveshare
POST   http://192.168.1.229:3001/api/settings/waveshare
```

## BroadLink IR/RF

```
GET    http://192.168.1.229:3001/api/broadlink/codes
POST   http://192.168.1.229:3001/api/broadlink/learn/ir
POST   http://192.168.1.229:3001/api/broadlink/learn/rf
POST   http://192.168.1.229:3001/api/broadlink/send
DELETE http://192.168.1.229:3001/api/broadlink/codes
POST   http://192.168.1.229:3001/api/settings/test-broadlink
POST   http://192.168.1.229:3001/api/settings/broadlink
```

## ESPHome

```
POST   http://192.168.1.229:3001/api/settings/test-esphome
POST   http://192.168.1.229:3001/api/settings/esphome
```

## LG ThinQ

```
POST   http://192.168.1.229:3001/api/settings/lgthinq-login
POST   http://192.168.1.229:3001/api/settings/test-lgthinq
POST   http://192.168.1.229:3001/api/settings/lgthinq
```

## Fibaro Home Center

```
POST   http://192.168.1.229:3001/api/settings/test-fibaro
POST   http://192.168.1.229:3001/api/settings/fibaro
```

## WebRTC WHEP proxy

```
POST   http://192.168.1.229:3001/api/webrtc/offer
```

## SmartBob

```
POST   http://192.168.1.229:3001/api/settings/test-smartbob
POST   http://192.168.1.229:3001/api/settings/smartbob
```

## Arduino MQTT

```
POST   http://192.168.1.229:3001/api/settings/arduino
```

## Suppla

```
POST   http://192.168.1.229:3001/api/settings/test-suppla
POST   http://192.168.1.229:3001/api/settings/suppla
```

## KNX

```
POST   http://192.168.1.229:3001/api/settings/test-knx
POST   http://192.168.1.229:3001/api/settings/knx
```

## FFmpeg RTSP proxy

```
GET    http://192.168.1.229:3001/api/rtsp-proxy
POST   http://192.168.1.229:3001/api/settings/ffmpeg-rtsp
```

## Logs

```
GET    http://192.168.1.229:3001/api/logs
GET    http://192.168.1.229:3001/api/logs/:name
DELETE http://192.168.1.229:3001/api/logs/:name
POST   http://192.168.1.229:3001/api/admin/restart
POST   http://192.168.1.229:3001/api/admin/reset-config
```

## MQTT Explorer

```
GET    http://192.168.1.229:3001/api/mqtt-explorer/topics
GET    http://192.168.1.229:3001/api/mqtt-explorer/history
POST   http://192.168.1.229:3001/api/mqtt-explorer/publish
POST   http://192.168.1.229:3001/api/mqtt-explorer/subscribe
POST   http://192.168.1.229:3001/api/mqtt-explorer/clear
```

## HTTPS / TLS settings

```
POST   http://192.168.1.229:3001/api/settings/https
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
B=http://192.168.1.229:3001

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
