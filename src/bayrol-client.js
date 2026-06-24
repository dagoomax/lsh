'use strict';

const https          = require('https');
const platformStatus = require('./platform-status');

const BASE_HOST = 'www.bayrol-poolaccess.de';
const BASE_PATH = '/webservice/p.php';

class BayrolClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._session  = null; // PHPSESSID=abc123
    this._timer    = null;
    this._pools    = {};   // cid → { name, deviceKey }
  }

  async start() {
    const cfg = this._config.bayrol;
    if (!cfg?.username || !cfg?.password) return;

    await this._login(cfg.username, cfg.password);
    await this._discoverAndRegister(cfg);
    platformStatus.set('bayrol', true);
    const interval = (cfg.pollInterval || 60) * 1000;
    this._timer = setInterval(() => this._pollAll(), interval);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  async _login(username, password) {
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&stay=1`;
    const res  = await this._request('POST', `${BASE_PATH}?i=access`, body, {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    });

    const cookies  = [].concat(res.headers['set-cookie'] || []);
    const phpsessid = cookies.find(c => c.startsWith('PHPSESSID='));
    if (!phpsessid) throw new Error('Login failed — no session cookie returned');

    this._session = phpsessid.split(';')[0]; // "PHPSESSID=abc123"
    console.log('[Bayrol] Login successful');
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  async _discoverAndRegister(cfg) {
    const json  = await this._getJson(`${BASE_PATH}?i=getPlants`);
    const plants = Array.isArray(json) ? json : (json?.data || []);
    const configPools = cfg.pools || [];

    for (const plant of plants) {
      const cid = String(plant.cid ?? plant.id ?? plant.contId ?? '');
      if (!cid) continue;

      // If user restricted to specific pool cids, skip others
      if (configPools.length && !configPools.find(p => String(p.cid) === cid)) continue;

      const poolCfg   = configPools.find(p => String(p.cid) === cid) || {};
      const name      = poolCfg.name || plant.name || plant.title || `Pool ${cid}`;
      const deviceKey = `bayrol/${cid}`;

      const device = {
        key:   deviceKey,
        label: name,
        type:  'bayrol',
        sensors: [
          { path: 'ph',          label: 'pH',            unit: 'pH',   precision: 2 },
          { path: 'orp',         label: 'ORP',           unit: 'mV',   precision: 0 },
          { path: 'temperature', label: 'Temperature',   unit: '°C',   precision: 1, homekit: 'temperature' },
          { path: 'chlorine',    label: 'Free Chlorine', unit: 'mg/L', precision: 2 },
        ],
      };

      this._registry.registerDevice(device);
      this._pools[cid] = { name, deviceKey };
      console.log(`[Bayrol] Registered: ${name} (cid=${cid})`);
    }

    await this._pollAll();
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  async _pollAll() {
    for (const [cid, pool] of Object.entries(this._pools)) {
      try {
        await this._pollPool(cid, pool.deviceKey);
      } catch (err) {
        // Re-login once on session expiry
        if (err.message.includes('session') || err.message.includes('401')) {
          try {
            const cfg = this._config.bayrol;
            await this._login(cfg.username, cfg.password);
            await this._pollPool(cid, pool.deviceKey);
          } catch (e2) {
            console.error(`[Bayrol] Poll failed cid=${cid}: ${e2.message}`);
          }
        } else {
          console.error(`[Bayrol] Poll failed cid=${cid}: ${err.message}`);
        }
      }
    }
  }

  async _pollPool(cid, deviceKey) {
    const json  = await this._getJson(`${BASE_PATH}?i=getData&cid=${encodeURIComponent(cid)}`);
    const items = Array.isArray(json) ? json : (json?.data || json?.measurements || []);

    for (const m of items) {
      const label = (m.header || m.name || m.label || '').toLowerCase();
      const val   = parseFloat(m.value ?? m.current ?? m.val);
      if (isNaN(val)) continue;

      if (label === 'ph' || (label.includes('ph') && !label.includes('orp'))) {
        this._store.set(`${deviceKey}/ph`, val);
      } else if (label.includes('mv') || label.includes('orp') || label.includes('redox')) {
        this._store.set(`${deviceKey}/orp`, val);
      } else if (label.includes('temp') || label.includes('°c')) {
        this._store.set(`${deviceKey}/temperature`, val);
      } else if (label.includes('cl') || label.includes('chlor')) {
        this._store.set(`${deviceKey}/chlorine`, val);
      }
    }
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  _request(method, path, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      const headers = {
        Accept:       'application/json, text/html, */*',
        'User-Agent': 'LSH-Dashboard/1.0',
        ...(this._session ? { Cookie: this._session } : {}),
        ...extraHeaders,
      };
      const req = https.request(
        { hostname: BASE_HOST, port: 443, path, method, headers, timeout: 10000 },
        res => {
          let data = '';
          res.on('data', d => (data += d));
          res.on('end', () => { res.body = data; resolve(res); });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }

  async _getJson(path) {
    const res = await this._request('GET', path, null, {});
    try {
      return JSON.parse(res.body);
    } catch {
      throw new Error(`Non-JSON from Bayrol (${path}): ${String(res.body).slice(0, 120)}`);
    }
  }
}

module.exports = BayrolClient;
