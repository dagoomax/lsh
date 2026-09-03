'use strict';

// Dyson connected fans/purifiers/humidifiers (Pure Cool, Pure Hot+Cool, Pure
// Humidify+Cool, …) — local MQTT, matching every WiFi-connected model in that
// line. Dyson's cordless vacuums (360 Eye/Heurist/Vis Nav) use a completely
// different AWS-IoT-based cloud protocol and are NOT covered here.
//
// Cloud login (scripts/dyson-auth.js) happens once, offline, to obtain each
// device's serial/product type and its local MQTT password (shipped
// AES-encrypted by Dyson's API) — see persist/dyson-tokens.json. This client
// only ever talks to devices on the local network from then on; it never
// calls Dyson's cloud API itself.
//
// Protocol reference: reimplemented from the reverse-engineered Dyson local
// MQTT protocol documented across several open-source projects (libdyson,
// ha-dyson, node-dyson-api) — Dyson publishes nothing official. Untested
// against real hardware in this repo (no Dyson device available here); field
// names/encodings below are the commonly-documented ones for the Pure
// Cool/Hot+Cool/Humidify+Cool family and may not match every model exactly.

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const platformStatus = require('./platform-status');

const TOKENS_PATH = path.join(__dirname, '..', 'persist', 'dyson-tokens.json');
const MQTT_PORT = 1883;

// Known product-state fields → friendly label/unit/control shape. Anything
// not listed here (a field this file doesn't know about, or a future/other
// model's field) still gets registered, humanized from its raw key, same
// dynamic-discovery approach as vitodens-client.js — since Dyson's exact
// field set varies by model and isn't documented anywhere authoritative.
const KNOWN_FIELDS = {
  fpwr: { label: 'Power', kind: 'toggle' },
  fnst: { label: 'Fan state', kind: 'text' },
  fnsp: { label: 'Fan speed', kind: 'range', min: 1, max: 10, encode: (v) => String(v).padStart(4, '0'), decode: (v) => (/^\d+$/.test(v) ? parseInt(v, 10) : null) },
  auto: { label: 'Auto mode', kind: 'toggle' },
  oson: { label: 'Oscillation', kind: 'toggle' },
  nmod: { label: 'Night mode', kind: 'toggle' },
  rhtm: { label: 'Continuous monitoring', kind: 'toggle' },
  fdir: { label: 'Jet focus', kind: 'toggle' },
  hume: { label: 'Humidification', kind: 'toggle' },
  haut: { label: 'Auto humidity', kind: 'toggle' },
  hmax: { label: 'Target humidity', kind: 'sensor', unit: '%', decode: (v) => (/^\d+$/.test(v) ? parseInt(v, 10) : null) },
  filf: { label: 'Filter life', kind: 'sensor', unit: '%', decode: (v) => (/^\d+$/.test(v) ? parseInt(v, 10) : null) },
  hflr: { label: 'HEPA filter life', kind: 'sensor', unit: '%', decode: (v) => (/^\d+$/.test(v) ? parseInt(v, 10) : null) },
  cflr: { label: 'Carbon filter life', kind: 'sensor', unit: '%', decode: (v) => (/^\d+$/.test(v) ? parseInt(v, 10) : null) },
  sltm: { label: 'Sleep timer', kind: 'text' },
  // Environmental sensor data (separate MQTT message, same store namespace)
  pm25: { label: 'PM2.5', kind: 'sensor', unit: 'µg/m³', decode: parseNumericOrNull },
  pm10: { label: 'PM10', kind: 'sensor', unit: 'µg/m³', decode: parseNumericOrNull },
  va10: { label: 'VOC', kind: 'sensor', decode: parseNumericOrNull },
  noxl: { label: 'NOx', kind: 'sensor', decode: parseNumericOrNull },
  hact: { label: 'Humidity', kind: 'sensor', unit: '%', decode: parseNumericOrNull },
  tact: { label: 'Temperature', kind: 'sensor', unit: '°C', decode: (v) => { const k = parseNumericOrNull(v); return k == null ? null : Math.round((k / 10 - 273.15) * 10) / 10; } },
};

function parseNumericOrNull(v) {
  return /^\d+$/.test(String(v)) ? parseInt(v, 10) : null;
}

function humanize(key) {
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

class DysonDevice {
  constructor(entry, store, sensorRegistry) {
    this.entry = entry; // { serial, name, productType, localPassword, ip }
    this.store = store;
    this.sensorRegistry = sensorRegistry;
    this.deviceKey = `dyson/${entry.serial}`;
    this._registeredFields = new Set();
    this._client = null;

    this.device = {
      key: this.deviceKey,
      type: 'dyson',
      label: entry.name || `Dyson ${entry.productType}`,
      icon: '🌀',
      color: 'cyan',
      sensors: [],
      _writeCapability: (field, cmd, args) => this._writeField(field, args ? args[0] : cmd),
    };
    this.sensorRegistry.registerDevice(this.device);
  }

  start() {
    if (!this.entry.ip) {
      console.warn(`[Dyson] "${this.entry.name}" (${this.entry.serial}) has no IP set in persist/dyson-tokens.json — skipping. Find it on your router and fill in the "ip" field.`);
      return;
    }
    if (!this.entry.localPassword) {
      console.warn(`[Dyson] "${this.entry.name}" (${this.entry.serial}) has no local password — re-run scripts/dyson-auth.js.`);
      return;
    }

    const url = `mqtt://${this.entry.ip}:${MQTT_PORT}`;
    this._client = mqtt.connect(url, {
      username: this.entry.serial,
      password: this.entry.localPassword,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    const statusTopic = `${this.entry.productType}/${this.entry.serial}/status/current`;
    const commandTopic = `${this.entry.productType}/${this.entry.serial}/command`;
    this._commandTopic = commandTopic;

    this._client.on('connect', () => {
      console.log(`[Dyson] Connected to "${this.entry.name}" at ${this.entry.ip}`);
      platformStatus.set('dyson', true);
      this._client.subscribe(statusTopic);
      this._client.publish(commandTopic, JSON.stringify({ msg: 'REQUEST-CURRENT-STATE', time: new Date().toISOString() }));
    });
    this._client.on('message', (topic, payload) => this._onMessage(payload));
    this._client.on('error', (err) => console.error(`[Dyson] "${this.entry.name}" MQTT error: ${err.message}`));
    this._client.on('offline', () => platformStatus.set('dyson', false));
    this._client.on('close', () => platformStatus.set('dyson', false));
  }

  stop() {
    this._client?.end(true);
  }

  _onMessage(payload) {
    let msg;
    try { msg = JSON.parse(payload.toString()); } catch { return; }

    if (msg.msg === 'CURRENT-STATE' && msg['product-state']) {
      for (const [field, value] of Object.entries(msg['product-state'])) {
        // CURRENT-STATE gives the value directly; STATE-CHANGE (below) gives [old, new].
        this._applyField(field, value);
      }
    } else if (msg.msg === 'STATE-CHANGE' && msg['product-state']) {
      for (const [field, value] of Object.entries(msg['product-state'])) {
        this._applyField(field, Array.isArray(value) ? value[1] : value);
      }
    } else if (msg.msg === 'ENVIRONMENTAL-CURRENT-SENSOR-DATA' && msg.data) {
      for (const [field, value] of Object.entries(msg.data)) {
        this._applyField(field, value);
      }
    }
  }

  _applyField(field, rawValue) {
    if (!this._registeredFields.has(field)) {
      this._registeredFields.add(field);
      this._registerSensor(field);
    }
    const known = KNOWN_FIELDS[field];
    const decoded = known?.decode ? known.decode(rawValue) : rawValue;
    if (decoded == null) return; // placeholder value (e.g. "INIT", "OFF" sentinel) — skip rather than store garbage
    this.store.update(`${this.deviceKey}/${field}`, known?.kind === 'toggle' ? decoded === 'ON' : decoded);
  }

  _registerSensor(field) {
    const known = KNOWN_FIELDS[field];
    const sensor = { path: field, name: known?.label || humanize(field), label: known?.label || humanize(field) };

    if (known?.unit) sensor.unit = known.unit;

    if (known?.kind === 'toggle') {
      sensor.sensorType = 'switch';
      sensor.controllable = true;
      sensor.capabilityId = field;
      sensor.writeOn = 'ON';
      sensor.writeOff = 'OFF';
    } else if (known?.kind === 'range') {
      sensor.sensorType = 'sensor';
      sensor.type = 'range';
      sensor.controllable = true;
      sensor.capabilityId = field;
      sensor.writeCmd = field;
      sensor.min = known.min;
      sensor.max = known.max;
    } else {
      sensor.sensorType = 'sensor';
      sensor.raw = known?.kind === 'text' || !known;
    }

    this.device.sensors.push(sensor);
  }

  _writeField(field, value) {
    const known = KNOWN_FIELDS[field];
    const encoded = known?.encode ? known.encode(value) : value;
    return new Promise((resolve, reject) => {
      this._client.publish(this._commandTopic, JSON.stringify({
        msg: 'STATE-SET', time: new Date().toISOString(), 'mode-reason': 'LAPP', data: { [field]: encoded },
      }), (err) => (err ? reject(err) : resolve()));
    });
  }
}

class DysonClient {
  constructor(config, store, sensorRegistry) {
    this.config = config;
    this.store = store;
    this.sensorRegistry = sensorRegistry;
    this.devices = [];
  }

  async start() {
    if (!fs.existsSync(TOKENS_PATH)) {
      console.warn('[Dyson] No persist/dyson-tokens.json — run: node scripts/dyson-auth.js <email> <password>');
      return;
    }
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    } catch (err) {
      console.error(`[Dyson] Could not read dyson-tokens.json: ${err.message}`);
      return;
    }
    const entries = saved.devices || [];
    if (!entries.length) {
      console.warn('[Dyson] dyson-tokens.json has no devices.');
      return;
    }

    // configOverrides lets config.json's dyson.devices override/add an `ip`
    // per serial without re-running the auth script.
    const overrides = new Map((this.config.dyson?.devices || []).map((d) => [d.serial, d]));

    for (const entry of entries) {
      const override = overrides.get(entry.serial);
      const merged = override ? { ...entry, ip: override.ip || entry.ip } : entry;
      const device = new DysonDevice(merged, this.store, this.sensorRegistry);
      this.devices.push(device);
      device.start();
    }
    platformStatus.set('dyson', this.devices.some((d) => d.entry.ip));
  }

  stop() {
    this.devices.forEach((d) => d.stop());
  }
}

module.exports = DysonClient;
