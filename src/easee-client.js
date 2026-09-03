'use strict';

// Easee — cloud integration against Easee's official REST API
// (api.easee.com, documented at developer.easee.com / api.easee.com/swagger).
// Best-documented of the cloud EV integrations here, but still unverified
// against a real charger.

const https           = require('https');
const platformStatus  = require('./platform-status');

const API_HOST = 'api.easee.com';

// chargerOpMode enum per Easee's public API.
const OP_MODE = { 1: 'available', 2: 'connected', 3: 'charging', 4: 'complete', 5: 'error', 6: 'connected' };
const CHARGING_MODES = [3];

class EaseeClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._token    = null;
    this._chargers = new Map(); // id → deviceKey
    this._timer    = null;
  }

  async start() {
    const cfg = this._config.easee;
    if (!cfg?.username || !cfg?.password) return;
    this._cfg = cfg;

    await this._login();
    await this._discover();

    if (this._chargers.size) platformStatus.set('easee', true);
    this._timer = setInterval(() => this._pollAll().catch(err =>
      console.error(`[Easee] Poll failed: ${err.message}`)), (cfg.pollInterval || 30) * 1000);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  async _login() {
    const res = await this._request('POST', '/api/accounts/login', {
      userName: this._cfg.username, password: this._cfg.password,
    });
    this._token = res.accessToken;
    if (!this._token) throw new Error('Login did not return an access token');
  }

  async _discover() {
    const chargers = await this._api('GET', '/api/chargers');
    for (const c of chargers || []) {
      if (!c.id) continue;
      this._register(c.id, c.name || `Easee ${c.id}`);
    }
  }

  _register(chargerId, label) {
    const deviceKey = `easee/${chargerId}`;
    this._chargers.set(chargerId, deviceKey);

    const device = {
      key:      deviceKey,
      label,
      type:     'easee',
      category: 'ev-charger',
      sensors: [
        { path: 'power',  label: 'Power',  sensorType: 'power',  unit: 'W' },
        { path: 'energy', label: 'Energy', sensorType: 'energy', unit: 'kWh' },
        { path: 'status', label: 'Status', sensorType: 'sensor' },
        {
          path: 'charging', label: 'Charging', sensorType: 'switch', format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: 'on', writeOff: 'off',
          capabilityId: 'charging', homekit: 'switch-rw',
        },
        {
          path: 'currentLimit', label: 'Charge current', sensorType: 'dimmer', unit: 'A',
          controllable: true, type: 'range',
          writeCmd: 'setCurrent', capabilityId: 'currentLimit',
          min: 6, max: 32, rangeFormat: 'raw',
        },
      ],
      homekit: ['switch-rw'],
      _writeCapability: async (capId, command, args = []) =>
        this._send(chargerId, capId, command, args),
    };

    this._registry.registerDevice(device);
    console.log(`[Easee] Registered ${label} (${chargerId})`);
  }

  async _pollAll() {
    for (const [chargerId, deviceKey] of this._chargers) {
      const state = await this._api('GET', `/api/chargers/${chargerId}/state`);
      if (!state) continue;

      if (state.totalPower     != null) this._store.set(`${deviceKey}/power`,  Number(state.totalPower) * 1000);
      if (state.sessionEnergy  != null) this._store.set(`${deviceKey}/energy`, Number(state.sessionEnergy));
      if (state.dynamicChargerCurrent != null) this._store.set(`${deviceKey}/currentLimit`, Number(state.dynamicChargerCurrent));

      const mode = OP_MODE[state.chargerOpMode] || 'unknown';
      this._store.set(`${deviceKey}/status`, mode);
      this._store.set(`${deviceKey}/charging`, CHARGING_MODES.includes(state.chargerOpMode));
    }
  }

  async _send(chargerId, capId, command, args) {
    if (capId === 'charging') {
      const path = command === 'on' ? 'start_charging' : 'stop_charging';
      await this._api('POST', `/api/chargers/${chargerId}/commands/${path}`);
    } else if (capId === 'currentLimit') {
      const amp = Math.round(Number(args[0]));
      await this._api('POST', `/api/chargers/${chargerId}/settings`, { dynamicChargerCurrent: amp });
    }
  }

  async _api(method, path, body) {
    if (!this._token) await this._login();
    try {
      return await this._request(method, path, body, { Authorization: `Bearer ${this._token}` });
    } catch (err) {
      if (err.statusCode === 401) {
        await this._login();
        return this._request(method, path, body, { Authorization: `Bearer ${this._token}` });
      }
      throw err;
    }
  }

  _request(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const json = body != null ? JSON.stringify(body) : null;
      const h = { ...headers, 'Content-Type': 'application/json' };
      if (json) h['Content-Length'] = Buffer.byteLength(json);

      const req = https.request({ hostname: API_HOST, port: 443, path, method, timeout: 8000, headers: h }, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : {}; } catch { /* non-JSON body */ }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed || {});
          else { const e = new Error(`Easee API ${method} ${path} → ${res.statusCode}`); e.statusCode = res.statusCode; reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (json) req.write(json);
      req.end();
    });
  }
}

module.exports = EaseeClient;
