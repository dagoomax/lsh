'use strict';

// Integrations whose entire server.js wiring is: if configured, construct
// with (config, store, sensorRegistry) and call start(). server.js loops over
// this list; anything that needs more stays written out inline there.
//
//   file   src/<file>.js
//   label  log prefix for "[label] Start failed: …"
//   when   (config) => truthy when the integration should start. Also used
//          by scripts/gen-modules-manifest.js → modules.json, so keep it a
//          plain expression over `config` (no closures over other values).
//   hint   optional — shown when the module can't be loaded
//   expose optional — apiClients key, for integrations with REST routes
//
// Order is start order.
module.exports = [
  // Start Viessmann Vitodens client if configured. `vicare` was a separate,
  // older client (different API domain, inline user/password auth) that has
  // been merged into this one — `config.vicare.clientId` is still accepted
  // here as a legacy alias (see vitodens-client.js).
  { file: 'vitodens-client', label: 'Vitodens', when: (config) => config.vitodens?.clientId || config.vicare?.clientId },
  // Start Solar Accelerator Connect client if configured (local SA Connect
  // gateway — Deye-family hybrid inverters)
  { file: 'solaraccelerator-client', label: 'SolarAccelerator', when: (config) => config.solaraccelerator?.host },
  // Start Sofar Solar inverter client if configured (K-TLX series via its
  // local LSW-3/Solarman WiFi dongle — no cloud, no API key)
  { file: 'sofar-client', label: 'Sofar', when: (config) => config.sofar?.host },
  // Start Dyson client if enabled (device list/credentials come from
  // persist/dyson-tokens.json, produced by scripts/dyson-auth.js)
  { file: 'dyson-client', label: 'Dyson', when: (config) => config.dyson?.enabled },
  { file: 'dirigera-client', label: 'Dirigera', when: (config) => config.dirigera?.host && config.dirigera?.token },
  { file: 'tradfri-client', label: 'Tradfri', hint: 'npm install node-tradfri-client', when: (config) => config.tradfri?.host },
  // Start ESPHome client if devices are configured
  { file: 'esphome-client', label: 'ESPHome', when: (config) => config.esphome?.devices?.length },
  // Start Shelly client if devices are configured
  { file: 'shelly-client', label: 'Shelly', when: (config) => config.shelly?.devices?.length },
  // Start go-eCharger client if devices are configured (local API, no cloud)
  { file: 'goecharger-client', label: 'go-eCharger', when: (config) => config.goecharger?.devices?.length },
  { file: 'wallbox-client', label: 'Wallbox', when: (config) => config.wallbox?.email && config.wallbox?.password },
  { file: 'easee-client', label: 'Easee', when: (config) => config.easee?.username && config.easee?.password },
  { file: 'zaptec-client', label: 'Zaptec', when: (config) => config.zaptec?.username && config.zaptec?.password },
  // Start OCPP 1.6 central system if enabled (generic EV charger listener —
  // any brand speaking standard OCPP 1.6-J connects here)
  { file: 'ocpp-server', label: 'OCPP', when: (config) => config.ocpp?.enabled },
  { file: 'dreame-client', label: 'Dreame', when: (config) => config.dreame?.devices?.length },
  // expose for /api/mc6/* timer & schedule routes
  { file: 'mc6-client', label: 'MC6', expose: 'mc6', when: (config) => config.mc6?.broker && config.mc6?.devices?.length },
  // Start Roborock client if configured (miio protocol: host + token)
  { file: 'roborock-client', label: 'Roborock', when: (config) => config.roborock?.devices?.length },
  // Kärcher Home Robots (RCV5/RCV3/RCF5) — cloud-only, see src/karcher-client.js
  // exposed for /api/karcher/* (map), /api/cameras and the HomeKit bridge
  { file: 'karcher-client', label: 'Karcher', expose: 'karcher', when: (config) => config.karcher?.email },
  { file: 'waveshare-modbus-client', label: 'Waveshare', when: (config) => config.waveshare?.devices?.length },
  // Start Tedee Bridge client if configured — local REST API, no cloud
  { file: 'tedee-client', label: 'Tedee', when: (config) => config.tedee?.devices?.length },
  // Start Home Connect client if configured — Bosch/Siemens/Gaggenau/Neff
  // (OAuth device flow via scripts/homeconnect-auth.js; tokens persisted + auto-refreshed)
  { file: 'homeconnect-client', label: 'HomeConnect', when: (config) => config.homeConnect },
  // Start Grenton client if configured (GATE HTTP module + LSH listener script)
  { file: 'grenton-client', label: 'Grenton', when: (config) => config.grenton?.host && config.grenton?.devices?.length },
  // Start Philips Hue client if configured (local bridge, CLIP v1 REST)
  { file: 'hue-client', label: 'Hue', when: (config) => config.hue?.host && config.hue?.username },
  // Start Miele client if configured (OAuth password grant, or one-off
  // scripts/miele-auth.js; tokens persisted + auto-refreshed)
  { file: 'miele-client', label: 'Miele', when: (config) => config.miele },
  // Start LG ThinQ client if configured (token-based — no credentials needed)
  { file: 'lgthinq-client', label: 'LGThinQ', when: (config) => config.lgthinq },
  { file: 'denon-client', label: 'Denon', when: (config) => config.denon?.host },
  // Start Bang & Olufsen speaker client if configured
  { file: 'beosound-client', label: 'Beosound', when: (config) => config.beosound?.host },
  { file: 'sony-client', label: 'Sony', when: (config) => config.sony?.host },
  // Start Android TV / Google TV client if configured (any brand — TCL, Sharp, ...)
  { file: 'googletv-client', label: 'GoogleTv', when: (config) => config.googletv?.host },
  { file: 'vents-client', label: 'VENTS', when: (config) => config.vents?.host },
  { file: 'landroid-client', label: 'Landroid', when: (config) => config.landroid?.email && config.landroid?.password },
  { file: 'googlehome-client', label: 'GoogleHome', when: (config) => config.googlehome?.devices?.length },
  { file: 'bayrol-client', label: 'Bayrol', when: (config) => config.bayrol?.username && config.bayrol?.password },
  { file: 'airly-client', label: 'Airly', when: (config) => config.airly?.apiKey },
  { file: 'smarttub-client', label: 'SmartTub', when: (config) => config.smarttub?.email && config.smarttub?.password },
  { file: 'thermomix-client', label: 'Thermomix', when: (config) => config.thermomix?.email && config.thermomix?.password },
  { file: 'wled-client', label: 'WLED', when: (config) => config.wled?.devices?.length },
  { file: 'suppla-client', label: 'Suppla', when: (config) => config.suppla?.token },
  { file: 'zway-client', label: 'Z-Way', when: (config) => config.zway?.host },
  // Start Z-Wave JS client if configured (Z-Wave JS Server / Z-Wave JS UI —
  // distinct from the Z-Way/RaZberry REST integration above)
  { file: 'zwave-js-client', label: 'Z-Wave JS', when: (config) => config.zwaveJs?.host },
  { file: 'vera-client', label: 'Vera', when: (config) => config.vera?.host },
  { file: 'knx-client', label: 'KNX', hint: 'npm install knx', when: (config) => config.knx?.host },
  { file: 'fibaro-client', label: 'Fibaro', when: (config) => config.fibaro?.host },
  { file: 'can-client', label: 'CAN', when: (config) => config.can?.transport || config.can?.interface || config.can?.serialPort },
  { file: 'modbus-client', label: 'Modbus', when: (config) => config.modbus?.devices?.length },
  // Start Domatiq CAN bus bridge if configured (domatiq-loxone-bridge ESP32 gateway)
  { file: 'domatiq-client', label: 'Domatiq', when: (config) => config.domatiq?.host },
  { file: 'homey-client', label: 'Homey', when: (config) => config.homey?.token && (config.homey?.host || config.homey?.homeyId) },
  // Victron devices over Bluetooth, read by the LSH host itself (Arduino UNO Q)
  { file: 'lsh-ble-client', label: 'LSH BLE', expose: 'lshBle', when: (config) => config.lshBle?.devices?.length },
  // DSC PowerSeries Neo via TL280 ITv2 — the panel dials in to LSH (TCP 3072)
  // Modbus device emulator — LSH answers Modbus TCP/RTU register queries
  { file: 'modbus-emulator', label: 'ModbusEmu', expose: 'modbusEmu', when: (config) => config.modbusEmu?.enabled },
  { file: 'dsc-client', label: 'DSC', expose: 'dsc', when: (config) => config.dsc?.enabled && (config.dsc?.type2Key || config.dsc?.type1Code) },
  // Home Assistant — imports HA entities (WebSocket API) and/or exports LSH devices (MQTT Discovery)
  { file: 'homeassistant-client', label: 'HomeAssistant', expose: 'homeassistant', when: (config) => (config.homeassistant?.url && config.homeassistant?.token) || config.homeassistant?.export?.enabled },
];
