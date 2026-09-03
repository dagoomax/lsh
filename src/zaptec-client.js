'use strict';

// Zaptec — cloud integration against Zaptec's REST API (api.zaptec.com).
// Zaptec's charger "state" is a list of numeric ObservationId → value pairs
// rather than flat fields; the IDs below (power/energy/opMode) and the
// SendCommand ids (start/stop) are taken from Zaptec's published API and the
// community Home Assistant integration, but — like the other cloud clients
// here — this has not been run against a real charger, so treat the exact
// numeric ids as best-effort and verify against your charger's actual
// /api/chargers/{id}/state response if commands don't behave as expected.

const https           = require('https');
const platformStatus  = require('./platform-status');

const API_HOST = 'api.zaptec.com';

const OBS_TOTAL_CHARGE_POWER   = 513; // Watts
const OBS_TOTAL_CHARGE_ENERGY  = 553; // kWh, current session
const OBS_CHARGER_OPERATION_MODE = 710;
const OBS_CHARGE_CURRENT_SET   = 731; // Amps, active charge-current limit

const CMD_START = 507;
const CMD_STOP  = 506;

// ChargerOperationMode: 1=Disconnected, 2=Connected(idle), 3=Charging, 5=Connected(finished).
const OP_MODE = { 1: 'available', 2: 'connected', 3: 'charging', 5: 'complete' };

class ZaptecClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._token    = null;
    this._chargers = new Map(); // id → deviceKey
    this._timer    = null;
  }

  async start() {
    const cfg = this._config.zaptec;
    if (!cfg?.username || !cfg?.password) return;
    this._cfg = cfg;

    await this._login();
    await this._discover();

    if (this._chargers.size) platformStatus.set('zaptec', true);
    this._timer = setInterval(() => this._pollAll().catch(err =>
      console.error(`[Zaptec] Poll failed: ${err.message}`)), (cfg.pollInterval || 30) * 1000);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  async _login() {
    const form = `grant_type=password&username=${encodeURIComponent(this._cfg.username)}&password=${encodeURIComponent(this._cfg.password)}`;
    const res  = await this._request('POST', '/oauth/token', form, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    this._token = res.access_token;
    if (!this._token) throw new Error('Login did not return an access token');
  }

  async _discover() {
    const res = await this._api('GET', '/api/chargers');
    const chargers = res?.Data || res?.data || [];
    for (const c of chargers) {
      const id = c.Id || c.id;
      if (!id) continue;
      this._register(id, c.Name || c.name || `Zaptec ${id}`);
    }
  }

  _register(chargerId, label) {
    const deviceKey = `zaptec/${chargerId}`;
    this._chargers.set(chargerId, deviceKey);

    const device = {
      key:      deviceKey,
      label,
      type:     'zaptec',
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
    console.log(`[Zaptec] Registered ${label} (${chargerId})`);
  }

  async _pollAll() {
    for (const [chargerId, deviceKey] of this._chargers) {
      const res = await this._api('GET', `/api/chargers/${chargerId}/state`);
      const observations = Array.isArray(res) ? res : (res?.Data || []);
      const byId = {};
      for (const o of observations) byId[o.StateId ?? o.stateId] = o.ValueAsString ?? o.value;

      if (byId[OBS_TOTAL_CHARGE_POWER]  != null) this._store.set(`${deviceKey}/power`,  Number(byId[OBS_TOTAL_CHARGE_POWER]));
      if (byId[OBS_TOTAL_CHARGE_ENERGY] != null) this._store.set(`${deviceKey}/energy`, Number(byId[OBS_TOTAL_CHARGE_ENERGY]));
      if (byId[OBS_CHARGE_CURRENT_SET]  != null) this._store.set(`${deviceKey}/currentLimit`, Number(byId[OBS_CHARGE_CURRENT_SET]));

      const modeId = Number(byId[OBS_CHARGER_OPERATION_MODE]);
      const mode = OP_MODE[modeId] || 'unknown';
      this._store.set(`${deviceKey}/status`, mode);
      this._store.set(`${deviceKey}/charging`, modeId === 3);
    }
  }

  async _send(chargerId, capId, command, args = []) {
    if (capId === 'charging') {
      const cmd = command === 'on' ? CMD_START : CMD_STOP;
      await this._api('POST', `/api/chargers/${chargerId}/SendCommand/${cmd}`);
    } else if (capId === 'currentLimit') {
      const amp = Math.round(Number(args[0]));
      await this._api('POST', `/api/chargers/${chargerId}/update`, { maxChargeCurrent: amp });
    }
  }

  async _api(method, path, body) {
    if (!this._token) await this._login();
    try {
      return await this._request(method, path, body != null ? JSON.stringify(body) : null, {
        Authorization: `Bearer ${this._token}`, 'Content-Type': 'application/json',
      });
    } catch (err) {
      if (err.statusCode === 401) {
        await this._login();
        return this._request(method, path, body != null ? JSON.stringify(body) : null, {
          Authorization: `Bearer ${this._token}`, 'Content-Type': 'application/json',
        });
      }
      throw err;
    }
  }

  _request(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const h = { ...headers };
      if (body) h['Content-Length'] = Buffer.byteLength(body);

      const req = https.request({ hostname: API_HOST, port: 443, path, method, timeout: 8000, headers: h }, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : {}; } catch { /* non-JSON body */ }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed || {});
          else { const e = new Error(`Zaptec API ${method} ${path} → ${res.statusCode}`); e.statusCode = res.statusCode; reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = ZaptecClient;
