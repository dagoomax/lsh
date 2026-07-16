'use strict';

const https          = require('https');
const fs             = require('fs');
const path           = require('path');
const platformStatus = require('./platform-status');

// Home Connect cloud (developer.home-connect.com) — all BSH brands:
// Bosch, Siemens, Gaggenau, Neff, Thermador, Balay, Constructa.
// Auth is OAuth2 device flow — run `node scripts/homeconnect-auth.js` once to
// obtain tokens; they are persisted (and auto-refreshed) in persist/.
// Live updates come from the account-wide SSE event stream, with a slow
// periodic re-sync as safety net (the API is rate-limited to ~1000 req/day).

const TOKENS_FILE = path.join(__dirname, '..', 'persist', 'homeconnect-tokens.json');
const PROD_HOST      = 'api.home-connect.com';
const SIMULATOR_HOST = 'simulator.home-connect.com';

const TYPE_ICONS = {
  Dishwasher: '🍽️', Washer: '🧺', Dryer: '👕', WasherDryer: '🧺',
  Oven: '🔥', CoffeeMaker: '☕', FridgeFreezer: '🧊', Refrigerator: '🧊',
  Freezer: '🧊', WineCooler: '🍷', Hood: '💨', Hob: '🍳',
  CleaningRobot: '🤖', CookProcessor: '🥘', WarmingDrawer: '♨️',
};

// last segment of a BSH enum, e.g. "BSH.Common.EnumType.DoorState.Open" → "Open"
const short = (v) => (typeof v === 'string' ? v.split('.').pop() : v);

class HomeConnectClient {
  constructor(config, store, sensorRegistry) {
    this._config    = config;
    this._store     = store;
    this._registry  = sensorRegistry;
    this._tokens    = null;
    this._host      = PROD_HOST;
    this._appliances = {};   // haId → { deviceKey, type }
    this._stream    = null;
    this._streamRetry = 5000;
    this._syncTimer = null;
    this._stopped   = false;
  }

  async start() {
    const cfg = this._config.homeConnect || {};
    this._host = cfg.simulator ? SIMULATOR_HOST : (cfg.host || PROD_HOST);

    this._tokens = this._loadTokens();
    if (!this._tokens?.refresh_token && cfg.refreshToken) {
      this._tokens = { refresh_token: cfg.refreshToken };
    }
    if (!this._tokens?.refresh_token) {
      platformStatus.set('homeconnect', false);
      console.log('[HomeConnect] No tokens — run `node scripts/homeconnect-auth.js` to log in');
      return;
    }

    try {
      await this._ensureToken();
      await this._discover();
      platformStatus.set('homeconnect', true);
      this._openStream();
      // SSE carries all live updates; the re-sync is only a safety net and the
      // API budget is ~1000 req/day, so keep it rare (default every 6 h)
      const resync = Math.max(3600, cfg.pollInterval || 21600) * 1000;
      this._syncTimer = setInterval(() => this._syncAll().catch(() => {}), resync);
    } catch (err) {
      platformStatus.set('homeconnect', false);
      console.error(`[HomeConnect] Start failed: ${err.message}`);
      if (this._stopped) return;
      // rate-limited (HTTP 429) → wait out the advertised block, else retry in 30 min
      const blocked = err.message.match(/remaining period of (\d+) seconds/);
      const delay = blocked ? (Number(blocked[1]) + 60) * 1000 : 30 * 60 * 1000;
      console.log(`[HomeConnect] Retrying start in ${Math.round(delay / 60000)} min`);
      this._retryTimer = setTimeout(() => this.start(), delay);
    }
  }

  stop() {
    this._stopped = true;
    if (this._syncTimer) clearInterval(this._syncTimer);
    if (this._retryTimer) clearTimeout(this._retryTimer);
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
    if (this._tokens.access_token && (this._tokens.expires_at || 0) > Date.now() + 120000) return;
    const cfg  = this._config.homeConnect || {};
    const body = 'grant_type=refresh_token'
      + `&refresh_token=${encodeURIComponent(this._tokens.refresh_token)}`
      + (cfg.clientSecret ? `&client_secret=${encodeURIComponent(cfg.clientSecret)}` : '')
      + (cfg.clientId ? `&client_id=${encodeURIComponent(cfg.clientId)}` : '');
    const res = await this._req('POST', '/security/oauth/token', body,
      { 'Content-Type': 'application/x-www-form-urlencoded' }, false);
    this._tokens = {
      ...this._tokens,
      access_token:  res.access_token,
      refresh_token: res.refresh_token || this._tokens.refresh_token,
      expires_at:    Date.now() + (res.expires_in || 86400) * 1000,
    };
    this._saveTokens();
  }

  // ── Discovery & state sync ───────────────────────────────────────────────

  async _discover() {
    const res  = await this._api('GET', '/api/homeappliances');
    const list = res?.data?.homeappliances || [];
    for (const ha of list) {
      const deviceKey = `homeconnect/${ha.haId}`;
      this._appliances[ha.haId] = { deviceKey, type: ha.type };

      const sensors = this._sensors();
      this._registry.registerDevice({
        key:   deviceKey,
        label: ha.name || `${ha.brand || ''} ${ha.type}`.trim(),
        type:  'homeconnect',
        icon:  TYPE_ICONS[ha.type] || '🏭',
        sensors,
        homekit: sensors.map((s) => s.homekit).filter(Boolean),
        _writeCapability: (capId, command) => this._write(ha.haId, capId, command),
      });

      this._store.set(`${deviceKey}/connected`, !!ha.connected);
      if (ha.connected) await this._syncAppliance(ha.haId).catch((err) =>
        console.error(`[HomeConnect] Initial sync failed for ${ha.haId}: ${err.message}`));
      console.log(`[HomeConnect] Registered ${ha.name} (${ha.type})`);
    }
    if (!list.length) console.log('[HomeConnect] No appliances on this account');
  }

  _sensors() {
    return [
      { path: 'power', label: 'Power', sensorType: 'switch', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
        capabilityId: 'power', homekit: 'switch-rw' },
      { path: 'operation', label: 'Operation', sensorType: 'sensor' },
      { path: 'program',   label: 'Program',   sensorType: 'sensor' },
      { path: 'progress',  label: 'Progress',  sensorType: 'sensor', unit: '%'   },
      { path: 'remaining', label: 'Remaining', sensorType: 'sensor', unit: 'min' },
      { path: 'door',      label: 'Door',      sensorType: 'door', format: 'on-off', homekit: 'contact' },
      { path: 'connected', label: 'Connected', sensorType: 'sensor', format: 'on-off' },
    ];
  }

  async _syncAll() {
    await this._ensureToken();
    // one request for the connected flags — SSE carries everything else; a
    // full per-appliance sync (3 requests each) only on reconnection
    const res = await this._api('GET', '/api/homeappliances');
    for (const ha of res?.data?.homeappliances || []) {
      const meta = this._appliances[ha.haId];
      if (!meta) continue;
      const was = this._store.get(`${meta.deviceKey}/connected`);
      this._store.set(`${meta.deviceKey}/connected`, !!ha.connected);
      if (ha.connected && was === false) await this._syncAppliance(ha.haId).catch(() => {});
    }
  }

  async _syncAppliance(haId) {
    const status = await this._api('GET', `/api/homeappliances/${haId}/status`).catch(() => null);
    for (const it of status?.data?.status || []) this._applyItem(haId, it);

    const settings = await this._api('GET', `/api/homeappliances/${haId}/settings`).catch(() => null);
    for (const it of settings?.data?.settings || []) this._applyItem(haId, it);

    // 404/409 simply means nothing is running
    const active = await this._api('GET', `/api/homeappliances/${haId}/programs/active`).catch(() => null);
    if (active?.data) {
      this._applyItem(haId, { key: 'BSH.Common.Root.ActiveProgram', value: active.data.key });
      for (const opt of active.data.options || []) this._applyItem(haId, opt);
    }
  }

  // one status/setting/option/event item → store update
  _applyItem(haId, item) {
    const meta = this._appliances[haId];
    if (!meta || !item?.key) return;
    const k = meta.deviceKey;
    switch (item.key) {
      case 'BSH.Common.Setting.PowerState':
        this._store.set(`${k}/power`, short(item.value) === 'On'); break;
      case 'BSH.Common.Status.DoorState':
        this._store.set(`${k}/door`, short(item.value) === 'Open'); break;
      case 'BSH.Common.Status.OperationState':
        this._store.set(`${k}/operation`, short(item.value)); break;
      case 'BSH.Common.Root.ActiveProgram':
      case 'BSH.Common.Root.SelectedProgram':
        this._store.set(`${k}/program`, short(item.value) ?? ''); break;
      case 'BSH.Common.Option.ProgramProgress':
        this._store.set(`${k}/progress`, item.value); break;
      case 'BSH.Common.Option.RemainingProgramTime':
        this._store.set(`${k}/remaining`, Math.round((item.value || 0) / 60)); break;
      case 'BSH.Common.Event.ProgramFinished':
        this._store.set(`${k}/operation`, 'Finished'); break;
      default: break; // appliance-specific keys are ignored for now
    }
  }

  // ── SSE event stream ─────────────────────────────────────────────────────

  async _openStream() {
    if (this._stopped) return;
    try { await this._ensureToken(); }
    catch (err) { console.error(`[HomeConnect] Token refresh failed: ${err.message}`); }

    const req = https.request({
      hostname: this._host,
      path: '/api/homeappliances/events',
      headers: {
        'Accept':        'text/event-stream',
        'Authorization': `Bearer ${this._tokens.access_token}`,
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        console.error(`[HomeConnect] Event stream HTTP ${res.statusCode}`);
        // 429 = daily quota exhausted — hammering it every few minutes only
        // burns more budget; retry hourly until the block lifts
        if (res.statusCode === 429) this._streamRetry = Math.max(this._streamRetry, 3600000);
        return this._scheduleReconnect();
      }
      this._streamRetry = 5000;
      platformStatus.set('homeconnect', true);
      console.log('[HomeConnect] Event stream connected');

      let buf = '', ev = { event: '', data: '', id: '' };
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (line === '') { this._handleEvent(ev); ev = { event: '', data: '', id: '' }; }
          else if (line.startsWith('event:')) ev.event = line.slice(6).trim();
          else if (line.startsWith('data:'))  ev.data += line.slice(5).trim();
          else if (line.startsWith('id:'))    ev.id = line.slice(3).trim();
        }
      });
      res.on('end', () => this._scheduleReconnect());
      res.on('error', () => this._scheduleReconnect());
    });
    req.on('error', (err) => {
      console.error(`[HomeConnect] Event stream error: ${err.message}`);
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
    if (!ev.event || ev.event === 'KEEP-ALIVE') return;
    const haId = ev.id;
    const meta = this._appliances[haId];
    if (ev.event === 'CONNECTED' || ev.event === 'DISCONNECTED') {
      if (meta) this._store.set(`${meta.deviceKey}/connected`, ev.event === 'CONNECTED');
      if (ev.event === 'CONNECTED') this._syncAppliance(haId).catch(() => {});
      return;
    }
    // STATUS / EVENT / NOTIFY carry {items:[{key,value,uri},…]}
    let payload;
    try { payload = JSON.parse(ev.data); } catch { return; }
    for (const item of payload?.items || []) {
      const id = haId || item.uri?.match(/homeappliances\/([^/]+)/)?.[1];
      this._applyItem(id, item);
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  async _write(haId, capId, command) {
    if (capId !== 'power') return;
    const value = command === 'on'
      ? 'BSH.Common.EnumType.PowerState.On'
      : 'BSH.Common.EnumType.PowerState.Off';
    try {
      await this._putSetting(haId, 'BSH.Common.Setting.PowerState', value);
    } catch (err) {
      // many appliance types have no "Off", only "Standby" — retry once
      if (command === 'off') {
        await this._putSetting(haId, 'BSH.Common.Setting.PowerState',
          'BSH.Common.EnumType.PowerState.Standby');
      } else {
        throw err;
      }
    }
  }

  _putSetting(haId, key, value) {
    return this._api('PUT', `/api/homeappliances/${haId}/settings/${key}`,
      { data: { key, value } });
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  async _api(method, apiPath, body) {
    await this._ensureToken();
    const json    = body ? JSON.stringify(body) : null;
    const headers = {
      'Accept':        'application/vnd.bsh.sdk.v1+json',
      'Authorization': `Bearer ${this._tokens.access_token}`,
    };
    if (json) headers['Content-Type'] = 'application/vnd.bsh.sdk.v1+json';
    return this._req(method, apiPath, json, headers, true);
  }

  _req(method, reqPath, body, headers = {}, parse = true) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this._host, path: reqPath, method, timeout: 15000,
        headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
      }, (res) => {
        let data = '';
        res.on('data', (d) => data += d);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            let msg = `HTTP ${res.statusCode}`;
            try { msg += `: ${JSON.parse(data).error?.description || data.slice(0, 120)}`; } catch {}
            return reject(new Error(msg));
          }
          if (!parse || !data) return resolve(null);
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

module.exports = HomeConnectClient;
