'use strict';

const http           = require('http');
const https          = require('https');
const platformStatus = require('./platform-status');

/**
 * Z-Way / RaZberry client — Z-Wave.Me ZAutomation v1 REST API.
 *
 * Covers any Z-Way installation: RaZberry boards, UZB sticks, Z-Way on a
 * Raspberry Pi. Virtual devices (vDevs) are discovered from
 * /ZAutomation/api/v1/devices, grouped per physical Z-Wave node
 * (ZWayVDev_zway_<node>-…), and polled for state. Commands go through
 * /devices/<vdev>/command/<cmd>.
 */

// deviceType → sensor descriptor behaviour
const SKIP_TYPES = new Set(['camera', 'text', 'sensorDiscrete', 'switchControl']);

class ZWayClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._sid      = null;
    this._timer    = null;
    this._nodes    = new Map(); // deviceKey → { registered: bool }
  }

  async start() {
    const cfg = this._config.zway;
    if (!cfg?.host) return;

    console.log(`[Z-Way] Starting — ${cfg.host}:${cfg.port || 8083}`);
    platformStatus.set('zway', false);
    await this._login();

    await this._poll(true);
    const interval = (cfg.pollInterval || 10) * 1000;
    this._timer = setInterval(() => this._poll().catch((err) => {
      console.error(`[Z-Way] Poll error: ${err.message}`);
      platformStatus.set('zway', false);
    }), interval);
    console.log(`[Z-Way] Started — polling every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  async _login() {
    const cfg = this._config.zway;
    const res = await this._req('POST', '/ZAutomation/api/v1/login', {
      login: cfg.username || 'admin',
      password: cfg.password || '',
    }, true);
    this._sid = res?.data?.sid;
    if (!this._sid) throw new Error('Login failed — no session id');
    console.log('[Z-Way] Login OK');
  }

  // ── Discovery & polling ─────────────────────────────────────────────────

  async _poll(initial = false) {
    let res;
    try {
      res = await this._req('GET', '/ZAutomation/api/v1/devices');
    } catch (err) {
      if (!/401|403/.test(err.message)) throw err;
      await this._login(); // session expired — re-auth once
      res = await this._req('GET', '/ZAutomation/api/v1/devices');
    }

    const vdevs = (res?.data?.devices || []).filter((d) =>
      !d.permanently_hidden && d.visibility !== false && !SKIP_TYPES.has(d.deviceType));

    // Group per physical node; app-created virtual devices stand alone
    const groups = new Map();
    for (const d of vdevs) {
      const m = /^ZWayVDev_zway_(\d+)-/.exec(d.id);
      const groupKey = m ? `zway/node_${m[1]}` : `zway/${sanitize(d.id)}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(d);
    }

    for (const [deviceKey, devs] of groups) {
      if (!this._nodes.has(deviceKey)) this._registerNode(deviceKey, devs);
      for (const d of devs) this._updateValue(deviceKey, d);
    }

    platformStatus.set('zway', true);
    if (initial) console.log(`[Z-Way] Discovered ${groups.size} device(s) from ${vdevs.length} vDev(s)`);
  }

  _registerNode(deviceKey, vdevs) {
    this._nodes.set(deviceKey, true);
    const sensors = vdevs.map((d) => this._sensorDescriptor(d)).filter(Boolean);
    if (!sensors.length) return;

    // Node label: common prefix of the vDev titles ("Garage Light"+"Garage
    // Temp" → "Garage"); falls back to the first title
    const titles = vdevs.map((d) => d.metrics?.title).filter(Boolean);
    let label = titles[0] || deviceKey;
    if (titles.length > 1) {
      let prefix = titles[0];
      for (const t of titles) { while (prefix && !t.startsWith(prefix)) prefix = prefix.slice(0, -1); }
      prefix = prefix.replace(/[\s\-–—:(]+$/, '');
      if (prefix.length >= 3) label = prefix;
    }

    // Bridge the first temperature-ish sensor to HomeKit
    const homekit = sensors.some((s) => s.homekit === 'temperature') ? ['temperature'] : [];

    this._registry.registerDevice({
      key:     deviceKey,
      label,
      type:    'zway',
      homekit,
      sensors,
      _writeCapability: (capId, command, args = []) => this._command(capId, command, args),
    });
  }

  _sensorDescriptor(d) {
    const path  = sanitize(d.id.replace(/^ZWayVDev_zway_\d+-/, '') || d.id);
    const name  = d.metrics?.title || path;
    const unit  = d.metrics?.scaleTitle || '';

    switch (d.deviceType) {
      case 'switchBinary':
        return { path, name, type: 'boolean', format: 'on-off', controllable: true,
          capabilityId: d.id, writeOn: 'on', writeOff: 'off' };
      case 'switchMultilevel':
        return { path, name, type: 'range', controllable: true,
          capabilityId: d.id, writeCmd: 'exact', min: 0, max: 99 };
      case 'thermostat':
        return { path, name, type: 'range', unit: unit || '°C', controllable: true,
          capabilityId: d.id, writeCmd: 'exact', min: 5, max: 40 };
      case 'doorlock':
        return { path, name, type: 'boolean', format: 'on-off', controllable: true,
          capabilityId: d.id, writeOn: 'close', writeOff: 'open' };
      case 'toggleButton':
        return { path, name, type: 'trigger', controllable: true,
          capabilityId: d.id, writeOn: 'on' };
      case 'sensorBinary':
        return { path, name, type: 'boolean', format: 'on-off' };
      case 'battery':
        return { path, name, type: 'number', unit: '%', precision: 0 };
      case 'sensorMultilevel':
      default:
        return { path, name, type: 'number', unit, precision: 1,
          ...(unit === '°C' ? { homekit: 'temperature' } : {}) };
    }
  }

  _updateValue(deviceKey, d) {
    const path  = sanitize(d.id.replace(/^ZWayVDev_zway_\d+-/, '') || d.id);
    const level = d.metrics?.level;
    if (level === undefined || level === null) return;

    let value = level;
    if (level === 'on'  || level === 'close') value = 1;
    if (level === 'off' || level === 'open')  value = 0;
    if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) value = Number(value);
    if (typeof value !== 'number') return;

    this._store.update(`${deviceKey}/${path}`, value);
  }

  // ── Commands ────────────────────────────────────────────────────────────

  async _command(vdevId, command, args) {
    let cmd = command;
    if (command === 'exact') cmd = `exact?level=${encodeURIComponent(Math.round(Number(args[0])))}`;
    await this._req('GET', `/ZAutomation/api/v1/devices/${encodeURIComponent(vdevId)}/command/${cmd}`);
    setTimeout(() => this._poll().catch(() => {}), 1500);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────

  _req(method, path, body, isLogin = false) {
    const cfg     = this._config.zway;
    const payload = body ? JSON.stringify(body) : null;
    const proto   = cfg.https ? https : http;

    return new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json' };
      if (payload) {
        headers['Content-Type']   = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (this._sid && !isLogin) headers.ZWAYSession = this._sid;

      const req = proto.request({
        hostname: cfg.host, port: cfg.port || 8083, path, method, headers, timeout: 12_000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`${method} ${path} → ${res.statusCode}: ${text.slice(0, 100)}`));
          }
          if (!text) return resolve(null);
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error(`Bad JSON from ${path}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${path}`)); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = ZWayClient;
