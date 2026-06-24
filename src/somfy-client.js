'use strict';

const https          = require('https');
const platformStatus = require('./platform-status');

const BASE_PATH = '/enduser-mobile-web/1/enduserAPI';

// Somfy uiClass values that are motorised and controllable
const CONTROLLABLE = [
  'RollerShutter', 'ExteriorScreen', 'ExteriorVenetianBlind',
  'VenetianBlind', 'Pergola', 'SwingingShutter', 'Gate',
  'GarageDoor', 'Awning', 'Window', 'Blind',
];

class SomfyClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._session  = null; // JSESSIONID=... (cookie auth)
    this._token    = null; // Bearer token (developer mode)
    this._timer    = null;
    this._devices  = {}; // deviceURL → { label, deviceKey, uiClass }
    // TaHoma box uses a self-signed TLS certificate
    this._agent    = new https.Agent({ rejectUnauthorized: false });
  }

  async start() {
    const cfg = this._config.somfy;
    if (!cfg?.host) return;
    if (!cfg.token && (!cfg.email || !cfg.password))
      throw new Error('Somfy requires either a token or email + password');

    if (cfg.token) {
      this._token = cfg.token;
      console.log('[Somfy] Using Bearer token auth');
    } else {
      await this._login(cfg);
    }
    await this._discoverDevices(cfg);
    platformStatus.set('somfy', true);
    const ms = (cfg.pollInterval || 30) * 1000;
    this._timer = setInterval(() => this._pollAll(), ms);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  async _login(cfg) {
    const body = `userId=${encodeURIComponent(cfg.email)}&userPassword=${encodeURIComponent(cfg.password)}`;
    const res  = await this._request(cfg, 'POST', `${BASE_PATH}/login`, body, {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    });
    const cookies   = [].concat(res.headers['set-cookie'] || []);
    const sessionId = cookies.find(c => c.startsWith('JSESSIONID='));
    if (!sessionId) {
      let msg = 'Login failed — no session cookie';
      try { const d = JSON.parse(res.body); msg = d.errorCode || d.error || msg; } catch {}
      throw new Error(msg);
    }
    this._session = sessionId.split(';')[0];
    console.log('[Somfy] Login successful');
  }

  // ── Device discovery ───────────────────────────────────────────────────────

  async _discoverDevices(cfg) {
    const json    = await this._getJson(cfg, `${BASE_PATH}/setup/devices`);
    const devices = Array.isArray(json) ? json : [];
    const filter  = (cfg.devices || []).map(f => f.toLowerCase());

    for (const dev of devices) {
      const uiClass = dev.uiClass || dev.widget || '';
      if (!CONTROLLABLE.some(c => uiClass.includes(c))) continue;

      const url   = dev.deviceURL || '';
      const label = dev.label || url.split('/').pop() || url;

      if (filter.length && !filter.some(f =>
        label.toLowerCase().includes(f) || url.toLowerCase().includes(f)
      )) continue;

      const deviceKey = `somfy/${url.replace(/[:/]/g, '_')}`;

      const device = {
        key:   deviceKey,
        label: label,
        type:  'somfy',
        sensors: [
          {
            path: 'switch', label: 'Open/Close', format: 'on-off',
            controllable: true, type: 'toggle',
            writeOn: 'on', writeOff: 'off',
            capabilityId: 'toggle', homekit: 'switch-rw',
          },
          {
            path: 'level', label: 'Position', format: 'percent',
            controllable: true, type: 'range',
            writeCmd: 'setPosition', capabilityId: 'position',
            min: 0, max: 100, rangeFormat: 'percent',
          },
        ],
        _writeCapability: (capId, command, args) =>
          this._executeCommand(cfg, url, capId, command, args),
      };

      this._registry.registerDevice(device);
      this._devices[url] = { label, deviceKey, uiClass };
      console.log(`[Somfy] Registered: ${label} (${uiClass})`);
    }

    await this._pollAll();
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  async _pollAll() {
    for (const [url, dev] of Object.entries(this._devices)) {
      try {
        await this._pollDevice(url, dev.deviceKey);
      } catch (err) {
        if (err.message.includes('401') || err.message.includes('session')) {
          try {
            if (!this._token) await this._login(this._config.somfy);
            await this._pollDevice(url, dev.deviceKey);
          } catch (e2) {
            console.error(`[Somfy] Poll retry failed for ${dev.label}: ${e2.message}`);
          }
        } else {
          console.error(`[Somfy] Poll failed for ${dev.label}: ${err.message}`);
        }
      }
    }
  }

  async _pollDevice(url, deviceKey) {
    const cfg     = this._config.somfy;
    const encoded = encodeURIComponent(url);
    const states  = await this._getJson(cfg, `${BASE_PATH}/setup/devices/${encoded}/states`);

    for (const state of (Array.isArray(states) ? states : [])) {
      const { name, value } = state;

      // closure: 0=fully open, 100=fully closed → level: 100=open, 0=closed
      if (name === 'core:ClosureState' || name === 'core:DeploymentState') {
        const closure = Number(value);
        this._store.update(`${deviceKey}/level`,  100 - closure);
        this._store.update(`${deviceKey}/switch`, closure < 100 ? 1 : 0);
      } else if (name === 'core:OpenClosedState' || name === 'core:OpenClosedUnknownState') {
        this._store.update(`${deviceKey}/switch`, value === 'open' ? 1 : 0);
      }
    }
  }

  // ── Command dispatch ──────────────────────────────────────────────────────

  async _executeCommand(cfg, deviceUrl, capId, command, args) {
    let cmd;
    if (capId === 'toggle') {
      cmd = { name: command === 'on' ? 'open' : 'close', parameters: [] };
    } else if (capId === 'position') {
      // level 0-100 → closure 100-0
      const closure = 100 - Math.round(args?.[0] ?? 0);
      cmd = { name: 'setClosure', parameters: [closure] };
    } else {
      return;
    }

    const body = JSON.stringify({
      label:   `LSH-${command}`,
      actions: [{ deviceURL: deviceUrl, commands: [cmd] }],
    });

    await this._request(cfg, 'POST', `${BASE_PATH}/exec/apply`, body, {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  _request(cfg, method, path, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      const headers = {
        Accept:       'application/json',
        'User-Agent': 'LSH-Dashboard/1.0',
        ...(this._token   ? { Authorization: `Bearer ${this._token}` } : {}),
        ...(this._session ? { Cookie: this._session } : {}),
        ...extraHeaders,
      };
      const req = https.request({
        hostname: cfg.host,
        port:     cfg.port || 8443,
        path, method, headers,
        agent:   this._agent,
        timeout: 10000,
      }, res => {
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => { res.body = data; resolve(res); });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }

  async _getJson(cfg, path) {
    const res = await this._request(cfg, 'GET', path, null, {});
    try {
      return JSON.parse(res.body);
    } catch {
      if (res.statusCode === 401) throw new Error('401 session expired');
      throw new Error(`Non-JSON from Somfy (${path}): ${String(res.body).slice(0, 120)}`);
    }
  }
}

module.exports = SomfyClient;
