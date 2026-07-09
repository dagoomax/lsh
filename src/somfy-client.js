'use strict';

const https          = require('https');
const platformStatus = require('./platform-status');

const BASE_PATH       = '/enduser-mobile-web/1/enduserAPI';        // local TaHoma box
const CLOUD_BASE_PATH = '/enduser-mobile-web/enduserAPI';          // Overkiz cloud

// Somfy / Overkiz cloud (Developer-Mode-free): authenticate against the Somfy
// SSO with the account email + password to obtain a short-lived Bearer token,
// then talk to the regional Overkiz endpoint exactly like the local token path.
const SOMFY_SSO      = 'accounts.somfy.com';
const SOMFY_SSO_PATH = '/oauth/oauth/v2/token/jwt';
// Public app credentials shared by the Somfy mobile apps (same values pyoverkiz uses).
const SOMFY_CLIENT_ID     = '0d8e920c-1478-11e7-a377-02dd59bd3041_1ewvaqmclfogo4kcsoo0c8k4kso884owg08sg8c40sk4go4ksg';
const SOMFY_CLIENT_SECRET = '12k73w1n540g8o4cokg0cw84cog840k84cwggscwg884004kgk';

// region → Overkiz cloud host
const CLOUD_HOSTS = {
  europe:        'ha101-1.overkiz.com',
  oceania:       'ha201-1.overkiz.com',
  north_america: 'ha401-1.overkiz.com',
};

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
    this._token      = null; // Bearer token (developer mode or cloud SSO)
    this._tokenExp   = 0;    // epoch ms when the cloud token expires (cloud only)
    this._cloud      = false;// cloud (Overkiz SSO) mode
    this._listenerId = null; // event listener ID (token mode only)
    this._eventTimer = null; // event poll interval
    this._pollTimer  = null; // fallback state poll interval
    this._devices    = {};   // deviceURL → { label, deviceKey, uiClass }
    // Resolved per-mode connection target (set in start()).
    this._host       = null;
    this._port       = 8443;
    this._basePath   = BASE_PATH;
    // TaHoma box uses a self-signed TLS certificate; the cloud uses a valid one.
    this._agent      = new https.Agent({ rejectUnauthorized: false });
  }

  async start() {
    const cfg = this._config.somfy;
    this._cloud = cfg?.mode === 'cloud' || cfg?.cloud === true;

    if (this._cloud) {
      if (!cfg.email || !cfg.password)
        throw new Error('Somfy cloud requires email + password');
      const region = cfg.region || 'europe';
      this._host     = CLOUD_HOSTS[region];
      if (!this._host) throw new Error(`Unknown Somfy region: ${region}`);
      this._port     = 443;
      this._basePath = CLOUD_BASE_PATH;
      this._agent    = new https.Agent({ rejectUnauthorized: true });
      await this._cloudLogin(cfg);
      console.log(`[Somfy] Using cloud auth (Overkiz ${region}) — token valid`);
    } else {
      if (!cfg?.host) return;
      if (!cfg.token && (!cfg.email || !cfg.password))
        throw new Error('Somfy requires either a token or email + password');
      this._host     = cfg.host;
      this._port     = cfg.port || 8443;
      this._basePath = BASE_PATH;
      if (cfg.token) {
        this._token = cfg.token;
        console.log('[Somfy] Using Bearer token auth (Developer Mode)');
      } else {
        await this._login(cfg);
      }
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
    const res  = await this._request(cfg, 'POST', `${this._basePath}/login`, body, {
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

  // Somfy SSO password grant → short-lived Bearer (JWT) for the Overkiz cloud.
  async _cloudLogin(cfg) {
    const params = new URLSearchParams({
      grant_type:    'password',
      client_id:     SOMFY_CLIENT_ID,
      client_secret: SOMFY_CLIENT_SECRET,
      username:      cfg.email,
      password:      cfg.password,
    }).toString();

    const res = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: SOMFY_SSO, port: 443, path: SOMFY_SSO_PATH, method: 'POST',
        headers: {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params),
          Accept:           'application/json',
          'User-Agent':     'LSH-Dashboard/1.0',
        },
        timeout: 10000,
      }, r => {
        let data = '';
        r.on('data', d => (data += d));
        r.on('end', () => resolve({ statusCode: r.statusCode, body: data }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('SSO timeout')); });
      req.write(params);
      req.end();
    });

    let json;
    try { json = JSON.parse(res.body); } catch { json = {}; }
    if (res.statusCode >= 300 || !json.access_token) {
      const msg = json.error === 'invalid_grant'
        ? 'Invalid Somfy account email or password'
        : (json.error_description || json.error || `SSO HTTP ${res.statusCode}`);
      throw new Error(msg);
    }
    this._token    = json.access_token;
    // Refresh a minute early; default to 1 h if the server omits expires_in.
    this._tokenExp = Date.now() + ((json.expires_in || 3600) - 60) * 1000;
  }

  // Refresh the cloud token before it expires (no-op in local/token modes).
  async _ensureToken() {
    if (this._cloud && Date.now() >= this._tokenExp) {
      await this._cloudLogin(this._config.somfy);
    }
  }

  // ── Device discovery ───────────────────────────────────────────────────────

  async _discoverDevices(cfg) {
    const json    = await this._getJson(cfg, `${this._basePath}/setup/devices`);
    const devices = Array.isArray(json) ? json : [];
    const filter  = (cfg.devices || []).map(f => f.toLowerCase());

    console.log(`[Somfy] ${devices.length} device(s) found from TaHoma`);
    for (const dev of devices) {
      // Prefer the clean uiClass: the cloud sets dev.uiClass, the local box
      // sets definition.uiClass. controllableName is a protocol string like
      // "rts:RollerShutterRTSComponent", so it's a last resort only.
      const uiClass = dev.uiClass || dev.definition?.uiClass
        || dev.widget || dev.definition?.widgetName || dev.controllableName || '';
      // Exact match — substring matching mis-classified gateways
      // (e.g. 'Gate' ⊂ 'ProtocolGateway') as controllable shutters.
      if (!CONTROLLABLE.includes(uiClass)) continue;

      const url   = dev.deviceURL || dev.deviceUrl || '';
      const label = dev.label || url.split('/').pop() || url;

      if (filter.length && !filter.some(f =>
        label.toLowerCase().includes(f) || url.toLowerCase().includes(f)
      )) continue;

      const deviceKey = `somfy/${url.replace(/[:/]/g, '_')}`;

      // Determine position command from available commands list
      const cmds = (dev.definition?.commands || []).map(c => c.commandName || c.name || c);
      const hasSetPosition = cmds.includes('setPosition');
      const posCmd = hasSetPosition ? 'setPosition' : 'setClosure';
      // The "my" favourite (Somfy remote's middle button). Advertised by io
      // covers; RTS motors report incomplete command lists, so include it when
      // the device lists it OR reports no commands at all.
      const hasMy = cmds.includes('my') || cmds.length === 0;
      // Absolute slat tilt (venetian blinds / orientable pergolas). Only io
      // covers expose `setOrientation`; RTS venetians offer relative tilt only
      // (tiltPositive/tiltNegative), which a slider can't drive, so skip those.
      const hasTilt = cmds.includes('setOrientation');

      const device = {
        key:   deviceKey,
        label: label,
        type:  'somfy',
        // Bridge tilt-capable io venetian blinds to HomeKit as a WindowCovering
        // (position + horizontal slat tilt). Other covers stay dashboard-only.
        homekit: hasTilt ? ['somfy-cover'] : [],
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
            writeCmd: posCmd, capabilityId: 'position',
            min: 0, max: 100, rangeFormat: 'percent',
          },
          {
            // Momentary: any value halts the motor (Somfy/Overkiz `stop`).
            path: 'stop', label: 'Stop', format: 'on-off',
            controllable: true, type: 'toggle',
            writeOn: 'stop', writeOff: 'stop',
            capabilityId: 'stop', homekit: null,
          },
          ...(hasMy ? [{
            // Momentary: move to the stored "my" favourite position.
            path: 'my', label: 'My', format: 'on-off',
            controllable: true, type: 'toggle',
            writeOn: 'my', writeOff: 'my',
            capabilityId: 'my', homekit: null,
          }] : []),
          ...(hasTilt ? [{
            // Absolute slat angle: 0 = closed slats, 100 = open slats.
            path: 'tilt', label: 'Tilt', format: 'percent',
            controllable: true, type: 'range',
            writeCmd: 'setOrientation', capabilityId: 'orientation',
            min: 0, max: 100, rangeFormat: 'percent',
          }] : []),
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
      const res = await this._postJson(`${this._basePath}/events/register`, {});
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
      const events = await this._postJson(`${this._basePath}/events/${this._listenerId}/fetch`, {});
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
    await this._postJson(`${this._basePath}/events/${this._listenerId}/unregister`, {}).catch(() => {});
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
    const states  = await this._getJson(cfg, `${this._basePath}/setup/devices/${encoded}/states`);
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
    } else if (name === 'core:SlateOrientationState') {
      // Raw orientation is 0 = open, 100 = closed; expose as "% open" to match level.
      this._store.update(`${deviceKey}/tilt`, 100 - Number(value));
    }
  }

  // ── Command dispatch ──────────────────────────────────────────────────────

  async _executeCommand(cfg, deviceUrl, capId, command, args) {
    await this._ensureToken();
    let cmd;
    if (capId === 'toggle') {
      cmd = { name: command === 'on' ? 'open' : 'close', parameters: [] };
    } else if (capId === 'stop') {
      // Halt an in-motion cover. RTS motors use `stop`; some io covers expose
      // `stopIdentify` — `stop` is accepted by both via exec/apply.
      cmd = { name: 'stop', parameters: [] };
    } else if (capId === 'my') {
      // Move to the stored "my" favourite position (Somfy remote middle button).
      cmd = { name: 'my', parameters: [] };
    } else if (capId === 'orientation') {
      // Slat tilt slider is "% open" (0 = closed, 100 = open) to match the
      // position slider; Somfy's setOrientation uses 0 = open, 100 = closed.
      const pct = Math.round(args?.[0] ?? 0);
      cmd = { name: command, parameters: [100 - pct] };
    } else if (capId === 'position') {
      const pct = Math.round(args?.[0] ?? 0);
      // setPosition: 0=closed, 100=open  |  setClosure: 0=open, 100=closed
      const param = command === 'setPosition' ? pct : 100 - pct;
      cmd = { name: command, parameters: [param] };
    } else {
      return;
    }

    const body = JSON.stringify({
      label:   `LSH-${command}`,
      actions: [{ deviceURL: deviceUrl, commands: [cmd] }],
    });

    const res = await this._request(cfg, 'POST', `${this._basePath}/exec/apply`, body, {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    });

    if (res.statusCode && res.statusCode >= 300) {
      console.error(`[Somfy] Command failed (HTTP ${res.statusCode}): ${res.body}`);
      throw new Error(`TaHoma rejected command: HTTP ${res.statusCode}`);
    }
    console.log(`[Somfy] Command sent: ${cmd.name}(${cmd.parameters}) → ${deviceUrl.split('/').pop()}`);
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
        hostname: this._host,
        port:     this._port,
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
    await this._ensureToken();
    let res = await this._request(cfg, 'GET', path, null, {});
    if (res.statusCode === 401 && this._cloud) {
      await this._cloudLogin(this._config.somfy);            // token rejected — re-auth once
      res = await this._request(cfg, 'GET', path, null, {});
    }
    try {
      return JSON.parse(res.body);
    } catch {
      if (res.statusCode === 401) throw new Error('401 session expired');
      throw new Error(`Non-JSON from Somfy (${path}): ${String(res.body).slice(0, 120)}`);
    }
  }

  async _postJson(path, payload) {
    await this._ensureToken();
    const body    = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    let res = await this._request(this._config.somfy, 'POST', path, body, headers);
    if (res.statusCode === 401 && this._cloud) {
      await this._cloudLogin(this._config.somfy);            // token rejected — re-auth once
      res = await this._request(this._config.somfy, 'POST', path, body, headers);
    }
    if (res.statusCode === 404) throw new Error('404 listener not found or expired');
    try { return JSON.parse(res.body); } catch { return null; }
  }
}

module.exports = SomfyClient;
