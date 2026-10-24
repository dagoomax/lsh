'use strict';

// Sonoff / eWeLink devices — relays (BASIC, MINI, 4CH, DUALR3), plugs (S26,
// S40, POW), dimmers (D1, KING-M4), bulbs (B02/B05), TH temperature sensors,
// curtain motors and Zigbee sensors (via a bridge) — cloud, LAN, or both.
//
//   config.sonoff = {
//     mode: 'auto',              // auto | cloud | local
//     region: 'eu',              // eu | us | as | cn  (eWeLink account region)
//     email, password, countryCode: '+48',   // or phoneNumber instead of email
//     appId, appSecret,          // your own app from dev.ewelink.cc (CoolKit open platform)
//     pollInterval: 30,          // s — cloud status poll for devices not seen on the LAN
//     devices: [ { id, devicekey, host, name } ]   // LAN / DIY devices, overrides
//   }
//
// Cloud: CoolKit API v2 (the eWeLink app's backend) — sign in, list devices
// with their params, and POST new params. Each device's `devicekey` comes with
// the list, and that is what LAN mode needs.
//
// LAN: Sonoff firmware announces itself over mDNS (_ewelink._tcp) with its
// state in TXT records, AES-128-CBC encrypted with MD5(devicekey) — or in plain
// JSON for devices switched to DIY mode. Control is an HTTP POST to
// http://<ip>:8081/zeroconf/<switch|switches|dimmable>. In auto mode a device
// seen on the LAN is read and switched locally, everything else via the cloud.
// Zigbee sub-devices and bulbs only work through the cloud.
//
// NOTE: built from CoolKit's API v2 docs and the documented LAN protocol, and
// checked with scripts/ewelink-simulator.js plus unit tests — no physical
// Sonoff was on hand. Per-model param layouts (uiid) follow those docs.

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const platformStatus = require('./platform-status');

const hosts = (r) => `https://${r}-apia.coolkit.${r === 'cn' ? 'cn' : 'cc'}`;

// Relay channel count per uiid — params.switches always carries four entries
const CHANNELS = {
  2: 2, 3: 3, 4: 4, 7: 2, 8: 3, 9: 4, 29: 2, 30: 3, 31: 4, 41: 4, 77: 1, 78: 1, 81: 1, 82: 2, 83: 3, 84: 4,
  107: 1, 112: 1, 113: 2, 114: 3, 126: 2, 133: 2, 138: 1, 139: 2, 140: 3, 141: 4, 160: 1, 161: 2, 162: 3, 165: 2, 210: 4, 212: 4,
};
const HUNDREDTHS_POWER = new Set([182, 190]);       // S40 / POWR3 report W, V, A ×100
const HUNDREDTHS_CLIMATE = new Set([1770, 7014]);   // Zigbee SNZB-02 family
const LIGHT_UIIDS = new Set([103, 104, 135, 136]);

// ── Cloud: CoolKit API v2 ──────────────────────────────────────────────────────
class EwelinkCloud {
  constructor({ appId, appSecret, region = 'eu', email, phoneNumber, password, countryCode = '+48', baseUrl }) {
    Object.assign(this, { appId, appSecret, email, phoneNumber, password, countryCode });
    this.base = baseUrl || hosts(region);
    this._fixedBase = !!baseUrl;
    this.at = null;
  }

  static sign(secret, body) {
    return crypto.createHmac('sha256', secret).update(body).digest('base64');
  }

  async login() {
    const body = JSON.stringify({ countryCode: this.countryCode, password: this.password,
      ...(this.email ? { email: this.email } : { phoneNumber: this.phoneNumber }) });
    const headers = { 'X-CK-Appid': this.appId, 'X-CK-Nonce': nonce(), Authorization: `Sign ${EwelinkCloud.sign(this.appSecret, body)}`,
      'Content-Type': 'application/json' };
    let json = await requestJson(`${this.base}/v2/user/login`, { method: 'POST', headers, body });
    if (json.error === 10004 && json.data?.region && !this._fixedBase) { // account lives in another region
      this.base = hosts(json.data.region);
      json = await requestJson(`${this.base}/v2/user/login`, { method: 'POST', headers: { ...headers, 'X-CK-Nonce': nonce() }, body });
    }
    if (json.error !== 0 || !json.data?.at) throw new Error(`eWeLink login: ${json.msg || `error ${json.error}`}`);
    this.at = json.data.at;
    return json.data;
  }

  async request(method, path, body, retried = false) {
    if (!this.at) await this.login();
    const data = body ? JSON.stringify(body) : undefined;
    const json = await requestJson(this.base + path, { method, body: data,
      headers: { 'X-CK-Appid': this.appId, 'X-CK-Nonce': nonce(), Authorization: `Bearer ${this.at}`, 'Content-Type': 'application/json' } });
    if ((json.error === 401 || json.error === 402) && !retried) { this.at = null; return this.request(method, path, body, true); }
    if (json.error !== 0) throw new Error(`eWeLink ${path}: ${json.msg || `error ${json.error}`}`);
    return json.data;
  }

  async devices() {
    const d = await this.request('GET', '/v2/device/thing?num=0');
    return (d?.thingList || []).filter((t) => t.itemType === 1 || t.itemType === 2).map((t) => t.itemData);
  }

  setParams(id, params) {
    return this.request('POST', '/v2/device/thing/status', { type: 1, id, params });
  }
}

const nonce = () => crypto.randomBytes(4).toString('hex');

function requestJson(url, { method = 'GET', headers = {}, body, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, timeout, headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers }, (res) => {
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

// ── LAN crypto ────────────────────────────────────────────────────────────────
function lanKey(devicekey) { return crypto.createHash('md5').update(String(devicekey)).digest(); }
function decryptLan(devicekey, ivB64, dataB64) {
  const d = crypto.createDecipheriv('aes-128-cbc', lanKey(devicekey), Buffer.from(ivB64, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8'));
}
function encryptLan(devicekey, obj) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-128-cbc', lanKey(devicekey), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]).toString('base64');
  return { iv: iv.toString('base64'), data };
}
// TXT record → state params: data1..data4 joined, decrypted when encrypt=true
function parseTxt(txt, devicekey) {
  const raw = ['data1', 'data2', 'data3', 'data4'].map((k) => txt[k] || '').join('');
  if (!raw) return null;
  if (String(txt.encrypt) === 'true') {
    if (!devicekey || !txt.iv) return null;
    return decryptLan(devicekey, txt.iv, raw);
  }
  return JSON.parse(raw);
}

// ── Params → LSH sensors ───────────────────────────────────────────────────────
function buildModel(uiid, params = {}) {
  uiid = Number(uiid) || 0;
  const sensors = [];
  const homekit = [];
  let kind = 'switch';
  if (uiid === 11 || (uiid === 126 && params.workMode === 2)) {
    kind = 'cover';
    sensors.push({ path: 'windowShade', name: 'Open', format: 'on-off', controllable: true, type: 'toggle',
      writeOn: 'open', writeOff: 'close', capabilityId: 'windowShade', homekit: 'cover-rw' });
    sensors.push({ path: 'level', name: 'Position', format: 'percent', unit: '%', min: 0, max: 100, step: 1,
      controllable: true, type: 'range', capabilityId: 'windowShade', writeCmd: 'setLevel' });
    sensors.push({ path: 'stop', name: 'Stop', hidden: true });
    homekit.push('cover-rw');
  } else if (LIGHT_UIIDS.has(uiid)) {
    kind = 'light';
    sensors.push({ path: 'switch', name: 'Power', format: 'on-off', controllable: true, type: 'toggle',
      writeOn: 'on', writeOff: 'off', capabilityId: 'switch', homekit: 'light-rw' });
    sensors.push({ path: 'level', name: 'Brightness', format: 'percent', unit: '%', min: 0, max: 100, step: 1,
      controllable: true, type: 'range', capabilityId: 'switchLevel', writeCmd: 'setLevel' });
    if (uiid === 104 || uiid === 136) {
      sensors.push({ path: 'hue', name: 'Hue', format: 'number', hidden: true });
      sensors.push({ path: 'saturation', name: 'Saturation', format: 'number', hidden: true });
      sensors.push({ path: 'color', name: 'Color', format: 'color', controllable: true, type: 'color', capabilityId: 'colorControl' });
    }
    homekit.push('light-rw');
  } else if (Array.isArray(params.switches)) {
    const n = CHANNELS[uiid] || params.switches.length;
    for (let i = 0; i < n; i++) {
      const path = i === 0 ? 'switch' : `switch_${i + 1}`;
      sensors.push({ path, name: n > 1 ? `Channel ${i + 1}` : 'Power', format: 'on-off', controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off', capabilityId: path, homekit: 'switch-rw' });
    }
    if (n) homekit.push('switch-rw');
  } else if (typeof params.switch === 'string' && uiid !== 2026 && uiid !== 3026) {
    const dim = params.brightness != null || params.bright != null;
    if (dim) kind = 'light';
    sensors.push({ path: 'switch', name: 'Power', format: 'on-off', controllable: true, type: 'toggle',
      writeOn: 'on', writeOff: 'off', capabilityId: 'switch', homekit: dim ? 'light-rw' : 'switch-rw' });
    if (dim) sensors.push({ path: 'level', name: 'Brightness', format: 'percent', unit: '%', min: 0, max: 100, step: 1,
      controllable: true, type: 'range', capabilityId: 'switchLevel', writeCmd: 'setLevel' });
    homekit.push(dim ? 'light-rw' : 'switch-rw');
  }
  const has = (k) => params[k] != null && params[k] !== 'unavailable';
  if (has('power')) sensors.push({ path: 'power', name: 'Power', unit: 'W', format: 'number' });
  if (has('voltage')) sensors.push({ path: 'voltage', name: 'Voltage', unit: 'V', format: 'number' });
  if (has('current')) sensors.push({ path: 'current', name: 'Current', unit: 'A', format: 'number' });
  if (has('currentTemperature') || has('temperature')) { sensors.push({ path: 'temperature', name: 'Temperature', unit: '°C', format: 'number', homekit: 'temperature' }); homekit.push('temperature'); }
  if (has('currentHumidity') || has('humidity')) { sensors.push({ path: 'humidity', name: 'Humidity', unit: '%', format: 'number', homekit: 'humidity' }); homekit.push('humidity'); }
  if (has('battery')) { sensors.push({ path: 'battery', name: 'Battery', unit: '%', format: 'number', homekit: 'battery-level' }); homekit.push('battery'); }
  if (uiid === 3026) { sensors.push({ path: 'contact', name: 'Contact', format: 'on-off', homekit: 'contact' }); homekit.push('contact'); }
  if (uiid === 2026) sensors.push({ path: 'motion', name: 'Motion', format: 'on-off', homekit: 'motion' });
  if (!sensors.some((s) => s.controllable)) kind = 'sensor';
  return { sensors, homekit, kind, uiid };
}

// Params (cloud list, cloud/LAN update) → { path: value }
function readings(m, params) {
  const out = {};
  const on = (v) => (v === 'on' ? 1 : v === 'off' ? 0 : undefined);
  const n = (v) => (v == null || v === '' || v === 'unavailable' || isNaN(Number(v)) ? undefined : Number(v));
  if (m.kind === 'cover') {
    let pos;
    if (m.uiid === 11 && n(params.setclose) != null) pos = 100 - n(params.setclose);
    if (m.uiid === 126 && n(params.currLocation) != null) pos = n(params.currLocation);
    if (pos != null) { out.level = pos; out.windowShade = pos > 0 ? 1 : 0; }
  } else if (LIGHT_UIIDS.has(m.uiid)) {
    if (params.switch) out.switch = on(params.switch);
    const mode = params.ltype;
    const br = n(params[mode]?.br);
    if (br != null) out.level = br;
    const c = params.color;
    if (mode === 'color' && c && n(c.r) != null) {
      const [h, s] = rgbToHs(n(c.r), n(c.g), n(c.b));
      out.hue = Math.round(h / 3.6); out.saturation = Math.round(s);
    }
  } else if (Array.isArray(params.switches)) {
    for (const s of params.switches) {
      const i = Number(s.outlet);
      if (i < (CHANNELS[m.uiid] || params.switches.length)) out[i === 0 ? 'switch' : `switch_${i + 1}`] = on(s.switch);
    }
  } else if (params.switch && m.sensors.some((s) => s.path === 'switch')) {
    out.switch = on(params.switch);
  }
  if (m.kind === 'light' && !LIGHT_UIIDS.has(m.uiid)) {
    const b = n(params.brightness ?? params.bright);
    if (b != null) out.level = b;
  }
  const div = HUNDREDTHS_POWER.has(m.uiid) ? 100 : 1;
  for (const k of ['power', 'voltage', 'current']) if (n(params[k]) != null) out[k] = +(n(params[k]) / div).toFixed(2);
  const cdiv = HUNDREDTHS_CLIMATE.has(m.uiid) ? 100 : 1;
  const t = n(params.currentTemperature ?? params.temperature);
  if (t != null) out.temperature = +(t / cdiv).toFixed(1);
  const h = n(params.currentHumidity ?? params.humidity);
  if (h != null) out.humidity = +(h / cdiv).toFixed(1);
  if (n(params.battery) != null) out.battery = n(params.battery);
  if (m.uiid === 3026 && params.lock != null) out.contact = Number(params.lock) === 1 ? 1 : 0;
  if (m.uiid === 2026 && params.motion != null) out.motion = Number(params.motion) === 1 ? 1 : 0;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

function rgbToHs(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, (max ? d / max : 0) * 100];
}
function hsToRgb(h, s) {
  s /= 100;
  const c = s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 1 - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

// LSH command → eWeLink params
function commandParams(m, state, capId, command, args) {
  const v = args[0];
  if (capId === 'windowShade') {
    if (m.uiid === 11) {
      if (command === 'setLevel' || command === 'set') return { setclose: 100 - Math.round(Number(v)) };
      return { switch: command === 'stop' ? 'pause' : command === 'open' ? 'on' : 'off' };
    }
    if (command === 'setLevel' || command === 'set') return { location: Math.round(Number(v)) };
    return { motorTurn: command === 'stop' ? 0 : command === 'open' ? 1 : 2 };
  }
  if (capId === 'switchLevel') {
    const pct = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    if (pct === 0) return { switch: 'off' };
    if (LIGHT_UIIDS.has(m.uiid)) {
      const mode = state.ltype || 'white';
      return { switch: 'on', ltype: mode, [mode]: { ...(state[mode] || {}), br: pct } };
    }
    if (m.uiid === 36) return { switch: 'on', bright: Math.max(10, pct) };
    return { switch: 'on', brightness: pct, mode: 0 };
  }
  if (capId === 'colorControl') {
    const [r, g, b] = hsToRgb((v?.hue || 0) * 3.6, v?.saturation ?? 100);
    return { switch: 'on', ltype: 'color', color: { br: state.color?.br || state.white?.br || 100, r, g, b } };
  }
  const want = command === 'on' ? 'on' : 'off';
  if (Array.isArray(state.switches) && !LIGHT_UIIDS.has(m.uiid)) {
    const outlet = capId === 'switch' ? 0 : Number(/_(\d+)$/.exec(capId)?.[1] || 1) - 1;
    return { switches: [{ switch: want, outlet }] };
  }
  return { switch: want };
}
// LAN endpoint for a params object; null = cloud only
function lanEndpoint(params) {
  if (params.switches) return 'switches';
  if (params.brightness != null) return 'dimmable';
  if (Object.keys(params).length === 1 && params.switch) return 'switch';
  return null;
}

// ── Client ─────────────────────────────────────────────────────────────────────
class EwelinkClient {
  constructor(config, store, sensorRegistry) {
    this._cfg = config.sonoff || {};
    this._store = store;
    this._registry = sensorRegistry;
    this._mode = ['cloud', 'local'].includes(this._cfg.mode) ? this._cfg.mode : 'auto';
    const c = this._cfg;
    this._cloud = this._mode !== 'local' && c.appId && c.appSecret && c.password && (c.email || c.phoneNumber) ? new EwelinkCloud(c) : null;
    this._devs = new Map(); // deviceid → { id, name, uiid, devicekey, host, port, params, m, lanSeen }
    this._timers = [];
    this._cloudOk = false;
    this._mdns = null;
  }

  async start() {
    platformStatus.set('sonoff', false);
    for (const d of this._cfg.devices || []) {
      if (!d?.id) continue;
      this._devs.set(d.id, { id: d.id, name: d.name || `Sonoff ${d.id}`, devicekey: d.devicekey || '', host: d.host || '', configuredHost: !!d.host, port: Number(d.port) || 8081, params: {}, configured: true });
    }
    if (this._cloud) {
      try { await this._pollCloud(true); }
      catch (err) { console.error(`[Sonoff] Cloud: ${err.message}`); }
      const every = Math.max(15, Number(this._cfg.pollInterval) || 30) * 1000;
      this._timers.push(setInterval(() => this._pollCloud().catch((e) => console.error(`[Sonoff] Cloud: ${e.message}`)), every));
    }
    if (this._mode !== 'cloud') this._startLan();
    this._updateStatus();
    console.log(`[Sonoff] ${this._devs.size} device(s), mode ${this._mode}${this._cloud ? ', eWeLink account linked' : ''}`);
  }

  stop() {
    this._timers.forEach(clearInterval);
    try { this._mdns?.destroy(); } catch { /* closed */ }
    platformStatus.set('sonoff', false);
  }

  async _pollCloud(initial = false) {
    try {
      const list = await this._cloud.devices();
      for (const t of list) {
        let d = this._devs.get(t.deviceid);
        if (!d) { d = { id: t.deviceid, port: 8081, params: {} }; this._devs.set(t.deviceid, d); }
        d.name = d.configured && d.name ? d.name : (t.name || d.name || t.deviceid);
        d.uiid = t.extra?.uiid ?? d.uiid;
        d.model = t.productModel || t.extra?.model || d.model;
        d.devicekey = d.devicekey || t.devicekey;
        d.online = !!t.online;
        d.fromCloud = true;
        if (d.lanFresh && Date.now() - d.lanFresh < 90000) continue; // LAN is newer
        this._apply(d, t.params || {});
      }
      this._cloudOk = true;
    } catch (err) {
      this._cloudOk = false;
      if (initial) throw err;
      console.error(`[Sonoff] Cloud poll: ${err.message}`);
    }
    this._updateStatus();
  }

  _startLan() {
    let mdnsFactory;
    try { mdnsFactory = require('multicast-dns'); }
    catch { console.error('[Sonoff] LAN mode needs multicast-dns — using the cloud only'); return; }
    try { this._mdns = mdnsFactory(); }
    catch (err) { console.error(`[Sonoff] mDNS: ${err.message}`); return; }
    this._mdns.on('error', (err) => console.error(`[Sonoff] mDNS: ${err.message}`));
    this._mdns.on('response', (res) => this._onMdns(res));
    const ask = () => this._mdns.query({ questions: [{ name: '_ewelink._tcp.local', type: 'PTR' }] });
    ask();
    this._timers.push(setInterval(ask, 60000));
  }

  _onMdns(res) {
    const records = [...(res.answers || []), ...(res.additionals || [])];
    const addr = new Map(records.filter((r) => r.type === 'A').map((r) => [r.name, r.data]));
    const srv = new Map(records.filter((r) => r.type === 'SRV').map((r) => [r.name, r.data]));
    for (const r of records) {
      if (r.type !== 'TXT' || !/\._ewelink\._tcp\.local$/i.test(r.name)) continue;
      const txt = {};
      for (const b of [].concat(r.data || [])) {
        const s = Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
        const i = s.indexOf('=');
        if (i > 0) txt[s.slice(0, i)] = s.slice(i + 1);
      }
      const id = txt.id;
      if (!id) continue;
      let d = this._devs.get(id);
      if (!d) {
        if (this._mode === 'auto' && this._cloud) continue; // not on this account
        d = { id, name: `Sonoff ${id}`, port: 8081, params: {} };
        this._devs.set(id, d);
      }
      const s = srv.get(r.name);
      if (s) { d.port = s.port || d.port; const ip = addr.get(s.target); if (ip && !d.configuredHost) d.host = ip; }
      if (!d.host) { const ip = [...addr.values()][0]; if (ip) d.host = ip; }
      if (txt.seq && d.seq === txt.seq) continue;
      d.seq = txt.seq;
      let params;
      try { params = parseTxt(txt, d.devicekey); }
      catch { if (!d.keyWarned) console.error(`[Sonoff] ${d.name}: can't decrypt LAN state — wrong or missing devicekey`); d.keyWarned = true; continue; }
      if (!params) continue;
      if (!d.lanSeen) console.log(`[Sonoff] ${d.name}: on the LAN at ${d.host}:${d.port}${String(txt.encrypt) === 'true' ? '' : ' (DIY mode)'}`);
      d.lanSeen = true;
      d.diy = String(txt.encrypt) !== 'true';
      d.lanFresh = Date.now();
      d.online = true;
      if (d.uiid == null && txt.type) d.uiid = { diy_plug: 1, plug: 1, strip: 4, diy_light: 44, light: 44 }[txt.type] ?? null;
      this._apply(d, params);
    }
    this._updateStatus();
  }

  _apply(d, params) {
    // a write or LAN update may carry only the changed outlets — merge them in
    const prevSwitches = d.params.switches;
    d.params = { ...d.params, ...params };
    if (Array.isArray(params.switches) && Array.isArray(prevSwitches)) {
      const merged = prevSwitches.map((x) => params.switches.find((s) => s.outlet === x.outlet) || x);
      for (const s of params.switches) if (!merged.some((x) => x.outlet === s.outlet)) merged.push(s);
      d.params.switches = merged;
    }
    d.state = d.params;
    if (!d.m) {
      const m = buildModel(d.uiid, d.params);
      if (!m.sensors.length) return;
      d.m = m;
      m.sensors.push({ path: 'online', name: 'Online', format: 'on-off', hidden: true });
      this._registry.registerDevice({
        key: `sonoff/${d.id}`, label: d.name, type: 'sonoff', model: d.model || `eWeLink UIID ${d.uiid ?? '?'}`,
        icon: { light: '💡', cover: '🪟', sensor: '🌡️' }[m.kind] || '🔌',
        sensors: m.sensors, homekit: m.homekit,
        _writeCapability: (capId, command, args = []) => this._write(d, capId, command, args),
      });
      console.log(`[Sonoff] Registered ${d.name} (${m.kind}, uiid ${d.uiid ?? '?'})`);
    }
    const key = `sonoff/${d.id}`;
    for (const [path, v] of Object.entries(readings(d.m, params))) this._store.update(`${key}/${path}`, v);
    this._store.update(`${key}/online`, d.online === false ? 0 : 1);
  }

  async _write(d, capId, command, args) {
    const params = commandParams(d.m, d.state || {}, capId, command, args);
    const ep = lanEndpoint(params);
    const lan = this._mode !== 'cloud' && d.host && ep && (d.diy || d.devicekey) && (d.lanSeen || d.configured);
    if (lan) {
      try { await this._lanSend(d, ep, params); this._apply(d, params); return; }
      catch (err) {
        if (!this._cloud) throw err;
        console.error(`[Sonoff] ${d.name}: LAN write failed (${err.message}) — trying the cloud`);
      }
    }
    if (!this._cloud) throw new Error(`Sonoff: ${d.name} isn't reachable on the LAN and no eWeLink account is set`);
    await this._cloud.setParams(d.id, params);
    this._apply(d, params);
  }

  _lanSend(d, endpoint, params) {
    const body = d.diy
      ? JSON.stringify({ deviceid: d.id, data: params })
      : JSON.stringify({ sequence: String(Date.now()), deviceid: d.id, selfApikey: '123', encrypt: true, ...encryptLan(d.devicekey, params) });
    return new Promise((resolve, reject) => {
      const req = http.request({ host: d.host, port: d.port || 8081, path: `/zeroconf/${endpoint}`, method: 'POST', timeout: 5000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(out); } catch { /* checked below */ }
          if (res.statusCode !== 200 || !j || (j.error && j.error !== 0)) return reject(new Error(`HTTP ${res.statusCode}${j?.error ? `, error ${j.error}` : ''}`));
          resolve(j);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Timeout')));
      req.end(body);
    });
  }

  _updateStatus() {
    const anyLan = [...this._devs.values()].some((d) => d.lanSeen);
    platformStatus.set('sonoff', anyLan || (!!this._cloud && this._cloudOk));
  }

  status() {
    return [...this._devs.values()].map((d) => ({
      id: d.id, name: d.name, uiid: d.uiid ?? null, model: d.model || null, online: d.online !== false,
      lan: !!d.lanSeen, host: d.host || null, diy: !!d.diy, registered: !!d.m, kind: d.m?.kind || null,
    }));
  }

  // Settings "Test": sign in and list the account's devices.
  static async probe(cfg) {
    const cloud = new EwelinkCloud(cfg);
    await cloud.login();
    const list = await cloud.devices();
    return list.map((t) => ({ id: t.deviceid, name: t.name, uiid: t.extra?.uiid, model: t.productModel || t.extra?.model, online: !!t.online }));
  }
}

EwelinkClient.EwelinkCloud = EwelinkCloud;
EwelinkClient._test = { buildModel, readings, commandParams, lanEndpoint, encryptLan, decryptLan, parseTxt };

module.exports = EwelinkClient;
