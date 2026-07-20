# Modules Index

‹ [Home](Home) · [Architecture](Architecture) ›

Every JavaScript module in `src/` has a reference page below (65 modules). Pages are generated from source plus the README's module notes.

## Core

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`automation-engine.js`](Module-automation-engine) | 206 | — | — |
| [`connection-manager.js`](Module-connection-manager) | 138 | `mqtt` `vrm` | — |
| [`data-store.js`](Module-data-store) | 175 | — | — |
| [`device-definitions.js`](Module-device-definitions) | 273 | — | — |
| [`relay-controller.js`](Module-relay-controller) | 33 | `relays` | — |
| [`sensor-registry.js`](Module-sensor-registry) | 101 | — | — |

## Interface

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`api-routes.js`](Module-api-routes) | 2607 | `json` `relays` | — |
| [`websocket.js`](Module-websocket) | 88 | — | — |

## Victron / MQTT

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`mqtt-explorer.js`](Module-mqtt-explorer) | 115 | `mqtt` | — |

## Security

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`acme.js`](Module-acme) | 186 | — | — |
| [`auth.js`](Module-auth) | 247 | `json` | — |

## Loxone

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`loxone-xml.js`](Module-loxone-xml) | 118 | — | — |

## HomeKit

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`homekit-bridge.js`](Module-homekit-bridge) | 1135 | `relays` `cameras` `homekit` | — |
| [`homekit-camera.js`](Module-homekit-camera) | 181 | — | — |
| [`homekit-uri.js`](Module-homekit-uri) | 43 | — | — |

## Media

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`ffmpeg-rtsp.js`](Module-ffmpeg-rtsp) | 86 | `cameras` `ffmpegRtsp` | — |

## Support

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`camera-log.js`](Module-camera-log) | 27 | — | — |
| [`logger.js`](Module-logger) | 131 | — | — |
| [`platform-status.js`](Module-platform-status) | 21 | — | — |
| [`server-i18n.js`](Module-server-i18n) | 142 | `json` | — |
| [`simulator-manager.js`](Module-simulator-manager) | 120 | `simulators` | — |

## Integration client

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`ampio-client.js`](Module-ampio-client) | 191 | `ampio` | `ampio` |
| [`aqara-client.js`](Module-aqara-client) | 280 | `aqara` | `aqara` |
| [`arduino-client.js`](Module-arduino-client) | 200 | `arduino` `mqtt` | — |
| [`auxair-client.js`](Module-auxair-client) | 250 | `auxair` | — |
| [`bayrol-client.js`](Module-bayrol-client) | 230 | `bayrol` | — |
| [`boneio-client.js`](Module-boneio-client) | 255 | — | `boneio` |
| [`broadlink-client.js`](Module-broadlink-client) | 349 | `broadlink` | — |
| [`denon-client.js`](Module-denon-client) | 213 | `denon` | — |
| [`dirigera-client.js`](Module-dirigera-client) | 318 | `dirigera` | — |
| [`dreame-client.js`](Module-dreame-client) | 286 | `dreame` | — |
| [`esphome-client.js`](Module-esphome-client) | 295 | `esphome` | — |
| [`fibaro-client.js`](Module-fibaro-client) | 259 | `fibaro` | — |
| [`grenton-client.js`](Module-grenton-client) | 201 | `grenton` | `grenton` |
| [`homeconnect-client.js`](Module-homeconnect-client) | 353 | `homeConnect` | `homeconnect` |
| [`homey-client.js`](Module-homey-client) | 232 | `homey` | `homey` |
| [`hue-client.js`](Module-hue-client) | 215 | `hue` | `hue` |
| [`kenik-client.js`](Module-kenik-client) | 141 | `json` | — |
| [`knx-client.js`](Module-knx-client) | 169 | `knx` | — |
| [`landroid-client.js`](Module-landroid-client) | 226 | `landroid` | `landroid` |
| [`lgthinq-client.js`](Module-lgthinq-client) | 474 | `lgthinq` | — |
| [`loxone-client.js`](Module-loxone-client) | 474 | — | — |
| [`loxone-out-client.js`](Module-loxone-out-client) | 61 | `loxoneOut` | — |
| [`mc6-client.js`](Module-mc6-client) | 127 | `mc` | — |
| [`miele-client.js`](Module-miele-client) | 353 | `miele` | `miele` |
| [`mqtt-client.js`](Module-mqtt-client) | 142 | `mqtt` | — |
| [`reolink-client.js`](Module-reolink-client) | 110 | `json` | — |
| [`roborock-client.js`](Module-roborock-client) | 211 | `roborock` | — |
| [`roborock-cloud-client.js`](Module-roborock-cloud-client) | 836 | `roborock` | `roborock` |
| [`satel-client.js`](Module-satel-client) | 467 | `satel` | `satel` |
| [`shelly-client.js`](Module-shelly-client) | 327 | `shelly` | — |
| [`smartbob-client.js`](Module-smartbob-client) | 128 | `smartbob` | — |
| [`smartthings-client.js`](Module-smartthings-client) | 318 | `smartthings` | `smartthings` |
| [`smarttub-client.js`](Module-smarttub-client) | 275 | `smarttub` | — |
| [`solaredge-client.js`](Module-solaredge-client) | 119 | `solaredge` | — |
| [`somfy-client.js`](Module-somfy-client) | 431 | `somfy` | — |
| [`sonos-client.js`](Module-sonos-client) | 300 | `sonos` | — |
| [`suppla-client.js`](Module-suppla-client) | 291 | `suppla` | — |
| [`tradfri-client.js`](Module-tradfri-client) | 226 | `tradfri` | — |
| [`unifi-access-client.js`](Module-unifi-access-client) | 142 | `unifiAccess` | `unifiAccess` |
| [`unifi-protect-client.js`](Module-unifi-protect-client) | 312 | `unifi` | `unifi` |
| [`vents-client.js`](Module-vents-client) | 183 | `vents` | `vents` |
| [`vrm-client.js`](Module-vrm-client) | 220 | `vrm` | — |
| [`waveshare-modbus-client.js`](Module-waveshare-modbus-client) | 282 | `waveshare` | — |
| [`wirenboard-client.js`](Module-wirenboard-client) | 206 | `wirenboard` | — |
| [`zway-client.js`](Module-zway-client) | 225 | `zway` | — |

