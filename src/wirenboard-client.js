'use strict';

const mqtt           = require('mqtt');
const platformStatus = require('./platform-status');

/**
 * Wiren Board client — MQTT Conventions.
 *
 * WB controllers publish retained topics:
 *   /devices/<dev>/meta/name                 device display name
 *   /devices/<dev>/controls/<ctrl>           current value
 *   /devices/<dev>/controls/<ctrl>/meta/type switch|range|pushbutton|temperature|…
 *   /devices/<dev>/controls/<ctrl>/meta/{readonly,max,units}
 * Writes go to /devices/<dev>/controls/<ctrl>/on.
 *
 * Controls arrive as a retained burst on subscribe; each device is registered
 * once its topic stream has settled (debounced), so the sensor list is complete.
 */

// System devices that add noise on every WB controller — skipped unless
// explicitly whitelisted via cfg.devices.
const DEFAULT_EXCLUDE = new Set([
  'system', 'network', 'hwmon', 'power_status', 'buzzer', 'metrics', 'alarms',
]);

const UNIT_BY_TYPE = {
  temperature: '°C', rel_humidity: '%', voltage: 'V', current: 'A',
  power: 'W', power_consumption: 'kWh', illuminance: 'lx',
  atmospheric_pressure: 'hPa', pressure: 'bar', sound_level: 'dB',
  concentration: 'ppm', heat_power: 'W', heat_energy: 'kWh',
};

const SETTLE_MS = 2500;

class WirenBoardClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._client   = null;
    // devId → { name, controls: Map(ctrl → {type, readonly, max, units, value}), timer, registered }
    this._devices  = new Map();
  }

  start() {
    const cfg = this._config.wirenboard;
    if (!cfg?.host) return;

    const url  = `mqtt://${cfg.host}:${cfg.port || 1883}`;
    const opts = { clientId: `lsh-wirenboard-${process.pid}`, connectTimeout: 10000, reconnectPeriod: 5000 };
    if (cfg.username) { opts.username = cfg.username; opts.password = cfg.password || ''; }

    console.log(`[WirenBoard] Connecting to ${url}`);
    platformStatus.set('wirenboard', false);
    this._client = mqtt.connect(url, opts);

    this._client.on('connect', () => {
      console.log('[WirenBoard] Connected');
      platformStatus.set('wirenboard', true);
      this._client.subscribe(['/devices/+/meta/name', '/devices/+/controls/+', '/devices/+/controls/+/meta/+']);
    });
    this._client.on('message', (topic, payload) => this._onMessage(topic, payload.toString()));
    this._client.on('error',   (err) => console.error(`[WirenBoard] MQTT error: ${err.message}`));
    this._client.on('offline', () => platformStatus.set('wirenboard', false));
    this._client.on('close',   () => platformStatus.set('wirenboard', false));
  }

  stop() {
    if (this._client) this._client.end(true);
  }

  // ── Topic handling ──────────────────────────────────────────────────────

  _included(devId) {
    const cfg = this._config.wirenboard;
    if (cfg.devices?.length) return cfg.devices.includes(devId);
    return !DEFAULT_EXCLUDE.has(devId);
  }

  _dev(devId) {
    let d = this._devices.get(devId);
    if (!d) { d = { name: devId, controls: new Map(), timer: null, registered: false }; this._devices.set(devId, d); }
    return d;
  }

  _ctrl(dev, name) {
    let c = dev.controls.get(name);
    if (!c) { c = { type: 'value', readonly: false, max: null, units: '' }; dev.controls.set(name, c); }
    return c;
  }

  _onMessage(topic, value) {
    const m = /^\/devices\/([^/]+)\/(.+)$/.exec(topic);
    if (!m || !this._included(m[1])) return;
    const [, devId, rest] = m;
    const dev = this._dev(devId);

    if (rest === 'meta/name') {
      dev.name = value || devId;
    } else {
      const cm = /^controls\/([^/]+)(?:\/meta\/(.+))?$/.exec(rest);
      if (!cm) return;
      const [, ctrlName, metaKey] = cm;
      const ctrl = this._ctrl(dev, ctrlName);

      if (!metaKey) {
        ctrl.value = value;
        if (dev.registered) this._pushValue(devId, ctrlName, ctrl);
      } else if (metaKey === 'type')     ctrl.type = value;
      else if (metaKey === 'readonly')   ctrl.readonly = value === '1' || value === 'true';
      else if (metaKey === 'max')        ctrl.max = Number(value) || null;
      else if (metaKey === 'units')      ctrl.units = value;
    }

    // Debounced registration once the retained burst settles
    if (!dev.registered) {
      clearTimeout(dev.timer);
      dev.timer = setTimeout(() => this._registerDevice(devId, dev), SETTLE_MS);
    }
  }

  // ── Registration ────────────────────────────────────────────────────────

  _registerDevice(devId, dev) {
    dev.registered = true;
    const deviceKey = `wirenboard/${sanitize(devId)}`;
    const sensors = [];

    for (const [ctrlName, c] of dev.controls) {
      const desc = this._sensorDescriptor(devId, ctrlName, c);
      if (desc) sensors.push(desc);
    }
    if (!sensors.length) return;

    this._registry.registerDevice({
      key:     deviceKey,
      label:   dev.name,
      type:    'wirenboard',
      homekit: sensors.some((s) => s.homekit === 'temperature') ? ['temperature'] : [],
      sensors,
      _writeCapability: (capId, command, args = []) => this._command(capId, command, args),
    });
    console.log(`[WirenBoard] Registered: ${dev.name} (${sensors.length} controls)`);

    for (const [ctrlName, c] of dev.controls) {
      if (c.value !== undefined) this._pushValue(devId, ctrlName, c);
    }
  }

  _sensorDescriptor(devId, ctrlName, c) {
    const path  = sanitize(ctrlName);
    const capId = JSON.stringify([devId, ctrlName]); // raw ids for the write topic (names may contain spaces)
    const base  = { path, name: ctrlName };

    if (c.type === 'text' || c.type === 'rgb') return null;

    if (c.type === 'switch' || c.type === 'alarm') {
      return c.readonly || c.type === 'alarm'
        ? { ...base, type: 'boolean', format: 'on-off' }
        : { ...base, type: 'boolean', format: 'on-off', controllable: true, capabilityId: capId, writeOn: 'on', writeOff: 'off' };
    }
    if (c.type === 'pushbutton') {
      return { ...base, type: 'trigger', controllable: true, capabilityId: capId, writeOn: 'press' };
    }
    if (c.type === 'range') {
      const max = c.max || 100;
      return c.readonly
        ? { ...base, type: 'number' }
        : { ...base, type: 'range', controllable: true, capabilityId: capId, writeCmd: 'set', min: 0, max };
    }
    // numeric sensor types (temperature, power, voltage, value, …)
    const unit = c.units || UNIT_BY_TYPE[c.type] || '';
    return { ...base, type: 'number', unit, precision: 1,
      ...(c.type === 'temperature' ? { homekit: 'temperature' } : {}) };
  }

  _pushValue(devId, ctrlName, c) {
    const key = `wirenboard/${sanitize(devId)}/${sanitize(ctrlName)}`;
    let v = c.value;
    if (v === '1' && (c.type === 'switch' || c.type === 'alarm' || c.type === 'pushbutton')) v = 1;
    else if (v === '0' && (c.type === 'switch' || c.type === 'alarm' || c.type === 'pushbutton')) v = 0;
    else if (v !== '' && !isNaN(Number(v))) v = Number(v);
    else return; // non-numeric text — skip
    this._store.update(key, v);
  }

  // ── Commands ────────────────────────────────────────────────────────────

  _command(capId, command, args) {
    const [devId, ctrlName] = JSON.parse(capId);
    const topic = `/devices/${devId}/controls/${ctrlName}/on`;
    let payload;
    if      (command === 'on' || command === 'press') payload = '1';
    else if (command === 'off')                       payload = '0';
    else if (command === 'set')                       payload = String(Math.round(Number(args[0])));
    else return;
    this._client.publish(topic, payload);
  }
}

function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = WirenBoardClient;
