'use strict';

// Wallbox — cloud integration. Wallbox has no official public API; this
// follows the endpoints reverse-engineered by the community (pywallbox /
// home-assistant-wallbox), not vendor documentation, so treat it as best-effort
// and unverified against real hardware.

const https           = require('https');
const platformStatus  = require('./platform-status');

const AUTH_HOST = 'user-api.wall-box.com';
const API_HOST  = 'api.wall-box.com';

// Remote-action codes used by the community client (pause/resume a session).
const ACTION_RESUME = 1;
const ACTION_PAUSE  = 2;

class WallboxClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._token    = null;
    this._chargers = new Map(); // chargerId → deviceKey
    this._timer    = null;
  }

  async start() {
    const cfg = this._config.wallbox;
    if (!cfg?.email || !cfg?.password) return;
    this._cfg = cfg;

    await this._login();
    await this._discover();

    if (this._chargers.size) platformStatus.set('wallbox', true);
    this._timer = setInterval(() => this._pollAll().catch(err =>
      console.error(`[Wallbox] Poll failed: ${err.message}`)), (cfg.pollInterval || 30) * 1000);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  async _login() {
    const auth = Buffer.from(`${this._cfg.email}:${this._cfg.password}`).toString('base64');
    const res  = await this._request(AUTH_HOST, 'POST', '/users/signin', null, { Authorization: `Basic ${auth}` });
    this._token = res.jwt || res?.data?.attributes?.token;
    if (!this._token) throw new Error('Login did not return a token');
  }

  async _discover() {
    const res = await this._api('GET', '/v3/chargers/groups');
    const groups = res?.data?.chargerGroups || res?.result?.data || [];
    for (const group of groups) {
      for (const charger of group.chargers || group.chargersData || []) {
        const id = charger.id || charger.chargerId;
        if (id == null) continue;
        this._register(id, charger.name || `Wallbox ${id}`);
      }
    }
  }

  _register(chargerId, label) {
    const deviceKey = `wallbox/${chargerId}`;
    this._chargers.set(chargerId, deviceKey);

    const device = {
      key:      deviceKey,
      label,
      type:     'wallbox',
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
    console.log(`[Wallbox] Registered ${label} (${chargerId})`);
  }

  async _pollAll() {
    for (const [chargerId, deviceKey] of this._chargers) {
      const res  = await this._api('GET', `/chargers/status/${chargerId}`);
      const data = res?.data?.chargerData || res?.data || {};

      if (data.charging_power  != null) this._store.set(`${deviceKey}/power`,  Number(data.charging_power) * 1000);
      if (data.added_energy    != null) this._store.set(`${deviceKey}/energy`, Number(data.added_energy));
      if (data.max_charging_current != null) this._store.set(`${deviceKey}/currentLimit`, Number(data.max_charging_current));

      const statusId = data.status_id ?? res?.data?.status;
      const charging = [2, 194].includes(Number(statusId)); // 2/194 = "Charging" per community status map
      this._store.set(`${deviceKey}/status`, charging ? 'charging' : 'connected');
      this._store.set(`${deviceKey}/charging`, charging);
    }
  }

  async _send(chargerId, capId, command, args) {
    if (capId === 'charging') {
      const action = command === 'on' ? ACTION_RESUME : ACTION_PAUSE;
      await this._api('POST', `/v3/chargers/${chargerId}/remote-action`, { action });
    } else if (capId === 'currentLimit') {
      const amp = Math.round(Number(args[0]));
      await this._api('PUT', `/v2/charger/${chargerId}`, { maxChargingCurrent: amp });
    }
  }

  async _api(method, path, body) {
    if (!this._token) await this._login();
    try {
      return await this._request(API_HOST, method, path, body, { Authorization: `Bearer ${this._token}` });
    } catch (err) {
      if (err.statusCode === 401) {
        await this._login();
        return this._request(API_HOST, method, path, body, { Authorization: `Bearer ${this._token}` });
      }
      throw err;
    }
  }

  _request(host, method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const json = body != null ? JSON.stringify(body) : null;
      const h = { ...headers, 'Content-Type': 'application/json' };
      if (json) h['Content-Length'] = Buffer.byteLength(json);

      const req = https.request({ hostname: host, port: 443, path, method, timeout: 8000, headers: h }, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : {}; } catch { /* non-JSON body */ }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed || {});
          else { const e = new Error(`Wallbox API ${method} ${path} → ${res.statusCode}`); e.statusCode = res.statusCode; reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (json) req.write(json);
      req.end();
    });
  }
}

module.exports = WallboxClient;
