'use strict';

const https = require('https');

// SmartTub cloud API (Jacuzzi / Sundance / Watkins etc.)
const AUTH_URL   = 'https://api.smarttub.io/idp/signin';
const API_HOST   = 'api.smarttub.io';
const ACCOUNT_ID_CLAIM = 'custom:account_id';

// Spa.HeatMode enum order — index is what the dashboard range control sends
const HEAT_MODES = ['ECONOMY', 'DAY', 'AUTO', 'READY', 'REST'];

// Spa temperature bounds (Celsius)
const TEMP_MIN = 15;
const TEMP_MAX = 40;

class SmartTubClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;

    this._accessToken = null;
    this._accountId   = null;
    this._expiresAt   = 0;

    this._spas  = []; // { id, name }
    this._lightOnMode = {}; // `${spaId}:${zone}` → 'WHITE' | 'ON' (exterior zones reject WHITE)
    this._timer = null;
  }

  async start() {
    const cfg = this._config.smarttub;
    if (!cfg?.email || !cfg?.password) return;

    console.log('[SmartTub] Starting…');
    await this._login();

    const spas = await this._req('GET', `spas?ownerId=${encodeURIComponent(this._accountId)}`);
    const list = spas?.content || [];
    for (const s of list) {
      try {
        await this._registerSpa(s);
      } catch (err) {
        console.error(`[SmartTub] Spa ${s.id} setup error: ${err.message}`);
      }
    }
    console.log(`[SmartTub] Found ${this._spas.length} spa(s)`);
    if (!this._spas.length) return;

    await this._poll();
    const interval = (cfg.pollInterval || 60) * 1000;
    this._timer = setInterval(() => this._poll().catch(() => {}), interval);
    console.log(`[SmartTub] Started — polling every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  async _login() {
    const cfg = this._config.smarttub;
    const res = await this._authReq({ username: cfg.email, password: cfg.password });
    const token = res?.token;
    if (!token?.access_token) throw new Error('Login failed: no access token');

    this._accessToken = token.access_token;
    this._expiresAt   = Date.now() + ((token.expires_in || 86400) * 1000);

    // account_id lives in the id_token JWT payload
    if (token.id_token) {
      const parts = token.id_token.split('.');
      if (parts.length > 1) {
        const json = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        this._accountId = json[ACCOUNT_ID_CLAIM];
      }
    }
    if (!this._accountId) throw new Error('Login OK but account_id missing from id_token');
    console.log('[SmartTub] Login OK');
  }

  async _ensureToken() {
    // No refresh endpoint — re-authenticate with stored credentials when expired
    if (!this._accessToken || Date.now() > this._expiresAt - 60_000) {
      await this._login();
    }
  }

  // ── Spa setup ───────────────────────────────────────────────────────────

  async _registerSpa(spaInfo) {
    const spaId = spaInfo.id;
    const name  = [spaInfo.brand, spaInfo.model].filter(Boolean).join(' ') || `Spa ${spaId}`;

    const pumps  = ((await this._req('GET', `spas/${spaId}/pumps`))?.pumps || []);
    const lights = ((await this._req('GET', `spas/${spaId}/lights`))?.lights || []);

    const deviceKey = `smarttub/${spaId}`;
    const sensors = [
      { path: 'water_temp', name: 'Water',    type: 'number',  unit: '°C', precision: 1, homekit: 'temperature' },
      { path: 'set_temp',   name: 'Set Temp', type: 'range',   unit: '°C', controllable: true,
        capabilityId: 'setTemp', writeCmd: 'setTemperature', min: TEMP_MIN, max: TEMP_MAX, step: 0.5 },
      { path: 'heat_mode',  name: 'Heat Mode', type: 'range',  controllable: true,
        capabilityId: 'heatMode', writeCmd: 'setHeatMode', min: 0, max: HEAT_MODES.length - 1 },
      { path: 'heater',     name: 'Heater',   type: 'boolean' },
      { path: 'online',     name: 'Online',   type: 'boolean' },
    ];

    for (const p of pumps) {
      // Circulation pumps aren't user-toggleable; expose them read-only
      const controllable = p.type !== 'CIRCULATION';
      const label = `${_titleCase(p.type)} Pump`;
      sensors.push({
        path: `pump_${p.id}`, name: label, type: 'boolean',
        ...(controllable ? { controllable: true, capabilityId: `pump:${p.id}`, writeOn: 'on', writeOff: 'off' } : {}),
      });
    }

    for (const l of lights) {
      // Exterior zones only accept ON/OFF; interior zones use WHITE
      this._lightOnMode[`${spaId}:${l.zone}`] = (l.exterior || l.zoneType === 'EXTERIOR') ? 'ON' : 'WHITE';
      sensors.push({
        path: `light_${l.zone}`, name: `${l.exterior || l.zoneType === 'EXTERIOR' ? 'Exterior ' : ''}Light ${l.zone}`, type: 'boolean',
        controllable: true, capabilityId: `light:${l.zone}`, writeOn: 'on', writeOff: 'off',
      });
    }

    this._registry.registerDevice({
      key:     deviceKey,
      label:   name,
      type:    'smarttub',
      homekit: ['spa'], // Thermostat + pump/light switches (see homekit-bridge addSpaServices)
      sensors,
      _writeCapability: (capId, command, args = []) => this._writeCapability(spaId, capId, command, args),
    });

    this._spas.push({ id: spaId, name });
  }

  async _writeCapability(spaId, capId, command, args) {
    if (capId === 'setTemp') {
      const temp = Math.round(Number(args[0]) * 10) / 10; // API rejects >1 decimal
      await this._req('PATCH', `spas/${spaId}/config`, { setTemperature: temp });
    } else if (capId === 'heatMode') {
      const mode = HEAT_MODES[Number(args[0])] || HEAT_MODES[2];
      await this._req('PATCH', `spas/${spaId}/config`, { heatMode: mode });
    } else if (capId.startsWith('pump:')) {
      const pumpId = capId.slice('pump:'.length);
      // The API only offers toggle — skip if the pump is already in the
      // desired state so scenes/HomeKit "on" commands are idempotent
      const cur = this._store.get(`smarttub/${spaId}/pump_${pumpId}`);
      const want = command === 'on' ? 1 : 0;
      if (cur === want) return;
      await this._req('POST', `spas/${spaId}/pumps/${pumpId}/toggle`);
    } else if (capId.startsWith('light:')) {
      const zone = capId.slice('light:'.length);
      const on   = command === 'on';
      const onMode = this._lightOnMode[`${spaId}:${zone}`] || 'WHITE';
      await this._req('PATCH', `spas/${spaId}/lights/${zone}`,
        on ? { intensity: 100, mode: onMode } : { intensity: 0, mode: 'OFF' });
    }
    // Reflect the change shortly after
    setTimeout(() => this._poll().catch(() => {}), 2000);
  }

  // ── Polling ─────────────────────────────────────────────────────────────

  async _poll() {
    for (const spa of this._spas) {
      try {
        await this._pollSpa(spa);
      } catch (err) {
        console.error(`[SmartTub] Poll error (${spa.id}): ${err.message}`);
      }
    }
  }

  async _pollSpa(spa) {
    const key    = `smarttub/${spa.id}`;
    const status = await this._req('GET', `spas/${spa.id}/status`);
    if (status) {
      const waterTemp = status.water?.temperature ?? status.current;
      if (waterTemp != null)             this._store.update(`${key}/water_temp`, Number(waterTemp));
      if (status.setTemperature != null) this._store.update(`${key}/set_temp`,   Number(status.setTemperature));
      if (status.heatMode != null)       this._store.update(`${key}/heat_mode`,  HEAT_MODES.indexOf(status.heatMode));
      // booleans stored as 0/1 — dashboard toggles and Loxone \v expect numbers
      if (status.heater != null)         this._store.update(`${key}/heater`,     status.heater === 'ON' ? 1 : 0);
      if (status.online != null)         this._store.update(`${key}/online`,     status.online ? 1 : 0);
    }

    const pumps = (await this._req('GET', `spas/${spa.id}/pumps`))?.pumps || [];
    for (const p of pumps) this._store.update(`${key}/pump_${p.id}`, p.state !== 'OFF' ? 1 : 0);

    const lights = (await this._req('GET', `spas/${spa.id}/lights`))?.lights || [];
    for (const l of lights) this._store.update(`${key}/light_${l.zone}`, l.mode !== 'OFF' && l.intensity > 0 ? 1 : 0);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────

  _authReq(body) {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: API_HOST, port: 443, path: '/idp/signin', method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          Accept:           'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15_000,
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 201) return reject(new Error(`signin ${res.statusCode}: ${text.slice(0, 120)}`));
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error(`Bad signin JSON: ${text.slice(0, 120)}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('signin timeout')); });
      req.write(payload);
      req.end();
    });
  }

  async _req(method, path, body) {
    await this._ensureToken();
    const payload = body != null ? JSON.stringify(body) : null;
    return new Promise((resolve, reject) => {
      const headers = {
        Authorization: `Bearer ${this._accessToken}`,
        Accept:        'application/json',
      };
      if (payload) {
        headers['Content-Type']   = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = https.request({ hostname: API_HOST, port: 443, path: `/${path}`, method, headers, timeout: 15_000 }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`${method} ${path} → ${res.statusCode}: ${text.slice(0, 120)}`));
          }
          if (!text) return resolve(null);
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error(`Bad JSON from ${path}: ${text.slice(0, 120)}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${path}`)); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

function _titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|_)([a-z])/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase());
}

module.exports = SmartTubClient;
module.exports.HEAT_MODES = HEAT_MODES;
