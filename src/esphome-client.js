'use strict';

const http           = require('http');
const platformStatus = require('./platform-status');

// ESPHome web_server REST API client.
// Requires `web_server:` component in ESPHome config (port 80 by default).
// Discovers entities via the /events SSE stream, then polls every 30 s.

const DOMAIN_MAP = {
  sensor:        { type: 'number',  controllable: false },
  binary_sensor: { type: 'boolean', controllable: false },
  switch:        { type: 'boolean', controllable: true  },
  light:         { type: 'boolean', controllable: true  },
  climate:       { type: 'number',  controllable: false },
  cover:         { type: 'boolean', controllable: true  },
};

function sensorFormat(domain, deviceClass, unitOfMeasurement) {
  const u = (unitOfMeasurement || '').toLowerCase();
  const dc = (deviceClass || '').toLowerCase();
  if (dc === 'temperature' || u === '°c' || u === '°f') return 'temperature';
  if (dc === 'humidity'    || (u === '%' && dc === 'humidity')) return 'percent';
  if (dc === 'power'       || u === 'w' || u === 'kw')  return 'power';
  if (dc === 'energy'      || u === 'kwh')               return 'energy';
  if (dc === 'battery')                                  return 'percent';
  if (dc === 'illuminance' || u === 'lx' || u === 'lux') return 'number';
  if (dc === 'carbon_dioxide' || u === 'ppm')            return 'co2';
  if (dc === 'pressure'    || u === 'hpa')               return 'number';
  if (dc === 'voltage'     || u === 'v')                 return 'number';
  if (dc === 'current'     || u === 'a')                 return 'number';
  if (domain === 'binary_sensor' || domain === 'switch' || domain === 'light') return 'on-off';
  return 'number';
}

function homekitType(domain, deviceClass) {
  const dc = (deviceClass || '').toLowerCase();
  if (domain === 'switch')        return 'switch-rw';
  if (domain === 'light')         return 'light-rw';
  if (dc === 'motion')            return 'motion';
  if (dc === 'door' || dc === 'window' || dc === 'opening') return 'contact';
  if (dc === 'smoke')             return 'smoke';
  if (dc === 'moisture')          return 'leak';
  if (dc === 'temperature')       return 'temperature';
  if (dc === 'humidity')          return 'humidity';
  if (dc === 'carbon_dioxide')    return 'co2-sensor';
  return null;
}

class ESPHomeClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._devices  = {}; // host → { cfg, entities: Map<id → {domain, path}> }
    this._timer    = null;
  }

  async start() {
    const devices = this._config.esphome?.devices || [];
    if (!devices.length) return;

    for (const cfg of devices) {
      await this._initDevice(cfg).catch(err =>
        console.error(`[ESPHome] Init failed for ${cfg.host}: ${err.message}`)
      );
    }

    if (Object.keys(this._devices).length) {
      platformStatus.set('esphome', true);
      this._timer = setInterval(() => this._pollAll(), 30000);
    }
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  // ── Device initialisation ────────────────────────────────────────────────

  async _initDevice(cfg) {
    const { host, port = 80, name, password } = cfg;
    const deviceKey = `esphome/${host.replace(/\./g, '_')}`;
    const label     = name || `ESPHome ${host}`;

    // Discover entities via /events SSE (initial state events)
    const entities = await this._discoverEntities(host, port, password);
    if (!entities.size) {
      console.warn(`[ESPHome] No entities found on ${host}`);
      return;
    }

    this._devices[host] = { cfg, entities };

    const sensors = [];
    for (const [id, meta] of entities) {
      const dmInfo   = DOMAIN_MAP[meta.domain];
      if (!dmInfo) continue;
      const fmt      = sensorFormat(meta.domain, meta.deviceClass, meta.unit);
      const hk       = homekitType(meta.domain, meta.deviceClass);
      const sensor   = {
        path:        `${meta.domain}/${id}`,
        name:        meta.name || id,
        type:        dmInfo.type,
        controllable: dmInfo.controllable,
        format:      fmt,
      };
      if (hk)              sensor.homekit = { service: _hkService(hk), characteristic: 'On' };
      if (dmInfo.controllable) {
        sensor.capabilityId = `${meta.domain}/${id}`;
        sensor.writeOn  = 'on';
        sensor.writeOff = 'off';
      }
      sensors.push(sensor);
      // Apply initial value
      if (meta.value !== undefined) {
        this._store.set(`${deviceKey}/${meta.domain}/${id}`, _parseValue(meta.domain, meta.value, meta.state));
      }
    }

    const device = {
      key:    deviceKey,
      label,
      type:   'esphome',
      sensors,
      _writeCapability: async (capId, command) => this._write(host, port, password, capId, command),
    };

    this._registry.registerDevice(device);
    console.log(`[ESPHome] Registered ${label} (${host}) — ${sensors.length} sensor(s)`);
  }

  // ── Entity discovery via SSE ──────────────────────────────────────────────

  _discoverEntities(host, port, password) {
    return new Promise((resolve) => {
      const entities = new Map();
      const headers  = { 'Accept': 'text/event-stream' };
      if (password) headers['Authorization'] = 'Basic ' + Buffer.from(`:${password}`).toString('base64');

      const req = http.get({ hostname: host, port, path: '/events', timeout: 8000, headers }, res => {
        let buf = '';
        // Set a hard cutoff — we only need the initial burst of state events
        const done = setTimeout(() => { req.destroy(); resolve(entities); }, 4000);

        res.on('data', chunk => {
          buf += chunk.toString();
          const parts = buf.split('\n\n');
          buf = parts.pop(); // keep incomplete last event
          for (const block of parts) {
            const eventMatch = block.match(/event:\s*(\S+)/);
            const dataMatch  = block.match(/data:\s*(.+)/s);
            if (!eventMatch || !dataMatch) continue;
            const evType = eventMatch[1];
            // ESPHome emits 'state' events for each entity on connect
            if (evType !== 'state' && evType !== 'ping') continue;
            if (evType === 'ping') continue;
            try {
              const d = JSON.parse(dataMatch[1]);
              if (d.id && d.domain) {
                entities.set(d.id, {
                  domain:      d.domain,
                  name:        d.name || d.id,
                  deviceClass: d.device_class || '',
                  unit:        d.unit_of_measurement || d.unit || '',
                  value:       d.value,
                  state:       d.state,
                });
              }
            } catch {}
          }
        });

        res.on('end', () => { clearTimeout(done); resolve(entities); });
        res.on('error', () => { clearTimeout(done); resolve(entities); });
      });

      req.on('error', () => resolve(entities));
      req.on('timeout', () => { req.destroy(); resolve(entities); });
    });
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  async _pollAll() {
    for (const [host, { cfg, entities }] of Object.entries(this._devices)) {
      const { port = 80, password } = cfg;
      const deviceKey = `esphome/${host.replace(/\./g, '_')}`;
      for (const [id, meta] of entities) {
        try {
          const data = await this._get(host, port, `/${meta.domain}/${id}`, password);
          const val  = _parseValue(meta.domain, data.value, data.state);
          if (val !== undefined) this._store.set(`${deviceKey}/${meta.domain}/${id}`, val);
        } catch { /* ignore individual poll failure */ }
      }
    }
    platformStatus.set('esphome', true);
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async _write(host, port, password, capId, command) {
    // capId = "switch/<id>" or "light/<id>" or "cover/<id>"
    const [domain, id] = capId.split('/');
    let path;
    if (domain === 'switch' || domain === 'light') {
      path = `/${domain}/${id}/${command === 'on' ? 'turn_on' : 'turn_off'}`;
    } else if (domain === 'cover') {
      path = `/cover/${id}/${command === 'on' ? 'open' : 'close'}`;
    } else {
      return;
    }
    const headers = {};
    if (password) headers['Authorization'] = 'Basic ' + Buffer.from(`:${password}`).toString('base64');
    await new Promise((resolve, reject) => {
      const req = http.request({ hostname: host, port, path, method: 'POST', timeout: 5000, headers }, res => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  // ── HTTP helper ───────────────────────────────────────────────────────────

  _get(host, port, path, password) {
    const headers = {};
    if (password) headers['Authorization'] = 'Basic ' + Buffer.from(`:${password}`).toString('base64');
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: host, port, path, timeout: 5000, headers }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error(`Non-JSON from ${host}${path}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${host}`)); });
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _parseValue(domain, value, state) {
  if (domain === 'binary_sensor' || domain === 'switch' || domain === 'light') {
    if (value !== undefined) return value ? 1 : 0;
    const s = String(state || '').toUpperCase();
    return (s === 'ON' || s === 'TRUE') ? 1 : 0;
  }
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

function _hkService(hkType) {
  const map = {
    'switch-rw':   'Switch',
    'light-rw':    'Lightbulb',
    'motion':      'MotionSensor',
    'contact':     'ContactSensor',
    'temperature': 'TemperatureSensor',
    'humidity':    'HumiditySensor',
    'smoke':       'SmokeSensor',
    'leak':        'LeakSensor',
    'co2-sensor':  'CarbonDioxideSensor',
  };
  return map[hkType] || 'Switch';
}

module.exports = ESPHomeClient;
