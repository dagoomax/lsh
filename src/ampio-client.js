'use strict';

const mqtt           = require('mqtt');
const platformStatus = require('./platform-status');

// Ampio smart home (CAN modules) via the MQTT broker on the M-SERV.
// States arrive on ampio/from/<MAC>/state/<type>/<idx> (t temperature, i binary
// input, o binary output, a analogue 0-255, au 8-bit level e.g. LED/DALI,
// f flags); commands go to ampio/to/<MAC>/<o|f>/<idx>/cmd ('on'/'off', 0-255,
// or 0=STOP/1=DOWN/2=UP for roller modules). There is no discovery API —
// devices are declared in config.ampio.devices with the module MAC (as shown
// in Smart Home Konfigurator) and the input/output index.
//
// config.ampio = {
//   host: '192.168.1.x', port: 1883, username: '', password: '',
//   devices: [
//     { name: 'Lampa salon',  mac: '1C4A', type: 'light',       index: 1 },
//     { name: 'Ściemniacz',   mac: '1C4A', type: 'dimmer',      index: 2 },
//     { name: 'Roleta',       mac: '3910', type: 'blind',       index: 1 },
//     { name: 'Temp. salon',  mac: '3910', type: 'temperature', index: 1 },
//     { name: 'Czujka ruchu', mac: '3910', type: 'motion',      index: 3 },
//     { name: 'Flaga sceny',  mac: '1C4A', type: 'flag',        index: 5 },
//     { name: 'Jasność',      mac: '3910', type: 'sensor', index: 1, stateType: 'a', unit: 'lx' },
//   ],
// }

const TYPE_ICONS = {
  light: '💡', dimmer: '💡', switch: '🔌', blind: '🪟', flag: '🚩',
  temperature: '🌡️', contact: '🚪', motion: '🚶', sensor: '📟',
};

// default ampio/from state-type letter per device type
const STATE_TYPES = {
  light: 'o', switch: 'o', dimmer: 'au', flag: 'f', blind: 'o',
  temperature: 't', contact: 'i', motion: 'i', sensor: 'a',
};

class AmpioClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._client   = null;
    this._topics   = new Map();   // stateTopic → { d, deviceKey, type }
  }

  start() {
    const cfg = this._config.ampio || {};
    if (!cfg.host || !Array.isArray(cfg.devices) || !cfg.devices.length) {
      console.log('[Ampio] No host/devices configured');
      return;
    }

    for (const d of cfg.devices) {
      if (!d.mac || d.index == null) continue;
      this._register(d);
    }

    const url  = `mqtt://${cfg.host}:${cfg.port || 1883}`;
    const opts = { clientId: `lsh-ampio-${process.pid}`, connectTimeout: 10000, reconnectPeriod: 5000 };
    if (cfg.username) { opts.username = cfg.username; opts.password = cfg.password || ''; }

    console.log(`[Ampio] Connecting to ${url}`);
    this._client = mqtt.connect(url, opts);

    this._client.on('connect', () => {
      platformStatus.set('ampio', true);
      console.log(`[Ampio] Connected — subscribing to ${this._topics.size} state topics`);
      for (const topic of this._topics.keys()) this._client.subscribe(topic, { qos: 0 });
    });
    this._client.on('message', (topic, payload) => this._onState(topic, payload));
    this._client.on('error',   (err) => console.error('[Ampio] MQTT error:', err.message));
    this._client.on('offline', () => platformStatus.set('ampio', false));
    this._client.on('close',   () => platformStatus.set('ampio', false));
  }

  stop() {
    if (this._client) this._client.end(true);
    platformStatus.set('ampio', false);
  }

  // ── Registration ─────────────────────────────────────────────────────────

  _register(d) {
    const type      = d.type || 'switch';
    const letter    = d.stateType || STATE_TYPES[type] || 'a';
    const deviceKey = `ampio/${String(d.mac).toLowerCase()}-${letter}${d.index}`;
    const sensors   = [];

    if (type === 'light' || type === 'switch' || type === 'dimmer' || type === 'flag') {
      sensors.push({
        path: 'switch', label: type === 'flag' ? 'Flag' : type === 'switch' ? 'Switch' : 'Light',
        format: 'on-off', sensorType: type === 'dimmer' ? 'dimmer' : 'switch',
        controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off',
        capabilityId: 'switch', homekit: 'switch-rw',
      });
    }
    if (type === 'dimmer') {
      sensors.push({
        path: 'level', label: 'Brightness', format: 'percent', sensorType: 'dimmer',
        controllable: true, type: 'range',
        writeCmd: 'setLevel', capabilityId: 'level',
        min: 0, max: 100, rangeFormat: 'percent',
      });
    }
    if (type === 'blind') {
      // Roller modules take 0=STOP / 1=DOWN / 2=UP on the o/<idx>/cmd topic;
      // position feedback needs raw CAN frames, so only momentary buttons here
      for (const dir of ['up', 'down', 'stop']) {
        sensors.push({
          path: dir, label: dir[0].toUpperCase() + dir.slice(1), format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: dir, writeOff: dir,
          capabilityId: 'command', homekit: null,
        });
      }
    }
    if (type === 'temperature') {
      sensors.push({ path: 'value', label: 'Temperature', sensorType: 'temperature',
        unit: d.unit || '°C', homekit: 'temperature' });
    }
    if (type === 'contact' || type === 'motion') {
      sensors.push({ path: 'value', label: type === 'motion' ? 'Motion' : 'Contact',
        format: 'on-off', sensorType: 'sensor', homekit: type });
    }
    if (type === 'sensor') {
      sensors.push({ path: 'value', label: d.label || 'Value', sensorType: 'sensor', unit: d.unit || '' });
    }

    this._registry.registerDevice({
      key:   deviceKey,
      label: d.name || `${d.mac} ${letter}${d.index}`,
      type:  'ampio',
      icon:  d.icon || TYPE_ICONS[type] || '🏠',
      sensors,
      homekit: sensors.map((s) => s.homekit).filter(Boolean),
      _writeCapability: (capId, command, args) => this._write(d, capId, command, args),
    });

    if (type !== 'blind') {
      const stateTopic = d.stateTopic || `ampio/from/${d.mac}/state/${letter}/${d.index}`;
      this._topics.set(stateTopic, { d, deviceKey, type });
    }
    console.log(`[Ampio] Registered ${d.name || d.mac} (${type})`);
  }

  // ── State updates ────────────────────────────────────────────────────────

  _onState(topic, payload) {
    const entry = this._topics.get(topic);
    if (!entry) return;

    const { deviceKey, type } = entry;
    const raw = payload.toString().trim();
    const num = parseFloat(raw);
    if (isNaN(num)) return;

    if (type === 'light' || type === 'switch' || type === 'flag') {
      this._store.set(`${deviceKey}/switch`, num > 0);
    } else if (type === 'dimmer') {
      const pct = Math.round((num / 255) * 100);
      this._store.set(`${deviceKey}/level`, pct);
      this._store.set(`${deviceKey}/switch`, pct > 0);
    } else if (type === 'contact' || type === 'motion') {
      this._store.set(`${deviceKey}/value`, num > 0);
    } else {
      this._store.set(`${deviceKey}/value`, num * (entry.d.scale ?? 1));
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  _write(d, capId, command, args) {
    if (!this._client) return;
    const type  = d.type || 'switch';
    const kind  = type === 'flag' ? 'f' : 'o';
    const topic = d.commandTopic || `ampio/to/${d.mac}/${kind}/${d.index}/cmd`;

    if (capId === 'switch') {
      this._client.publish(topic, command === 'on' ? 'on' : 'off');
    } else if (capId === 'level') {
      this._client.publish(topic, String(Math.round(((args?.[0] ?? 0) / 100) * 255)));
    } else if (capId === 'command') {
      const code = { stop: '0', down: '1', up: '2' }[command];
      if (code) this._client.publish(topic, code);
    }
  }
}

module.exports = AmpioClient;
