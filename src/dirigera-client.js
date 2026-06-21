'use strict';

/**
 * IKEA Dirigera hub client.
 *
 * Discovers devices via REST and receives live updates via WebSocket.
 * Attribute names are normalized to match the SmartThings naming convention
 * so that existing HomeKit service builders in homekit-bridge.js can be reused.
 *
 * Auth: obtain a bearer token once using the one-time OAuth pairing flow
 * (press button on hub then run: node scripts/dirigera-auth.js <host>).
 * Set "token" in config.dirigera.
 *
 * Config:
 *   "dirigera": { "host": "192.168.x.x", "token": "..." }
 */

const https          = require('https');
const platformStatus = require('./platform-status');

const PORT           = 8443;
const POLL_INTERVAL  = 30_000;
const AGENT          = new https.Agent({ rejectUnauthorized: false });

// Dirigera attribute → LSH normalized store path
const ATTR_PATH = {
  isOn:               'switch',
  lightLevel:         'level',        // 1-100
  colorTemperature:   'colorTemperature', // Kelvin
  colorHue:           'hue',          // 0-360 → stored 0-100 (SmartThings compat)
  colorSaturation:    'saturation',   // 0-1   → stored 0-100
  blindsCurrentLevel: 'level',        // 0-100
  currentActivePower: 'power',
  isDetected:         'motion',       // boolean → 1/0
  batteryPercentage:  'battery',
  currentTemperature: 'temperature',  // °C
  currentRH:          'humidity',     // %
  currentPM25:        'fineDustLevel',
  vocIndex:           'airQuality',   // 1-500 VOC index used as AQI proxy
};

function normaliseValue(attr, raw) {
  if (attr === 'isOn' || attr === 'isDetected') return raw ? 1 : 0;
  if (attr === 'colorHue') return Math.round(raw / 3.6);       // 0-360 → 0-100
  if (attr === 'colorSaturation') return Math.round(raw * 100); // 0-1   → 0-100
  return raw;
}

class DirigeraClient {
  constructor(config, store, sensorRegistry) {
    this._cfg      = config.dirigera;
    this._store    = store;
    this._registry = sensorRegistry;
    this._meta     = new Map(); // dirigera id → { key, type, raw (original item) }
    this._timer    = null;
    this._ws       = null;
    this._wsTimer  = null;
  }

  async start() {
    const { host, token } = this._cfg;
    if (!host || !token) throw new Error('Dirigera: host and token are required');

    await this._discover();
    platformStatus.set('dirigera', true);
    this._connectWS();
    this._timer = setInterval(() => this._pollAll(), POLL_INTERVAL);
    console.log(`[Dirigera] Started — ${this._meta.size} device(s)`);
  }

  stop() {
    if (this._timer)   clearInterval(this._timer);
    if (this._wsTimer) clearTimeout(this._wsTimer);
    if (this._ws)      try { this._ws.destroy(); } catch {}
    platformStatus.set('dirigera', false);
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  async _discover() {
    const items = await this._get('/v1/devices');
    for (const item of items) this._registerItem(item);
    await this._pollAll();
  }

  _registerItem(item) {
    const { id, type, attributes = {} } = item;
    if (!attributes.isReachable) return;

    const { sensors, homekit } = this._buildSensors(type, attributes);
    if (sensors.length === 0) return;

    const key = `dirigera/${id}`;
    this._meta.set(id, { key, type, item });

    const device = {
      key,
      label:   attributes.customName || attributes.model || type,
      type:    'dirigera',
      icon:    this._icon(type),
      color:   'blue',
      sensors,
      homekit,
      _writeCapability: (capId, command, args = []) =>
        this._write(id, type, capId, command, args),
    };

    this._registry.registerDevice(device);
  }

  // ── Sensor schema ─────────────────────────────────────────────────────────

  _buildSensors(type, attrs) {
    const sensors = [];
    const homekit = [];
    const add = (path, name, format, hk, extra = {}) => {
      if (hk && !homekit.includes(hk)) homekit.push(hk);
      sensors.push({ path, name, format, ...(hk ? { homekit: hk } : {}), ...extra });
    };

    switch (type) {
      case 'light':
        add('switch', 'Power', 'on-off', 'light-rw',
          { controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch' });
        if ('lightLevel' in attrs)
          add('level', 'Brightness', 'percent');
        if ('colorTemperature' in attrs)
          add('colorTemperature', 'Color Temp', 'number');
        if ('colorHue' in attrs) {
          add('hue',        'Hue',        'number', null, { hidden: true });
          add('saturation', 'Saturation', 'number', null, { hidden: true });
        }
        break;

      case 'outlet':
        add('switch', 'Power', 'on-off', 'switch-rw',
          { controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch' });
        if ('currentActivePower' in attrs)
          add('power', 'Power', 'power');
        break;

      case 'blinds':
        // windowShade: binary open/close used by addWindowCoveringService
        add('windowShade', 'Blinds', 'on-off', 'cover-rw',
          { controllable: true, type: 'toggle', writeOn: 'open', writeOff: 'close', capabilityId: 'windowShade' });
        add('level', 'Position', 'percent');
        break;

      case 'motionSensor':
        add('motion', 'Motion', 'on-off', 'motion');
        if ('batteryPercentage' in attrs)
          add('battery', 'Battery', 'percent', 'battery-level');
        break;

      case 'environmentSensor':
        if ('currentPM25' in attrs)        add('fineDustLevel', 'PM2.5',       'pm25', 'air-quality');
        if ('vocIndex' in attrs)           add('airQuality',    'VOC Index',   'aqi');
        if ('currentTemperature' in attrs) add('temperature',   'Temperature', 'temperature', 'temperature');
        if ('currentRH' in attrs)          add('humidity',      'Humidity',    'percent', 'humidity');
        break;
    }

    return { sensors, homekit };
  }

  _icon(type) {
    return { light: '💡', outlet: '🔌', blinds: '🪟', motionSensor: '👁', environmentSensor: '💨' }[type] || '📟';
  }

  // ── State application ─────────────────────────────────────────────────────

  async _pollAll() {
    let items;
    try { items = await this._get('/v1/devices'); }
    catch (err) {
      console.error(`[Dirigera] Poll failed: ${err.message}`);
      platformStatus.set('dirigera', false);
      return;
    }
    platformStatus.set('dirigera', true);
    for (const item of items) this._applyAttrs(item.id, item.type, item.attributes);
  }

  _applyAttrs(id, type, attrs = {}) {
    const meta = this._meta.get(id);
    if (!meta) return;
    const { key } = meta;

    for (const [attr, raw] of Object.entries(attrs)) {
      if (raw == null) continue;
      const path = ATTR_PATH[attr];
      if (!path) continue;
      this._store.update(`${key}/${path}`, normaliseValue(attr, raw));
    }

    // Derived: windowShade (binary open/close) from blindsCurrentLevel
    if (type === 'blinds' && 'blindsCurrentLevel' in attrs) {
      this._store.update(`${key}/windowShade`, attrs.blindsCurrentLevel >= 50 ? 1 : 0);
    }
  }

  // ── Write (HomeKit → Dirigera API) ───────────────────────────────────────

  async _write(id, type, capId, command, args) {
    const attr = {};

    if (capId === 'switch') {
      attr.isOn = command === 'on';
    } else if (capId === 'switchLevel') {
      attr.lightLevel = args[0];
    } else if (capId === 'colorControl') {
      const { hue, saturation } = args[0] || {};
      if (hue        != null) attr.colorHue        = hue * 3.6;        // 0-100 → 0-360
      if (saturation != null) attr.colorSaturation = saturation / 100; // 0-100 → 0-1
    } else if (capId === 'colorTemperature') {
      attr.colorTemperature = args[0]; // Kelvin
    } else if (capId === 'windowShade') {
      if (command === 'open')        attr.blindsTargetLevel = 100;
      else if (command === 'close')  attr.blindsTargetLevel = 0;
      else if (command === 'setLevel') attr.blindsTargetLevel = args[0];
    }

    if (Object.keys(attr).length) {
      try {
        await this._patch(`/v1/devices/${id}`, [{ attributes: attr }]);
      } catch (err) {
        console.error(`[Dirigera] Write failed for ${id}: ${err.message}`);
      }
    }
  }

  // ── WebSocket (live events) ───────────────────────────────────────────────

  _connectWS() {
    const { host, token } = this._cfg;
    let buf = '';

    const req = https.request({
      hostname: host,
      port:     PORT,
      path:     '/v1',
      method:   'GET',
      agent:    AGENT,
      headers:  {
        Authorization: `Bearer ${token}`,
        Upgrade:       'websocket',
        Connection:    'Upgrade',
        'Sec-WebSocket-Key':     Buffer.from(Math.random().toString()).toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (res, socket) => {
      this._ws = socket;
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        let boundary;
        while ((boundary = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, boundary).trim();
          buf = buf.slice(boundary + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'deviceStateChanged' && msg.data?.id) {
              this._applyAttrs(msg.data.id, msg.data.type, msg.data.attributes);
            }
          } catch {}
        }
      });
      socket.on('close', () => this._scheduleWSReconnect());
      socket.on('error', () => this._scheduleWSReconnect());
    });

    req.on('error', () => this._scheduleWSReconnect());
    req.end();
  }

  _scheduleWSReconnect() {
    if (this._wsTimer) return;
    this._wsTimer = setTimeout(() => {
      this._wsTimer = null;
      this._connectWS();
    }, 10_000);
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  _get(path) { return this._request('GET', path); }
  _patch(path, body) { return this._request('PATCH', path, body); }

  _request(method, path, body = null) {
    const { host, token } = this._cfg;
    const payload = body ? JSON.stringify(body) : null;

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: host, port: PORT, path, method, agent: AGENT,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} ${path}`));
          try { resolve(data ? JSON.parse(data) : null); } catch { resolve(null); }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}

module.exports = DirigeraClient;
