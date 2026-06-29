'use strict';

const mqtt           = require('mqtt');
const platformStatus = require('./platform-status');

class ArduinoClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._client   = null;
    // topic → { kind:'device'|'sensor', key, sensors?[], path? }
    this._topicMap = new Map();
  }

  start() {
    const cfg     = this._config.arduino;
    const devices = cfg.devices || [];
    if (!devices.length) {
      console.warn('[Arduino] No devices configured');
      return;
    }

    const mqttCfg = this._config.mqtt;
    const host    = cfg.host || mqttCfg?.host || 'localhost';
    const port    = cfg.port || mqttCfg?.port || 1883;
    const url     = `mqtt://${host}:${port}`;
    const opts    = {
      clientId:        `lsh-arduino-${process.pid}`,
      connectTimeout:  10000,
      reconnectPeriod: 5000,
    };
    if (cfg.username) { opts.username = cfg.username; opts.password = cfg.password || ''; }

    console.log(`[Arduino] Connecting to ${url}`);
    this._client = mqtt.connect(url, opts);

    this._client.on('connect', () => {
      console.log('[Arduino] Connected');
      platformStatus.set('arduino', true);
      this._registerDevices(devices);
    });

    this._client.on('message', (topic, payload) => this._onMessage(topic, payload));
    this._client.on('error',   err => console.error(`[Arduino] MQTT error: ${err.message}`));
    this._client.on('offline', () => platformStatus.set('arduino', false));
    this._client.on('close',   () => platformStatus.set('arduino', false));
  }

  stop() {
    if (this._client) this._client.end(true);
  }

  // ── Registration ────────────────────────────────────────────────────────────

  _registerDevices(devices) {
    for (const dev of devices) {
      const safeName = (dev.name || 'device').replace(/[^a-zA-Z0-9_-]/g, '_');
      const key      = `arduino/${dev.key || safeName}`;
      const sensors  = (dev.sensors || []).map(s => this._sensorDescriptor(s));

      this._registry.registerDevice({
        key,
        label:   dev.name || safeName,
        type:    'arduino',
        homekit: [],
        sensors,
        _writeCapability: (capId, command, args) =>
          this._executeCommand(dev, capId, command, args),
      });

      // Device-level JSON topic
      if (dev.stateTopic) {
        this._topicMap.set(dev.stateTopic, { kind: 'device', key, sensors: dev.sensors || [] });
        this._client.subscribe(dev.stateTopic);
      }

      // Per-sensor topics
      for (const s of (dev.sensors || [])) {
        if (s.stateTopic) {
          this._topicMap.set(s.stateTopic, { kind: 'sensor', key, path: s.path });
          this._client.subscribe(s.stateTopic);
        }
      }

      console.log(`[Arduino] Registered: ${dev.name || key} (${sensors.length} sensors)`);
    }
  }

  _sensorDescriptor(s) {
    const sensorType = s.sensorType || _inferSensorType(s);
    if (s.type === 'toggle') {
      return {
        path: s.path, label: s.label || s.path, sensorType, format: 'on-off',
        controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off',
        capabilityId: s.path,
        homekit: s.homekit || null,
      };
    }
    if (s.type === 'range') {
      return {
        path: s.path, label: s.label || s.path, sensorType, unit: s.unit || '',
        controllable: true, type: 'range',
        min: s.min ?? 0, max: s.max ?? 100, rangeFormat: 'percent',
        writeCmd: 'set', capabilityId: s.path,
        homekit: s.homekit || null,
      };
    }
    // Read-only (temperature, humidity, numeric sensors, etc.)
    return {
      path: s.path, label: s.label || s.path, sensorType, unit: s.unit || '',
      homekit: s.homekit || null,
    };
  }

  // ── MQTT Message Handler ────────────────────────────────────────────────────

  _onMessage(topic, payload) {
    const entry = this._topicMap.get(topic);
    if (!entry) return;
    const raw = payload.toString().trim();

    if (entry.kind === 'sensor') {
      this._store.update(`${entry.key}/${entry.path}`, coerce(raw));
      return;
    }

    // Device-level JSON object
    let obj;
    try { obj = JSON.parse(raw); } catch { return; }
    if (typeof obj !== 'object' || obj === null) return;

    for (const s of entry.sensors) {
      const jsonKey = s.jsonKey || s.path;
      if (!(jsonKey in obj)) continue;
      const val = obj[jsonKey];
      this._store.update(`${entry.key}/${s.path}`,
        typeof val === 'boolean' ? (val ? 1 : 0) : val);
    }
  }

  // ── Command Dispatch ────────────────────────────────────────────────────────

  async _executeCommand(dev, capId, command, args) {
    if (!this._client) return;
    const sensor = (dev.sensors || []).find(s => s.path === capId);

    let payload;
    if (command === 'on') {
      payload = sensor?.payloadOn  ?? '1';
    } else if (command === 'off') {
      payload = sensor?.payloadOff ?? '0';
    } else if (command === 'set') {
      payload = String(args?.[0] ?? 0);
    } else {
      return;
    }

    const cmdTopic = sensor?.commandTopic || dev.commandTopic;
    if (!cmdTopic) return;

    if (sensor?.commandTopic) {
      // Per-sensor topic: publish bare payload
      this._client.publish(cmdTopic, payload);
    } else {
      // Device-level topic: publish JSON { sensorPath: payload }
      this._client.publish(cmdTopic, JSON.stringify({ [capId]: payload }));
    }
  }
}

function _inferSensorType(s) {
  if (s.type === 'toggle') return 'switch';
  if (s.type === 'range')  return 'dimmer';
  const unit  = (s.unit  || '').toLowerCase();
  const label = (s.label || s.path || '').toLowerCase();
  if (unit === '°c' || unit === '°f' || unit === 'c' || unit === 'f') return 'temperature';
  if (unit === 'lux' || unit === 'lx')                                  return 'light';
  if (unit === 'w' || unit === 'kw' || unit === 'va')                   return 'power';
  if (unit === 'kwh' || unit === 'wh')                                  return 'energy';
  if (label.includes('hum') || unit === 'rh')                           return 'humidity';
  if (unit === '%')                                                      return 'humidity';
  if (label.includes('motion') || label.includes('pir'))                return 'motion';
  if (label.includes('door') || label.includes('window'))               return 'door';
  if (label.includes('smoke') || label.includes('flood'))               return 'security';
  return 'sensor';
}

// Normalise common Arduino payload strings to numbers/booleans
function coerce(str) {
  const lo = str.toLowerCase();
  if (lo === '1' || lo === 'true'  || lo === 'on')  return 1;
  if (lo === '0' || lo === 'false' || lo === 'off') return 0;
  const n = parseFloat(str);
  return isNaN(n) ? str : n;
}

module.exports = ArduinoClient;
