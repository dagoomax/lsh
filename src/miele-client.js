'use strict';

const https          = require('https');
const http           = require('http');
const fs             = require('fs');
const path           = require('path');
const platformStatus = require('./platform-status');

// Miele@home appliances via the official Miele 3rd Party API
// (developer.miele.com, host api.mcs3.miele.com). Auth is OAuth2: the client
// logs in directly with grant_type=password when username/password are
// configured, otherwise use scripts/miele-auth.js (authorization-code flow)
// once; tokens are persisted and auto-refreshed in persist/.
// Live updates come from the /devices/all/events SSE stream (each "devices"
// event carries the full state of every appliance), with a periodic re-sync
// as safety net.

const TOKENS_FILE = path.join(__dirname, '..', 'persist', 'miele-tokens.json');
const API_HOST    = 'api.mcs3.miele.com';

// host/port are configurable so scripts/miele-simulator.js can stand in for
// the cloud during development (plain http when a non-443 port is set)
function endpoint(cfg = {}) {
  const host = cfg.host || API_HOST;
  const port = cfg.port || 443;
  return { host, port, mod: port === 443 ? https : http };
}

// ident.type.value_raw → icon
const TYPE_ICONS = {
  1: '🧺', 2: '👕', 24: '🧺',            // washer, dryer, washer-dryer
  7: '🍽️', 8: '🍽️',                     // dishwashers
  12: '🔥', 13: '🔥', 15: '♨️', 16: '♨️', 31: '♨️', 45: '♨️', 67: '🔥', // ovens
  14: '🍳', 27: '🍳',                    // hobs
  17: '☕',                              // coffee system
  18: '💨',                              // hood
  19: '🧊', 20: '🧊', 21: '🧊', 68: '🧊', // cooling
  32: '🍷', 33: '🍷', 34: '🍷',          // wine units
  23: '🤖',                              // robot vacuum
};

// status value_raw fallback names (value_localized is preferred when present)
const STATUS_NAMES = {
  1: 'Off', 2: 'On', 3: 'Programmed', 4: 'Waiting to start', 5: 'Running',
  6: 'Paused', 7: 'Finished', 8: 'Failure', 9: 'Interrupted', 10: 'Idle',
  11: 'Rinse hold', 12: 'Service', 13: 'Superfreezing', 14: 'Supercooling',
  15: 'Superheating', 145: 'Locked', 255: 'Not connected',
};

// the API is inconsistent about key casing (ProgramID vs programId)
const pick = (obj, ...keys) => {
  for (const k of keys) if (obj?.[k] !== undefined) return obj[k];
  return undefined;
};

class MieleClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._tokens   = null;
    this._devices  = {};   // deviceId → deviceKey
    this._stream   = null;
    this._streamRetry = 5000;
    this._syncTimer = null;
    this._stopped  = false;
  }

  async start() {
    const cfg = this._config.miele || {};
    this._tokens = this._loadTokens();
    if (!this._tokens?.refresh_token && cfg.refreshToken) {
      this._tokens = { refresh_token: cfg.refreshToken };
    }

    try {
      await this._ensureToken();
      await this._discover();
      platformStatus.set('miele', true);
      this._openStream();
      const resync = Math.max(60, cfg.pollInterval || 300) * 1000;
      this._syncTimer = setInterval(() => this._syncAll().catch(() => {}), resync);
    } catch (err) {
      platformStatus.set('miele', false);
      console.error(`[Miele] Start failed: ${err.message}`);
      if (!this._tokens?.refresh_token && !(cfg.username && cfg.password)) {
        console.log('[Miele] No credentials — set miele.username/password in config.json or run `node scripts/miele-auth.js`');
      }
    }
  }

  stop() {
    this._stopped = true;
    if (this._syncTimer) clearInterval(this._syncTimer);
    if (this._stream) { this._stream.destroy(); this._stream = null; }
  }

  // ── Tokens ───────────────────────────────────────────────────────────────

  _loadTokens() {
    try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); }
    catch { return null; }
  }

  _saveTokens() {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(this._tokens, null, 2));
  }

  async _ensureToken() {
    if (this._tokens?.access_token && (this._tokens.expires_at || 0) > Date.now() + 120000) return;
    const cfg = this._config.miele || {};

    if (this._tokens?.refresh_token) {
      try { return await this._tokenRequest({
        grant_type: 'refresh_token', refresh_token: this._tokens.refresh_token,
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
      }); } catch (err) {
        console.error(`[Miele] Token refresh failed (${err.message}) — retrying full login`);
      }
    }
    if (cfg.username && cfg.password) {
      return this._tokenRequest({
        grant_type: 'password', username: cfg.username, password: cfg.password,
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
        vg: cfg.country || 'en-GB',
      });
    }
    throw new Error('No usable Miele tokens or credentials');
  }

  async _tokenRequest(form) {
    const body = Object.entries(form)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const res = await this._req('POST', '/thirdparty/token', body,
      { 'Content-Type': 'application/x-www-form-urlencoded' });
    this._tokens = {
      access_token:  res.access_token,
      refresh_token: res.refresh_token || this._tokens?.refresh_token,
      expires_at:    Date.now() + (res.expires_in || 3600) * 1000,
    };
    this._saveTokens();
  }

  // ── Discovery & state sync ───────────────────────────────────────────────

  async _discover() {
    const devices = await this._api('GET', '/v1/devices');
    for (const [id, dev] of Object.entries(devices || {})) {
      this._registerDevice(id, dev);
      this._applyState(id, dev.state);
    }
    if (!Object.keys(devices || {}).length) console.log('[Miele] No appliances on this account');
  }

  _registerDevice(id, dev) {
    if (this._devices[id]) return;
    const deviceKey = `miele/${id}`;
    this._devices[id] = deviceKey;

    const ident   = dev.ident || {};
    const typeRaw = ident.type?.value_raw;
    const label   = ident.deviceName
      || ident.type?.value_localized
      || ident.deviceIdentLabel?.techType
      || `Miele ${id}`;

    const sensors = [
      { path: 'power', label: 'Power', sensorType: 'switch', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
        capabilityId: 'power', homekit: 'switch-rw' },
      { path: 'status',    label: 'Status',    sensorType: 'sensor' },
      { path: 'program',   label: 'Program',   sensorType: 'sensor' },
      { path: 'phase',     label: 'Phase',     sensorType: 'sensor' },
      { path: 'remaining', label: 'Remaining', sensorType: 'sensor', unit: 'min' },
      { path: 'temperature', label: 'Temperature', sensorType: 'temperature', unit: '°C', homekit: 'temperature' },
      { path: 'target',    label: 'Target',    sensorType: 'temperature', unit: '°C' },
      { path: 'door',      label: 'Door',      sensorType: 'door', format: 'on-off', homekit: 'contact' },
      { path: 'failure',   label: 'Failure',   sensorType: 'security', format: 'alarm' },
      { path: 'connected', label: 'Connected', sensorType: 'sensor', format: 'on-off' },
    ];

    this._registry.registerDevice({
      key:   deviceKey,
      label,
      type:  'miele',
      icon:  TYPE_ICONS[typeRaw] || '🏭',
      sensors,
      homekit: sensors.map((s) => s.homekit).filter(Boolean),
      _writeCapability: (capId, command) => this._write(id, capId, command),
    });
    console.log(`[Miele] Registered ${label} (${id})`);
  }

  async _syncAll() {
    await this._ensureToken();
    const devices = await this._api('GET', '/v1/devices');
    for (const [id, dev] of Object.entries(devices || {})) {
      this._registerDevice(id, dev); // pick up appliances added later
      this._applyState(id, dev.state);
    }
  }

  _applyState(id, state) {
    const k = this._devices[id];
    if (!k || !state) return;

    const statusRaw = state.status?.value_raw;
    if (statusRaw !== undefined) {
      this._store.set(`${k}/status`, state.status.value_localized || STATUS_NAMES[statusRaw] || String(statusRaw));
      this._store.set(`${k}/power`, statusRaw > 1 && statusRaw !== 255);
      this._store.set(`${k}/connected`, statusRaw !== 255);
    }

    const program = pick(state, 'ProgramID', 'programID', 'programId');
    if (program?.value_localized !== undefined) this._store.set(`${k}/program`, program.value_localized || '');
    const phase = pick(state, 'programPhase', 'ProgramPhase');
    if (phase?.value_localized !== undefined) this._store.set(`${k}/phase`, phase.value_localized || '');

    const rt = pick(state, 'remainingTime', 'RemainingTime');
    if (Array.isArray(rt)) this._store.set(`${k}/remaining`, (rt[0] || 0) * 60 + (rt[1] || 0));

    // temperatures come in 1/100 °C; -32768 means not available
    const temp = state.temperature?.[0]?.value_raw;
    if (temp !== undefined && temp !== -32768) this._store.set(`${k}/temperature`, temp / 100);
    const target = state.targetTemperature?.[0]?.value_raw;
    if (target !== undefined && target !== -32768) this._store.set(`${k}/target`, target / 100);

    if (state.signalDoor    !== undefined) this._store.set(`${k}/door`,    !!state.signalDoor);
    if (state.signalFailure !== undefined) this._store.set(`${k}/failure`, !!state.signalFailure);
  }

  // ── SSE event stream ─────────────────────────────────────────────────────

  async _openStream() {
    if (this._stopped) return;
    try { await this._ensureToken(); }
    catch (err) { console.error(`[Miele] Token refresh failed: ${err.message}`); }

    const ep = endpoint(this._config.miele);
    const req = ep.mod.request({
      hostname: ep.host,
      port: ep.port,
      path: '/v1/devices/all/events',
      headers: {
        'Accept':          'text/event-stream',
        'Accept-Language': this._config.miele?.language || 'en',
        'Authorization':   `Bearer ${this._tokens.access_token}`,
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        console.error(`[Miele] Event stream HTTP ${res.statusCode}`);
        return this._scheduleReconnect();
      }
      this._streamRetry = 5000;
      platformStatus.set('miele', true);
      console.log('[Miele] Event stream connected');

      let buf = '', ev = { event: '', data: '' };
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (line === '') { this._handleEvent(ev); ev = { event: '', data: '' }; }
          else if (line.startsWith('event:')) ev.event = line.slice(6).trim();
          else if (line.startsWith('data:'))  ev.data += line.slice(5).trim();
        }
      });
      res.on('end', () => this._scheduleReconnect());
      res.on('error', () => this._scheduleReconnect());
    });
    req.on('error', (err) => {
      console.error(`[Miele] Event stream error: ${err.message}`);
      this._scheduleReconnect();
    });
    req.end();
    this._stream = req;
  }

  _scheduleReconnect() {
    if (this._stopped) return;
    if (this._stream) { this._stream.destroy(); this._stream = null; }
    const delay = this._streamRetry;
    this._streamRetry = Math.min(this._streamRetry * 2, 300000);
    setTimeout(() => this._openStream(), delay);
  }

  _handleEvent(ev) {
    // "devices" events carry the full state of every appliance; "ping" is keep-alive
    if (ev.event !== 'devices' || !ev.data) return;
    let payload;
    try { payload = JSON.parse(ev.data); } catch { return; }
    for (const [id, dev] of Object.entries(payload || {})) {
      this._registerDevice(id, dev);
      this._applyState(id, dev.state);
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  async _write(id, capId, command) {
    if (capId !== 'power') return;
    await this._api('PUT', `/v1/devices/${id}/actions`,
      command === 'on' ? { powerOn: true } : { powerOff: true });
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  async _api(method, apiPath, body) {
    await this._ensureToken();
    const json    = body ? JSON.stringify(body) : null;
    const headers = {
      'Accept':          'application/json',
      'Accept-Language': this._config.miele?.language || 'en',
      'Authorization':   `Bearer ${this._tokens.access_token}`,
    };
    if (json) headers['Content-Type'] = 'application/json';
    return this._req(method, apiPath, json, headers);
  }

  _req(method, reqPath, body, headers = {}) {
    const ep = endpoint(this._config.miele);
    return new Promise((resolve, reject) => {
      const req = ep.mod.request({
        hostname: ep.host, port: ep.port, path: reqPath, method, timeout: 15000,
        headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
      }, (res) => {
        let data = '';
        res.on('data', (d) => data += d);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            let msg = `HTTP ${res.statusCode}`;
            try { msg += `: ${JSON.parse(data).message || data.slice(0, 120)}`; } catch {}
            return reject(new Error(msg));
          }
          if (!data) return resolve(null);
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Non-JSON response from ${reqPath}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = MieleClient;
