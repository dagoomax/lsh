'use strict';

// UGREEN PowerRoam portable power stations — through UGREEN's cloud
// (hw-powerapi.ugpps.com, the "UGREEN" / PowerRoam app's backend). The units
// have no local network API (only an outbound connection to that cloud), so
// this needs the app account and internet. Reverse-engineered by the
// community (github.com/tanka8/ugreen-powerroam, MIT) — not an official API,
// it can change without notice.
//
// Login: GET /app/v1/sa/encrypt/key → RSA public key + uuid; e-mail and
// password RSA (PKCS#1 v1.5) encrypted → POST /app/v1/login → token, userId.
// GET /app/v1/device/list → the account's units. Live telemetry: one
// WebSocket per unit (wss://…:8089/app/device/websocket/<userId>/<device>,
// header `token`), subscribed and kept alive by re-sending
// {userId, content: "ugreenSocketConnection"} every 25 s; the server pushes a
// flat JSON object every few seconds. Control: POST /app/v1/device/setDeviceInfo
// { deviceName, map: { switch_ac | switch_dc | usb_sw | lamp_sw: 0|1 } }.
//
// One LSH device per unit, `ugreen/<sn>`: battery %, input / output power
// (total, AC, DC, USB), time to empty / full, temperatures, battery health,
// cycles, cell imbalance; AC / DC / USB outputs and the light as switches.
//
// config.ugreen = { email, password }   (apiBase / wsBase override for tests)
// Tested against scripts/ugreen-simulator.js (test/ugreen.test.js) — not yet
// against a real unit.

const crypto = require('crypto');
const platformStatus = require('./platform-status');

let WebSocketLib = null;
try { WebSocketLib = require('ws'); } catch { /* reported in start() */ }

const KEEPALIVE_MS = 25_000;
const STALL_MS = 90_000;
const SWITCHES = { switch_ac: ['ac', 'AC output'], switch_dc: ['dc', 'DC output'], usb_sw: ['usb', 'USB output'], lamp_sw: ['light', 'Light'] };
const POWER = { discharge_pow: ['output', 'Output power'], ac_discharge_pow: ['acOutput', 'AC output power'], car_discharge_pow: ['dcOutput', 'DC output power'], usb_discharge_pow: ['usbOutput', 'USB output power'], charge_power_all: ['input', 'Input power'] };

class UgreenClient {
  constructor(config, store, sensorRegistry) {
    this.cfg = config.ugreen || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || 'https://hw-powerapi.ugpps.com').replace(/\/+$/, '');
    this.wsBase = (this.cfg.wsBase || 'wss://hw-powerapi.ugpps.com:8089').replace(/\/+$/, '');
    this.token = null; this.userId = null;
    this.units = new Map(); // deviceName → { sn, key, ws, timers, connected }
    this.stopped = false;
  }

  async start() {
    if (!this.cfg.email || !this.cfg.password) throw new Error('config.ugreen needs email and password (the UGREEN app account)');
    if (!WebSocketLib) throw new Error('"ws" module missing');
    platformStatus.set('ugreen', false);
    await this.login();
    for (const d of await this.devices()) this._register(d);
    for (const name of this.units.keys()) this._connect(name);
  }

  stop() {
    this.stopped = true;
    for (const u of this.units.values()) this._close(u);
    platformStatus.set('ugreen', false);
  }

  // ── REST ──────────────────────────────────────────────────────────────────
  async _call(method, p, body) {
    const res = await fetch(`${this.api}${p}`, {
      method, headers: { 'Content-Type': 'application/json', 'wl-lang': 'en', token: this.token || '' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.errcode !== 200) {
      const e = new Error(`UGREEN ${p}: ${j.errmsg || `HTTP ${res.status}`}`);
      e.auth = res.status === 401 || /token|login|auth/i.test(j.errmsg || '');
      throw e;
    }
    return j.result;
  }

  async login() {
    const k = await this._call('GET', '/app/v1/sa/encrypt/key');
    const key = crypto.createPublicKey({ key: Buffer.from(k.encryptKey, 'base64'), format: 'der', type: 'spki' });
    const enc = (s) => crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(String(s))).toString('base64');
    let r;
    try {
      r = await this._call('POST', '/app/v1/login', { account: enc(this.cfg.email), password: enc(this.cfg.password), code: null, type: 2, uuid: k.uuid });
    } catch (err) { throw new Error(`UGREEN login failed — check the app e-mail and password (${err.message})`) }
    this.token = r.token; this.userId = r.userId;
  }

  async devices() {
    const list = await this._call('GET', '/app/v1/device/list?pageNum=1&pageSize=50');
    if (!Array.isArray(list) || !list.length) throw new Error('UGREEN: no power stations on this account');
    return list;
  }

  async setSwitch(deviceName, field, on) {
    const run = () => this._call('POST', '/app/v1/device/setDeviceInfo', { deviceName, map: { [field]: on ? 1 : 0 } });
    try { await run() } catch (err) { if (!err.auth) throw err; await this.login(); await run() }
    const u = this.units.get(deviceName);
    if (u) this.store.update(`${u.key}/${SWITCHES[field][0]}`, on ? 1 : 0);
  }

  // ── Devices ───────────────────────────────────────────────────────────────
  _register(d) {
    const name = d.deviceModelName;
    if (!name || this.units.has(name)) return;
    const sn = String(d.sn || name).replace(/[^A-Za-z0-9_-]/g, '');
    const key = `ugreen/${sn}`;
    this.units.set(name, { name, sn, key, ws: null, timers: {}, connected: false, backoff: 5000, failures: 0 });
    this.registry.registerDevice({
      key, label: d.deviceAlias || d.name || d.productName || `UGREEN PowerRoam ${sn.slice(-4)}`, type: 'ugreen', icon: '🔋', homekit: ['battery-level'],
      sensors: [
        { path: 'battery', label: 'Battery', unit: '%', format: 'number', homekit: 'battery-level' },
        ...Object.values(POWER).map(([path, label]) => ({ path, label, unit: 'W', format: 'number' })),
        { path: 'timeToEmpty', label: 'Time to empty', unit: 'min', format: 'number' },
        { path: 'timeToFull', label: 'Time to full', unit: 'min', format: 'number' },
        { path: 'batteryTemp', label: 'Battery temperature', unit: '°C', format: 'number' },
        { path: 'inverterTemp', label: 'Inverter temperature', unit: '°C', format: 'number' },
        { path: 'health', label: 'Battery health', unit: '%', format: 'number' },
        { path: 'cycles', label: 'Battery cycles', format: 'number' },
        { path: 'cellImbalance', label: 'Cell imbalance', unit: 'mV', format: 'number' },
        { path: 'online', label: 'Online', type: 'boolean', format: 'on-off' },
        ...Object.entries(SWITCHES).map(([field, [path, label]]) => ({ path, label, format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: field })),
      ],
      _writeCapability: (field, cmd) => this.setSwitch(name, field, cmd === 'on'),
    });
  }

  _apply(u, t) {
    const set = (k, v) => { if (v !== null && v !== undefined && v !== '' && !Number.isNaN(v)) this.store.update(`${u.key}/${k}`, v) };
    const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    set('battery', n(t.battery_percentage));
    for (const [f, [path]] of Object.entries(POWER)) set(path, n(t[f]));
    if (t.discharge_remain_time != null) set('timeToEmpty', Math.round(n(t.discharge_remain_time) / 60));
    if (t.charge_remain_time != null) set('timeToFull', Math.round(n(t.charge_remain_time) / 60));
    const max = (...xs) => { const v = xs.map(n).filter(Number.isFinite); return v.length ? Math.max(...v) : null };
    set('batteryTemp', max(t.bat_temp1, t.bat_temp2));
    set('inverterTemp', max(t.inverter_temp1, t.inverter_temp2));
    set('health', n(t.bat_health));
    set('cycles', n(t.bat_cycle_num));
    const cells = [1, 2, 3, 4, 5, 6, 7].map((i) => n(t[`cell${i}_vol`])).filter((v) => Number.isFinite(v) && v > 0);
    if (cells.length >= 2) set('cellImbalance', Math.round(Math.max(...cells) - Math.min(...cells)));
    for (const [f, [path]] of Object.entries(SWITCHES)) if (t[f] != null) set(path, n(t[f]) ? 1 : 0);
  }

  // ── WebSocket per unit ────────────────────────────────────────────────────
  _status() {
    platformStatus.set('ugreen', [...this.units.values()].some((u) => u.connected));
  }

  _close(u) {
    clearInterval(u.timers.keep); clearTimeout(u.timers.stall); clearTimeout(u.timers.retry);
    if (u.ws) { try { u.ws.terminate() } catch {} u.ws = null }
    u.connected = false;
  }

  _connect(name) {
    const u = this.units.get(name);
    if (!u || this.stopped) return;
    this._close(u);
    const ws = new WebSocketLib(`${this.wsBase}/app/device/websocket/${encodeURIComponent(this.userId)}/${encodeURIComponent(name)}`, { headers: { token: this.token } });
    u.ws = ws;
    const hello = () => { try { ws.send(JSON.stringify({ userId: this.userId, content: 'ugreenSocketConnection' })) } catch {} };
    const stall = () => { clearTimeout(u.timers.stall); u.timers.stall = setTimeout(() => { try { ws.terminate() } catch {} }, STALL_MS) };
    ws.on('open', () => {
      hello(); stall();
      u.timers.keep = setInterval(hello, KEEPALIVE_MS);
    });
    ws.on('message', (raw) => {
      let t; try { t = JSON.parse(raw) } catch { return }
      if (!t || typeof t !== 'object' || !('battery_percentage' in t)) return; // acks
      stall();
      u.backoff = 5000; u.failures = 0;
      if (!u.connected) { u.connected = true; this.store.update(`${u.key}/online`, 1); this._status() }
      this._apply(u, t);
    });
    ws.on('error', (err) => console.warn(`[UGREEN] ${u.sn}: ${err.message}`));
    ws.on('close', async () => {
      clearInterval(u.timers.keep); clearTimeout(u.timers.stall);
      const was = u.connected;
      u.connected = false; u.ws = null;
      if (was) { this.store.update(`${u.key}/online`, 0); this._status() }
      if (this.stopped) return;
      // A dead token closes the socket at once — log in again after a few failures
      if (++u.failures >= 3) { u.failures = 0; await this.login().catch((err) => console.warn(`[UGREEN] re-login: ${err.message}`)) }
      u.timers.retry = setTimeout(() => this._connect(name), u.backoff);
      u.timers.retry.unref?.();
      u.backoff = Math.min(u.backoff * 2, 60_000);
    });
  }
}

module.exports = UgreenClient;
