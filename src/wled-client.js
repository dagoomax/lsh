'use strict';

// WLED addressable-LED controllers (ESP8266/ESP32) via the local JSON HTTP API.
//
// Each configured controller is polled on /json (state + info) and registered
// as a dashboard light with power, brightness, RGB colour and — on RGBW
// strips — a separate white channel. Control is a POST to /json/state.
//
//   config.wled = { pollInterval: 5, devices: [ { name, host, port } ] }
//
// Devices are read from config.json on every poll, so Settings-page edits
// apply without a restart (same live-config pattern as the camera clients).

const http = require('http');
const path = require('path');
const fs   = require('fs');
const platformStatus = require('./platform-status');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const POLL_DEFAULT_S = 5;

function loadDevices() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return (cfg.wled?.devices || []).filter((d) => d && d.host);
  } catch { return []; }
}
function loadPollInterval() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Number(cfg.wled?.pollInterval) || POLL_DEFAULT_S;
  } catch { return POLL_DEFAULT_S; }
}

// ── HSV ↔ RGB (LSH colour capability is hue/saturation 0-100; WLED is RGB) ────
function hsvToRgb(h, s, v) { // h 0-360, s 0-100, v 0-100 → [r,g,b] 0-255
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r, g, b;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHsv(r, g, b) { // 0-255 → { h:0-360, s:0-100, v:0-100 }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: (max ? d / max : 0) * 100, v: max * 100 };
}

class WledClient {
  constructor(config, store, sensorRegistry) {
    this._store    = store;
    this._registry = sensorRegistry;
    this._timer    = null;
    this._known    = new Set();
    this._lastCol  = {}; // idx → last [r,g,b,w] so white edits preserve colour
  }

  async start() {
    const devs = loadDevices();
    if (!devs.length) return;
    platformStatus.set('wled', false);
    await this._poll();
    this._timer = setInterval(() => this._poll().catch(() => {}), Math.max(2, loadPollInterval()) * 1000);
    console.log(`[WLED] ${devs.length} controller(s)`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    platformStatus.set('wled', false);
  }

  async _poll() {
    const devs = loadDevices();
    let anyOk = false;
    await Promise.all(devs.map(async (d, idx) => {
      let json;
      try { json = await this._req(d, 'GET', '/json'); anyOk = true; }
      catch { return; }
      this._apply(idx, d, json);
    }));
    platformStatus.set('wled', anyOk);
  }

  _apply(idx, d, json) {
    const key  = `wled/${idx}`;
    const st   = json.state || {};
    const info = json.info  || {};
    const rgbw = !!info.leds?.rgbw;
    const col  = st.seg?.[0]?.col?.[0] || [0, 0, 0, 0];
    this._lastCol[idx] = col;

    if (!this._known.has(key)) {
      this._known.add(key);
      const sensors = [
        { path: 'switch', name: 'Power', format: 'on-off',
          controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
          capabilityId: 'switch', homekit: 'light-rw' },
        { path: 'level', name: 'Brightness', format: 'percent',
          controllable: true, type: 'range', capabilityId: 'switchLevel', writeCmd: 'setLevel',
          min: 0, max: 100, step: 1 },
        { path: 'hue',        name: 'Hue',        format: 'number', hidden: true },
        { path: 'saturation', name: 'Saturation', format: 'number', hidden: true },
        { path: 'color', name: 'Color', format: 'color',
          controllable: true, type: 'color', capabilityId: 'colorControl' },
      ];
      if (rgbw) sensors.push({ path: 'white', name: 'White', format: 'percent',
        controllable: true, type: 'range', capabilityId: 'white', writeCmd: 'setWhite',
        min: 0, max: 100, step: 1 });

      this._registry.registerDevice({
        key,
        label: d.name || info.name || `WLED ${d.host}`,
        type:  'wled',
        icon:  '💡',
        color: 'blue',
        sensors,
        homekit: ['light-rw'],
        _writeCapability: (capId, command, args = []) => this._write(idx, d, capId, command, args),
      });
      console.log(`[WLED] Registered ${d.name || info.name || d.host}`);
    }

    this._store.update(`${key}/switch`, st.on ? 1 : 0);
    if (st.bri != null) this._store.update(`${key}/level`, Math.round((st.bri / 255) * 100));
    const { h, s } = rgbToHsv(col[0] || 0, col[1] || 0, col[2] || 0);
    this._store.update(`${key}/hue`, Math.round(h / 3.6));
    this._store.update(`${key}/saturation`, Math.round(s));
    if (rgbw) this._store.update(`${key}/white`, Math.round(((col[3] || 0) / 255) * 100));
  }

  async _write(idx, d, capId, command, args) {
    let body = null;
    if (capId === 'switch') {
      body = { on: command === 'on' };
    } else if (capId === 'switchLevel') {
      const pct = Number(args[0]) || 0;
      body = { on: pct > 0, bri: Math.round((pct / 100) * 255) };
    } else if (capId === 'colorControl') {
      const { hue = 0, saturation = 100 } = args[0] || {};
      const [r, g, b] = hsvToRgb(hue * 3.6, saturation, 100);
      body = { on: true, seg: [{ col: [[r, g, b]] }] };
    } else if (capId === 'white') {
      const pct = Number(args[0]) || 0;
      const w = Math.round((pct / 100) * 255);
      const [r, g, b] = this._lastCol[idx] || [0, 0, 0]; // keep the current colour
      body = { on: true, seg: [{ col: [[r || 0, g || 0, b || 0, w]] }] };
    }
    if (!body) return;
    try { await this._req(d, 'POST', '/json/state', body); }
    catch (err) { console.error(`[WLED] Write failed for ${d.host}: ${err.message}`); }
  }

  // One-shot reachability check (used by the Settings "Test" button).
  static fetchState(d) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: d.host, port: Number(d.port) || 80, path: '/json', method: 'GET', timeout: 6000,
      }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        let out = '';
        res.on('data', (c) => out += c);
        res.on('end', () => { try { resolve(JSON.parse(out)); } catch { reject(new Error('Bad JSON from WLED')); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
      req.end();
    });
  }

  _req(d, method, pathname, body) {
    const data = body ? JSON.stringify(body) : null;
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: d.host, port: Number(d.port) || 80, path: pathname, method,
        timeout: 6000,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      }, (res) => {
        let out = '';
        res.on('data', (c) => out += c);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
          if (method === 'POST') return resolve(out);
          try { resolve(JSON.parse(out)); } catch { reject(new Error('Bad JSON from WLED')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end(data);
    });
  }
}

WledClient._test = { hsvToRgb, rgbToHsv };

module.exports = WledClient;
