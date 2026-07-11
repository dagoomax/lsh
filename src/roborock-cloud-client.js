'use strict';

/*
 * Roborock cloud client (MQTT transport) for Roborock-app-only devices such as
 * the Q Revo, which use Roborock's own protocol rather than the Xiaomi miio
 * protocol handled by roborock-client.js.
 *
 * Flow:  cloud login (email/password) → home data (Hawk-signed) → connect to
 * Roborock's MQTT broker → poll get_status / send start·dock·pause commands.
 *
 * Protocol details ported from the authoritative python-roborock reference
 * (v1 message codec, MQTT credential derivation, Hawk auth).
 */

const crypto         = require('crypto');
const https          = require('https');
const zlib           = require('zlib');
const fs             = require('fs');
const path           = require('path');
const mqtt           = require('mqtt');
const platformStatus = require('./platform-status');

const USERDATA_CACHE = path.join(__dirname, '..', 'persist', 'roborock-userdata.json');
const DEVICEID_CACHE = path.join(__dirname, '..', 'persist', 'roborock-deviceid.txt');

const SALT      = 'TXdfu$jyZ#TZHsg4';
const BASE_URLS = [
  'https://usiot.roborock.com',
  'https://euiot.roborock.com',
  'https://cniot.roborock.com',
  'https://ruiot.roborock.com',
];
const POLL_MS       = 30_000;
const CMD_TIMEOUT   = 10_000;
const RPC_REQUEST   = 101;
const RPC_RESPONSE  = 102;
const MAP_RESPONSE  = 301;
const MAP_TIMEOUT   = 15_000;

// Roborock/miio status + error code maps (identical code space to roborock-client.js).
const STATE = {
  1:  'Starting',     2:  'Idle',          3:  'Idle',
  4:  'Remote ctrl',  5:  'Cleaning',       6:  'Returning',
  7:  'Manual',       8:  'Charging',       9:  'Charge error',
  10: 'Paused',       11: 'Spot cleaning',  12: 'Error',
  13: 'Shutting down',14: 'Updating',       15: 'Docking',
  16: 'Going to target', 17: 'Zone cleaning', 18: 'Room cleaning',
  100: 'Fully charged',
};
const ERROR = {
  0:  'None',         1:  'Laser sensor',   2:  'Collision sensor',
  3:  'Wheel floating', 4: 'Cliff sensor',  5:  'Main brush blocked',
  6:  'Side brush',   7:  'Wheel blocked',  8:  'No dustbox',
  9:  'Dustbox full', 10: 'Filter blocked', 12: 'Low battery',
  13: 'Charging error', 14: 'Battery fault',
};
const CLEANING_STATES = [5, 6, 11, 15, 16, 17, 18];

// ── small crypto/util helpers ────────────────────────────────────────────────
const md5hex  = s => crypto.createHash('md5').update(s).digest('hex');
const md5b    = b => crypto.createHash('md5').update(b).digest();
const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

// timestamp → reordered hex bytes, per Roborock v1 key derivation
function encodeTimestamp(ts) {
  const hex   = ts.toString(16).padStart(8, '0');
  const order = [5, 6, 3, 7, 1, 2, 0, 4];
  return Buffer.from(order.map(i => hex[i]).join(''), 'utf8');
}
function v1Key(localKey, timestamp) {
  return md5b(Buffer.concat([encodeTimestamp(timestamp), Buffer.from(localKey, 'utf8'), Buffer.from(SALT, 'utf8')]));
}
function encryptEcb(plain, key) {
  const c = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([c.update(plain), c.final()]);
}
function decryptEcb(enc, key) {
  const d = crypto.createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([d.update(enc), d.final()]);
}
// AES-128-CBC with a zero IV — used to decrypt map (301) payloads keyed by the
// request's 16-byte security nonce.
function decryptCbc(enc, key16) {
  for (const pad of [true, false]) {
    try {
      const d = crypto.createDecipheriv('aes-128-cbc', key16, Buffer.alloc(16));
      d.setAutoPadding(pad);
      return Buffer.concat([d.update(enc), d.final()]);
    } catch (e) { if (pad === false) throw e; }
  }
}

// ── v1 message framing (MQTT, non-prefixed) ──────────────────────────────────
function buildV1Message({ version, seq, random, timestamp, protocol, payload }, localKey) {
  const enc  = payload && payload.length ? encryptEcb(payload, v1Key(localKey, timestamp)) : Buffer.alloc(0);
  const head = Buffer.alloc(17);
  Buffer.from(version, 'utf8').copy(head, 0);       // "1.0"
  head.writeUInt32BE(seq >>> 0, 3);
  head.writeUInt32BE(random >>> 0, 7);
  head.writeUInt32BE(timestamp >>> 0, 11);
  head.writeUInt16BE(protocol, 15);
  const lenBuf = Buffer.alloc(2); lenBuf.writeUInt16BE(enc.length, 0);
  const body = Buffer.concat([head, lenBuf, enc]);
  const crc  = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
  return Buffer.concat([body, crc]);
}

function parseV1Messages(buf, localKey) {
  const out = [];
  let off = 0;
  while (off + 19 <= buf.length) {
    const version = buf.slice(off, off + 3).toString('utf8');
    if (!['1.0', 'A01', 'B01', 'L01'].includes(version)) break;
    const seq       = buf.readUInt32BE(off + 3);
    const random    = buf.readUInt32BE(off + 7);
    const timestamp = buf.readUInt32BE(off + 11);
    const protocol  = buf.readUInt16BE(off + 15);
    const len       = buf.readUInt16BE(off + 17);
    if (off + 19 + len + 4 > buf.length) break;
    const enc     = buf.slice(off + 19, off + 19 + len);
    let payload   = Buffer.alloc(0);
    try { payload = len ? decryptEcb(enc, v1Key(localKey, timestamp)) : Buffer.alloc(0); }
    catch { /* undecryptable frame — skip payload */ }
    out.push({ version, seq, random, timestamp, protocol, payload });
    off += 19 + len + 4;
  }
  return out;
}

// ── HTTPS JSON helper ─────────────────────────────────────────────────────────
function httpJson(method, base, path, { params, headers } = {}) {
  const url = new URL(base.replace(/\/+$/, '') + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method, hostname: url.hostname, path: url.pathname + url.search, headers: headers || {}, timeout: 15000 },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(`Bad JSON from ${path}: ${d.slice(0, 200)}`)); } });
      });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`Timeout contacting ${url.hostname}`)); });
    req.end();
  });
}

// ── Roborock cloud login + home data ─────────────────────────────────────────
function headerClientId(email, deviceId) {
  return md5b(Buffer.concat([Buffer.from(email, 'utf8'), Buffer.from(deviceId, 'utf8')])).toString('base64');
}

function hawkAuth(rriot, path) {
  const ts    = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(6).toString('base64url');
  const prestr = [rriot.u, rriot.s, nonce, String(ts), md5hex(path), '', ''].join(':');
  const mac    = crypto.createHmac('sha256', rriot.h).update(prestr).digest('base64');
  return `Hawk id="${rriot.u}",s="${rriot.s}",ts="${ts}",nonce="${nonce}",mac="${mac}"`;
}

// Stable per-install device id — MUST be identical between sendEmailCode and
// codeLogin, otherwise Roborock rejects the code (2018). Persisted to disk so it
// survives across separate process invocations.
function getDeviceId() {
  try { const id = fs.readFileSync(DEVICEID_CACHE, 'utf8').trim(); if (id) return id; } catch { /* generate below */ }
  const id = crypto.randomBytes(16).toString('base64url');
  try { fs.mkdirSync(path.dirname(DEVICEID_CACHE), { recursive: true }); fs.writeFileSync(DEVICEID_CACHE, id); } catch { /* non-fatal */ }
  return id;
}
function clientIdFor(email) {
  return headerClientId(email, getDeviceId());
}

// Resolve the account's regional base URL (usiot/euiot/…).
async function resolveBaseUrl(email) {
  let lastMsg = '';
  for (const iot of BASE_URLS) {
    let r;
    try { r = await httpJson('POST', iot, '/api/v1/getUrlByEmail', { params: { email, needtwostepauth: 'false' } }); }
    catch (e) { lastMsg = e.message; continue; }
    if (r && r.code === 200 && r.data && r.data.url) return r.data.url;
    lastMsg = r ? `${r.msg} (code ${r.code})` : lastMsg;
    if (r && (r.code === 2003 || r.code === 1001)) throw new Error(`Login lookup failed: ${lastMsg}`);
  }
  throw new Error(`Could not resolve Roborock server for ${email}: ${lastMsg || 'no response'}`);
}

// Password login → userData (may fail with code 70016 if the account requires code login).
async function passwordLogin(email, password) {
  const clientId = clientIdFor(email);
  const baseUrl  = await resolveBaseUrl(email);
  const login = await httpJson('POST', baseUrl, '/api/v1/login', {
    params: { username: email, password, needtwostepauth: 'false' },
    headers: { header_clientid: clientId },
  });
  if (!login || login.code !== 200 || !login.data) {
    throw new Error(`Roborock login failed: ${login ? `${login.msg} (code ${login.code})` : 'no response'}`);
  }
  return login.data;
}

// Email-code login (Roborock's current default). Step 1: send code to inbox.
async function sendEmailCode(email) {
  const clientId = clientIdFor(email);
  const baseUrl  = await resolveBaseUrl(email);
  const r = await httpJson('POST', baseUrl, '/api/v1/sendEmailCode', {
    params: { username: email, type: 'auth' },
    headers: { header_clientid: clientId },
  });
  if (!r || r.code !== 200) {
    if (r && r.code === 2008) throw new Error('Account does not exist for password/email login — it may be an Apple/Google/Xiaomi SSO account (no email-code path).');
    if (r && r.code === 9002) throw new Error('Too many code requests — wait and try again later.');
    throw new Error(`Send code failed: ${r ? `${r.msg} (code ${r.code})` : 'no response'}`);
  }
  return true;
}

// Step 2: exchange the emailed code for userData.
async function codeLogin(email, code) {
  const clientId = clientIdFor(email);
  const baseUrl  = await resolveBaseUrl(email);
  const r = await httpJson('POST', baseUrl, '/api/v1/loginWithCode', {
    params: { username: email, verifycode: code, verifycodetype: 'AUTH_EMAIL_CODE' },
    headers: { header_clientid: clientId },
  });
  if (!r || r.code !== 200 || !r.data) {
    throw new Error(`Code login failed: ${r ? `${r.msg} (code ${r.code})` : 'no response'}`);
  }
  return r.data;
}

// Given a userData session, fetch home id + Hawk-signed home data → devices.
async function fetchHomeDevices(email, userData) {
  const rriot = userData.rriot;
  if (!rriot || !rriot.r || !rriot.r.m) throw new Error('User data missing rriot/MQTT info');
  const clientId = clientIdFor(email);
  const baseUrl  = await resolveBaseUrl(email);
  const homeDetail = await httpJson('GET', baseUrl, '/api/v1/getHomeDetail', {
    headers: { header_clientid: clientId, Authorization: userData.token },
  });
  if (!homeDetail || homeDetail.code !== 200 || !homeDetail.data) {
    throw new Error(`getHomeDetail failed: ${homeDetail ? `${homeDetail.msg} (code ${homeDetail.code})` : 'no response'}`);
  }
  const homeId = homeDetail.data.rrHomeId;
  const p      = `/user/homes/${homeId}`;
  const home   = await httpJson('GET', rriot.r.a, p, { headers: { Authorization: hawkAuth(rriot, p) } });
  if (!home || !home.success || !home.result) throw new Error(`Home data failed: ${JSON.stringify(home).slice(0, 200)}`);

  const products = new Map((home.result.products || []).map(x => [x.id, x]));
  return [...(home.result.devices || []), ...(home.result.receivedDevices || [])].map(d => ({
    duid:     d.duid,
    name:     d.name,
    localKey: d.localKey,
    pv:       d.pv,
    online:   d.online,
    model:    products.get(d.productId)?.model || d.productId || 'unknown',
  }));
}

// Password login + device fetch (used by the CLI self-test and API test route).
async function roborockLogin(email, password) {
  const userData = await passwordLogin(email, password);
  const devices  = await fetchHomeDevices(email, userData);
  return { userData, rriot: userData.rriot, devices };
}

// ── cached session (persist/) ────────────────────────────────────────────────
function saveUserData(userData) {
  try {
    fs.mkdirSync(path.dirname(USERDATA_CACHE), { recursive: true });
    fs.writeFileSync(USERDATA_CACHE, JSON.stringify(userData));
  } catch (err) { console.error(`[RoborockCloud] Could not cache session: ${err.message}`); }
}
function loadUserData() {
  try { return JSON.parse(fs.readFileSync(USERDATA_CACHE, 'utf8')); }
  catch { return null; }
}

// mqtt username/password + broker params from rriot
function mqttParams(rriot) {
  const url = new URL(rriot.r.m);
  return {
    host:     url.hostname,
    port:     parseInt(url.port, 10),
    tls:      url.protocol === 'ssl:' || url.protocol === 'mqtts:',
    username: md5hex(`${rriot.u}:${rriot.k}`).slice(2, 10),
    password: md5hex(`${rriot.s}:${rriot.k}`).slice(16),
  };
}

// ── RoborockCloudClient ──────────────────────────────────────────────────────
class RoborockCloudClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._devs      = [];
    this._pending   = new Map();
    this._pendingMap = new Map();
    this._mapCache   = new Map();
    this._timer     = null;
    this._mqtt      = null;
  }

  async start() {
    const cloud = this._config.roborock?.cloud || {};
    const email    = process.env.ROBOROCK_EMAIL    || cloud.email;
    const password = process.env.ROBOROCK_PASSWORD || cloud.password;
    if (!email) throw new Error('roborock.cloud.email is required');

    // Prefer a cached session (from email-code login); fall back to password.
    let userData = loadUserData();
    if (!userData) {
      if (!password) {
        throw new Error('No cached Roborock session and no password set. Run: node scripts/roborock-cloud-auth.js to sign in with an email code.');
      }
      userData = await passwordLogin(email, password);
      saveUserData(userData);
    }

    let devices;
    try {
      devices = await fetchHomeDevices(email, userData);
    } catch (err) {
      // Cached session may be stale — retry once with password if available.
      if (password) {
        console.log(`[RoborockCloud] Cached session failed (${err.message}); re-logging in with password`);
        userData = await passwordLogin(email, password);
        saveUserData(userData);
        devices = await fetchHomeDevices(email, userData);
      } else {
        throw new Error(`${err.message}. Re-run scripts/roborock-cloud-auth.js to refresh the session.`);
      }
    }
    if (!devices.length) throw new Error('No Roborock devices found on the account');

    const rriot = userData.rriot;
    this._rriot   = rriot;
    this._mParams = mqttParams(rriot);
    const filter  = cloud.duid ? devices.filter(d => d.duid === cloud.duid) : devices;
    if (!filter.length) throw new Error(`Configured duid ${cloud.duid} not found on account`);

    for (const d of filter) this._registerDevice(d);
    await this._connectMqtt();

    platformStatus.set('roborock', true);
    this._timer = setInterval(() => this._pollAll(), POLL_MS);
    console.log(`[RoborockCloud] Started — ${this._devs.length} device(s) via ${this._mParams.host}`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._mqtt) this._mqtt.end(true);
    for (const p of this._pending.values()) { clearTimeout(p.timer); p.reject(new Error('client stopped')); }
    this._pending.clear();
    console.log('[RoborockCloud] Stopped');
  }

  _registerDevice(d) {
    const deviceKey = `roborock/${d.duid}`;
    const entry = { ...d, deviceKey };
    this._registry.registerDevice({
      key:   deviceKey,
      type:  'roborock',
      label: d.name,
      icon:  '🤖',
      color: 'blue',
      sensors: [
        { path: 'battery',    name: 'Battery',    format: 'percent', unit: '%', homekit: 'battery-level' },
        { path: 'state',      name: 'State',      format: 'string',  raw: true },
        { path: 'error',      name: 'Error',      format: 'string',  raw: true },
        { path: 'clean_time', name: 'Clean time', format: 'number',  unit: 'min' },
        { path: 'clean_area', name: 'Clean area', format: 'number',  unit: 'm²' },
        {
          path: 'cleaning',  name: 'Cleaning', format: 'on-off',
          controllable: true, type: 'toggle',  homekit: 'switch-rw',
          writeOn: 'start',   writeOff: 'dock', capabilityId: 'cleaning',
        },
      ],
      homekit: ['battery-level', 'switch-rw'],
      _writeCapability: (_capId, command) => this._command(entry, command),
    });
    this._devs.push(entry);
    console.log(`[RoborockCloud] Registered ${d.name} (${d.model}, ${d.duid})`);
  }

  _connectMqtt() {
    const { host, port, tls, username, password } = this._mParams;
    const url = `${tls ? 'mqtts' : 'mqtt'}://${host}:${port}`;
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, {
        username, password,
        protocolVersion: 5,
        keepalive: 60,
        reconnectPeriod: 5000,
        rejectUnauthorized: false,
        clientId: 'lsh_' + crypto.randomBytes(8).toString('hex'),
      });
      this._mqtt = client;
      let settled = false;

      client.on('connect', () => {
        for (const d of this._devs) {
          client.subscribe(`rr/m/o/${this._rriot.u}/${username}/${d.duid}`, err => {
            if (err) console.error(`[RoborockCloud] Subscribe failed for ${d.name}: ${err.message}`);
          });
        }
        if (!settled) { settled = true; resolve(); }
        // Initial poll shortly after connect.
        setTimeout(() => this._pollAll(), 1500);
      });

      client.on('message', (topic, payload) => this._onMessage(topic, payload));
      client.on('error', err => {
        console.error(`[RoborockCloud] MQTT error: ${err.message}`);
        if (!settled) { settled = true; reject(err); }
      });
      client.on('close', () => platformStatus.set('roborock', false));
      setTimeout(() => { if (!settled) { settled = true; reject(new Error('MQTT connect timeout')); } }, 20000);
    });
  }

  _deviceForTopic(topic) {
    return this._devs.find(d => topic.endsWith(`/${d.duid}`));
  }

  _onMessage(topic, payload) {
    const dev = this._deviceForTopic(topic);
    if (!dev) return;
    let messages;
    try { messages = parseV1Messages(payload, dev.localKey); }
    catch (err) { console.error(`[RoborockCloud] Parse error from ${dev.name}: ${err.message}`); return; }

    for (const msg of messages) {
      // Map (301) response: 24-byte header (endpoint[8], _[8], requestId u16 LE, _[6]),
      // then AES-128-CBC(body, key=request nonce) then gzip.
      if (msg.protocol === MAP_RESPONSE && msg.payload && msg.payload.length >= 24) {
        const requestId = msg.payload.readUInt16LE(16);
        const pend = this._pendingMap.get(requestId);
        if (!pend) continue;
        clearTimeout(pend.timer);
        this._pendingMap.delete(requestId);
        try {
          const body = msg.payload.slice(24);
          const raw  = zlib.gunzipSync(decryptCbc(body, pend.nonce));
          pend.resolve(raw);
        } catch (err) { pend.reject(new Error(`Map decode failed: ${err.message}`)); }
        continue;
      }

      if (msg.protocol !== RPC_RESPONSE || !msg.payload || !msg.payload.length) continue;
      let dps;
      try { dps = JSON.parse(msg.payload.toString()).dps; } catch { continue; }
      const raw = dps && dps['102'];
      if (!raw) continue;
      let inner;
      try { inner = JSON.parse(raw); } catch { continue; }
      const pend = this._pending.get(inner.id);
      if (pend) {
        clearTimeout(pend.timer);
        this._pending.delete(inner.id);
        if (inner.error) pend.reject(new Error(typeof inner.error === 'object' ? JSON.stringify(inner.error) : String(inner.error)));
        else pend.resolve(inner.result);
      }
    }
  }

  // Fetch the raw (decrypted, gunzipped) Roborock map blob for a device.
  fetchMap(dev) {
    if (!this._mqtt || !this._mqtt.connected) return Promise.reject(new Error('MQTT not connected'));
    const requestId = randInt(10000, 32767);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce     = crypto.randomBytes(16);
    const endpoint  = md5b(Buffer.from(this._rriot.k, 'utf8')).slice(8, 14).toString('base64');
    const inner = { id: requestId, method: 'get_map_v1', params: [], security: { endpoint, nonce: nonce.toString('hex') } };
    const payload = Buffer.from(JSON.stringify({ dps: { '101': JSON.stringify(inner) }, t: timestamp }));
    const frame = buildV1Message(
      { version: '1.0', seq: randInt(100000, 999999), random: randInt(10000, 99999), timestamp, protocol: RPC_REQUEST, payload },
      dev.localKey);
    const topic = `rr/m/i/${this._rriot.u}/${this._mParams.username}/${dev.duid}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pendingMap.delete(requestId); reject(new Error('Map request timed out')); }, MAP_TIMEOUT);
      this._pendingMap.set(requestId, { resolve, reject, timer, nonce, endpoint });
      this._mqtt.publish(topic, frame, { qos: 1 }, err => {
        if (err) { clearTimeout(timer); this._pendingMap.delete(requestId); reject(err); }
      });
    });
  }

  // Public helpers for the API/dashboard.
  listDevices() { return this._devs.map(d => ({ duid: d.duid, name: d.name, model: d.model })); }
  getDevice(duid) { return this._devs.find(d => d.duid === duid); }

  // Fetch + render a device's map to a PNG, cached briefly to avoid hammering.
  async fetchMapPng(duid) {
    const dev = this.getDevice(duid);
    if (!dev) throw new Error(`Device ${duid} not found`);
    const now = Date.now();
    const cached = this._mapCache.get(duid);
    if (cached && now - cached.t < 5000) return cached.buf;
    const { renderMap } = require('./roborock-map');
    const raw = await this.fetchMap(dev);
    const { buf } = renderMap(raw);
    this._mapCache.set(duid, { t: now, buf });
    return buf;
  }

  _sendCommand(dev, method, params = []) {
    if (!this._mqtt || !this._mqtt.connected) return Promise.reject(new Error('MQTT not connected'));
    const requestId = randInt(10000, 32767);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce     = crypto.randomBytes(16);
    const endpoint  = md5b(Buffer.from(this._rriot.k, 'utf8')).slice(8, 14).toString('base64');
    const inner = { id: requestId, method, params: params || [], security: { endpoint, nonce: nonce.toString('hex') } };
    const payload = Buffer.from(JSON.stringify({ dps: { '101': JSON.stringify(inner) }, t: timestamp }));
    const frame = buildV1Message(
      { version: '1.0', seq: randInt(100000, 999999), random: randInt(10000, 99999), timestamp, protocol: RPC_REQUEST, payload },
      dev.localKey);
    const topic = `rr/m/i/${this._rriot.u}/${this._mParams.username}/${dev.duid}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pending.delete(requestId); reject(new Error(`Command ${method} timed out`)); }, CMD_TIMEOUT);
      this._pending.set(requestId, { resolve, reject, timer });
      this._mqtt.publish(topic, frame, { qos: 1 }, err => {
        if (err) { clearTimeout(timer); this._pending.delete(requestId); reject(err); }
      });
    });
  }

  async _pollAll() {
    await Promise.allSettled(this._devs.map(d => this._poll(d)));
  }

  async _poll(dev) {
    try {
      const result = await this._sendCommand(dev, 'get_status');
      const status = Array.isArray(result) ? result[0] : result;
      if (!status || typeof status !== 'object') return;
      const stateCode = status.state ?? 0;
      const k = dev.deviceKey;
      this._store.update(`${k}/battery`,    status.battery ?? 0);
      this._store.update(`${k}/state`,      STATE[stateCode] ?? `State ${stateCode}`);
      this._store.update(`${k}/error`,      ERROR[status.error_code] ?? `Error ${status.error_code}`);
      this._store.update(`${k}/clean_time`, Math.round((status.clean_time ?? 0) / 60));
      this._store.update(`${k}/clean_area`, Math.round((status.clean_area ?? 0) / 1_000_000));
      this._store.update(`${k}/cleaning`,   CLEANING_STATES.includes(stateCode) ? 1 : 0);
    } catch (err) {
      console.error(`[RoborockCloud] Poll failed for ${dev.name}: ${err.message}`);
    }
  }

  async _command(dev, command) {
    const map = { start: 'app_start', dock: 'app_charge', pause: 'app_pause', stop: 'app_stop' };
    const method = map[command];
    if (!method) return;
    try {
      await this._sendCommand(dev, method);
      setTimeout(() => this._poll(dev), 2000);
    } catch (err) {
      console.error(`[RoborockCloud] Command "${command}" failed for ${dev.name}: ${err.message}`);
    }
  }
}

module.exports = RoborockCloudClient;
module.exports.roborockLogin   = roborockLogin;
module.exports.passwordLogin   = passwordLogin;
module.exports.sendEmailCode   = sendEmailCode;
module.exports.codeLogin       = codeLogin;
module.exports.fetchHomeDevices = fetchHomeDevices;
module.exports.saveUserData    = saveUserData;
module.exports.mqttParams      = mqttParams;

// ── CLI self-test: `node src/roborock-cloud-client.js` lists devices ─────────
if (require.main === module) {
  const readline = require('readline');
  const ask = (q, hidden = false) => new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      const mute = () => { readline.moveCursor(process.stdout, -100, 0); readline.clearLine(process.stdout, 1); process.stdout.write(q); };
      process.stdin.on('data', mute);
      rl.question(q, a => { process.stdin.removeListener('data', mute); rl.close(); process.stdout.write('\n'); res(a); });
    } else rl.question(q, a => { rl.close(); res(a); });
  });
  (async () => {
    const email    = process.env.ROBOROCK_EMAIL    || await ask('Roborock email: ');
    const password = process.env.ROBOROCK_PASSWORD || await ask('Roborock password (hidden): ', true);
    process.stdout.write('\nLogging in…\n');
    try {
      const { devices, rriot } = await roborockLogin(email.trim(), password);
      const p = mqttParams(rriot);
      console.log(`\n✓ Login OK. MQTT broker: ${p.host}:${p.port} (tls=${p.tls})`);
      console.log(`\nFound ${devices.length} device(s):\n`);
      for (const d of devices) {
        console.log(`  • ${d.name}`);
        console.log(`      model:    ${d.model}`);
        console.log(`      duid:     ${d.duid}`);
        console.log(`      pv:       ${d.pv}   online: ${d.online}`);
        console.log(`      localKey: ${d.localKey ? d.localKey.slice(0, 3) + '…' + d.localKey.slice(-2) : '(none)'}`);
        console.log('');
      }
      console.log('Add to config.json:  "roborock": { "cloud": { "email": "<you>", "password": "<pw>" } }');
      if (devices.length > 1) console.log('(optionally add "duid":"<one of the above>" to pick a single device)');
      process.exit(0);
    } catch (e) {
      console.error(`\n✗ ${e.message}`);
      process.exit(1);
    }
  })();
}
