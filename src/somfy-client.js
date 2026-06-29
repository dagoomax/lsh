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

// Events that carry device state changes
const STATE_EVENTS = new Set(['DeviceStateChangedEvent', 'DeviceCreatedEvent', 'DeviceUpdatedEvent']);

class SomfyClient {
  constructor(config, store, sensorRegistry) {
    this._config     = config;
    this._store      = store;
    this._registry   = sensorRegistry;
    this._session    = null; // JSESSIONID=... (cookie auth)
    this._token      = null; // Bearer token (developer mode)
    this._listenerId = null; // event listener ID (token mode only)
    this._eventTimer = null; // event poll interval
    this._pollTimer  = null; // fallback state poll interval
    this._devices    = {};   // deviceURL → { label, deviceKey, uiClass }
    // TaHoma box uses a self-signed TLS certificate
    this._agent      = new https.Agent({ rejectUnauthorized: false });
  }

  async start() {
    const cfg = this._config.somfy;
    if (!cfg?.host) return;
    if (!cfg.token && (!cfg.email || !cfg.password))
      throw new Error('Somfy requires either a token or email + password');

    if (cfg.token) {
      this._token = cfg.token;
      console.log('[Somfy] Using Bearer token auth (Developer Mode)');
    } else {
      await this._login(cfg);
    }

    await this._discoverDevices(cfg);
    platformStatus.set('somfy', true);

    if (this._token) {
      // Event-based updates: register listener, poll every 1 s
      await this._startEventPolling();
    } else {
      // Cookie auth: fallback to periodic state polling
      const ms = (cfg.pollInterval || 30) * 1000;
      this._pollTimer = setInterval(() => this._pollAll(), ms);
    }
  }

  stop() {
    if (this._eventTimer) clearInterval(this._eventTimer);
    if (this._pollTimer)  clearInterval(this._pollTimer);
    if (this._listenerId) this._unregisterListener().catch(() => {});
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

    console.log(`[Somfy] ${devices.length} device(s) found from TaHoma`);
    for (const dev of devices) {
      const uiClass = dev.uiClass || dev.widget || dev.controllableName
        || dev.definition?.uiClass || dev.definition?.widgetName || '';
      if (!CONTROLLABLE.some(c => uiClass.includes(c))) continue;

      const url   = dev.deviceURL || dev.deviceUrl || '';
      const label = dev.label || url.split('/').pop() || url;

      if (filter.length && !filter.some(f =>
        label.toLowerCase().includes(f) || url.toLowerCase().includes(f)
      )) continue;

      const deviceKey = `somfy/${url.replace(/[:/]/g, '_')}`;

      const device = {
        key:   deviceKey,
        label: label,
        type:  'somfy',
        homekit: [],
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

    // Initial state fetch via state API
    await this._pollAll();
  }

  // ── Event polling (Developer Mode / token auth) ────────────────────────────

  async _startEventPolling() {
    try {
      const res = await this._postJson(`${BASE_PATH}/events/register`, {});
      this._listenerId = res?.id;
      if (!this._listenerId) throw new Error('No listener ID returned');
      console.log(`[Somfy] Event listener registered: ${this._listenerId}`);
      // Poll for events every 1 s; re-register listener if it expires (10 min inactivity)
      this._eventTimer = setInterval(() => this._fetchEvents(), 1000);
    } catch (err) {
      console.error(`[Somfy] Event registration failed: ${err.message} — falling back to polling`);
      const ms = (this._config.somfy?.pollInterval || 30) * 1000;
      this._pollTimer = setInterval(() => this._pollAll(), ms);
    }
  }

  async _fetchEvents() {
    if (!this._listenerId) return;
    try {
      const events = await this._postJson(`${BASE_PATH}/events/${this._listenerId}/fetch`, {});
      if (!Array.isArray(events)) return;
      for (const evt of events) {
        if (!STATE_EVENTS.has(evt.name)) continue;
        const dev = this._devices[evt.deviceURL];
        if (!dev) continue;
        for (const state of (evt.deviceStates || [])) {
          this._applyState(dev.deviceKey, state.name, state.value);
        }
      }
    } catch (err) {
      const msg = String(err.message);
      if (msg.includes('404') || msg.includes('UNKNOWN_OBJECT') || msg.includes('expired')) {
        // Listener expired — re-register
        console.warn('[Somfy] Event listener expired — re-registering');
        this._listenerId = null;
        clearInterval(this._eventTimer);
        this._eventTimer = null;
        await this._startEventPolling();
      }
    }
  }

  async _unregisterListener() {
    if (!this._listenerId) return;
    await this._postJson(`${BASE_PATH}/events/${this._listenerId}/unregister`, {}).catch(() => {});
    this._listenerId = null;
  }

  // ── State polling (cookie auth fallback) ──────────────────────────────────

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
      this._applyState(deviceKey, state.name, state.value);
    }
  }

  _applyState(deviceKey, name, value) {
    if (name === 'core:ClosureState' || name === 'core:DeploymentState') {
      const closure = Number(value);
      this._store.update(`${deviceKey}/level`,  100 - closure);
      this._store.update(`${deviceKey}/switch`, closure < 100 ? 1 : 0);
    } else if (name === 'core:OpenClosedState' || name === 'core:OpenClosedUnknownState') {
      this._store.update(`${deviceKey}/switch`, value === 'open' ? 1 : 0);
    }
  }

  // ── Command dispatch ──────────────────────────────────────────────────────

  async _executeCommand(cfg, deviceUrl, capId, command, args) {
    let cmd;
    if (capId === 'toggle') {
      cmd = { name: command === 'on' ? 'open' : 'close', parameters: [] };
    } else if (capId === 'position') {
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

  async _postJson(path, payload) {
    const body = JSON.stringify(payload);
    const res  = await this._request(this._config.somfy, 'POST', path, body, {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    if (res.statusCode === 404) throw new Error('404 listener not found or expired');
    try { return JSON.parse(res.body); } catch { return null; }
  }
}

module.exports = SomfyClient;
