'use strict';

const http           = require('http');
const platformStatus = require('./platform-status');

const TRACKED_TYPES = [
  'binarySwitch', 'dimmer', 'temperatureSensor', 'humiditySensor',
  'lightSensor',  'powerSensor', 'energyMeter',  'doorSensor',
  'motionSensor', 'windowSensor', 'smokeSensor',  'floodSensor',
  'multilevelSensor', 'FGRM', 'FGR', 'rollerShutter',
];

class FibaroClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._last     = 0;
    this._pollTimer = null;
    this._devices  = {}; // deviceId → { deviceKey }
  }

  async start() {
    const cfg = this._config.fibaro;
    if (!cfg?.host) return;
    try {
      await this._init();
      platformStatus.set('fibaro', true);
      this._schedulePoll();
    } catch (err) {
      console.error(`[Fibaro] Init failed: ${err.message}`);
      platformStatus.set('fibaro', false);
    }
  }

  stop() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  async _init() {
    const [rooms, devices] = await Promise.all([
      this._get('/api/rooms'),
      this._get('/api/devices'),
    ]);

    const roomNames = {};
    for (const r of rooms) roomNames[r.id] = r.name;

    const byRoom = {};
    for (const dev of devices) {
      if (!this._shouldTrack(dev)) continue;
      const roomId   = dev.roomID || 0;
      const roomName = roomNames[roomId] || 'Devices';
      if (!byRoom[roomId]) byRoom[roomId] = { name: roomName, devices: [] };
      byRoom[roomId].devices.push(dev);
    }

    for (const [roomId, group] of Object.entries(byRoom)) {
      const deviceKey = `fibaro/room_${roomId}`;
      const sensors   = group.devices.map(dev => this._sensorFor(dev));

      const device = {
        key:    deviceKey,
        label:  group.name,
        type:   'fibaro',
        homekit: [],
        sensors,
        _writeCapability: async (capId, command, args = []) =>
          this._writeDevice(capId, command, args),
      };

      this._registry.registerDevice(device);

      for (const dev of group.devices) {
        this._devices[dev.id] = { deviceKey };
        this._applyValue(deviceKey, dev.id, dev.properties?.value);
      }
    }

    const roomCount   = Object.keys(byRoom).length;
    const deviceCount = Object.keys(this._devices).length;
    console.log(`[Fibaro] Registered ${deviceCount} device(s) across ${roomCount} room(s)`);
  }

  _shouldTrack(dev) {
    const t = dev.type || '';
    return TRACKED_TYPES.some(p => t.includes(p));
  }

  _sensorFor(dev) {
    const t   = dev.type || '';
    const id  = String(dev.id);
    const path = `${id}/value`;
    const base = { path, name: dev.name, capabilityId: id };

    if (t.includes('binarySwitch')) {
      return { ...base, type: 'boolean', controllable: true,
        writeOn: 'on', writeOff: 'off',
        homekit: { service: 'Switch', characteristic: 'On' } };
    }
    if (t.includes('dimmer')) {
      return { ...base, type: 'range', controllable: true, min: 0, max: 99, writeCmd: 'set',
        homekit: { service: 'Lightbulb', characteristic: 'Brightness' } };
    }
    if (t.includes('FGRM') || t.includes('FGR') || t.includes('rollerShutter')) {
      return { ...base, type: 'range', controllable: true, min: 0, max: 100, writeCmd: 'set',
        homekit: { service: 'WindowCovering', characteristic: 'CurrentPosition' } };
    }
    if (t.includes('temperatureSensor')) {
      return { ...base, type: 'number', controllable: false, unit: '°C' };
    }
    if (t.includes('humiditySensor')) {
      return { ...base, type: 'number', controllable: false, unit: '%' };
    }
    if (t.includes('lightSensor')) {
      return { ...base, type: 'number', controllable: false, unit: 'lux' };
    }
    if (t.includes('powerSensor') || t.includes('energyMeter')) {
      return { ...base, type: 'number', controllable: false,
        unit: dev.properties?.unit || 'W' };
    }
    if (t.includes('doorSensor') || t.includes('windowSensor')) {
      return { ...base, type: 'boolean', controllable: false };
    }
    if (t.includes('motionSensor')) {
      return { ...base, type: 'boolean', controllable: false };
    }
    if (t.includes('smokeSensor') || t.includes('floodSensor')) {
      return { ...base, type: 'boolean', controllable: false };
    }
    return { ...base, type: 'number', controllable: false,
      unit: dev.properties?.unit || '' };
  }

  _applyValue(deviceKey, deviceId, rawValue) {
    let value = rawValue;
    if (value === 'true')  value = true;
    else if (value === 'false') value = false;
    else {
      const n = Number(value);
      if (value !== '' && value !== null && value !== undefined && !isNaN(n)) value = n;
    }
    this._store.update(`${deviceKey}/${deviceId}/value`, value);
  }

  // ── Write ──────────────────────────────────────────────────────────────

  async _writeDevice(deviceId, command, args) {
    let action, body;
    if (command === 'on')  { action = 'turnOn';  body = { args: [] }; }
    else if (command === 'off') { action = 'turnOff'; body = { args: [] }; }
    else if (command === 'set') { action = 'setValue'; body = { args: [args[0]] }; }
    else { action = command; body = { args: args || [] }; }
    await this._post(`/api/devices/${deviceId}/action/${action}`, body);
  }

  // ── Long-poll state updates ────────────────────────────────────────────

  _schedulePoll() {
    const poll = async () => {
      try {
        const data = await this._get(`/api/refreshStates?last=${this._last}`, 55000);
        if (data.last) this._last = data.last;
        for (const change of data.changes || []) {
          const info = this._devices[change.id];
          if (!info || !('value' in change)) continue;
          this._applyValue(info.deviceKey, change.id, change.value);
        }
        platformStatus.set('fibaro', true);
      } catch (err) {
        console.error(`[Fibaro] Poll error: ${err.message}`);
        platformStatus.set('fibaro', false);
      }
      this._pollTimer = setTimeout(poll, 500);
    };
    poll();
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────

  _authHeader() {
    const { username = 'admin', password = '' } = this._config.fibaro;
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  _get(path, timeoutMs = 10000) {
    const cfg = this._config.fibaro;
    return new Promise((resolve, reject) => {
      const req = http.get({
        hostname: cfg.host,
        port:     cfg.port || 80,
        path,
        timeout:  timeoutMs,
        headers:  { Authorization: this._authHeader(), Accept: 'application/json' },
      }, res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error('Non-JSON response')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  _post(path, body) {
    const cfg     = this._config.fibaro;
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: cfg.host,
        port:     cfg.port || 80,
        path,
        method:   'POST',
        timeout:  8000,
        headers: {
          Authorization:    this._authHeader(),
          'Content-Type':   'application/json',
          'Content-Length': payload.length,
        },
      }, res => {
        res.resume();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
        } else {
          resolve();
        }
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(payload);
      req.end();
    });
  }
}

module.exports = FibaroClient;
