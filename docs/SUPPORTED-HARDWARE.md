# Supported Hardware & Platforms

Lightweight Smart Home (LSH) integrates ~45 platforms, all built into the single
Node.js process — no add-ons or separate containers. Each row lists its
`config.json` section (see the [README](../README.md) for the full config
reference of every one).

## Energy & Solar

| Platform | Config | Notes |
|---|---|---|
| **Victron Energy** (Venus OS / Cerbo GX) | `mqtt` | Local MQTT, first-class; auto-fallback to VRM |
| **Victron VRM** (cloud) | `vrm` | Cloud fallback when local MQTT is unreachable |
| **SolarEdge** | `solaredge` | Cloud monitoring API (production, battery, grid) |

## Smart-home hubs & controllers

| Platform | Config | Notes |
|---|---|---|
| **Loxone Miniserver** | `loxone` / `loxoneOut` | Two-way: WebSocket in + Virtual Input push out |
| **Fibaro Home Center 2/3** | `fibaro` / `fibaroOut` | Rooms/devices in; global-variable push out |
| **Homey Pro / Cloud** | `homey` | All devices auto-discovered |
| **IKEA Dirigera** | `dirigera` | Lights, plugs, blinds, sensors |
| **IKEA Trådfri** | `tradfri` | Gateway (CoAP/DTLS) |
| **Grenton** | `grenton` | GATE HTTP API |
| **Ampio** | `ampio` | M-SERV over MQTT |
| **Z-Way / RaZberry** (Z-Wave) | `zway` | Switches, dimmers, thermostats, locks, sensors |
| **Wiren Board** | `wirenboard` | Relays, dimmers, inputs, climate via MQTT |
| **BoneIO** | `boneio` | Relay boards, MQTT auto-discovery |
| **Suppla** | `suppla` | Cloud or self-hosted (cloud.supla.org) |
| **SmartBob** | `smartbob` | MQTT sensors / switches / automation |

## Lighting, switches & I/O

| Platform | Config | Notes |
|---|---|---|
| **Shelly** (Gen1 / Gen2) | `shelly` | Local REST, auto-detected generation |
| **Philips Hue** | `hue` | Bridge API |
| **KNX** | `knx` | KNXnet/IP gateway, group-address mapping |
| **ESPHome** (ESP32 / ESP8266) | `esphome` | HTTP REST API |
| **Arduino / generic MQTT** | `arduino` | Map JSON topics to sensors/outputs |
| **BroadLink** | `broadlink` | IR / RF blasters |
| **Waveshare Modbus TCP** | `waveshare` | Relay/gate controllers |

## Climate & appliances

| Platform | Config | Notes |
|---|---|---|
| **AUX Air** (AC Freedom) | `auxair` | AC on/off, temp, mode, fan |
| **MC6 thermostats** | `mc6` | Floor/room thermostats |
| **LG ThinQ** | `lgthinq` | Appliances (token auth, v1 API) |
| **Home Connect** (Bosch/Siemens) | `homeConnect` | Ovens, dishwashers, etc. |
| **Miele** | `miele` | Appliances (cloud API) |
| **SmartTub** (Jacuzzi/Sundance/Watkins) | `smarttub` | Hot tubs — temp, heat, pumps, lights |
| **Bayrol Pool Manager** | `bayrol` | pH, ORP, temperature, dosing, salt |
| **Blauberg / Vents** | `vents` | Ventilation / recuperation |

## Security & sensors

| Platform | Config | Notes |
|---|---|---|
| **Satel INTEGRA** | `satel` | Alarm panel — zones, outputs, partitions (TCP) |
| **UniFi Protect** | `unifi` | Cameras, motion/contact sensors, doorbell (Integration API + event WebSocket) |
| **UniFi Access** | `unifiAccess` | Door controllers — lock/unlock, door status |
| **Aqara / Xiaomi** | `aqara` | Gateway sensors |

## Cameras

| Platform | Config | Notes |
|---|---|---|
| **UniFi Protect** | `unifi` | Proxied snapshots + RTSPS |
| **Reolink** (PoE / NVR) | `reolink` | Snapshots, RTSP, AI object detection |
| **KENIK / Eltrox** (DVR/XVR) | `kenik` | IP cameras and recorders |
| **Manual cameras** | `cameras` | RTSP, snapshot, MJPEG, WebRTC (any brand) |

## Robots & lawn

| Platform | Config | Notes |
|---|---|---|
| **Roborock** vacuums | `roborock` | Cloud + local control |
| **Dreame** vacuums / air purifiers | `dreame` | Local token control |
| **Worx Landroid** mowers | `landroid` | Cloud API |

## Media & AV

| Platform | Config | Notes |
|---|---|---|
| **Sonos** | `sonos` | UPnP/SOAP local control + TTS |
| **Denon / Marantz** AVR | `denon` | Telnet control (power, volume, input) |

## Covers, blinds & gates

| Platform | Config | Notes |
|---|---|---|
| **Somfy TaHoma** | `somfy` | Local API or Overkiz cloud — shutters, awnings, gates |

## Other clouds & bridges

| Platform | Config | Notes |
|---|---|---|
| **Samsung SmartThings** | `smartthings` | Switches, power meters, sensors |
| **SIP doorbell / softphone** | `sip` | Intercom over WebSocket (e.g. UniFi Talk) |
| **Apple HomeKit** (out) | `homekit` | Exposes registry devices, relays, cameras |
| **Victron relays** | `relays` | Cerbo GX relay control |

---

*This list is generated from the `src/*-client.js` integrations and the
`config.json` sections. Each platform's full configuration lives in the
[README](../README.md) (one `###` section per platform).*
