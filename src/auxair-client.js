'use strict';

const https  = require('https');
const crypto = require('crypto');

const BASE_HOSTS = {
  eu:  'app-service-deu-f0e9ebbb.smarthomecs.de',
  usa: 'app-service-usa-fd7cc04c.smarthomecs.com',
  cn:  'app-service-chn-31a93883.ibroadlink.com',
  rus: 'app-service-rus-b8bbc3be.smarthomecs.com',
};

const LICENSE_ID = '3c015b249dd66ef0f11f9bef59ecd737';
const COMPANY_ID = '48eb1b36cf0202ab2ef07b880ecda60d';
const LICENSE    = 'PAFbJJ3WbvDxH5vvWezXN5BujETtH/iuTtIIW5CE/SeHN7oNKqnEajgljTcL0fBQ';
const PW_SALT    = '4969fj#k23#';
const BODY_KEY   = 'xgx3d*fe3478$ukx';
const TS_KEY     = 'kdixkdqp54545^#*';
// IV bytes: [-22,-86,-86,58,-69,88,98,-94,25,24,-75,119,29,22,21,-86] each +256
const AES_IV     = Buffer.from([234, 170, 170, 58, 187, 88, 98, 162, 25, 24, 181, 119, 29, 22, 21, 170]);

const AC_MODES  = ['cool', 'heat', 'dry', 'fan', 'auto'];
const FAN_NAMES = ['auto', 'low', 'med', 'high', 'turbo', 'mute'];

function sha1Hex(str)  { return crypto.createHash('sha1').update(str).digest('hex'); }
function md5Hex(str)   { return crypto.createHash('md5').update(str).digest('hex'); }
function md5Bytes(str) { return crypto.createHash('md5').update(str).digest(); }

function aesEncrypt(key16, plaintext) {
  const len = Buffer.byteLength(plaintext, 'utf8');
  const pad = len % 16 === 0 ? 0 : 16 - (len % 16);
  const buf = Buffer.alloc(len + pad, 0);
  buf.write(plaintext, 0, len, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key16, AES_IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(buf), cipher.final()]);
}

class AuxAirClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._host     = BASE_HOSTS[(config.auxair?.region || 'eu').toLowerCase()] || BASE_HOSTS.eu;
    this._session  = null;
    this._devices  = [];
    this._timer    = null;
  }

  async start() {
    await this._login();
    const families = await this._getFamilies();
    for (const f of families) {
      const devs = await this._getDevices(f.familyid);
      this._devices.push(...devs);
    }
    console.log(`[AuxAir] Found ${this._devices.length} device(s)`);
    if (!this._devices.length) return;
    await this._poll();
    const interval = (this._config.auxair?.pollInterval || 30) * 1000;
    this._timer = setInterval(() => this._poll(), interval);
    console.log(`[AuxAir] Started — polling every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async _login() {
    const cfg    = this._config.auxair;
    const sha_pw = sha1Hex(cfg.password + PW_SALT);
    const ts     = String(Date.now());
    const payload = JSON.stringify({
      email: cfg.email, password: sha_pw, companyid: COMPANY_ID, lid: LICENSE_ID,
    });
    const token  = md5Hex(payload + BODY_KEY);
    const aesKey = md5Bytes(ts + TS_KEY);
    const body   = aesEncrypt(aesKey, payload);

    const res = await this._req('POST', '/account/login', body, { timestamp: ts, token });
    if (res.status !== 0) throw new Error(`Login failed: status=${res.status}`);
    this._session = { loginsession: res.loginsession, userid: res.userid };
    console.log('[AuxAir] Login OK');
  }

  async _getFamilies() {
    const res = await this._req('POST', '/appsync/group/member/getfamilylist', '{}');
    return res.data?.familyList || [];
  }

  async _getDevices(familyId) {
    const res = await this._req('POST', '/appsync/group/dev/query?action=select',
      JSON.stringify({ pids: [] }), { familyid: familyId });
    return res.data?.endpoints || [];
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  async _poll() {
    for (const dev of this._devices) {
      try {
        const state = await this._getParams(dev);
        this._syncDevice(dev, state);
      } catch (err) {
        console.error(`[AuxAir] Poll error (${dev.endpointId}): ${err.message}`);
      }
    }
  }

  async _getParams(dev) {
    const ts    = String(Date.now());
    const body  = JSON.stringify({
      directive: {
        header: {
          namespace: 'DNA.KeyValueControl', name: 'KeyValueControl',
          interfaceVersion: '2', senderId: 'sdk',
          messageId: `${dev.endpointId}-${ts}`, timstamp: ts,
        },
        endpoint: {
          devicePairedInfo: {
            did: dev.endpointId, pid: dev.productId, mac: dev.mac,
            devicetypeflag: dev.devicetypeFlag, cookie: this._buildCookie(dev),
          },
          endpointId: dev.endpointId, cookie: {}, devSession: dev.devSession,
        },
        payload: { act: 'get', params: [], vals: [[{ val: 0, idx: 1 }]], did: dev.endpointId },
      },
    });
    const res = await this._req('POST', `/device/control/v2/sdkcontrol?license=${LICENSE}`, body);
    return JSON.parse(res.event?.payload?.data || '{}');
  }

  async _setParam(dev, param, value) {
    const ts   = String(Date.now());
    const body = JSON.stringify({
      directive: {
        header: {
          namespace: 'DNA.KeyValueControl', name: 'KeyValueControl',
          interfaceVersion: '2', senderId: 'sdk',
          messageId: `${dev.endpointId}-${ts}`, timstamp: ts,
        },
        endpoint: {
          devicePairedInfo: {
            did: dev.endpointId, pid: dev.productId, mac: dev.mac,
            devicetypeflag: dev.devicetypeFlag, cookie: this._buildCookie(dev),
          },
          endpointId: dev.endpointId, cookie: {}, devSession: dev.devSession,
        },
        payload: { act: 'set', params: [param], vals: [[{ idx: 1, val: value }]], did: dev.endpointId },
      },
    });
    await this._req('POST', `/device/control/v2/sdkcontrol?license=${LICENSE}`, body);
  }

  _buildCookie(dev) {
    const raw = JSON.parse(Buffer.from(dev.cookie, 'base64').toString('utf8'));
    return Buffer.from(JSON.stringify({
      device: {
        id: raw.terminalid, key: raw.aeskey, devSession: dev.devSession,
        aeskey: raw.aeskey, did: dev.endpointId, pid: dev.productId, mac: dev.mac,
      },
    })).toString('base64');
  }

  // ── Store / Registry ──────────────────────────────────────────────────────

  _syncDevice(dev, state) {
    const storeKey = `auxair/${dev.endpointId}`;
    if (!this._registry.getDevice(storeKey)) this._registerDevice(dev, storeKey);

    if (state.pwr     != null) this._store.update(`${storeKey}/pwr`,     state.pwr);
    if (state.ac_mode != null) this._store.update(`${storeKey}/ac_mode`, state.ac_mode);
    if (state.temp    != null) this._store.update(`${storeKey}/temp`,    state.temp / 10);
    if (state.envtemp != null) this._store.update(`${storeKey}/envtemp`, state.envtemp / 10);
    if (state.ac_mark != null) this._store.update(`${storeKey}/ac_mark`, state.ac_mark);
  }

  _registerDevice(dev, storeKey) {
    const device = {
      key:     storeKey,
      label:   dev.name || `AC ${dev.endpointId}`,
      type:    'auxair',
      homekit: [],
      sensors: [
        { path: 'pwr',     name: 'Power',    type: 'boolean', controllable: true, capabilityId: 'pwr',     writeOn: 'on', writeOff: 'off' },
        { path: 'temp',    name: 'Set Temp', type: 'range',   controllable: true, capabilityId: 'temp',    writeCmd: 'setTemp', min: 16, max: 30, unit: '°C' },
        { path: 'envtemp', name: 'Room',     type: 'number',  unit: '°C' },
        { path: 'ac_mode', name: 'Mode',     type: 'range',   controllable: true, capabilityId: 'ac_mode', writeCmd: 'setMode', min: 0, max: 4 },
        { path: 'ac_mark', name: 'Fan',      type: 'range',   controllable: true, capabilityId: 'ac_mark', writeCmd: 'setFan',  min: 0, max: 5 },
      ],
      _writeCapability: async (capId, command, args = []) => {
        const val = Array.isArray(args) && args.length ? Number(args[0]) : (command === 'on' ? 1 : 0);
        if      (capId === 'pwr')     await this._setParam(dev, 'pwr',     command === 'on' ? 1 : command === 'off' ? 0 : val);
        else if (capId === 'temp')    await this._setParam(dev, 'temp',    Math.round(val * 10));
        else if (capId === 'ac_mode') await this._setParam(dev, 'ac_mode', val);
        else if (capId === 'ac_mark') await this._setParam(dev, 'ac_mark', val);
        // Refresh state after command
        setTimeout(() => this._poll(), 1500);
      },
    };
    this._registry.registerDevice(device);
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  _headers(extra = {}) {
    const sess = this._session || {};
    return {
      'Content-Type': 'application/x-java-serialized-object',
      licenseId:      LICENSE_ID,
      lid:            LICENSE_ID,
      language:       'en',
      appVersion:     '2.2.10.456537160',
      'User-Agent':   'Dalvik/2.1.0 (Linux; U; Android 12; SM-G991B Build/SP1A.210812.016)',
      system:         'android',
      appPlatform:    'android',
      loginsession:   sess.loginsession || '',
      userid:         sess.userid       || '',
      ...extra,
    };
  }

  _req(method, path, body = '', extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      const headers = { ...this._headers(extraHeaders), 'Content-Length': bodyBuf.length };
      const req = https.request({ hostname: this._host, port: 443, path, method, headers, timeout: 12_000 }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error(`Bad JSON from ${path}: ${text.slice(0, 120)}`)); }
        });
      });
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${path}`)); });
      req.write(bodyBuf);
      req.end();
    });
  }
}

module.exports = AuxAirClient;
module.exports.AC_MODES  = AC_MODES;
module.exports.FAN_NAMES = FAN_NAMES;
