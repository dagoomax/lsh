'use strict';

// Tuya / Smart Life devices (plugs, switches, bulbs, LED strips, dimmers,
// curtain motors, climate and door/motion/leak sensors) — cloud, local, or both.
//
//   config.tuya = {
//     mode: 'auto',            // auto | cloud | local
//     region: 'eu',            // eu | eu-w | us | us-e | cn | in  (Tuya IoT data centre)
//     accessId, accessSecret,  // Tuya IoT Platform cloud project (Authorization Key)
//     uid: '',                 // optional — one linked app account; default: every account linked to the project
//     pollInterval: 30,        // s — cloud status poll for devices not held by a local connection
//     devices: [ { id, key, ip, version, name, dps } ]   // local devices / overrides
//   }
//
// Cloud: the Tuya IoT OpenAPI (iot.tuya.com → Cloud project, "Link Tuya App
// Account" with the Smart Life app). It lists the devices, their data model
// (DP ids, codes, ranges) and — usefully — each device's LAN `local_key`.
//
// Local: tuyapi speaks the LAN protocol (3.1–3.5) straight to the device on
// port 6668. It needs the device id, local key and IP; in auto mode the id and
// key come from the cloud list and the IP from a UDP broadcast find, so the
// cloud is only a fallback once the local link is up. Local-only devices
// (no cloud project) list { id, key, ip, version } here; their DPs are guessed
// from the common Tuya layouts unless `dps` maps them ({ "20": "switch_led" }).
//
// NOTE: written against Tuya's published OpenAPI and the tuyapi LAN library,
// checked with scripts/tuya-simulator.js and unit tests — no real Tuya device
// was on hand. Paths, sign algorithm and DP codes follow Tuya's docs.

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const platformStatus = require('./platform-status');

const REGIONS = {
  eu: 'https://openapi.tuyaeu.com', 'eu-w': 'https://openapi-weaz.tuyaeu.com',
  us: 'https://openapi.tuyaus.com', 'us-e': 'https://openapi-ueaz.tuyaus.com',
  cn: 'https://openapi.tuyacn.com', in: 'https://openapi.tuyain.com',
};

const LIGHT_CATEGORIES = new Set(['dj', 'dd', 'xdd', 'fwd', 'dc', 'tgq', 'tgkg', 'gyd', 'sxd', 'fsd', 'tyndj', 'xxj']);
const COVER_CATEGORIES = new Set(['cl', 'clkg', 'mc', 'ckmkzq']);
const SWITCH_RE = /^(switch(_led)?(_\d+)?|switch_usb\d+)$/;

// ── Cloud: Tuya IoT OpenAPI ───────────────────────────────────────────────────
class TuyaCloud {
  constructor({ accessId, accessSecret, region = 'eu', baseUrl }) {
    this.id = accessId;
    this.secret = accessSecret;
    this.base = baseUrl || REGIONS[region] || REGIONS.eu;
    this._token = null;
    this._tokenExp = 0;
  }

  // Tuya "new signature": HMAC-SHA256 over client_id [+ access_token] + t +
  // nonce + stringToSign, where stringToSign = METHOD \n sha256(body) \n
  // (signed headers, none) \n path?sorted-query.
  static sign({ id, secret, token = '', t, nonce, method, path, body = '' }) {
    const contentHash = crypto.createHash('sha256').update(body).digest('hex');
    const stringToSign = [method.toUpperCase(), contentHash, '', path].join('\n');
    return crypto.createHmac('sha256', secret).update(id + token + t + nonce + stringToSign).digest('hex').toUpperCase();
  }

  async _raw(method, path, body, token) {
    const data = body ? JSON.stringify(body) : '';
    const t = String(Date.now());
    const nonce = crypto.randomUUID();
    const headers = {
      client_id: this.id, t, nonce, sign_method: 'HMAC-SHA256',
      sign: TuyaCloud.sign({ id: this.id, secret: this.secret, token: token || '', t, nonce, method, path, body: data }),
      'Content-Type': 'application/json',
    };
    if (token) headers.access_token = token;
    const json = await requestJson(this.base + path, { method, headers, body: data || undefined });
    if (!json.success) {
      const err = new Error(`Tuya ${json.code}: ${json.msg || 'request failed'}`);
      err.code = json.code;
      throw err;
    }
    return json.result;
  }

  async token(force = false) {
    if (!force && this._token && Date.now() < this._tokenExp) return this._token;
    const r = await this._raw('GET', '/v1.0/token?grant_type=1');
    this._token = r.access_token;
    this._tokenExp = Date.now() + Math.max(60, (r.expire_time || 7200) - 120) * 1000;
    return this._token;
  }

  async request(method, path, body) {
    try {
      return await this._raw(method, path, body, await this.token());
    } catch (err) {
      // 1010 token invalid, 1011 token expired, 1012 status invalid
      if (![1010, 1011, 1012].includes(err.code)) throw err;
      return this._raw(method, path, body, await this.token(true));
    }
  }

  // Every device with its local key, IP, category, online flag and status.
  async devices(uid) {
    if (uid) return (await this.request('GET', `/v1.0/users/${encodeURIComponent(uid)}/devices`)) || [];
    const out = [];
    let rowKey = '';
    for (let page = 0; page < 50; page++) {
      const q = rowKey ? `last_row_key=${encodeURIComponent(rowKey)}&size=100` : 'size=100';
      const r = await this.request('GET', `/v1.0/iot-01/associated-users/devices?${q}`);
      out.push(...(r?.devices || []));
      if (!r?.has_more || !r.last_row_key) break;
      rowKey = r.last_row_key;
    }
    return out;
  }

  // Thing model: DP id (abilityId), code, access mode and type spec per property.
  async model(id) {
    try {
      const r = await this.request('GET', `/v2.0/cloud/thing/${encodeURIComponent(id)}/model`);
      const model = typeof r?.model === 'string' ? JSON.parse(r.model) : r?.model;
      const props = (model?.services || []).flatMap((s) => s.properties || []);
      if (props.length) {
        return props.map((p) => ({
          code: p.code, dpId: p.abilityId != null ? String(p.abilityId) : null,
          rw: p.accessMode !== 'ro', ...typeSpec(p.typeSpec || {}),
        }));
      }
    } catch { /* older projects lack the thing-model API — fall back below */ }
    const spec = await this.request('GET', `/v1.0/iot-03/devices/${encodeURIComponent(id)}/specification`);
    const byCode = new Map();
    for (const [list, rw] of [[spec?.status || [], false], [spec?.functions || [], true]]) {
      for (const f of list) {
        let values = {};
        try { values = typeof f.values === 'string' ? JSON.parse(f.values) : (f.values || {}); } catch { /* keep {} */ }
        const prev = byCode.get(f.code);
        byCode.set(f.code, { code: f.code, dpId: f.dp_id != null ? String(f.dp_id) : prev?.dpId || null,
          rw: rw || prev?.rw || false, ...typeSpec({ ...values, type: normType(f.type) }) });
      }
    }
    return [...byCode.values()];
  }

  async status(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20).map(encodeURIComponent).join(',');
      out.push(...((await this.request('GET', `/v1.0/iot-03/devices/status?device_ids=${chunk}`)) || []));
    }
    return out; // [{ id, status: [{ code, value }] }]
  }

  command(id, commands) {
    return this.request('POST', `/v1.0/iot-03/devices/${encodeURIComponent(id)}/commands`, { commands });
  }
}

function normType(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'boolean' || s === 'bool') return 'bool';
  if (s === 'integer' || s === 'value') return 'value';
  if (s === 'enum') return 'enum';
  if (s === 'json') return 'json';
  return s || 'string';
}
function typeSpec(ts) {
  return {
    type: normType(ts.type), min: num(ts.min, 0), max: num(ts.max, 0), scale: num(ts.scale, 0),
    step: num(ts.step, 1), unit: ts.unit || '', range: Array.isArray(ts.range) ? ts.range : [],
  };
}
const num = (v, d) => (v == null || v === '' || isNaN(Number(v)) ? d : Number(v));

function requestJson(url, { method = 'GET', headers = {}, body, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method, timeout,
      headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers,
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        try { resolve(JSON.parse(out)); }
        catch { reject(new Error(`HTTP ${res.statusCode}: not JSON`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.end(body);
  });
}

// ── Local DP layouts for devices without a cloud model ─────────────────────────
// The common Tuya layouts, picked by the value types the device reports.
function guessProps(dps) {
  const t = (k) => typeof dps[k];
  const P = (dpId, code, type, extra = {}) => ({ dpId: String(dpId), code, type, rw: true, min: 0, max: 0, scale: 0, step: 1, unit: '', range: [], ...extra });
  const props = [];
  if (t('20') === 'boolean' && (t('22') === 'number' || t('24') === 'string')) {            // v2 bulb / strip
    props.push(P(20, 'switch_led', 'bool'), P(21, 'work_mode', 'enum', { range: ['white', 'colour', 'scene', 'music'] }));
    if (t('22') === 'number') props.push(P(22, 'bright_value_v2', 'value', { min: 10, max: 1000 }));
    if (t('23') === 'number') props.push(P(23, 'temp_value_v2', 'value', { max: 1000 }));
    if (t('24') === 'string') props.push(P(24, 'colour_data_v2', 'json'));
    return props;
  }
  if (t('1') === 'boolean' && t('2') === 'string' && ['white', 'colour', 'scene'].includes(dps['2'])) { // v1 bulb
    props.push(P(1, 'switch_led', 'bool'), P(2, 'work_mode', 'enum', { range: ['white', 'colour', 'scene'] }));
    if (t('3') === 'number') props.push(P(3, 'bright_value', 'value', { min: 25, max: 255 }));
    if (t('4') === 'number') props.push(P(4, 'temp_value', 'value', { max: 255 }));
    if (t('5') === 'string') props.push(P(5, 'colour_data', 'json'));
    return props;
  }
  if (t('1') === 'string' && ['open', 'close', 'stop'].includes(dps['1'])) {                // curtain
    props.push(P(1, 'control', 'enum', { range: ['open', 'stop', 'close'] }));
    if (t('2') === 'number') props.push(P(2, 'percent_control', 'value', { max: 100 }));
    if (t('3') === 'number') props.push(P(3, 'percent_state', 'value', { max: 100, rw: false }));
    return props;
  }
  for (const k of Object.keys(dps)) {                                                     // plugs / relays
    const n = Number(k);
    if (t(k) === 'boolean' && n >= 1 && n <= 8) props.push(P(k, n === 1 && !('2' in dps && t('2') === 'boolean') ? 'switch_1' : `switch_${n}`, 'bool'));
  }
  if (t('18') === 'number') props.push(P(18, 'cur_current', 'value', { rw: false, unit: 'mA' }));
  if (t('19') === 'number') props.push(P(19, 'cur_power', 'value', { rw: false, scale: 1, unit: 'W' }));
  if (t('20') === 'number') props.push(P(20, 'cur_voltage', 'value', { rw: false, scale: 1, unit: 'V' }));
  if (t('17') === 'number') props.push(P(17, 'add_ele', 'value', { rw: false, scale: 3, unit: 'kWh' }));
  return props;
}

function propsFromMap(map) {
  return Object.entries(map).map(([dpId, code]) => {
    const c = String(code);
    const base = { dpId: String(dpId), code: c, rw: true, min: 0, max: 0, scale: 0, step: 1, unit: '', range: [] };
    if (SWITCH_RE.test(c)) return { ...base, type: 'bool' };
    if (c === 'bright_value_v2') return { ...base, type: 'value', min: 10, max: 1000 };
    if (c === 'bright_value') return { ...base, type: 'value', min: 25, max: 255 };
    if (c === 'temp_value_v2') return { ...base, type: 'value', max: 1000 };
    if (c === 'temp_value') return { ...base, type: 'value', max: 255 };
    if (c.startsWith('colour_data')) return { ...base, type: 'json' };
    if (c === 'work_mode') return { ...base, type: 'enum', range: ['white', 'colour', 'scene', 'music'] };
    if (c === 'control') return { ...base, type: 'enum', range: ['open', 'stop', 'close'] };
    if (c.startsWith('percent_')) return { ...base, type: 'value', max: 100, rw: c === 'percent_control' };
    return { ...base, type: 'value', rw: false };
  });
}

// ── Colour: cloud sends {h,s,v} JSON; LAN sends hex (v2 HHHHSSSSVVVV, v1 rrggbbHHHHSSVV) ─
function parseColour(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return { h: +value.h || 0, s: +value.s || 0, v: +value.v || 0 };
  const s = String(value);
  if (s.startsWith('{')) { try { const o = JSON.parse(s); return { h: +o.h || 0, s: +o.s || 0, v: +o.v || 0 }; } catch { return null; } }
  if (/^[0-9a-f]{12}$/i.test(s)) return { h: parseInt(s.slice(0, 4), 16), s: parseInt(s.slice(4, 8), 16), v: parseInt(s.slice(8, 12), 16) };
  if (/^[0-9a-f]{14}$/i.test(s)) return { h: parseInt(s.slice(6, 10), 16), s: parseInt(s.slice(10, 12), 16), v: parseInt(s.slice(12, 14), 16) };
  return null;
}
function encodeColour({ h, s, v }, code, local) {
  if (!local) return JSON.stringify({ h, s, v });
  const hx = (n, w) => Math.max(0, Math.round(n)).toString(16).padStart(w, '0');
  if (code === 'colour_data_v2') return hx(h, 4) + hx(s, 4) + hx(v, 4);
  const [r, g, b] = hsvToRgb(h, (s / 255) * 100, (v / 255) * 100);
  return hx(r, 2) + hx(g, 2) + hx(b, 2) + hx(h, 4) + hx(s, 2) + hx(v, 2);
}
function hsvToRgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round((n + m) * 255));
}

// ── DP model → LSH sensors ─────────────────────────────────────────────────────
// Returns { sensors, homekit, kind, roles } where roles names the codes that
// back each control (so reads and writes agree on which DP is which).
function buildModel(props, category = '') {
  const byCode = new Map(props.map((p) => [p.code, p]));
  const has = (c) => byCode.has(c);
  const pick = (...codes) => codes.find(has) || null;
  const roles = {
    bright: pick('bright_value_v2', 'bright_value', 'bright_value_1'),
    temp: pick('temp_value_v2', 'temp_value'),
    colour: pick('colour_data_v2', 'colour_data'),
    mode: pick('work_mode'),
    control: pick('control', 'mach_operate'),
    position: pick('percent_control', 'position'),
    positionState: pick('percent_state', 'percent_control', 'position'),
  };
  const switches = props.filter((p) => p.type === 'bool' && p.rw && SWITCH_RE.test(p.code))
    .sort((a, b) => (a.code === 'switch_led' ? -1 : b.code === 'switch_led' ? 1 : a.code.localeCompare(b.code, 'en', { numeric: true })));
  const isLight = LIGHT_CATEGORIES.has(category) || !!(roles.bright || roles.colour || roles.temp);
  const isCover = COVER_CATEGORIES.has(category) || !!(roles.control && (roles.position || roles.positionState));
  const sensors = [];
  const homekit = [];
  roles.switches = {};

  if (isCover) {
    sensors.push({ path: 'windowShade', name: 'Open', format: 'on-off', controllable: true, type: 'toggle',
      writeOn: 'open', writeOff: 'close', capabilityId: 'windowShade', homekit: 'cover-rw' });
    if (roles.position || roles.positionState) {
      sensors.push({ path: 'level', name: 'Position', format: 'percent', unit: '%', min: 0, max: 100, step: 1,
        controllable: !!roles.position, type: 'range', capabilityId: 'windowShade', writeCmd: 'setLevel' });
    }
    if (roles.control) sensors.push({ path: 'stop', name: 'Stop', hidden: true });
    homekit.push('cover-rw');
  } else if (isLight) {
    const main = switches[0];
    if (main) {
      roles.switches.switch = main.code;
      sensors.push({ path: 'switch', name: 'Power', format: 'on-off', controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off', capabilityId: 'switch', homekit: 'light-rw' });
    }
    if (roles.bright) sensors.push({ path: 'level', name: 'Brightness', format: 'percent', unit: '%', min: 0, max: 100, step: 1,
      controllable: true, type: 'range', capabilityId: 'switchLevel', writeCmd: 'setLevel' });
    if (roles.temp) sensors.push({ path: 'colorTemperature', name: 'Color Temp', format: 'number', unit: 'K', min: 2700, max: 6500, step: 50,
      controllable: true, type: 'color-temp', capabilityId: 'colorTemperature', writeCmd: 'setColorTemperature' });
    if (roles.colour) {
      sensors.push({ path: 'hue', name: 'Hue', format: 'number', hidden: true });
      sensors.push({ path: 'saturation', name: 'Saturation', format: 'number', hidden: true });
      sensors.push({ path: 'color', name: 'Color', format: 'color', controllable: true, type: 'color', capabilityId: 'colorControl' });
    }
    if (main) homekit.push('light-rw');
    switches.slice(1).forEach((p) => {
      roles.switches[p.code] = p.code;
      sensors.push({ path: p.code, name: switchName(p.code), format: 'on-off', controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off', capabilityId: p.code, homekit: 'switch-rw' });
      homekit.push('switch-rw');
    });
  } else {
    switches.forEach((p, i) => {
      const path = i === 0 ? 'switch' : p.code;
      roles.switches[path] = p.code;
      sensors.push({ path, name: switches.length > 1 ? switchName(p.code) : 'Power', format: 'on-off', controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off', capabilityId: path, homekit: 'switch-rw' });
    });
    if (switches.length) homekit.push('switch-rw');
  }

  // Readings — known codes get a proper name, unit and HomeKit service.
  const READINGS = [
    [['cur_power', 'power', 'phase_a_power'], 'power', 'Power', 'W', null],
    [['cur_voltage', 'voltage'], 'voltage', 'Voltage', 'V', null],
    [['cur_current', 'current'], 'current', 'Current', 'mA', null],
    [['add_ele', 'total_forward_energy'], 'energy', 'Energy', 'kWh', null],
    [['va_temperature', 'temp_current', 'temp_indoor', 'temperature'], 'temperature', 'Temperature', '°C', 'temperature'],
    [['va_humidity', 'humidity_value', 'humidity_indoor', 'humidity'], 'humidity', 'Humidity', '%', 'humidity'],
    [['battery_percentage', 'battery_value', 'residual_electricity', 'va_battery'], 'battery', 'Battery', '%', 'battery-level'],
    [['co2_value'], 'co2', 'CO₂', 'ppm', null],
    [['pm25_value'], 'pm25', 'PM2.5', 'µg/m³', null],
    [['bright_value_lux', 'illuminance_value'], 'lux', 'Illuminance', 'lx', 'lux'],
  ];
  roles.readings = {};
  for (const [codes, path, name, unit, hk] of READINGS) {
    const c = codes.find((x) => has(x) && byCode.get(x).type === 'value' && !(roles.bright === x));
    if (!c) continue;
    const p = byCode.get(c);
    roles.readings[path] = c;
    sensors.push({ path, name, unit: p.unit && p.unit !== '' && path !== 'current' ? normUnit(p.unit, unit) : unit,
      format: 'number', ...(hk ? { homekit: hk } : {}) });
    if (hk === 'temperature' || hk === 'humidity') homekit.push(hk);
    if (hk === 'battery-level') homekit.push('battery');
  }
  const BINARY = [
    ['doorcontact_state', 'contact', 'Contact', 'contact', (v) => v === true],
    ['pir', 'motion', 'Motion', 'motion', (v) => v === 'pir' || v === true],
    ['presence_state', 'motion', 'Presence', 'motion', (v) => v === 'presence' || v === true],
    ['watersensor_state', 'leak', 'Leak', 'leak', (v) => v === 'alarm' || v === '1' || v === true],
    ['smoke_sensor_status', 'smoke', 'Smoke', 'smoke', (v) => v === 'alarm' || v === '1' || v === true],
    ['smoke_sensor_state', 'smoke', 'Smoke', 'smoke', (v) => v === 'alarm' || v === '1' || v === true],
  ];
  roles.binary = {};
  for (const [code, path, name, hk, fn] of BINARY) {
    if (!has(code) || roles.binary[path]) continue;
    roles.binary[path] = { code, fn };
    sensors.push({ path, name, format: 'on-off', homekit: hk });
    if (hk === 'contact') homekit.push('contact');
  }
  const kind = isCover ? 'cover' : isLight ? 'light' : switches.length ? 'switch' : 'sensor';
  return { sensors, homekit, kind, roles, byCode };
}
function switchName(code) {
  const usb = /usb(\d+)/.exec(code);
  if (usb) return `USB ${usb[1]}`;
  const n = /_(\d+)$/.exec(code);
  return n ? `Socket ${n[1]}` : 'Power';
}
const normUnit = (u, fallback) => ({ '℃': '°C', 'c': '°C', 'C': '°C' }[u] || u || fallback);

// Tuya ints → LSH values, and back.
const pctOf = (v, p) => (p.max > 0 ? Math.round((Number(v) / p.max) * 100) : Number(v));
const fromPct = (pct, p) => Math.max(p.min || 0, Math.min(p.max, Math.round((pct / 100) * p.max)));
const kelvinOf = (v, p) => Math.round(2700 + (Number(v) / (p.max || 1000)) * 3800);
const fromKelvin = (k, p) => Math.max(0, Math.min(p.max || 1000, Math.round(((Number(k) - 2700) / 3800) * (p.max || 1000))));
const scaled = (v, p) => (p.scale ? Number(v) / 10 ** p.scale : Number(v));

// ── Client ─────────────────────────────────────────────────────────────────────
class TuyaClient {
  constructor(config, store, sensorRegistry) {
    this._cfg = config.tuya || {};
    this._store = store;
    this._registry = sensorRegistry;
    this._mode = ['cloud', 'local'].includes(this._cfg.mode) ? this._cfg.mode : 'auto';
    this._cloud = this._cfg.accessId && this._cfg.accessSecret && this._mode !== 'local' ? new TuyaCloud(this._cfg) : null;
    this._devs = new Map(); // id → { id, name, category, model, props, local, localKey, ip, version, online }
    this._timers = [];
    this._stopped = false;
    this._cloudOk = false;
  }

  async start() {
    platformStatus.set('tuya', false);
    if (this._cloud) {
      try { await this._refreshCloud(); }
      catch (err) { console.error(`[Tuya] Cloud: ${err.message}`); }
      const every = Math.max(10, Number(this._cfg.pollInterval) || 30) * 1000;
      this._timers.push(setInterval(() => this._pollCloud().catch(() => {}), every));
      this._timers.push(setInterval(() => this._refreshCloud().catch((e) => console.error(`[Tuya] Cloud: ${e.message}`)), 10 * 60 * 1000));
    }
    for (const d of this._cfg.devices || []) {
      if (!d?.id) continue;
      const known = this._devs.get(d.id);
      this._devs.set(d.id, { ...known, id: d.id, name: d.name || known?.name || `Tuya ${d.id.slice(-6)}`,
        localKey: d.key || known?.localKey, ip: d.ip || known?.ip, version: d.version || known?.version, dpsMap: d.dps,
        category: known?.category || '', props: known?.props || (d.dps ? propsFromMap(d.dps) : null) });
      if (!known && d.dps) this._register(this._devs.get(d.id));
    }
    if (this._mode !== 'cloud') this._startLocal();
    this._updateStatus();
    console.log(`[Tuya] ${this._devs.size} device(s), mode ${this._mode}${this._cloud ? ', cloud project linked' : ''}`);
  }

  stop() {
    this._stopped = true;
    this._timers.forEach(clearInterval);
    for (const d of this._devs.values()) { clearTimeout(d.retry); try { d.local?.disconnect(); } catch { /* closed */ } }
    platformStatus.set('tuya', false);
  }

  // ── Cloud ──
  async _refreshCloud() {
    const list = await this._cloud.devices(this._cfg.uid);
    for (const c of list) {
      let d = this._devs.get(c.id);
      if (!d) {
        d = { id: c.id, name: c.name || c.product_name || c.id };
        this._devs.set(c.id, d);
      }
      Object.assign(d, { category: c.category || d.category || '', product: c.product_name, online: c.online !== false,
        localKey: d.localKey || c.local_key, cloudName: c.name });
      if (!d.props || d.cloudModel !== true) {
        try { d.props = await this._cloud.model(c.id); d.cloudModel = true; }
        catch (err) { console.error(`[Tuya] Model for ${d.name}: ${err.message}`); continue; }
      }
      if (!d.registered) this._register(d);
      if (Array.isArray(c.status)) this._applyCodes(d, Object.fromEntries(c.status.map((s) => [s.code, s.value])));
      this._store.update(`tuya/${d.id}/online`, d.online ? 1 : 0);
    }
    this._cloudOk = true;
    this._updateStatus();
  }

  async _pollCloud() {
    const ids = [...this._devs.values()].filter((d) => d.registered && d.cloudModel && !d.localUp).map((d) => d.id);
    if (!ids.length) return;
    try {
      for (const r of await this._cloud.status(ids)) {
        const d = this._devs.get(r.id);
        if (d) this._applyCodes(d, Object.fromEntries((r.status || []).map((s) => [s.code, s.value])));
      }
      this._cloudOk = true;
    } catch (err) {
      this._cloudOk = false;
      console.error(`[Tuya] Cloud poll: ${err.message}`);
    }
    this._updateStatus();
  }

  // ── Local ──
  _startLocal() {
    let TuyAPI;
    try { TuyAPI = require('tuyapi'); }
    catch { console.error('[Tuya] Local control needs tuyapi (npm install tuyapi) — using the cloud only'); return; }
    const candidates = [...this._devs.values()].filter((d) => d.localKey);
    // find() binds the UDP broadcast ports, so devices without an IP look up one at a time
    (async () => {
      for (const d of candidates) {
        if (this._stopped) return;
        await this._connectLocal(TuyAPI, d);
      }
    })();
  }

  async _connectLocal(TuyAPI, d) {
    if (this._stopped) return;
    const opts = { id: d.id, key: d.localKey, issueRefreshOnConnect: true };
    if (d.ip) opts.ip = d.ip;
    if (d.version) opts.version = String(d.version);
    const dev = new TuyAPI(opts);
    d.local = dev;
    const retry = (ms) => { clearTimeout(d.retry); d.retry = setTimeout(() => this._connectLocal(TuyAPI, d), ms); };
    dev.on('connected', () => { d.localUp = true; d.backoff = 0; console.log(`[Tuya] ${d.name}: local link up (${dev.device.ip}, v${dev.device.version})`); this._updateStatus(); });
    dev.on('disconnected', () => {
      if (d.localUp) console.log(`[Tuya] ${d.name}: local link down`);
      d.localUp = false; this._updateStatus();
      if (!this._stopped && d.local === dev) retry(Math.min(300000, 10000 * 2 ** (d.backoff = (d.backoff || 0) + 1)));
    });
    dev.on('error', (err) => { if (!d.loggedErr) console.error(`[Tuya] ${d.name}: ${err.message || err}`); d.loggedErr = true; });
    const onDps = (data) => { if (data?.dps) this._applyDps(d, data.dps); };
    dev.on('data', onDps);
    dev.on('dp-refresh', onDps);
    try {
      if (!opts.ip) await dev.find({ timeout: 12 });
      if (opts.version == null && dev.device.version) d.version = dev.device.version;
      await dev.connect();
      d.ip = dev.device.ip;
    } catch (err) {
      if (!d.loggedErr) console.error(`[Tuya] ${d.name}: local ${opts.ip ? 'connect' : 'find'} failed — ${err.message || err}`);
      d.loggedErr = true;
      if (!this._stopped) retry(Math.min(300000, 30000 * 2 ** (d.backoff = (d.backoff || 0) + 1)));
    }
  }

  _applyDps(d, dps) {
    if (!d.props) {
      d.props = d.dpsMap ? propsFromMap(d.dpsMap) : guessProps(dps);
      if (!d.props.length) return;
      this._register(d);
    }
    if (!d.registered) return;
    const codes = {};
    for (const p of d.props) if (p.dpId != null && dps[p.dpId] !== undefined) codes[p.code] = dps[p.dpId];
    d.online = true;
    this._store.update(`tuya/${d.id}/online`, 1);
    this._applyCodes(d, codes);
  }

  // ── Registration and readings ──
  _register(d) {
    const m = buildModel(d.props || [], d.category);
    if (!m.sensors.length) return;
    d.m = m;
    d.registered = true;
    m.sensors.push({ path: 'online', name: 'Online', format: 'on-off', hidden: true });
    this._registry.registerDevice({
      key: `tuya/${d.id}`,
      label: d.name,
      type: 'tuya',
      model: d.product || d.category || 'Tuya',
      icon: { light: '💡', cover: '🪟', sensor: '🌡️' }[m.kind] || '🔌',
      sensors: m.sensors,
      homekit: m.homekit,
      _writeCapability: (capId, command, args = []) => this._write(d, capId, command, args),
    });
    console.log(`[Tuya] Registered ${d.name} (${m.kind}, ${m.sensors.length - 1} sensor(s))`);
  }

  _applyCodes(d, codes) {
    if (!d.m) return;
    const { roles, byCode } = d.m;
    const key = `tuya/${d.id}`;
    d.state = { ...d.state, ...codes };
    const set = (path, v) => { if (v != null && !Number.isNaN(v)) this._store.update(`${key}/${path}`, v); };
    for (const [path, code] of Object.entries(roles.switches)) if (code in codes) set(path, codes[code] ? 1 : 0);
    if (roles.bright && roles.bright in codes) set('level', pctOf(codes[roles.bright], byCode.get(roles.bright)));
    if (roles.temp && roles.temp in codes) set('colorTemperature', kelvinOf(codes[roles.temp], byCode.get(roles.temp)));
    if (roles.colour && roles.colour in codes) {
      const c = parseColour(codes[roles.colour]);
      if (c) {
        const smax = roles.colour === 'colour_data_v2' ? 1000 : 255;
        set('hue', Math.round(c.h / 3.6));
        set('saturation', Math.round((c.s / smax) * 100));
        if (d.state[roles.mode] === 'colour') set('level', Math.round((c.v / smax) * 100));
      }
    }
    if (d.m.kind === 'cover') {
      const pc = roles.positionState && roles.positionState in codes ? Number(codes[roles.positionState]) : null;
      if (pc != null && !Number.isNaN(pc)) { set('level', pc); set('windowShade', pc > 0 ? 1 : 0); }
      else if (roles.control && roles.control in codes && ['open', 'close'].includes(codes[roles.control])) set('windowShade', codes[roles.control] === 'open' ? 1 : 0);
    }
    for (const [path, code] of Object.entries(roles.readings)) if (code in codes) set(path, scaled(codes[code], byCode.get(code)));
    for (const [path, { code, fn }] of Object.entries(roles.binary)) if (code in codes) set(path, fn(codes[code]) ? 1 : 0);
  }

  // ── Control ──
  async _write(d, capId, command, args) {
    const { roles, byCode, kind } = d.m;
    const cmds = {};
    const v0 = args[0];
    const mainSwitch = roles.switches.switch;
    if (capId === 'windowShade') {
      if (command === 'setLevel' || command === 'set') {
        if (roles.position) cmds[roles.position] = Math.max(0, Math.min(100, Math.round(Number(v0))));
        else if (roles.control) cmds[roles.control] = Number(v0) >= 50 ? 'open' : 'close';
      } else if (roles.control) {
        const range = byCode.get(roles.control)?.range || [];
        const want = command === 'stop' ? 'stop' : command === 'open' ? 'open' : 'close';
        cmds[roles.control] = range.length && !range.includes(want) ? ({ open: 'on', close: 'off', stop: 'stop' }[want]) : want;
      }
    } else if (capId === 'switchLevel') {
      const pct = Number(v0) || 0;
      if (pct <= 0) { if (mainSwitch) cmds[mainSwitch] = false; }
      else if (roles.colour && d.state?.[roles.mode] === 'colour') {
        const c = parseColour(d.state[roles.colour]) || { h: 0, s: 0, v: 0 };
        const smax = roles.colour === 'colour_data_v2' ? 1000 : 255;
        cmds[roles.colour] = { ...c, v: Math.max(1, Math.round((pct / 100) * smax)) };
        if (mainSwitch) cmds[mainSwitch] = true;
      } else if (roles.bright) {
        cmds[roles.bright] = fromPct(pct, byCode.get(roles.bright));
        if (mainSwitch) cmds[mainSwitch] = true;
      }
    } else if (capId === 'colorTemperature' && roles.temp) {
      if (roles.mode) cmds[roles.mode] = 'white';
      cmds[roles.temp] = fromKelvin(v0, byCode.get(roles.temp));
      if (mainSwitch) cmds[mainSwitch] = true;
    } else if (capId === 'colorControl' && roles.colour) {
      const { hue = 0, saturation = 100 } = v0 || {};
      const smax = roles.colour === 'colour_data_v2' ? 1000 : 255;
      const lvl = Number(this._store.get(`tuya/${d.id}/level`)) || 100;
      if (roles.mode) cmds[roles.mode] = 'colour';
      cmds[roles.colour] = { h: Math.round(hue * 3.6), s: Math.round((saturation / 100) * smax), v: Math.max(1, Math.round((lvl / 100) * smax)) };
      if (mainSwitch) cmds[mainSwitch] = true;
    } else {
      const code = roles.switches[capId] || (kind === 'light' && capId === 'switch' ? mainSwitch : null);
      if (code) cmds[code] = command === 'on';
    }
    if (!Object.keys(cmds).length) throw new Error(`Tuya: ${capId}/${command} not supported by ${d.name}`);
    await this._send(d, cmds);
    // optimistic — the device's own report follows
    this._applyCodes(d, Object.fromEntries(Object.entries(cmds).map(([c, v]) => [c, typeof v === 'object' ? JSON.stringify(v) : v])));
  }

  async _send(d, cmds) {
    // local needs every code's DP id — cloud-only model entries may lack one
    const entries = Object.entries(cmds);
    const local = d.localUp && d.local && this._mode !== 'cloud' && entries.every(([code]) => d.m.byCode.get(code)?.dpId != null);
    if (local) {
      const data = Object.fromEntries(entries.map(([code, v]) =>
        [d.m.byCode.get(code).dpId, typeof v === 'object' ? encodeColour(v, code, true) : v]));
      try { await d.local.set({ multiple: true, data }); return; }
      catch (err) {
        if (!this._cloud) throw err;
        console.error(`[Tuya] ${d.name}: local write failed (${err.message}) — trying the cloud`);
      }
    }
    if (!this._cloud) throw new Error(`Tuya: ${d.name} has no local link and no cloud project`);
    await this._cloud.command(d.id, Object.entries(cmds).map(([code, v]) => ({ code, value: typeof v === 'object' ? encodeColour(v, code, false) : v })));
  }

  _updateStatus() {
    const anyLocal = [...this._devs.values()].some((d) => d.localUp);
    platformStatus.set('tuya', anyLocal || (!!this._cloud && this._cloudOk));
  }

  status() {
    return [...this._devs.values()].map((d) => ({
      id: d.id, name: d.name, category: d.category, product: d.product, online: !!d.online,
      local: !!d.localUp, ip: d.ip || null, version: d.version || null, registered: !!d.registered, kind: d.m?.kind || null,
    }));
  }

  // Settings "Test": sign in to the cloud project and list what it sees.
  static async probe(cfg) {
    const cloud = new TuyaCloud(cfg);
    await cloud.token(true);
    const list = await cloud.devices(cfg.uid);
    return list.map((c) => ({ id: c.id, name: c.name, category: c.category, product: c.product_name, online: c.online !== false, hasKey: !!c.local_key }));
  }
}

TuyaClient.TuyaCloud = TuyaCloud;
TuyaClient._test = { buildModel, guessProps, propsFromMap, parseColour, encodeColour, pctOf, fromPct, kelvinOf, fromKelvin };

module.exports = TuyaClient;
