'use strict';

const platformStatus = require('./platform-status');

const POLL_MS = 10_000;

// Capabilities Homey stores as 0–1 float; we scale ×100 for display and ÷100 on write
const SCALE_01 = new Set([
  'dim', 'light_temperature', 'window_coverings_set',
  'window_coverings_tilt_set', 'volume_set', 'fan_speed',
]);

// Homey capability ID → sensor descriptor
const CAP_DEFS = {
  onoff:                 { path: 'onoff',              name: 'Switch',          format: 'on-off',      homekit: 'switch-rw',         controllable: true, type: 'toggle',   writeOn: true,  writeOff: false, capId: 'onoff' },
  dim:                   { path: 'dim',                name: 'Brightness',      format: 'percent',                                   controllable: true, type: 'range',    writeCmd: 'dim', min: 0, max: 100, capId: 'dim' },
  light_temperature:     { path: 'light_temperature',  name: 'Color Temp',      format: 'number',      hidden: true },
  light_hue:             { path: 'light_hue',          name: 'Hue',             format: 'number',      hidden: true },
  light_saturation:      { path: 'light_saturation',   name: 'Saturation',      format: 'number',      hidden: true },
  measure_temperature:   { path: 'temperature',        name: 'Temperature',     format: 'temperature', homekit: 'temperature',       unit: '°C' },
  measure_humidity:      { path: 'humidity',           name: 'Humidity',        format: 'percent',     homekit: 'humidity',          unit: '%' },
  measure_power:         { path: 'power',              name: 'Power',           format: 'power',       unit: 'W' },
  measure_battery:       { path: 'battery',            name: 'Battery',         format: 'percent',     homekit: 'battery-level',     unit: '%' },
  measure_luminance:     { path: 'luminance',          name: 'Illuminance',     format: 'number',      homekit: 'lux',               unit: 'lux' },
  measure_co2:           { path: 'co2',                name: 'CO₂',             format: 'co2',         homekit: 'co2-sensor',        unit: 'ppm' },
  measure_pm25:          { path: 'pm25',               name: 'PM2.5',           format: 'pm25',        unit: 'μg/m³' },
  measure_voltage:       { path: 'voltage',            name: 'Voltage',         format: 'number',      unit: 'V' },
  measure_current:       { path: 'current',            name: 'Current',         format: 'number',      unit: 'A' },
  alarm_motion:          { path: 'motion',             name: 'Motion',          format: 'on-off',      homekit: 'motion' },
  alarm_contact:         { path: 'contact',            name: 'Contact',         format: 'on-off',      homekit: 'contact' },
  alarm_smoke:           { path: 'smoke',              name: 'Smoke',           format: 'alarm',       homekit: 'smoke' },
  alarm_co:              { path: 'co_alarm',           name: 'CO',              format: 'alarm',       homekit: 'co' },
  alarm_water:           { path: 'water',              name: 'Water',           format: 'alarm',       homekit: 'leak' },
  alarm_generic:         { path: 'alarm',              name: 'Alarm',           format: 'alarm' },
  target_temperature:    { path: 'target_temperature', name: 'Target Temp',     format: 'temperature', homekit: 'target-temperature', controllable: true, type: 'range', writeCmd: 'target_temperature', min: 5, max: 35, capId: 'target_temperature', unit: '°C' },
  thermostat_mode:       { path: 'thermostat_mode',    name: 'Thermostat Mode', format: 'string',      raw: true },
  locked:                { path: 'locked',             name: 'Lock',            format: 'on-off',      homekit: 'lock-rw',           controllable: true, type: 'toggle',   writeOn: true,  writeOff: false, capId: 'locked' },
  window_coverings_set:  { path: 'cover_position',     name: 'Position',        format: 'percent',     homekit: 'cover-rw',          controllable: true, type: 'range',    writeCmd: 'window_coverings_set',  min: 0, max: 100, capId: 'window_coverings_set' },
  volume_set:            { path: 'volume',             name: 'Volume',          format: 'percent',     controllable: true,           type: 'range',    writeCmd: 'volume_set',  min: 0, max: 100, capId: 'volume_set' },
  volume_mute:           { path: 'muted',              name: 'Mute',            format: 'on-off',      controllable: true,           type: 'toggle',   writeOn: true,  writeOff: false, capId: 'volume_mute' },
  speaker_playing:       { path: 'playing',            name: 'Playing',         format: 'on-off',      controllable: true,           type: 'toggle',   writeOn: true,  writeOff: false, capId: 'speaker_playing' },
  garagedoor_closed:     { path: 'garage_closed',      name: 'Garage Door',     format: 'on-off',      homekit: 'garage-door-opener', controllable: true, type: 'toggle', writeOn: true, writeOff: false, capId: 'garagedoor_closed' },
};

const CLASS_ICONS = {
  light: '💡', socket: '🔌', sensor: '📡', thermostat: '🌡', lock: '🔒',
  curtain: '🪟', blinds: '🪟', sunshade: '🪟', fan: '💨', camera: '📷',
  doorbell: '🔔', heater: '♨️', kettle: '☕', speaker: '🔊', tv: '📺',
  amplifier: '🎵', homealarm: '🚨', vacuumcleaner: '🤖', car: '🚗',
};
const CLASS_COLORS = { light: 'blue', socket: 'blue', lock: 'blue', curtain: 'blue', blinds: 'blue', sunshade: 'blue' };

function _homekitTypes(caps) {
  const types = [];
  if (caps.has('thermostat_mode') || caps.has('target_temperature')) types.push('thermostat');
  else if (caps.has('locked'))                  types.push('lock-rw');
  else if (caps.has('window_coverings_set'))    types.push('cover-rw');
  else if (caps.has('garagedoor_closed'))       types.push('garage-door-opener');
  else if (caps.has('speaker_playing'))         types.push('speaker');
  else if (caps.has('onoff') && caps.has('dim'))types.push('light-rw');
  else if (caps.has('onoff'))                   types.push('switch-rw');

  if (caps.has('measure_battery'))   types.push('battery-level');
  if (caps.has('measure_temperature') && !caps.has('thermostat_mode') && !caps.has('target_temperature')) types.push('temperature');
  if (caps.has('measure_humidity'))  types.push('humidity');
  if (caps.has('alarm_contact'))     types.push('contact');
  if (caps.has('alarm_motion'))      types.push('motion');
  if (caps.has('alarm_smoke'))       types.push('smoke');
  if (caps.has('alarm_co'))          types.push('co');
  if (caps.has('alarm_water'))       types.push('leak');
  if (caps.has('measure_co2'))       types.push('co2-sensor');
  if (caps.has('measure_luminance')) types.push('lux');
  return types;
}

class HomeyClient {
  constructor(config, store, sensorRegistry) {
    this._config    = config;
    this._store     = store;
    this._registry  = sensorRegistry;
    this._devices   = [];
    this._timer     = null;
    this._baseUrl   = '';
    this._token     = '';
  }

  async start() {
    const cfg = this._config.homey;
    this._token = cfg.token;

    if (cfg.mode === 'cloud') {
      if (!cfg.homeyId) throw new Error('Homey Cloud mode requires homeyId');
      this._baseUrl = `https://${cfg.homeyId}.connect.athom.com`;
    } else {
      if (!cfg.host) throw new Error('Homey local mode requires host');
      this._baseUrl = `http://${cfg.host}`;
    }

    await this._discoverDevices();
    platformStatus.set('homey', true);

    const interval = (cfg.pollInterval ?? 10) * 1000;
    this._timer = setInterval(() => this._pollAll(), interval);
    console.log(`[Homey] Started (${cfg.mode ?? 'local'}) — ${this._devices.length} device(s), polling every ${interval / 1000}s`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    console.log('[Homey] Stopped');
  }

  // ── Discovery ──────────────────────────────────────────────────────────

  async _discoverDevices() {
    const raw   = await this._get('/api/manager/devices/device');
    // Response can be an array or an object keyed by device ID
    const items = Array.isArray(raw) ? raw : Object.values(raw);

    for (const item of items) {
      if (item.available === false) continue;

      const caps = new Set(item.capabilities ?? []);

      const sensors = [];
      for (const [capId, def] of Object.entries(CAP_DEFS)) {
        if (!caps.has(capId) || def.hidden) continue;
        const s = { path: def.path, name: def.name, format: def.format };
        if (def.homekit)               s.homekit      = def.homekit;
        if (def.controllable)          s.controllable = true;
        if (def.type)                  s.type         = def.type;
        if (def.writeOn  !== undefined)s.writeOn      = def.writeOn;
        if (def.writeOff !== undefined)s.writeOff     = def.writeOff;
        if (def.writeCmd)              s.writeCmd     = def.writeCmd;
        if (def.capId)                 s.capabilityId = def.capId;
        if (def.min != null)           s.min          = def.min;
        if (def.max != null)           s.max          = def.max;
        if (def.unit)                  s.unit         = def.unit;
        sensors.push(s);
      }
      if (sensors.length === 0) continue;

      const deviceId = item.id;
      const cls      = item.class ?? 'other';
      const device   = {
        key:     `homey/${deviceId}`,
        type:    'homey',
        instance: deviceId,
        label:   item.name || deviceId,
        icon:    CLASS_ICONS[cls] ?? '📟',
        color:   CLASS_COLORS[cls] ?? 'orange',
        sensors,
        homekit: _homekitTypes(caps),
        _caps:   caps,
        _writeCapability: (capId, command, args = []) => this._writeDevice(deviceId, capId, command, args),
      };

      this._devices.push(device);
      this._registry.registerDevice(device);

      this._applyCapObj(device, item.capabilitiesObj ?? {});
    }
  }

  // ── Polling ────────────────────────────────────────────────────────────

  async _pollAll() {
    for (const device of this._devices) {
      try {
        const data = await this._get(`/api/manager/devices/device/${device.instance}`);
        this._applyCapObj(device, data.capabilitiesObj ?? {});
      } catch (err) {
        console.error(`[Homey] Poll failed for ${device.label}: ${err.message}`);
      }
    }
  }

  _applyCapObj(device, capObj) {
    for (const [capId, def] of Object.entries(CAP_DEFS)) {
      if (!device._caps.has(capId)) continue;
      const entry = capObj[capId];
      if (!entry || entry.value == null) continue;

      let value = entry.value;
      if (SCALE_01.has(capId) && typeof value === 'number') value = Math.round(value * 100);
      if (typeof value === 'boolean') value = value ? 1 : 0;

      this._store.update(`${device.key}/${def.path}`, value);
    }
  }

  // ── Control ────────────────────────────────────────────────────────────

  async _writeDevice(deviceId, capId, command, args = []) {
    // Range: args[0] is the scaled display value (0-100); Homey expects raw (0-1) for SCALE_01 caps
    let value;
    if (args.length > 0) {
      value = args[0];
      if (SCALE_01.has(capId) && typeof value === 'number') value = value / 100;
    } else {
      value = command; // toggle: true / false
    }
    try {
      await this._put(`/api/manager/devices/device/${deviceId}/capability/${capId}/value`, { value });
    } catch (err) {
      console.error(`[Homey] Write failed ${deviceId}/${capId}: ${err.message}`);
    }
  }

  // ── HTTP ───────────────────────────────────────────────────────────────

  async _get(path) {
    const res = await fetch(`${this._baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this._token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} GET ${path}`);
    return res.json();
  }

  async _put(path, body) {
    const res = await fetch(`${this._baseUrl}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this._token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} PUT ${path}`);
  }
}

module.exports = HomeyClient;
