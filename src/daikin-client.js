'use strict';

// Daikin air conditioners — local HTTP API of the Daikin Wi-Fi adapters
// (the protocol of the "Daikin Online Controller" app, as used by pydaikin).
//
//   BRP069A/B, BRP072A, built-in Wi-Fi of most 2015–2021 splits (Emura,
//   Stylish, Perfera, Sensira, Comfora, Ururu Sarara…): plain HTTP.
//   BRP072C (and units with it built in): HTTPS with a self-signed
//   certificate; the 13-digit key printed on the adapter registers LSH once
//   (GET /common/register_terminal?key=…, header X-Daikin-uuid).
//
//   GET /common/basic_info        name (url-encoded), mac, ver
//   GET /aircon/get_control_info  pow, mode, stemp, shum, f_rate, f_dir,
//                                 dt1…dt7 / dh1…dh7 (last temp / humidity per mode)
//   GET /aircon/get_sensor_info   htemp (room), otemp (outdoor), hhum
//   GET /aircon/set_control_info?pow&mode&stemp&shum&f_rate&f_dir   (all required)
//   answers are "ret=OK,key=value,…"
//
//   mode   0/1/7 auto, 2 dry, 3 cool, 4 heat, 6 fan
//   f_rate A auto, B silent, 3–7 level 1–5;  f_dir 0 off, 1 vertical, 2 horizontal, 3 both
//
// Newer units that only work with the Daikin Onecta app (cloud) have no local
// API and aren't covered — use them through Home Assistant / Matter.
//
// One LSH device per unit, `daikin/<mac>`, with the shared AC model of
// src/ac-common.js (power, mode, set temperature, fan, swing, room / outdoor
// temperature, humidity; HomeKit thermostat).
//
// config.daikin = { devices: [{ host, key?, uuid?, name? }], pollInterval = 30 (s) }
//   key  — BRP072C only: the 13-digit key on the adapter label (https is used then,
//          unless host is given as an explicit http:// URL)
// Tested against scripts/daikin-simulator.js (test/daikin.test.js) — not yet
// against a real unit.

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const PollingClient = require('./polling-client');
const { registerAc, publishAc } = require('./ac-common');

const TIMEOUT_MS = 8000;
const MODE_TO = { auto: '0', dry: '2', cool: '3', heat: '4', fan: '6' };
const MODE_FROM = { 0: 'auto', 1: 'auto', 7: 'auto', 2: 'dry', 3: 'cool', 4: 'heat', 6: 'fan' };
const FAN_FROM = { A: 0, B: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 5 };
const FAN_TO = ['A', 'B', '3', '5', '6', '7'];
const agent = new https.Agent({ rejectUnauthorized: false }); // BRP072C: self-signed certificate

function parse(text) {
  const out = {};
  for (const part of String(text).trim().split(',')) {
    const i = part.indexOf('=');
    if (i > 0) { const k = part.slice(0, i); let v = part.slice(i + 1); try { v = decodeURIComponent(v) } catch {} out[k] = v }
  }
  return out;
}

const num = (v) => { const n = Number(v); return v === '' || v === '-' || v === '--' || !Number.isFinite(n) ? undefined : n };

class DaikinClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'daikin', logTag: 'Daikin' });
    this.cfg = config.daikin || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.units = [];
  }

  async start() {
    const devs = Array.isArray(this.cfg.devices) ? this.cfg.devices.filter((d) => d?.host) : [];
    if (!devs.length) throw new Error('config.daikin.devices needs at least one { host }');
    this.units = devs.map((d) => ({
      conf: d, host: String(d.host).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      secure: /^http:\/\//.test(d.host) ? false : !!d.key || /^https:/.test(d.host), uuid: String(d.uuid || crypto.randomUUID()).replace(/-/g, ''),
      registered: !d.key, key: null, control: null,
    }));
    await this.startPolling(Math.max(5, Number(this.cfg.pollInterval) || 30) * 1000);
  }

  _get(u, p) {
    const mod = u.secure ? https : http;
    return new Promise((resolve, reject) => {
      const [hostname, port] = u.host.split(':');
      const req = mod.request({
        hostname, port: port || undefined, path: p, method: 'GET', timeout: TIMEOUT_MS,
        ...(u.secure ? { agent } : {}), ...(u.conf.key ? { headers: { 'X-Daikin-uuid': u.uuid } } : {}),
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c });
        res.on('end', () => {
          if (res.statusCode === 403) return reject(new Error(`${u.host}: access denied — ${u.secure ? 'check the adapter key' : 'this adapter needs its key (BRP072C)'}`));
          if (res.statusCode !== 200) return reject(new Error(`${u.host}${p}: HTTP ${res.statusCode}`));
          const r = parse(body);
          if (r.ret !== 'OK') return reject(new Error(`${u.host}${p}: ${r.ret || 'bad answer'}`));
          resolve(r);
        });
      });
      req.on('timeout', () => req.destroy(new Error(`${u.host}: timed out`)));
      req.on('error', reject);
      req.end();
    });
  }

  async _pollImpl() {
    let ok = 0; const errs = [];
    for (const u of this.units) {
      try { await this._pollUnit(u); ok++ } catch (err) {
        errs.push(err.message);
        if (u.key) publishAc(this.store, u.key, { online: false });
      }
    }
    if (!ok) throw new Error(errs.join('; '));
    if (errs.length) console.warn(`[Daikin] ${errs.join('; ')}`);
  }

  async _pollUnit(u) {
    if (!u.registered) {
      await this._get(u, `/common/register_terminal?key=${encodeURIComponent(u.conf.key)}`);
      u.registered = true;
    }
    if (!u.key) {
      const info = await this._get(u, '/common/basic_info');
      const id = String(info.mac || u.host).toLowerCase().replace(/[^a-z0-9]/g, '');
      u.key = `daikin/${id}`;
      registerAc(this.registry, {
        key: u.key, label: u.conf.name || info.name || `Daikin ${id.slice(-4)}`, type: 'daikin', model: 'Daikin Wi-Fi',
        features: { swing: true, outdoor: true, humidity: true, minTemp: 10, maxTemp: 32 },
        set: (patch) => this.set(u, patch),
      });
      console.log(`[Daikin] ${u.host}: ${info.name || id}`);
    }
    const c = await this._get(u, '/aircon/get_control_info');
    const s = await this._get(u, '/aircon/get_sensor_info');
    u.control = c;
    publishAc(this.store, u.key, {
      online: true, power: c.pow === '1', mode: MODE_FROM[c.mode], targetTemp: num(c.stemp),
      fan: FAN_FROM[c.f_rate], swing: c.f_dir !== undefined ? c.f_dir !== '0' : undefined,
      temperature: num(s.htemp), outdoorTemp: num(s.otemp), humidity: num(s.hhum),
    });
  }

  async set(u, patch) {
    if (!u.control) throw new Error(`Daikin ${u.host}: no state read yet`);
    const c = u.control;
    const q = { pow: c.pow, mode: c.mode, stemp: c.stemp, shum: c.shum, f_rate: c.f_rate, f_dir: c.f_dir };
    if (patch.power !== undefined) q.pow = patch.power ? '1' : '0';
    if (patch.mode) {
      q.mode = MODE_TO[patch.mode];
      // each mode remembers its own temperature / humidity (dt<mode>, dh<mode>)
      if (c[`dt${q.mode}`] !== undefined) q.stemp = c[`dt${q.mode}`];
      if (c[`dh${q.mode}`] !== undefined) q.shum = c[`dh${q.mode}`];
    }
    if (patch.targetTemp !== undefined) {
      if (q.mode === '2' || q.mode === '6') throw new Error('Daikin: no set temperature in dry / fan mode');
      q.stemp = String(patch.targetTemp);
    }
    if (patch.fan !== undefined) q.f_rate = FAN_TO[patch.fan];
    if (patch.swing !== undefined) q.f_dir = patch.swing ? (c.f_dir && c.f_dir !== '0' ? c.f_dir : '1') : '0';
    if (q.stemp === undefined || q.stemp === '') q.stemp = '--';
    if (q.shum === undefined || q.shum === '') q.shum = '0';
    if (q.f_rate === undefined) q.f_rate = 'A';
    if (q.f_dir === undefined) q.f_dir = '0';
    const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    await this._get(u, `/aircon/set_control_info?${qs}`);
    Object.assign(c, q);
    publishAc(this.store, u.key, { ...patch, targetTemp: num(q.stemp) });
    setTimeout(() => this._poll().catch(() => {}), 2000).unref?.();
  }
}

module.exports = DaikinClient;
module.exports.parse = parse;
