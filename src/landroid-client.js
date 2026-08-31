'use strict';

// Worx Landroid robot mower (and Kress / Landxcape sister brands) via the Worx
// cloud. Login is OAuth2 password grant; device state is read by polling the
// cloud REST API; commands are sent over the mower's AWS-IoT MQTT channel.
//
// The auth/API endpoints and the AWS-IoT MQTT command flow are brand-specific
// and evolve over time (Worx moved auth from id.eu.worx.com to id.worx.com with
// a new client_id at some point in 2025/2026 — see pyworxcloud's clouds.py for
// the current canonical values) — the defaults below are fully overridable via
// config.landroid (authHost/apiHost/clientId). Status polling is the reliable
// core; MQTT commands are best-effort and should be verified against a live
// account (see README / config.example).

const https          = require('https');
const platformStatus = require('./platform-status');

const BRANDS = {
  worx:      { authHost: 'id.worx.com',                 apiHost: 'api.worxlandroid.com',       clientId: '150da4d2-bb44-433b-9429-3773adc70a2a' },
  kress:     { authHost: 'id.kress.com',                apiHost: 'api.kress-robotik.com',      clientId: '931d4bc4-3192-405a-be78-98e43486dc59' },
  landxcape: { authHost: 'id.landxcape-services.com',   apiHost: 'api.landxcape-services.com', clientId: 'dec998a9-066f-433b-987a-f5fc54d3af7c' },
};

// Worx status codes → label (common subset).
const STATUS = {
  0: 'Idle', 1: 'Home', 2: 'Start sequence', 3: 'Leaving home', 4: 'Follow wire home',
  5: 'Searching zone', 6: 'Mowing', 7: 'Lifted', 8: 'Trapped', 9: 'Blade blocked',
  10: 'Debug', 11: 'Remote control', 12: 'Going home', 30: 'Going home',
  31: 'Zone training', 32: 'Edge cutting', 33: 'Searching zone', 34: 'Paused',
};
// Battery charging state (dat.bt.c): 0=not charging, 1=charging, 2=charging error.
const CHARGE_STATE = { 0: 'Not charging', 1: 'Charging', 2: 'Charging error' };
const ERRORS = {
  0: '', 1: 'Trapped', 2: 'Lifted', 3: 'Wire missing', 4: 'Outside wire', 5: 'Rain delay',
  6: 'Close door to mow', 7: 'Close door to go home', 8: 'Blade motor blocked',
  9: 'Wheel motor blocked', 10: 'Trapped timeout', 11: 'Upside down', 12: 'Battery low',
  13: 'Reverse wire', 14: 'Charge error', 15: 'Timeout finding home',
};

// Command codes for the MQTT command channel.
const CMD = { START: 1, STOP: 2, HOME: 3, ZONETRAINING: 4 };

class LandroidClient {
  constructor(config, store, sensorRegistry) {
    this.cfg      = config.landroid || {};
    this.store    = store;
    this.registry = sensorRegistry;
    const brand   = BRANDS[this.cfg.brand] || BRANDS.worx;
    this.ep = {
      authHost: this.cfg.authHost || brand.authHost,
      apiHost:  this.cfg.apiHost  || brand.apiHost,
      clientId: this.cfg.clientId || brand.clientId,
    };
    this.token    = null;
    this.tokenExp = 0;
    this.mowers   = {};   // serial → { name, mac, mqtt }
    this.mqtt     = null;
    this.pollTimer = null;
  }

  async start() {
    if (!this.cfg.email || !this.cfg.password) return;
    await this._login();
    await this._discover();
    platformStatus.set('landroid', true);

    const secs = this.cfg.pollInterval || 60;
    this._poll();
    this.pollTimer = setInterval(() => this._poll().catch(() => {}), secs * 1000);
    console.log(`[Landroid] Started — ${Object.keys(this.mowers).length} mower(s), polling every ${secs}s`);
  }

  stop() {
    clearInterval(this.pollTimer);
    if (this.mqtt) { try { this.mqtt.end(true); } catch {} this.mqtt = null; }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async _login() {
    const body = JSON.stringify({
      grant_type: 'password',
      client_id:  this.ep.clientId,
      username:   this.cfg.email,
      password:   this.cfg.password,
      scope:      '*',
    });
    const res = await this._request('POST', this.ep.authHost, '/oauth/token', body, {
      'Content-Type': 'application/json',
    });
    if (!res.access_token) throw new Error(`Login failed: ${JSON.stringify(res).slice(0, 120)}`);
    this.token    = res.access_token;
    this.tokenExp = Date.now() + ((res.expires_in || 3600) - 60) * 1000;
    console.log('[Landroid] Authenticated');
  }

  async _ensureToken() {
    if (!this.token || Date.now() > this.tokenExp) await this._login();
  }

  // ── Discovery + polling ──────────────────────────────────────────────────

  async _discover() {
    const products = await this._api('GET', '/api/v2/product-items');
    if (!Array.isArray(products)) throw new Error('Unexpected product-items response');
    for (const p of products) {
      const serial = p.serial_number || p.uuid;
      if (!serial) continue;
      this.mowers[serial] = {
        name: p.name || 'Landroid',
        mac:  p.mac_address,
        mqtt: { endpoint: p.mqtt_endpoint, topicIn: p.mqtt_topics?.command_in, topicOut: p.mqtt_topics?.command_out },
      };
      this._registerDevice(serial);
    }
  }

  async _poll() {
    const products = await this._api('GET', '/api/v2/product-items');
    if (!Array.isArray(products)) return;
    for (const p of products) {
      const serial = p.serial_number || p.uuid;
      if (!serial || !this.mowers[serial]) continue;
      const dat = p.last_status?.payload?.dat || {};
      const cfg = p.last_status?.payload?.cfg || {};
      const key = `landroid/${serial}`;
      const ls  = dat.ls, le = dat.le;
      const batt = dat.bt?.p;
      const chg  = dat.bt?.c;
      if (batt   != null) this.store.update(`${key}/battery`,  batt);
      if (chg    != null) {
        this.store.update(`${key}/batteryState`,    CHARGE_STATE[chg] ?? `State ${chg}`);
        this.store.update(`${key}/batteryCharging`, chg === 1 ? 1 : 0);
      }
      if (ls     != null) this.store.update(`${key}/status`,   STATUS[ls] ?? `Status ${ls}`);
      if (le     != null) this.store.update(`${key}/error`,    ERRORS[le] ?? `Error ${le}`);
      if (cfg.rd != null) this.store.update(`${key}/rainDelay`, cfg.rd);
      // reflect mowing/home as booleans
      this.store.update(`${key}/mow`,  ls === 6 || ls === 33 || ls === 5 ? 1 : 0);
      this.store.update(`${key}/home`, ls === 1 ? 1 : 0);
      this.store.update(`${key}/edgeCut`,      ls === 32 ? 1 : 0);
      this.store.update(`${key}/zoneTraining`, ls === 31 ? 1 : 0);
    }
  }

  // ── Device registration + commands ───────────────────────────────────────

  _registerDevice(serial) {
    const m = this.mowers[serial];
    const device = {
      key:    `landroid/${serial}`,
      type:   'landroid',
      label:  m.name,
      icon:   '🚜',
      color:  'green',
      homekit: ['battery-level', 'mower-rw'],
      sensors: [
        { path: 'battery',         name: 'Battery',          type: 'number',  unit: '%', homekit: 'battery-level' },
        { path: 'batteryState',    name: 'Battery state',    type: 'string' },
        { path: 'batteryCharging', name: 'Battery charging', type: 'boolean' },
        { path: 'status',    name: 'Status',     type: 'string' },
        { path: 'error',     name: 'Error',      type: 'string' },
        { path: 'rainDelay', name: 'Rain delay', type: 'number', unit: 'min' },
        { path: 'mow',  name: 'Mow',  type: 'boolean', controllable: true, capabilityId: 'mow',  writeOn: 'on', writeOff: 'off' },
        { path: 'home', name: 'Home', type: 'boolean', controllable: true, capabilityId: 'home', writeOn: 'on', writeOff: 'off' },
        { path: 'edgeCut',      name: 'Edge cut',      type: 'boolean', controllable: true, capabilityId: 'edgeCut',      writeOn: 'on', writeOff: 'off' },
        { path: 'zoneTraining', name: 'Zone training', type: 'boolean', controllable: true, capabilityId: 'zoneTraining', writeOn: 'on', writeOff: 'off' },
      ],
      _writeCapability: (capId, command) => {
        if (capId === 'mow')          return this._command(serial, command === 'on' ? CMD.START : CMD.STOP);
        if (capId === 'home')         return this._command(serial, command === 'on' ? CMD.HOME : CMD.START);
        if (capId === 'zoneTraining') return this._command(serial, command === 'on' ? CMD.ZONETRAINING : CMD.STOP);
        if (capId === 'edgeCut')      return command === 'on' ? this._edgeCut(serial) : this._command(serial, CMD.STOP);
        throw new Error(`Landroid: '${capId}' not writable`);
      },
    };
    this.registry.registerDevice(device);
  }

  async _command(serial, cmd) {
    return this._publish(serial, { cmd });
  }

  // Edge cut has no dedicated cmd code on the real Worx protocol — it's
  // requested the same way the app does it, via a one-time schedule entry
  // (cfg.sc.once = [weekday, hour, minute, durationMinutes, edgeCutFlag])
  // starting now, with the edge-cut flag set. Weekday is Monday-indexed (0-6)
  // per the Worx schedule format. Unverified against a live account — see the
  // file-level note on MQTT commands being best-effort.
  async _edgeCut(serial) {
    const minutes  = this.cfg.edgeCutDuration || 30;
    const now      = new Date();
    const weekday  = (now.getDay() + 6) % 7; // JS Sunday=0 → Worx Monday=0
    const once     = [weekday, now.getHours(), now.getMinutes(), minutes, 1];
    return this._publish(serial, { sc: { once } });
  }

  async _publish(serial, payload) {
    const m = this.mowers[serial];
    if (!m?.mqtt?.endpoint || !m.mqtt.topicIn) throw new Error('No MQTT command channel for this mower');
    const mqtt = tryRequire('mqtt');
    if (!mqtt) throw new Error('mqtt package unavailable');
    await this._ensureToken();
    if (!this.mqtt) {
      // AWS-IoT over WSS, authorised with the OAuth bearer token. Endpoint/auth
      // are brand-specific — verify against a live account.
      this.mqtt = mqtt.connect(`wss://${m.mqtt.endpoint}/mqtt`, {
        protocolVersion: 4,
        reconnectPeriod: 0,
        headers: { Authorization: `Bearer ${this.token}` },
      });
      this.mqtt.on('error', (err) => console.error(`[Landroid] MQTT: ${err.message}`));
    }
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      this.mqtt.publish(m.mqtt.topicIn, body, { qos: 1 }, (err) => {
        if (err) return reject(err);
        setTimeout(() => this._poll().catch(() => {}), 1500);
        resolve();
      });
    });
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  async _api(method, path, body) {
    await this._ensureToken();
    return this._request(method, this.ep.apiHost, path, body != null ? JSON.stringify(body) : null, {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    });
  }

  _request(method, host, path, payload, headers = {}) {
    return new Promise((resolve, reject) => {
      const h = { Accept: 'application/json', ...headers };
      if (payload) h['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request({ hostname: host, port: 443, path, method, headers: h, timeout: 15_000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 401) { this.token = null; return reject(new Error('Unauthorized')); }
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 120)}`));
          try { resolve(text ? JSON.parse(text) : {}); }
          catch { reject(new Error(`Bad JSON from ${path}: ${text.slice(0, 120)}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${path}`)); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

function tryRequire(mod) {
  try { return require(mod); } catch { return null; }
}

// Standalone (no live client instance needed) request helper for the
// Settings "Test Login" button — mirrors LandroidClient#_request but without
// the instance-bound token-reset side effect.
function httpRequest(method, host, path, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const h = { Accept: 'application/json', ...headers };
    if (payload) h['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({ hostname: host, port: 443, path, method, headers: h, timeout: 15_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
        try { resolve(text ? JSON.parse(text) : {}); }
        catch { reject(new Error(`Bad JSON from ${path}: ${text.slice(0, 120)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${path}`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function testLogin(brandKey, email, password) {
  const brand = BRANDS[brandKey] || BRANDS.worx;
  const body = JSON.stringify({
    grant_type: 'password',
    client_id:  brand.clientId,
    username:   email,
    password,
    scope:      '*',
  });
  const authRes = await httpRequest('POST', brand.authHost, '/oauth/token', body, {
    'Content-Type': 'application/json',
  });
  if (!authRes.access_token) throw new Error(`Login failed: ${JSON.stringify(authRes).slice(0, 120)}`);

  const products = await httpRequest('GET', brand.apiHost, '/api/v2/product-items', null, {
    Authorization: `Bearer ${authRes.access_token}`,
  });
  const mowers = Array.isArray(products)
    ? products.map((p) => ({ name: p.name || 'Landroid', serial: p.serial_number || p.uuid }))
    : [];
  return { mowers };
}

module.exports = LandroidClient;
module.exports.testLogin = testLogin;
module.exports.BRANDS = Object.keys(BRANDS);
