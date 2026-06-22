'use strict';

const https          = require('https');
const fs             = require('fs');
const path           = require('path');
const crypto         = require('crypto');
const platformStatus = require('./platform-status');

// Public app constants embedded in the official LG ThinQ Android app
const APP_ID       = 'LGAO221A02';
const APP_KEY      = 'VGhpblEyLjAgU0VSVklDRQ==';
const APP_VER      = '3.6.1200';
const SVC_CODE     = 'SVC202';
// OAuth credentials (public knowledge — extracted from LG app by community)
const OAUTH_ID     = 'LGAO221A02';
const OAUTH_SECRET = 'c053c2a6ddeb7ad97cb0eed0dcb31cf8';
const REDIRECT_URI = 'lgaccount.lgsmartthinq://';

const GATEWAY_HOST = 'aic-service.lgthinq.com';

// Country → EMP (auth) host
const EMP_HOSTS = {
  US: 'us.m.lgaccount.com',
  EU: 'eu.m.lgaccount.com',
  KR: 'kr.m.lgaccount.com',
  AU: 'au.m.lgaccount.com',
  CA: 'ca.m.lgaccount.com',
  JP: 'jp.m.lgaccount.com',
};
const DEFAULT_EMP = 'm.lgaccount.com';

const TOKENS_FILE = path.join(__dirname, '..', 'persist', 'lgthinq-tokens.json');

class LGThinQClient {
  constructor(config, store, sensorRegistry) {
    this._config    = config;
    this._store     = store;
    this._registry  = sensorRegistry;
    this._tokens    = null;
    this._thinq2Host = null;
    this._deviceMap  = {}; // deviceId → { deviceKey, type }
    this._pollTimer  = null;
  }

  async start() {
    const hasTokens = !!(this._loadTokens()?.access_token);
    if (!hasTokens) return;
    try {
      await this._authenticate();
      await this._discoverDevices();
      platformStatus.set('lgthinq', true);
      this._pollTimer = setInterval(() => this._pollAll(), 30000);
    } catch (err) {
      console.error(`[LGThinQ] Start failed: ${err.message}`);
      platformStatus.set('lgthinq', false);
    }
  }

  stop() {
    if (this._pollTimer) clearInterval(this._pollTimer);
  }

  // ── Authentication ────────────────────────────────────────────────────

  async _authenticate() {
    const saved = this._loadTokens();
    if (!saved?.access_token) throw new Error('No LG ThinQ tokens configured');
    this._tokens = saved;
    if (saved.thinq2Host) this._thinq2Host = saved.thinq2Host;
    if (saved.expires_at && saved.expires_at > Date.now() + 60000) return;
    if (saved.refresh_token) {
      const empHost = saved.empHost || EMP_HOSTS[(this._config.lgthinq?.country || 'US').toUpperCase()] || DEFAULT_EMP;
      await this._refreshTokens(empHost);
    }
  }

  async _login() {
    const cfg     = this._config.lgthinq;
    const country = (cfg.country || 'US').toUpperCase();
    const lang    = cfg.lang || _defaultLang(country);

    // 1. Gateway lookup → get country-specific server URLs
    const gw = await this._gatewayInfo(country, lang);
    const thinq2Raw  = gw.thinq2Path || gw.thinq2  || gw.thinq2Uri || '';
    this._thinq2Host = thinq2Raw.startsWith('http') ? _parseHost(thinq2Raw) : thinq2Raw || `${country.toLowerCase()}.api.lge.com`;
    const empHost    = gw.empPath || gw.empApiHost || gw.empHost || EMP_HOSTS[country] || DEFAULT_EMP;

    // 2. Pre-login — exchange credentials for an OAuth code
    const state     = crypto.randomBytes(4).toString('hex');
    const prelogin  = await this._preLogin(empHost, cfg.username, cfg.password, state);
    const redir     = prelogin.redirect_uri || prelogin.redirectUri || '';
    const codeMatch = redir.match(/[?&]code=([^&]+)/);
    if (!codeMatch) throw new Error(`LG pre-login did not return an auth code. Server response: ${JSON.stringify(prelogin).slice(0, 300)}`);
    const code = decodeURIComponent(codeMatch[1]);

    // 3. Token exchange
    const tokens = await this._exchangeCode(empHost, code);
    this._tokens = {
      ...tokens,
      expires_at:  Date.now() + (tokens.expires_in || 3600) * 1000,
      thinq2Host:  this._thinq2Host,
      empHost,
    };
    this._saveTokens(this._tokens);
    console.log('[LGThinQ] Authenticated successfully');
  }

  async _refreshTokens(empHost) {
    const body   = `grant_type=refresh_token&refresh_token=${encodeURIComponent(this._tokens.refresh_token)}`;
    const creds  = Buffer.from(`${OAUTH_ID}:${OAUTH_SECRET}`).toString('base64');
    const result = await this._httpsReq('POST', empHost, '/oauth2/token', body, {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    });
    this._tokens = {
      ...this._tokens,
      access_token: result.access_token,
      expires_at:   Date.now() + (result.expires_in || 3600) * 1000,
    };
    this._saveTokens(this._tokens);
  }

  async _gatewayInfo(country, lang) {
    return this._httpsReq('GET', GATEWAY_HOST,
      `/service/users/gateways?countryCode=${country}&langCode=${lang.replace('-', '_')}`,
      null, this._commonHeaders(country, lang)
    ).then(r => r.result || r);
  }

  async _preLogin(empHost, username, password, state) {
    // LG uses HMAC-SHA1 of specific data to sign the request
    const ts     = Date.now();
    const nonce  = crypto.randomBytes(8).toString('hex');
    const b64pw  = Buffer.from(password).toString('base64');
    const body   = {
      user_auth2:   b64pw,
      redirect_uri: REDIRECT_URI,
      state,
      username,
      log_param:    `login request / redirect_uri=${REDIRECT_URI} / user_auth2=${b64pw} / state=${state}`,
    };
    return this._httpsReq('POST', empHost, `/spx/common/oauthapps/${APP_ID}/preLogin`, body, {
      'Content-Type': 'application/json',
    });
  }

  async _exchangeCode(empHost, code) {
    const body  = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    const creds = Buffer.from(`${OAUTH_ID}:${OAUTH_SECRET}`).toString('base64');
    return this._httpsReq('POST', empHost, '/oauth2/token', body, {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    });
  }

  // ── Device discovery ──────────────────────────────────────────────────

  async _discoverDevices() {
    const cfg     = this._config.lgthinq;
    const country = (cfg.country || 'US').toUpperCase();
    const lang    = cfg.lang || _defaultLang(country);

    // Try home API; fall back to dashboard endpoint
    let homeList = [];
    try {
      const resp  = await this._thinqGet('/service/users/home', country, lang);
      homeList    = Array.isArray(resp) ? resp : (resp.result || resp.item || []);
    } catch {
      const resp  = await this._thinqGet('/service/application/dashboard', country, lang);
      homeList    = Array.isArray(resp) ? resp : (resp.result || resp.item || []);
    }

    for (const home of homeList) {
      for (const dev of home.devices || home.device || []) {
        await this._registerDevice(dev, country, lang).catch(err =>
          console.warn(`[LGThinQ] Device init failed for ${dev.alias || dev.deviceId}: ${err.message}`)
        );
      }
    }
    console.log(`[LGThinQ] Registered ${Object.keys(this._deviceMap).length} device(s)`);
  }

  async _registerDevice(dev, country, lang) {
    const deviceId = dev.deviceId;
    const type     = _resolveType(dev.deviceType);
    if (!type) return;

    const deviceKey = `lgthinq/${deviceId}`;
    const label     = dev.alias || dev.name || deviceId;

    let snapshot = dev.snapshot || {};
    try {
      const st = await this._thinqGet(`/service/devices/${deviceId}/status`, country, lang);
      snapshot  = st.result || st.snapshot || st || snapshot;
    } catch { /* use dev.snapshot */ }

    const sensors = _sensorsForType(type);
    if (!sensors.length) return;

    const device = {
      key:    deviceKey,
      label,
      type:   'lgthinq',
      sensors,
      _writeCapability: async (capId, command, args = []) =>
        this._writeDevice(deviceId, type, capId, command, args, country, lang),
    };

    this._registry.registerDevice(device);
    this._deviceMap[deviceId] = { deviceKey, type };
    _applySnapshot(this._store, deviceKey, type, snapshot);
    console.log(`[LGThinQ] Registered ${label} (${type})`);
  }

  // ── Write ─────────────────────────────────────────────────────────────

  async _writeDevice(deviceId, type, capId, command, args, country, lang) {
    let payload;
    if (capId === 'power') {
      const on = command === 'on';
      payload  = { dataKey: 'airState.operation', dataValue: on ? 1 : 0 };
    } else if (capId === 'targetTemp') {
      payload = { dataKey: 'airState.tempState.target', dataValue: String(args[0]) };
    } else {
      payload = { dataKey: capId, dataValue: String(command) };
    }
    await this._thinqPost(`/service/devices/${deviceId}/state`, { lge: [payload] }, country, lang);
  }

  // ── Polling ───────────────────────────────────────────────────────────

  async _pollAll() {
    const cfg     = this._config.lgthinq;
    const country = (cfg.country || 'US').toUpperCase();
    const lang    = cfg.lang || _defaultLang(country);

    if (this._tokens?.expires_at && this._tokens.expires_at < Date.now() + 120000) {
      try {
        const empHost = this._tokens.empHost || EMP_HOSTS[country] || DEFAULT_EMP;
        await this._refreshTokens(empHost);
      } catch (err) {
        console.error(`[LGThinQ] Token refresh failed: ${err.message}`);
        platformStatus.set('lgthinq', false);
        return;
      }
    }

    for (const [deviceId, info] of Object.entries(this._deviceMap)) {
      try {
        const st       = await this._thinqGet(`/service/devices/${deviceId}/status`, country, lang);
        const snapshot = st.result || st.snapshot || st;
        _applySnapshot(this._store, info.deviceKey, info.type, snapshot);
      } catch (err) {
        console.warn(`[LGThinQ] Poll failed for ${deviceId}: ${err.message}`);
      }
    }
    platformStatus.set('lgthinq', true);
  }

  // ── ThinQ2 API helpers ────────────────────────────────────────────────

  _apiHeaders(country, lang) {
    return {
      ...this._commonHeaders(country, lang),
      'Authorization': `Bearer ${this._tokens.access_token}`,
    };
  }

  async _thinqGet(apiPath, country, lang) {
    const host = this._thinq2Host || `${country.toLowerCase()}.api.lge.com`;
    return this._httpsReq('GET', host, apiPath, null, this._apiHeaders(country, lang));
  }

  async _thinqPost(apiPath, body, country, lang) {
    const host = this._thinq2Host || `${country.toLowerCase()}.api.lge.com`;
    return this._httpsReq('POST', host, apiPath, body, this._apiHeaders(country, lang));
  }

  _commonHeaders(country, lang) {
    return {
      'x-api-key':            APP_KEY,
      'x-client-id':          APP_ID,
      'x-country-code':       country,
      'x-language-code':      lang.replace('-', '_'),
      'x-message-id':         crypto.randomBytes(8).toString('hex'),
      'x-service-id':         SVC_CODE,
      'x-service-phase':      'OP',
      'x-thinq-app-level':    'PRD',
      'x-thinq-app-logintype':'LGE',
      'x-thinq-app-os':       'ANDROID',
      'x-thinq-app-type':     'NUTS',
      'x-thinq-app-ver':      APP_VER,
      'x-thinq-sdk-ver':      '2.0',
      'Accept':               'application/json',
    };
  }

  // ── Token persistence ─────────────────────────────────────────────────

  _loadTokens() {
    try {
      if (fs.existsSync(TOKENS_FILE)) return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    } catch {}
    return null;
  }

  _saveTokens(tokens) {
    try {
      fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[LGThinQ] Could not save tokens: ${err.message}`);
    }
  }

  // ── HTTPS helper ──────────────────────────────────────────────────────

  _httpsReq(method, hostname, reqPath, body, headers = {}) {
    return new Promise((resolve, reject) => {
      let payload = null;
      if (body !== null && body !== undefined) {
        if (typeof body === 'string') {
          payload = Buffer.from(body, 'utf8');
        } else {
          payload = Buffer.from(JSON.stringify(body), 'utf8');
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
        headers['Content-Length'] = payload.length;
      }
      const req = https.request({ hostname, path: reqPath, method, timeout: 15000, headers }, res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          }
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error(`Non-JSON: ${text.slice(0, 100)}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

// ── Helpers (module-level) ───────────────────────────────────────────────────

function _parseHost(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function _defaultLang(country) {
  const map = { KR: 'ko-KR', JP: 'ja-JP', EU: 'en-GB', PL: 'pl-PL', DE: 'de-DE', FR: 'fr-FR', IT: 'it-IT' };
  return map[country] || 'en-US';
}

function _resolveType(raw) {
  const t = String(raw || '').toUpperCase();
  if (t === '101' || t.includes('REFRIGERATOR'))     return 'REFRIGERATOR';
  if (t === '201' || t.includes('WASHER'))           return 'WASHER';
  if (t === '202' || t.includes('DRYER'))            return 'DRYER';
  if (t === '204' || t.includes('DISHWASHER'))       return 'DISHWASHER';
  if (t === '206' || t.includes('AIR_CONDITIONER'))  return 'AC';
  if (t === '401' || t.includes('AIR_PURIFIER'))     return 'AIR_PURIFIER';
  if (t === '402' || t.includes('HUMIDIFIER'))       return 'HUMIDIFIER';
  if (t === '406' || t.includes('DEHUMIDIFIER'))     return 'DEHUMIDIFIER';
  if (t === '101' || t.includes('ROBOT_CLEANER'))    return null; // no practical sensors
  return null;
}

function _sensorsForType(type) {
  switch (type) {
    case 'AC':
      return [
        { path: 'power',       name: 'Power',        type: 'boolean', controllable: true,  capabilityId: 'power',      writeOn: 'on', writeOff: 'off', homekit: { service: 'Switch', characteristic: 'On' } },
        { path: 'targetTemp',  name: 'Target Temp',  type: 'range',   controllable: true,  capabilityId: 'targetTemp', writeCmd: 'set', min: 16, max: 30, format: 'temperature' },
        { path: 'currentTemp', name: 'Current Temp', type: 'number',  controllable: false, format: 'temperature' },
      ];
    case 'AIR_PURIFIER':
      return [
        { path: 'power', name: 'Power', type: 'boolean', controllable: true, capabilityId: 'power', writeOn: 'on', writeOff: 'off' },
        { path: 'pm1',   name: 'PM1.0', type: 'number',  controllable: false, format: 'pm25' },
        { path: 'pm25',  name: 'PM2.5', type: 'number',  controllable: false, format: 'pm25' },
        { path: 'pm10',  name: 'PM10',  type: 'number',  controllable: false, format: 'pm10' },
      ];
    case 'WASHER':
    case 'DRYER':
      return [
        { path: 'state',     name: 'State',           type: 'number', controllable: false, format: 'washer-state' },
        { path: 'remaining', name: 'Remaining (min)', type: 'number', controllable: false },
      ];
    case 'DISHWASHER':
      return [
        { path: 'state', name: 'State', type: 'number', controllable: false, format: 'washer-state' },
      ];
    case 'REFRIGERATOR':
      return [
        { path: 'fridgeTemp',  name: 'Fridge Temp',  type: 'number', controllable: false, format: 'temperature' },
        { path: 'freezeTemp',  name: 'Freezer Temp', type: 'number', controllable: false, format: 'temperature' },
      ];
    case 'HUMIDIFIER':
    case 'DEHUMIDIFIER':
      return [
        { path: 'power',    name: 'Power',    type: 'boolean', controllable: true, capabilityId: 'power', writeOn: 'on', writeOff: 'off' },
        { path: 'humidity', name: 'Humidity', type: 'number',  controllable: false, format: 'percent' },
      ];
    default:
      return [];
  }
}

function _get(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function _applySnapshot(store, deviceKey, type, snap) {
  const set = (p, v) => { if (v !== undefined && v !== null) store.set(`${deviceKey}/${p}`, v); };
  switch (type) {
    case 'AC':
      set('power',       _get(snap, 'airState.operation', 'operation') === 1 ? 1 : 0);
      set('targetTemp',  parseFloat(_get(snap, 'airState.tempState.target',  'targetTemperature') ?? 'x') || undefined);
      set('currentTemp', parseFloat(_get(snap, 'airState.tempState.current', 'currentTemperature') ?? 'x') || undefined);
      break;
    case 'AIR_PURIFIER':
      set('power', _get(snap, 'airState.operation', 'operation') === 1 ? 1 : 0);
      set('pm1',   parseFloat(_get(snap, 'airState.airQuality.PM1H',  'PM1H')  ?? 'x') || undefined);
      set('pm25',  parseFloat(_get(snap, 'airState.airQuality.PM2H',  'PM2H')  ?? 'x') || undefined);
      set('pm10',  parseFloat(_get(snap, 'airState.airQuality.PM10H', 'PM10H') ?? 'x') || undefined);
      break;
    case 'WASHER':
    case 'DRYER': {
      const raw = _get(snap, 'washerDryer.state', 'state') || '';
      set('state', String(raw).replace(/@WM_STATE_|@DW_STATE_|_W$/g, '') || 'STANDBY');
      const h = parseInt(_get(snap, 'washerDryer.remainTimeHour',   'remainTimeHour')   || 0, 10);
      const m = parseInt(_get(snap, 'washerDryer.remainTimeMinute', 'remainTimeMinute') || 0, 10);
      set('remaining', h * 60 + m);
      break;
    }
    case 'DISHWASHER': {
      const raw = _get(snap, 'dishwasher.state', 'state') || '';
      set('state', String(raw).replace(/@DW_STATE_|_W$/g, '') || 'STANDBY');
      break;
    }
    case 'REFRIGERATOR':
      set('fridgeTemp',  parseFloat(_get(snap, 'refState.fridgeTemp', 'fridgeTemp') ?? 'x') || undefined);
      set('freezeTemp',  parseFloat(_get(snap, 'refState.freezeTemp', 'freezeTemp') ?? 'x') || undefined);
      break;
    case 'HUMIDIFIER':
    case 'DEHUMIDIFIER':
      set('power',    _get(snap, 'airState.operation', 'operation') === 1 ? 1 : 0);
      set('humidity', parseFloat(_get(snap, 'airState.humidity.current', 'currentHumidity') ?? 'x') || undefined);
      break;
  }
}

module.exports = LGThinQClient;
