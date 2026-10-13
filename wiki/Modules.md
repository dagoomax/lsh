# Modules Index

‹ [Home](Home) · [Architecture](Architecture) ›

Every JavaScript module in `src/` has a reference page below (110 modules). Pages are generated from source plus the README's module notes.

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
| [`mcp-server.js`](Module-mcp-server) | 241 | `mcp` | — |
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
| [`mcp-bots.js`](Module-mcp-bots) | 318 | `mcp` | — |

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
| [`airplay-client.js`](Module-airplay-client) | 373 | `airplay` | — |
| [`airplay-pairing.js`](Module-airplay-pairing) | 112 | — | — |
| [`announcer.js`](Module-announcer) | 314 | `announce` | `announce` |
| [`ffmpeg-rtsp.js`](Module-ffmpeg-rtsp) | 86 | `cameras` `ffmpegRtsp` | — |

## Support

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`camera-log.js`](Module-camera-log) | 27 | — | — |
| [`logger.js`](Module-logger) | 131 | — | — |
| [`platform-status.js`](Module-platform-status) | 21 | — | — |
| [`server-i18n.js`](Module-server-i18n) | 142 | `json` | — |
| [`simulator-manager.js`](Module-simulator-manager) | 120 | `simulators` | — |
| [`wiring-links.js`](Module-wiring-links) | 108 | — | — |

## Integration client

| Module | Lines | Config | Devices |
|---|---|---|---|
| [`airly-client.js`](Module-airly-client) | 130 | `airly` | `airly` |
| [`ampio-client.js`](Module-ampio-client) | 191 | `ampio` | `ampio` |
| [`anker-solix-client.js`](Module-anker-solix-client) | 278 | `ankerSolix` | `anker` |
| [`apple-music.js`](Module-apple-music) | 177 | `appleMusic` | `applemusic` |
| [`aqara-client.js`](Module-aqara-client) | 280 | `aqara` | `aqara` |
| [`aquilo-client.js`](Module-aquilo-client) | 228 | `aquilo` | `aquilo` |
| [`arduino-client.js`](Module-arduino-client) | 200 | `arduino` `mqtt` | — |
| [`auxair-client.js`](Module-auxair-client) | 250 | `auxair` | — |
| [`bayrol-client.js`](Module-bayrol-client) | 230 | `bayrol` | — |
| [`beosound-client.js`](Module-beosound-client) | 208 | `beosound` | `beosound` |
| [`boneio-client.js`](Module-boneio-client) | 255 | — | `boneio` |
| [`broadlink-client.js`](Module-broadlink-client) | 349 | `broadlink` | — |
| [`can-client.js`](Module-can-client) | 208 | `can` | `can` |
| [`denon-client.js`](Module-denon-client) | 213 | `denon` | — |
| [`dirigera-client.js`](Module-dirigera-client) | 318 | `dirigera` | — |
| [`domatiq-client.js`](Module-domatiq-client) | 352 | `domatiq` | `domatiq` |
| [`dreame-client.js`](Module-dreame-client) | 286 | `dreame` | — |
| [`dsc-client.js`](Module-dsc-client) | 365 | `dsc` | `dsc` |
| [`dyson-client.js`](Module-dyson-client) | 242 | `dyson` | `dyson` |
| [`easee-client.js`](Module-easee-client) | 157 | `easee` | — |
| [`esphome-client.js`](Module-esphome-client) | 295 | `esphome` | — |
| [`fibaro-client.js`](Module-fibaro-client) | 259 | `fibaro` | — |
| [`fibaro-out-client.js`](Module-fibaro-out-client) | 153 | `fibaroOut` | — |
| [`goecharger-client.js`](Module-goecharger-client) | 139 | `goecharger` | — |
| [`googlehome-client.js`](Module-googlehome-client) | 153 | `googlehome` | `googlehome` |
| [`googletv-client.js`](Module-googletv-client) | 144 | `googletv` | `googletv` |
| [`grenton-client.js`](Module-grenton-client) | 201 | `grenton` | `grenton` |
| [`homeassistant-client.js`](Module-homeassistant-client) | 404 | `homeassistant` | `ha` |
| [`homeconnect-client.js`](Module-homeconnect-client) | 353 | `homeConnect` | `homeconnect` |
| [`homey-client.js`](Module-homey-client) | 232 | `homey` | `homey` |
| [`hue-client.js`](Module-hue-client) | 215 | `hue` | `hue` |
| [`karcher-client.js`](Module-karcher-client) | 697 | `karcher` | `karcher` |
| [`kenik-client.js`](Module-kenik-client) | 141 | `json` | — |
| [`knx-client.js`](Module-knx-client) | 169 | `knx` | — |
| [`landroid-client.js`](Module-landroid-client) | 226 | `landroid` | `landroid` |
| [`lgthinq-client.js`](Module-lgthinq-client) | 474 | `lgthinq` | — |
| [`loxone-client.js`](Module-loxone-client) | 474 | — | — |
| [`loxone-out-client.js`](Module-loxone-out-client) | 61 | `loxoneOut` | — |
| [`lsh-ble-client.js`](Module-lsh-ble-client) | 325 | `lshBle` | `lshble` |
| [`mc6-client.js`](Module-mc6-client) | 127 | `mc` | — |
| [`miele-client.js`](Module-miele-client) | 353 | `miele` | `miele` |
| [`modbus-client.js`](Module-modbus-client) | 430 | `modbus` | `modbus` |
| [`modbus-emulator.js`](Module-modbus-emulator) | 386 | `modbusEmu` | — |
| [`mqtt-client.js`](Module-mqtt-client) | 142 | `mqtt` | — |
| [`music-player.js`](Module-music-player) | 135 | `music` | `music` |
| [`ocpp-server.js`](Module-ocpp-server) | 267 | `ocpp` | — |
| [`reolink-client.js`](Module-reolink-client) | 110 | `json` | — |
| [`roborock-client.js`](Module-roborock-client) | 211 | `roborock` | — |
| [`roborock-cloud-client.js`](Module-roborock-cloud-client) | 836 | `roborock` | `roborock` |
| [`satel-client.js`](Module-satel-client) | 467 | `satel` | `satel` |
| [`shelly-client.js`](Module-shelly-client) | 327 | `shelly` | — |
| [`sinum-client.js`](Module-sinum-client) | 294 | `sinum` | `sinum` |
| [`smartbob-client.js`](Module-smartbob-client) | 128 | `smartbob` | — |
| [`smartthings-client.js`](Module-smartthings-client) | 318 | `smartthings` | `smartthings` |
| [`smarttub-client.js`](Module-smarttub-client) | 275 | `smarttub` | — |
| [`sofar-client.js`](Module-sofar-client) | 294 | `sofar` | `sofar` |
| [`solaraccelerator-client.js`](Module-solaraccelerator-client) | 601 | `solaraccelerator` | `solaraccelerator` |
| [`solaredge-client.js`](Module-solaredge-client) | 119 | `solaredge` | — |
| [`somfy-client.js`](Module-somfy-client) | 431 | `somfy` | — |
| [`sonos-client.js`](Module-sonos-client) | 300 | `sonos` | — |
| [`sony-client.js`](Module-sony-client) | 198 | `sony` | `sony` |
| [`spotify-client.js`](Module-spotify-client) | 291 | `spotify` | `spotify` |
| [`suppla-client.js`](Module-suppla-client) | 291 | `suppla` | — |
| [`tedee-client.js`](Module-tedee-client) | 185 | `tedee` | `tedee` |
| [`thermomix-client.js`](Module-thermomix-client) | 243 | `thermomix` | `thermomix` |
| [`tradfri-client.js`](Module-tradfri-client) | 226 | `tradfri` | — |
| [`ugreen-client.js`](Module-ugreen-client) | 195 | `ugreen` | `ugreen` |
| [`unifi-access-client.js`](Module-unifi-access-client) | 142 | `unifiAccess` | `unifiAccess` |
| [`unifi-protect-client.js`](Module-unifi-protect-client) | 312 | `unifi` | `unifi` |
| [`vclu-client.js`](Module-vclu-client) | 231 | `vclu` | `vclu` |
| [`vents-client.js`](Module-vents-client) | 183 | `vents` | `vents` |
| [`vera-client.js`](Module-vera-client) | 229 | `vera` | `vera` |
| [`vitodens-client.js`](Module-vitodens-client) | 418 | `vitodens` `vicare` | `vitodens` |
| [`vrm-client.js`](Module-vrm-client) | 220 | `vrm` | — |
| [`wallbox-client.js`](Module-wallbox-client) | 162 | `wallbox` | — |
| [`waveshare-modbus-client.js`](Module-waveshare-modbus-client) | 282 | `waveshare` | — |
| [`wirenboard-client.js`](Module-wirenboard-client) | 206 | `wirenboard` | — |
| [`wled-client.js`](Module-wled-client) | 209 | `wled` | `wled` |
| [`zaptec-client.js`](Module-zaptec-client) | 177 | `zaptec` | — |
| [`zehnder-client.js`](Module-zehnder-client) | 222 | `zehnder` | `zehnder` |
| [`zendure-client.js`](Module-zendure-client) | 149 | `zendure` | `zendure` |
| [`zwave-js-client.js`](Module-zwave-js-client) | 393 | `zwaveJs` | `zwaveJs` |
| [`zway-client.js`](Module-zway-client) | 225 | `zway` | — |

