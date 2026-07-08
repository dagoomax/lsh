# HomeKit

‹ [Home](Home) · [Configuration](Configuration) · [REST API](REST-API) ›

## HomeKit

The HomeKit bridge exposes all relays and integration sensors as native HomeKit accessories. Scan the QR code shown in **Settings → HomeKit** with the **Home** app, or enter the PIN manually.

> **Requirement:** `npm install hap-nodejs` — the package is optional and not bundled. The server starts normally without it (bridge silently disabled). Set `homekit.enabled: false` in `config.json` to disable it even when the package is present.

**Supported service types:**

| HomeKit service | Triggered by |
|---|---|
| Switch | Relay, SmartThings switch, Homey `onoff`, Shelly relay |
| Temperature Sensor | SmartThings temperature, Homey `measure_temperature`, Loxone temp |
| Humidity Sensor | SmartThings humidity, Homey `measure_humidity` |
| Motion Sensor | SmartThings motion, Homey `alarm_motion`, BoneIO motion |
| Contact Sensor | SmartThings contact, BoneIO door sensor |
| Smoke Sensor | Homey `alarm_smoke` |
| CO Sensor | Homey `alarm_co` |
| Leak Sensor | Homey `alarm_water` |
| Occupancy Sensor | SmartThings presence, Homey `alarm_presence` |
| Battery Service | SmartThings battery, Homey `measure_battery` |
| Lightbulb (dimmer) | SmartThings dimmer, Homey `dim` |
| Lightbulb (color) | SmartThings color, Homey color capabilities |
| Thermostat | SmartThings thermostat, Homey `target_temperature` |
| Lock | SmartThings lock, Homey `locked` |
| Window Covering | Homey `window_coverings_set` |
| Lux Sensor | Homey `measure_luminance` |
| CO₂ Sensor | Homey `measure_co2` |
| Fan | Homey `fan_speed` |
| Air Quality Sensor | Dreame air purifier sensors |
| Tank Level | Victron tank sensors |
| Camera (stub) | Manual camera entries |

---
