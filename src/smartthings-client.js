/**
 * Samsung SmartThings API client.
 *
 * Discovers devices and polls their status every 30 seconds.
 * Device data is written to the store under smartthings/{deviceId}/{attribute}
 * and devices are registered with SensorRegistry so they appear in the dashboard.
 *
 * Auth: Personal Access Token from https://account.smartthings.com/tokens
 */

const platformStatus = require('./platform-status');

const BASE_URL = 'https://api.smartthings.com/v1';
const POLL_INTERVAL_MS = 30000;

// Capability → sensor metadata.
// type: 'toggle' | 'range' | 'color' | 'color-temp' (controls UI rendering)
const CAPABILITIES = {
  switch:                      { storeAttr: 'switch',           name: 'Switch',       format: 'on-off',      homekit: 'switch-rw',   controllable: true, type: 'toggle',     writeOn: 'on',                 writeOff: 'off',     capabilityId: 'switch' },
  switchLevel:                 { storeAttr: 'level',            name: 'Brightness',   format: 'percent',                             controllable: true, type: 'range',      writeCmd: 'setLevel',          capabilityId: 'switchLevel',   min: 0,   max: 100 },
  colorControl:                { storeAttr: null,               name: 'Color',        format: 'color',                               controllable: true, type: 'color',                                     capabilityId: 'colorControl' },
  colorTemperature:            { storeAttr: 'colorTemperature', name: 'Color Temp',   format: 'color-temp',                          controllable: true, type: 'color-temp', writeCmd: 'setColorTemperature', capabilityId: 'colorTemperature', min: 2700, max: 6500 },
  powerMeter:                  { storeAttr: 'power',            name: 'Power',        format: 'power' },
  energyMeter:                 { storeAttr: 'energy',           name: 'Energy',       format: 'energy' },
  temperatureMeasurement:      { storeAttr: 'temperature',      name: 'Temperature',  format: 'temperature', homekit: 'temperature' },
  relativeHumidityMeasurement: { storeAttr: 'humidity',         name: 'Humidity',     format: 'percent',     homekit: 'humidity' },
  battery:                     { storeAttr: 'battery',          name: 'Battery',      format: 'percent',     homekit: 'battery-level' },
  contactSensor:               { storeAttr: 'contact',          name: 'Contact',      format: 'on-off',      homekit: 'contact' },
  motionSensor:                { storeAttr: 'motion',           name: 'Motion',       format: 'on-off',      homekit: 'motion' },
  illuminanceMeasurement:      { storeAttr: 'illuminance',      name: 'Illuminance',  format: 'number',  homekit: 'lux' },
  thermostatMode:              { storeAttr: 'thermostatMode',          name: 'Mode',             format: 'string', raw: true },
  thermostatHeatingSetpoint:   { storeAttr: 'heatingSetpoint',         name: 'Heating Setpoint', format: 'temperature', unit: '°C', controllable: true, type: 'range', writeCmd: 'setHeatingSetpoint', capabilityId: 'thermostatHeatingSetpoint', min: 4, max: 38 },
  thermostatCoolingSetpoint:   { storeAttr: 'coolingSetpoint',         name: 'Cooling Setpoint', format: 'temperature', unit: '°C', controllable: true, type: 'range', writeCmd: 'setCoolingSetpoint', capabilityId: 'thermostatCoolingSetpoint', min: 10, max: 35 },
  thermostatOperatingState:    { storeAttr: 'thermostatOperatingState',name: 'Operating State',  format: 'string', raw: true },
  temperatureSetpoint:         { storeAttr: 'heatingSetpoint',         name: 'Setpoint',         format: 'temperature', unit: '°C', controllable: true, type: 'range', writeCmd: 'setHeatingSetpoint', capabilityId: 'temperatureSetpoint', min: 4, max: 38 },
  fanControl:                  { storeAttr: 'switch',           name: 'Fan',          format: 'on-off',  homekit: 'fan-rw',   controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch' },
  fanSpeed:                    { storeAttr: 'level',            name: 'Fan Speed',    format: 'percent', controllable: true, type: 'range', writeCmd: 'setFanSpeed', capabilityId: 'fanSpeed', min: 0, max: 100 },
  carbonMonoxideDetector:      { storeAttr: 'carbonMonoxide',   name: 'CO Detector',  format: 'alarm',       homekit: 'co' },
  smokeDetector:               { storeAttr: 'smoke',            name: 'Smoke',        format: 'alarm',       homekit: 'smoke' },
  waterSensor:                 { storeAttr: 'water',            name: 'Water Sensor', format: 'on-off',      homekit: 'leak' },
  presenceSensor:              { storeAttr: 'presence',         name: 'Presence',     format: 'on-off',      homekit: 'occupancy' },
  lock:                        { storeAttr: 'lock',             name: 'Lock',         format: 'on-off',      controllable: true, type: 'toggle',     writeOn: 'lock',               writeOff: 'unlock',  capabilityId: 'lock' },
  doorControl:                 { storeAttr: 'door',             name: 'Door',         format: 'on-off',      controllable: true, type: 'toggle',     writeOn: 'open',               writeOff: 'close',   capabilityId: 'doorControl' },
  windowShade:                 { storeAttr: 'windowShade',      name: 'Shade',        format: 'on-off',      controllable: true, type: 'toggle',     writeOn: 'open',               writeOff: 'close',   capabilityId: 'windowShade' },
  airQualitySensor:            { storeAttr: 'airQuality',       name: 'Air Quality',  format: 'aqi',         homekit: 'air-quality' },
  carbonDioxideMeasurement:    { storeAttr: 'carbonDioxide',    name: 'CO₂',     format: 'co2',         homekit: 'co2-sensor' },
  tvocMeasurement:             { storeAttr: 'tvocLevel',        name: 'TVOC',         format: 'voc',         homekit: 'air-quality' },
  dustSensor: { multi: [
    { storeAttr: 'fineDustLevel', name: 'PM2.5', format: 'pm25' },
    { storeAttr: 'dustLevel',     name: 'PM10',  format: 'pm10' },
  ]},
  soundSensor:  { storeAttr: 'sound',  name: 'Sound Detection', format: 'on-off' },
  imageCapture: { storeAttr: 'image',  name: 'Snapshot URL',    format: 'string', raw: true, isCamera: true },
};

function _deriveHomekitTypes(caps) {
  const types = [];

  // ── Controllable device type (mutually exclusive) ──────────
  if (caps.has('thermostatMode') || caps.has('thermostatHeatingSetpoint') || caps.has('temperatureSetpoint')) {
    types.push('thermostat');
  } else if (caps.has('lock')) {
    types.push('lock-rw');
  } else if (caps.has('doorControl')) {
    types.push('door-rw');
  } else if (caps.has('windowShade')) {
    types.push('cover-rw');
  } else if (caps.has('fanControl') || (caps.has('switch') && caps.has('fanSpeed'))) {
    types.push('fan-rw');
  } else if (caps.has('switch')) {
    // Dimmer or colour bulb → Lightbulb; plain switch → Switch
    types.push(caps.has('switchLevel') ? 'light-rw' : 'switch-rw');
  }

  // ── Sensor types (additive) ────────────────────────────────
  if (caps.has('battery'))                     types.push('battery-level');
  if (caps.has('temperatureMeasurement'))      types.push('temperature');
  if (caps.has('relativeHumidityMeasurement')) types.push('humidity');
  if (caps.has('contactSensor'))               types.push('contact');
  if (caps.has('motionSensor'))                types.push('motion');
  if (caps.has('smokeDetector'))               types.push('smoke');
  if (caps.has('carbonMonoxideDetector'))      types.push('co');
  if (caps.has('waterSensor'))                 types.push('leak');
  if (caps.has('presenceSensor'))              types.push('occupancy');
  if (caps.has('illuminanceMeasurement'))      types.push('lux');
  if (caps.has('airQualitySensor') || caps.has('tvocMeasurement') || caps.has('dustSensor')) types.push('air-quality');
  if (caps.has('carbonDioxideMeasurement'))    types.push('co2-sensor');

  return types;
}

function deviceColor(caps) {
  if (caps.has('powerMeter') || caps.has('energyMeter')) return 'solar';
  if (caps.has('temperatureMeasurement'))                return 'orange';
  if (caps.has('battery'))                               return 'battery';
  if (caps.has('switch'))                                return 'blue';
  return 'blue';
}

function deviceIcon(caps) {
  if (caps.has('imageCapture'))                                                                      return '📷';
  if (caps.has('powerMeter') || caps.has('energyMeter'))                                            return '⚡';
  if (caps.has('airQualitySensor') || caps.has('dustSensor') || caps.has('tvocMeasurement') || caps.has('carbonDioxideMeasurement')) return '💨';
  if (caps.has('temperatureMeasurement'))                                                            return '🌡';
  if (caps.has('contactSensor'))                                                                     return '🚪';
  if (caps.has('motionSensor'))                                                                      return '👁';
  if (caps.has('smokeDetector'))                                                                     return '🔥';
  if (caps.has('lock'))                                                                              return '🔒';
  if (caps.has('switch'))                                                                            return '💡';
  if (caps.has('presenceSensor'))                                                                    return '📍';
  return '📟';
}

class SmartThingsClient {
  constructor(config, store, sensorRegistry) {
    this.config          = config;
    this.store           = store;
    this.sensorRegistry  = sensorRegistry;
    this.pollTimer       = null;
    this.connected       = false;
    this.devices         = []; // discovered device descriptors
  }

  async start() {
    const { token } = this.config.smartthings;
    if (!token) throw new Error('SmartThings token is required');

    await this._discoverDevices();
    this.connected = true;
    platformStatus.set('smartthings', true);
    this.pollTimer = setInterval(() => this._pollAll(), POLL_INTERVAL_MS);
    console.log(`[SmartThings] Started — ${this.devices.length} device(s), polling every ${POLL_INTERVAL_MS / 1000}s`);
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.connected = false;
    console.log('[SmartThings] Stopped');
  }

  // ── Discovery ────────────────────────────────────────────

  async _discoverDevices() {
    const raw = await this._get('/devices');
    const items = raw?.items ?? [];

    const filter = new Set(this.config.smartthings.deviceIds ?? []);

    for (const item of items) {
      if (filter.size && !filter.has(item.deviceId)) continue;

      const caps = new Set(
        (item.components ?? []).flatMap((c) => c.capabilities?.map((x) => x.id) ?? [])
      );

      const sensors = [];
      for (const [capId, def] of Object.entries(CAPABILITIES)) {
        if (!caps.has(capId)) continue;

        if (def.type === 'color') {
          sensors.push({ path: 'hue',        name: 'Hue',        format: 'number', hidden: true });
          sensors.push({ path: 'saturation', name: 'Saturation', format: 'number', hidden: true });
          sensors.push({ path: 'color',      name: def.name,     format: 'color',  controllable: true, type: 'color', capabilityId: def.capabilityId });
          continue;
        }

        if (def.multi) {
          for (const m of def.multi) sensors.push({ path: m.storeAttr, name: m.name, format: m.format });
          continue;
        }

        const sensor = { path: def.storeAttr, name: def.name, format: def.format };
        if (def.homekit)       sensor.homekit      = def.homekit;
        if (def.controllable)  sensor.controllable = true;
        if (def.type)          sensor.type         = def.type;
        if (def.writeOn)       sensor.writeOn      = def.writeOn;
        if (def.writeOff)      sensor.writeOff     = def.writeOff;
        if (def.writeCmd)      sensor.writeCmd     = def.writeCmd;
        if (def.capabilityId)  sensor.capabilityId = def.capabilityId;
        if (def.min != null)   sensor.min          = def.min;
        if (def.max != null)   sensor.max          = def.max;
        sensors.push(sensor);
      }

      if (sensors.length === 0) continue;

      // Determine HomeKit types — order matters: specific types take precedence over generic switch
      const homekitTypes = _deriveHomekitTypes(caps);

      const deviceId = item.deviceId;
      const device = {
        key:      `smartthings/${deviceId}`,
        type:     'smartthings',
        instance: deviceId,
        label:    item.label || item.name || deviceId,
        icon:     deviceIcon(caps),
        color:    deviceColor(caps),
        sensors,
        homekit:  homekitTypes,
        _caps:    caps,
        _writeCapability: (capId, command, args = []) => this._writeDevice(deviceId, capId, command, args),
      };

      this.devices.push(device);
      this.sensorRegistry.registerDevice(device);
    }

    // Fetch initial values
    await this._pollAll();
  }

  // ── Polling ──────────────────────────────────────────────

  async _pollAll() {
    await Promise.allSettled(this.devices.map((d) => this._pollDevice(d)));
  }

  async _pollDevice(device) {
    const id = device.instance;
    let status;
    try {
      status = await this._get(`/devices/${id}/status`);
    } catch (err) {
      console.error(`[SmartThings] Poll failed for ${device.label}: ${err.message}`);
      return;
    }

    const main = status?.components?.main ?? {};

    for (const [capId, def] of Object.entries(CAPABILITIES)) {
      if (!device._caps.has(capId)) continue;

      if (def.type === 'color') {
        const hue = main[capId]?.hue?.value;
        const sat = main[capId]?.saturation?.value;
        if (hue != null) this.store.update(`${device.key}/hue`, hue);
        if (sat != null) this.store.update(`${device.key}/saturation`, sat);
        continue;
      }

      if (def.multi) {
        for (const m of def.multi) {
          const v = main[capId]?.[m.storeAttr]?.value;
          if (v != null) this.store.update(`${device.key}/${m.storeAttr}`, v);
        }
        continue;
      }

      if (!def.storeAttr) continue;
      const attrData = main[capId]?.[def.storeAttr];
      if (attrData == null) continue;

      let value = attrData.value;
      if (value == null) continue;

      // Normalise string state values to 1/0 (skip raw: true attributes like thermostat mode)
      if (!def.raw && typeof value === 'string') {
        if (['on', 'open', 'active', 'present', 'unlocked', 'detected'].includes(value)) value = 1;
        else if (['off', 'closed', 'inactive', 'not present', 'locked', 'clear', 'not detected'].includes(value)) value = 0;
      }

      this.store.update(`${device.key}/${def.storeAttr}`, value);
    }
  }

  // ── HTTP ─────────────────────────────────────────────────

  async _get(path) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${this.config.smartthings.token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
  }

  async _post(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.smartthings.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for POST ${path}`);
    return res.json();
  }

  async _writeDevice(deviceId, capability, command, args = []) {
    try {
      await this._post(`/devices/${deviceId}/commands`, {
        commands: [{ component: 'main', capability, command, arguments: args }],
      });
    } catch (err) {
      console.error(`[SmartThings] Write failed for ${deviceId}: ${err.message}`);
    }
  }
}

module.exports = SmartThingsClient;
