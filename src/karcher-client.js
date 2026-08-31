'use strict';

/*
 * Kärcher Home Robots cloud client (RCV5, RCV3, RCF5) — MQTT transport over
 * 3iRobotix's cloud, not Kärcher's own servers. There is no local API for
 * these robots; the official app itself goes through this same cloud, so an
 * outage on 3iRobotix's end makes the robot unreachable here too — same
 * tradeoff as roborock-cloud-client.js.
 *
 * Protocol ported from the MIT-licensed python-karcher
 * (github.com/lafriks/python-karcher — login/signing/encryption/property
 * poll) and cross-checked against the karcher-rcv5-ha Home Assistant
 * integration (github.com/vosadci/karcher-rcv5-ha) for the command set
 * neither project's README documents on its own (start/pause/stop/dock/
 * locate/fan-speed — verified against real RCV5 hardware by that project).
 *
 * Not implemented (out of scope for v1): per-room/zone cleaning, map
 * fetch/render, mop-water level control. Whole-home clean + pause/stop/
 * dock/locate/fan-speed/cleaning-mode covers the common case; room
 * selection would need its own UI (see roborock-cloud-client.js's rooms
 * support for what that'd look like) and is a reasonable follow-up, not
 * a blocker for a first working integration.
 */

const crypto         = require('crypto');
const https          = require('https');
const fs             = require('fs');
const path           = require('path');
const mqtt           = require('mqtt');
const platformStatus = require('./platform-status');

const SESSION_CACHE = path.join(__dirname, '..', 'persist', 'karcher-session.json');

const TENANT_ID         = '1528983614213726208';
const PROJECT_TYPE      = 'android_iot.karcher';
const PROTOCOL_VERSION  = 'v1';
const APP_VERSION_CODE  = 10004;
const APP_VERSION_NAME  = '1.0.4';
const USER_AGENT        = 'Android_' + TENANT_ID;

const REGION_URLS = {
  eu: 'https://eu-appaiot.3irobotix.net',
  us: 'https://us-appaiot.3irobotix.net',
  cn: 'https://cn-appaiot.3irobotix.net',
};

const PRODUCT_MODELS = {
  '1528986273083777024': 'RCV3',
  '1540149850806333440': 'RCV5',
  '1599715149861306368': 'RCF5',
};

const ROBOT_PROPERTIES = [
  'status', 'firmware_code', 'firmware', 'fault', 'mode', 'wind', 'water',
  'repeat_state', 'charge_state', 'quantity', 'work_mode', 'sweep_type',
  'build_map', 'cleaning_area', 'cleaning_time', 'current_map_id',
  'custom_type', 'privacy', 'alarm', 'volume', 'tank_state', 'cloth_state',
  'mop_route', 'map_num', 'language', 'voice_type', 'quiet_status', 'quiet_is_open',
];

const POLL_MS     = 30_000;
const CMD_TIMEOUT = 10_000;

// work_mode → coarse state, traffic-verified by karcher-rcv5-ha against real
// RCV5 hardware (its const.py) — the robot doesn't expose a simpler status.
const WORK_MODE_CLEANING = new Set([1, 7, 25, 30, 36, 81]);
const WORK_MODE_GO_HOME  = new Set([5, 10, 11, 12, 21, 26, 32, 38, 47]);
const WORK_MODE_PAUSE    = new Set([4, 9, 27, 31, 37, 82]);
const WORK_MODE_IDLE     = new Set([0, 14, 23, 29, 35, 40, 85]);

const FAN_LEVELS = ['Silent', 'Standard', 'Medium', 'Turbo']; // wind 0..3
const CLEAN_MODES = ['Vacuum', 'Vacuum & Mop', 'Mop'];         // mode 0..2

function stateLabel(workMode, chargeState) {
  if (workMode == null) return 'Unknown';
  if (WORK_MODE_CLEANING.has(workMode)) return 'Cleaning';
  if (WORK_MODE_GO_HOME.has(workMode)) return 'Returning';
  if (WORK_MODE_PAUSE.has(workMode)) return 'Paused';
  if (WORK_MODE_IDLE.has(workMode)) return chargeState ? 'Charging' : 'Idle';
  return `Mode ${workMode}`;
}

// ── crypto/signing (AES-128-ECB body encryption, MD5 request signature) ────

function encKey() {
  const hex = crypto.createHash('md5').update(TENANT_ID, 'utf8').digest('hex');
  return Buffer.from(hex.slice(8, 24), 'utf8'); // 16 ASCII chars = 16-byte AES-128 key
}
function encrypt(str) {
  const c = crypto.createCipheriv('aes-128-ecb', encKey(), null);
  return Buffer.concat([c.update(str, 'utf8'), c.final()]).toString('base64');
}
function decrypt(b64) {
  const d = crypto.createDecipheriv('aes-128-ecb', encKey(), null);
  const buf = Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]);
  return buf.toString('utf8');
}
function md5(str) { return crypto.createHash('md5').update(str, 'utf8').digest('hex'); }
function nonce32() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Field-order-dependent signing string — mirrors python-karcher's
// collections.OrderedDict concatenation exactly (see PROTOCOL.md): plain
// JS object key iteration is insertion-order for the string keys used
// throughout this API, so building request bodies as literals in the same
// field order as the reference client keeps the signature byte-identical.
function signData(method, body, query) {
  if (method === 'GET') {
    return new URLSearchParams(query || {}).toString();
  }
  let data = '';
  for (const [k, v] of Object.entries(body || {})) {
    data += k;
    if (v === null || v === undefined) data += 'null';
    else if (typeof v === 'string') data += v;
    else if (typeof v === 'object') data += JSON.stringify(v);
    else data += String(v);
  }
  return data;
}

function httpsJson(baseUrl, method, urlPath, { body, query, session } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + urlPath);
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);

    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = nonce32();
    const authToken = session?.authToken || '';
    const data = signData(method, body, query);

    const headers = {
      'User-Agent': USER_AGENT,
      tenantId: TENANT_ID,
      sign: md5(authToken + ts + nonce + data),
      ts, nonce,
      'Content-Type': 'application/json',
    };
    if (authToken) headers.authorization = authToken;
    if (session?.userId) headers.id = session.userId;

    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    if (payload) headers['Content-Length'] = payload.length;

    const req = https.request(
      // rejectUnauthorized:false: 3iRobotix's REST host fails default
      // certificate validation — the reference client pins the exact leaf
      // certificate's fingerprint (aiohttp.Fingerprint) rather than trusting
      // a CA, which Node's https module has no equivalent option for; this
      // mirrors the MQTT connection's same tradeoff (also unverified there,
      // per that client's own unresolved TODO) rather than leaving the
      // whole REST path unusable.
      { method, hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 15000, rejectUnauthorized: false },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch { reject(new Error(`Bad JSON from ${urlPath}: ${d.slice(0, 200)}`)); }
        });
      });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout contacting ${u.hostname}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

function checkResponse(resp, urlPath) {
  if (!resp || resp.code !== 0) {
    throw new Error(`Kärcher API error on ${urlPath}: ${resp ? `${resp.msg} (code ${resp.code})` : 'no response'}`);
  }
  return resp.result;
}

// ── login + device list ─────────────────────────────────────────────────

async function getUrls(baseUrl) {
  const resp = await httpsJson(baseUrl, 'GET', '/network-service/domains/list', {
    query: { tenantId: TENANT_ID, productModeCode: PROJECT_TYPE, version: PROTOCOL_VERSION },
  });
  const result = checkResponse(resp, 'domains/list');
  const domain = JSON.parse(decrypt(result.domain));
  return {
    appApi: domain.app_api ? 'https://' + domain.app_api : baseUrl,
    mqtt: domain.mqtt || null,
  };
}

async function login(baseUrl, email, password) {
  const registerId = crypto.randomBytes(14).toString('base64url').slice(0, 19);
  const resp = await httpsJson(baseUrl, 'POST', '/user-center/auth/login', {
    body: {
      tenantId: TENANT_ID,
      lang: 'en',
      token: null,
      userId: null,
      password: encrypt(password),
      username: encrypt(email),
      authcode: null,
      projectType: PROJECT_TYPE,
      versionCode: APP_VERSION_CODE,
      versionName: APP_VERSION_NAME,
      phoneBrand: encrypt('xiaomi_mi 9'),
      phoneSys: 1,
      noticeSetting: { andIpad: registerId, android: registerId },
    },
  });
  const result = checkResponse(resp, 'auth/login');
  const data = result.data || result;
  return {
    userId: String(result.id ?? data.id ?? data.userId),
    authToken: data.auth,
    mqttToken: data.emq_token,
  };
}

async function getDevices(appApi, session) {
  const resp = await httpsJson(appApi, 'GET',
    '/smart-home-service/smartHome/user/getDeviceInfoByUserId/' + session.userId,
    { session });
  const result = checkResponse(resp, 'getDeviceInfoByUserId');
  return (Array.isArray(result) ? result : []).map((d) => ({
    sn: d.sn,
    mac: d.mac,
    nickname: d.nickname || d.sn,
    productId: String(d.productId),
    model: PRODUCT_MODELS[String(d.productId)] || String(d.productId),
    online: d.status === 1,
  }));
}

function saveSession(session) {
  try {
    fs.mkdirSync(path.dirname(SESSION_CACHE), { recursive: true });
    fs.writeFileSync(SESSION_CACHE, JSON.stringify(session));
  } catch (err) { console.error(`[Karcher] Could not cache session: ${err.message}`); }
}
function loadSession() {
  try { return JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8')); }
  catch { return null; }
}

// ── MQTT envelope helpers ───────────────────────────────────────────────

function envelope(method, params, version = '3.0') {
  return JSON.stringify({ method, msgId: String(Date.now()), tenantId: TENANT_ID, version, params: params || {} });
}
function deviceTopic(productId, sn, suffix) {
  return `/mqtt/${productId}/${sn}/${suffix}`;
}

// ── KarcherClient ────────────────────────────────────────────────────────

class KarcherClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._devs     = [];
    this._pending  = new Map(); // sn -> {resolve, reject, timer}
    this._timer    = null;
    this._mqtt     = null;
  }

  async start() {
    const cfg = this._config.karcher || {};
    const email    = process.env.KARCHER_EMAIL    || cfg.email;
    const password = process.env.KARCHER_PASSWORD || cfg.password;
    if (!email || !password) throw new Error('karcher.email and karcher.password are required');
    const region  = REGION_URLS[cfg.region] ? cfg.region : 'eu';
    const baseUrl = REGION_URLS[region];

    let session = loadSession();
    let urls;
    try {
      urls = await getUrls(baseUrl);
      if (!session) throw new Error('no cached session');
      await getDevices(urls.appApi, session); // cheap probe — throws if the token's stale
    } catch {
      session = await login(urls?.appApi || baseUrl, email, password);
      urls = urls || await getUrls(baseUrl);
      saveSession(session);
    }
    this._session = session;
    this._urls    = urls;
    if (!urls.mqtt) throw new Error('Kärcher API did not return an MQTT broker address');

    let devices = await getDevices(urls.appApi, session);
    if (cfg.sn) devices = devices.filter((d) => d.sn === cfg.sn);
    if (!devices.length) throw new Error('No Kärcher devices found on the account');

    for (const d of devices) this._devs.push({ ...d, deviceKey: `karcher/${d.sn}` });
    await this._connectMqtt();
    for (const entry of this._devs) this._registerDevice(entry);

    platformStatus.set('karcher', true);
    this._timer = setInterval(() => this._pollAll(), POLL_MS);
    console.log(`[Karcher] Started — ${this._devs.length} device(s) via ${region.toUpperCase()}`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._mqtt) this._mqtt.end(true);
    for (const p of this._pending.values()) { clearTimeout(p.timer); p.reject(new Error('client stopped')); }
    this._pending.clear();
    console.log('[Karcher] Stopped');
  }

  _connectMqtt() {
    // mqtt field from the domains API is "host:port", no scheme — the
    // reference client always connects over TLS with certificate
    // verification disabled (its own unresolved TODO, not a simplification
    // made here); mirrored via rejectUnauthorized:false for compatibility.
    const [host, port] = this._urls.mqtt.split(':');
    const url = `mqtts://${host}:${port || 8883}`;
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, {
        username: this._session.userId,
        password: this._session.mqttToken,
        protocolVersion: 4,
        keepalive: 60,
        reconnectPeriod: 5000,
        rejectUnauthorized: false,
        clientId: this._session.userId + '_' + crypto.randomBytes(8).toString('hex'),
      });
      this._mqtt = client;
      let settled = false;

      client.on('connect', () => {
        for (const d of this._devs) {
          client.subscribe([
            deviceTopic(d.productId, d.sn, 'thing/service/property/get_reply'),
            deviceTopic(d.productId, d.sn, 'thing/event/property/post'),
          ], (err) => { if (err) console.error(`[Karcher] Subscribe failed for ${d.nickname}: ${err.message}`); });
        }
        if (!settled) { settled = true; resolve(); }
        setTimeout(() => this._pollAll(), 1500);
      });
      client.on('message', (topic, payload) => this._onMessage(topic, payload));
      client.on('error', (err) => {
        console.error(`[Karcher] MQTT error: ${err.message}`);
        if (!settled) { settled = true; reject(err); }
      });
      client.on('close', () => platformStatus.set('karcher', false));
      setTimeout(() => { if (!settled) { settled = true; reject(new Error('MQTT connect timeout')); } }, 20000);
    });
  }

  _deviceForTopic(topic) {
    return this._devs.find((d) => topic.includes(`/${d.productId}/${d.sn}/`));
  }

  _onMessage(topic, payload) {
    const dev = this._deviceForTopic(topic);
    if (!dev) return;
    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
    const data = msg?.data || msg?.params;
    if (!data || typeof data !== 'object') return;
    this._applyProperties(dev, data);

    const pend = this._pending.get(dev.sn);
    if (pend && topic.endsWith('get_reply')) {
      clearTimeout(pend.timer);
      this._pending.delete(dev.sn);
      pend.resolve();
    }
  }

  _registerDevice(entry) {
    this._registry.registerDevice({
      key:   entry.deviceKey,
      type:  'karcher',
      label: entry.nickname,
      icon:  '🧹',
      color: 'blue',
      sensors: [
        { path: 'battery',       name: 'Battery',        format: 'percent', unit: '%', homekit: 'battery-level' },
        { path: 'state',         name: 'State',          format: 'string',  raw: true },
        { path: 'fault',         name: 'Fault',          format: 'string',  raw: true },
        { path: 'cleaning_time', name: 'Cleaning time',  format: 'number',  unit: 'min' },
        { path: 'cleaning_area', name: 'Cleaning area',  format: 'number',  unit: 'm²' },
        {
          path: 'cleaning',  name: 'Cleaning', format: 'on-off',
          controllable: true, type: 'toggle',  homekit: 'switch-rw',
          writeOn: 'start',   writeOff: 'dock', capabilityId: 'cleaning',
        },
        {
          path: 'pause', name: 'Pause cleaning', type: 'trigger',
          controllable: true, capabilityId: 'pause', writeOn: 'pause',
        },
        {
          path: 'dock', name: 'Return to base', type: 'trigger',
          controllable: true, capabilityId: 'dock', writeOn: 'dock',
        },
        {
          path: 'locate', name: 'Find robot', type: 'trigger',
          controllable: true, capabilityId: 'locate', writeOn: 'locate',
        },
        {
          path: 'fan', name: 'Fan speed', type: 'range', format: 'karcher-fan',
          controllable: true, min: 0, max: FAN_LEVELS.length - 1,
          capabilityId: 'fan', writeCmd: 'setFan',
        },
        {
          path: 'clean_mode', name: 'Cleaning mode', type: 'range', format: 'karcher-clean-mode',
          controllable: true, min: 0, max: CLEAN_MODES.length - 1,
          capabilityId: 'clean_mode', writeCmd: 'setCleanMode',
        },
      ],
      homekit: ['battery-level', 'switch-rw'],
      _writeCapability: (capId, command, args = []) => this._writeCap(entry, capId, command, args),
    });
    console.log(`[Karcher] Registered ${entry.nickname} (${entry.model}, ${entry.sn})`);
  }

  _applyProperties(dev, data) {
    const k = dev.deviceKey;
    dev._props = { ...dev._props, ...data };
    const p = dev._props;

    if ('quantity' in data) this._store.update(`${k}/battery`, Number(p.quantity) || 0);
    if ('work_mode' in data || 'charge_state' in data) {
      this._store.update(`${k}/state`, stateLabel(Number(p.work_mode), !!Number(p.charge_state)));
      this._store.update(`${k}/cleaning`, WORK_MODE_CLEANING.has(Number(p.work_mode)) ? 1 : 0);
    }
    if ('fault' in data) this._store.update(`${k}/fault`, Number(p.fault) ? `Code ${p.fault}` : 'None');
    if ('cleaning_time' in data) this._store.update(`${k}/cleaning_time`, Math.round((Number(p.cleaning_time) || 0) / 60));
    if ('cleaning_area' in data) this._store.update(`${k}/cleaning_area`, Number(p.cleaning_area) || 0);
    if ('wind' in data) {
      const idx = Number(p.wind);
      if (idx >= 0 && idx < FAN_LEVELS.length) this._store.update(`${k}/fan`, idx);
    }
    if ('mode' in data) {
      const idx = Number(p.mode);
      if (idx >= 0 && idx < CLEAN_MODES.length) this._store.update(`${k}/clean_mode`, idx);
    }
  }

  _requestPropertyUpdate(dev) {
    if (!this._mqtt || !this._mqtt.connected) return;
    this._mqtt.publish(
      deviceTopic(dev.productId, dev.sn, 'thing/service/property/get'),
      envelope('prop.get', { property: ROBOT_PROPERTIES }, '3.0'));
  }

  async _pollAll() {
    await Promise.allSettled(this._devs.map((d) => this._poll(d)));
  }

  _poll(dev) {
    return new Promise((resolve) => {
      if (!this._mqtt || !this._mqtt.connected) return resolve();
      const timer = setTimeout(() => { this._pending.delete(dev.sn); resolve(); }, CMD_TIMEOUT);
      this._pending.set(dev.sn, { resolve, reject: resolve, timer });
      this._requestPropertyUpdate(dev);
    });
  }

  _sendCommand(dev, service, params = {}) {
    if (!this._mqtt || !this._mqtt.connected) throw new Error('MQTT not connected');
    this._mqtt.publish(
      deviceTopic(dev.productId, dev.sn, `thing/service_invoke/${service}`),
      envelope(`service.${service}`, params, '3.0'));
  }

  _setProperty(dev, params) {
    if (!this._mqtt || !this._mqtt.connected) throw new Error('MQTT not connected');
    this._mqtt.publish(
      deviceTopic(dev.productId, dev.sn, 'thing/service/property/set'),
      envelope('prop.set', params, '1.0'));
  }

  // Dispatch a controllable write — mirrors roborock-cloud-client.js's _writeCap shape.
  async _writeCap(dev, capId, command, args = []) {
    try {
      if (capId === 'cleaning') {
        if (command === 'start') this._sendCommand(dev, 'set_room_clean', { room_ids: [], ctrl_value: 1, clean_type: 0 });
        else if (command === 'dock') this._sendCommand(dev, 'start_recharge', {});
        return;
      }
      if (capId === 'pause') {
        this._sendCommand(dev, 'set_room_clean', { room_ids: [], ctrl_value: 2, clean_type: 0 });
        return;
      }
      if (capId === 'dock') {
        this._sendCommand(dev, 'start_recharge', {});
        return;
      }
      if (capId === 'locate') {
        this._sendCommand(dev, 'find_device', {});
        return;
      }
      if (capId === 'fan') {
        const idx = Math.max(0, Math.min(FAN_LEVELS.length - 1, Math.round(Number(args[0]) || 0)));
        this._setProperty(dev, { wind: idx });
        this._store.update(`${dev.deviceKey}/fan`, idx);
        return;
      }
      if (capId === 'clean_mode') {
        const idx = Math.max(0, Math.min(CLEAN_MODES.length - 1, Math.round(Number(args[0]) || 0)));
        this._setProperty(dev, { mode: idx });
        this._store.update(`${dev.deviceKey}/clean_mode`, idx);
        return;
      }
    } catch (err) {
      console.error(`[Karcher] Command "${capId}"/"${command}" failed for ${dev.nickname}: ${err.message}`);
    }
    setTimeout(() => this._poll(dev), 2000);
  }
}

module.exports = KarcherClient;
module.exports.login = login;
module.exports.getUrls = getUrls;
module.exports.getDevices = getDevices;
module.exports.saveSession = saveSession;
module.exports.REGION_URLS = REGION_URLS;

// ── CLI self-test: `node src/karcher-client.js` lists devices ─────────────
if (require.main === module) {
  const readline = require('readline');
  const ask = (q, hidden = false) => new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      const mute = () => { readline.moveCursor(process.stdout, -100, 0); readline.clearLine(process.stdout, 1); process.stdout.write(q); };
      process.stdin.on('data', mute);
      rl.question(q, (a) => { process.stdin.removeListener('data', mute); rl.close(); process.stdout.write('\n'); res(a); });
    } else rl.question(q, (a) => { rl.close(); res(a); });
  });
  (async () => {
    const email    = process.env.KARCHER_EMAIL    || await ask('Kärcher email: ');
    const password = process.env.KARCHER_PASSWORD || await ask('Kärcher password (hidden): ', true);
    const region   = (process.env.KARCHER_REGION || await ask('Region [eu/us/cn] (default eu): ') || 'eu').trim();
    const baseUrl  = REGION_URLS[region] || REGION_URLS.eu;
    process.stdout.write('\nLogging in…\n');
    try {
      const urls = await getUrls(baseUrl);
      const session = await login(urls.appApi, email.trim(), password);
      const devices = await getDevices(urls.appApi, session);
      console.log(`\n✓ Login OK. MQTT broker: ${urls.mqtt}`);
      console.log(`\nFound ${devices.length} device(s):\n`);
      for (const d of devices) {
        console.log(`  • ${d.nickname}`);
        console.log(`      model:  ${d.model}`);
        console.log(`      sn:     ${d.sn}`);
        console.log(`      online: ${d.online}`);
        console.log('');
      }
      console.log('Add to config.json:  "karcher": { "email": "<you>", "password": "<pw>", "region": "' + region + '" }');
      if (devices.length > 1) console.log('(optionally add "sn":"<one of the above>" to pick a single robot)');
      process.exit(0);
    } catch (e) {
      console.error(`\n✗ ${e.message}`);
      process.exit(1);
    }
  })();
}
