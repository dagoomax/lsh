'use strict';

// Aquilo (aquilo.pl) liquid-level sensors — septic tanks, rainwater tanks,
// wells. The microwave transmitter in the tank talks to a WiFi receiver
// (gateway) plugged in indoors; that gateway answers on the LAN, without
// login, at GET http://<gateway>/state (the endpoint Aquilo's own Home
// Assistant guide uses):
//
//   { "sensors": [ { "id": "000000", "name": "TANK", "lvl": 125.6, "pct": 34,
//                    "bat": 76, "lstRead": "2026-01-01T12:00:00+01:00",
//                    "lstEmpty": "…", "daysLeft": 48, "lvlToFull": 121 } ],
//     "from": "node-1" }
//
// Older firmware sends only id / lvl / pct / lstRead — the other readings are
// added to a tank only once its gateway reports them. One gateway can carry
// several tanks; each becomes its own device (aquilo/<id>), and tanks that
// show up later are added on the next poll. The gateway just repeats the last
// transmission, so a tank whose lstRead stops moving is flagged stale.
//
// config.aquilo = { gateways: [{ host, name? }], pollSeconds: 300,
//                   staleHours: 24, overflowPct: 90, exclude: ['<tank id>'],
//                   names: { '<tank id>': 'Septic tank' } }

const http           = require('http');
const platformStatus = require('./platform-status');

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (v) => { if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null };

function fetchState(host, { timeout = 8000 } = {}) {
  const [hostname, port] = String(host).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':');
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname, port: Number(port) || 80, path: '/state', timeout, headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(new Error('Response too large')) });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${host}/state`));
        let data;
        try { data = JSON.parse(body) } catch { return reject(new Error(`${host}/state is not JSON — is this an Aquilo gateway?`)) }
        if (!data || !Array.isArray(data.sensors)) return reject(new Error(`${host}/state has no "sensors" list — is this an Aquilo gateway?`));
        resolve({ from: data.from || null, tanks: data.sensors.filter((s) => s && typeof s === 'object' && s.id != null).map(normalize) });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout talking to ${host}`)));
    req.on('error', reject);
  });
}

function normalize(s) {
  return {
    id: String(s.id),
    name: s.name ? String(s.name) : null,
    level: num(s.lvl),
    fill: num(s.pct),
    battery: num(s.bat),
    daysLeft: num(s.daysLeft),
    toFull: num(s.lvlToFull),
    lastRead: iso(s.lstRead),
    lastEmptied: iso(s.lstEmpty),
  };
}

// Readings that are only added to a tank once its gateway reports them
const OPTIONAL = [
  { key: 'battery',     sensor: { path: 'battery',     label: 'Battery',          sensorType: 'battery', unit: '%', format: 'percent' } },
  { key: 'daysLeft',    sensor: { path: 'daysLeft',    label: 'Days left',        sensorType: 'sensor',  unit: 'd' } },
  { key: 'toFull',      sensor: { path: 'toFull',      label: 'Level to full',    sensorType: 'sensor',  unit: 'cm' } },
  { key: 'lastEmptied', sensor: { path: 'lastEmptied', label: 'Last emptied',     sensorType: 'sensor' } },
];

class AquiloClient {
  constructor(config, store, sensorRegistry) {
    this._store    = store;
    this._registry = sensorRegistry;
    this._timer    = null;
    this.tanks     = new Map(); // tank id → { id, gateway, deviceKey, data, at }
    this.gateways  = new Map(); // host → { host, name, ok, error, at, from, tankIds }
    this.configure(config.aquilo || {});
  }

  configure(cfg = {}) {
    this.cfg = {
      gateways:    (cfg.gateways || cfg.devices || []).filter((g) => g && g.host).map((g) => ({ host: String(g.host).trim(), name: g.name || '' })),
      pollSeconds: Math.max(30, Number(cfg.pollSeconds) || 300),
      staleHours:  Math.max(1, Number(cfg.staleHours) || 24),
      overflowPct: Math.min(100, Math.max(1, Number(cfg.overflowPct) || 90)),
      exclude:     new Set((cfg.exclude || []).map(String)),
      names:       cfg.names || {},
    };
    for (const host of [...this.gateways.keys()]) if (!this.cfg.gateways.some((g) => g.host === host)) this.gateways.delete(host);

    // Live changes to tanks already registered: dropped (excluded / gateway
    // removed) or renamed
    let changed = false;
    for (const t of [...this.tanks.values()]) {
      const dev = this._registry?.devices?.get(t.deviceKey);
      if (this.cfg.exclude.has(t.id) || !this.cfg.gateways.some((g) => g.host === t.gateway)) {
        this.tanks.delete(t.id);
        if (dev) { this._registry.devices.delete(t.deviceKey); changed = true }
        continue;
      }
      const label = this.cfg.names[t.id] || t.data.name || `Tank ${t.id}`;
      if (dev && dev.label !== label) { dev.label = label; this._registry._applyOverride?.(dev); changed = true }
    }
    if (changed) this._registry.emit?.('devices-changed');
  }

  async start() {
    await this.pollAll();
    this._schedule();
  }

  // Settings saved while running: new gateways / thresholds apply right away
  async reconfigure(cfg) {
    this.configure(cfg);
    await this.pollAll();
    this._schedule();
  }

  stop() { if (this._timer) clearInterval(this._timer); this._timer = null }

  _schedule() {
    this.stop();
    this._timer = setInterval(() => this.pollAll().catch(() => {}), this.cfg.pollSeconds * 1000);
    this._timer.unref?.();
  }

  async pollAll() {
    await Promise.all(this.cfg.gateways.map((g) => this._poll(g)));
    platformStatus.set('aquilo', [...this.gateways.values()].some((g) => g.ok));
    // stale flags move on their own as time passes, not only on new data
    for (const t of this.tanks.values()) this._applyFlags(t);
  }

  async _poll(gw) {
    const prev = this.gateways.get(gw.host) || {};
    try {
      const state = await fetchState(gw.host);
      this.gateways.set(gw.host, { host: gw.host, name: gw.name, ok: true, error: null, at: Date.now(), from: state.from, tankIds: state.tanks.map((t) => t.id) });
      for (const t of state.tanks) this._update(gw, t);
      if (!prev.ok) console.log(`[Aquilo] ${gw.host}: ${state.tanks.length} tank(s)`);
    } catch (err) {
      if (prev.ok !== false || prev.error !== err.message) console.error(`[Aquilo] ${gw.host}: ${err.message}`);
      this.gateways.set(gw.host, { ...prev, host: gw.host, name: gw.name, ok: false, error: err.message, at: Date.now() });
      for (const t of this.tanks.values()) if (t.gateway === gw.host) this._store.set(`${t.deviceKey}/online`, false);
    }
  }

  _update(gw, data) {
    if (this.cfg.exclude.has(data.id)) return;
    let t = this.tanks.get(data.id);
    if (!t) {
      t = { id: data.id, gateway: gw.host, deviceKey: `aquilo/${data.id.replace(/[^\w-]/g, '_')}`, data };
      this.tanks.set(data.id, t);
      this._register(t, gw);
    }
    t.gateway = gw.host;
    t.data = data;
    t.at = Date.now();
    this._addOptional(t);

    const set = (k, v) => { if (v !== null && v !== undefined) this._store.set(`${t.deviceKey}/${k}`, v) };
    set('fill', data.fill);
    set('level', data.level);
    set('battery', data.battery);
    set('daysLeft', data.daysLeft);
    set('toFull', data.toFull);
    set('lastRead', data.lastRead);
    set('lastEmptied', data.lastEmptied);
    this._store.set(`${t.deviceKey}/online`, true);
    this._applyFlags(t);
  }

  _applyFlags(t) {
    const { lastRead, fill } = t.data;
    const age = lastRead ? Date.now() - Date.parse(lastRead) : Infinity;
    this._store.set(`${t.deviceKey}/stale`, age > this.cfg.staleHours * 3600e3);
    this._store.set(`${t.deviceKey}/overflow`, fill !== null && fill >= this.cfg.overflowPct);
  }

  _register(t, gw) {
    const name = this.cfg.names[t.id] || t.data.name || `Tank ${t.id}`;
    this._registry.registerDevice({
      key:      t.deviceKey,
      label:    name,
      type:     'aquilo',
      category: 'tank',
      model:    'Aquilo liquid-level sensor',
      sensors: [
        { path: 'fill',     label: 'Fill',           sensorType: 'sensor',  unit: '%',  format: 'percent', homekit: 'tank-level' },
        { path: 'level',    label: 'Level',          sensorType: 'sensor',  unit: 'cm' },
        { path: 'overflow', label: 'Overflow risk',  sensorType: 'alarm',   format: 'alarm', homekit: 'leak' },
        { path: 'stale',    label: 'Stale data',     sensorType: 'trouble', format: 'alarm' },
        { path: 'lastRead', label: 'Last reading',   sensorType: 'sensor' },
        { path: 'online',   label: 'Gateway online', sensorType: 'connectivity', format: 'on-off', hidden: true },
      ],
      homekit: ['tank', 'leak'],
    });
    console.log(`[Aquilo] Registered ${name} (${t.id}) via ${gw.host}`);
  }

  // registerDevice ignores re-registration — add late readings to the existing device
  _addOptional(t) {
    const dev = this._registry.devices?.get(t.deviceKey);
    if (!dev) return;
    for (const o of OPTIONAL) {
      if (t.data[o.key] === null || dev.sensors.some((s) => s.path === o.sensor.path)) continue;
      dev.sensors.push({ ...o.sensor });
    }
  }

  status() {
    return {
      gateways: this.cfg.gateways.map((g) => ({ host: g.host, name: g.name, ...(this.gateways.get(g.host) || {}) })),
      tanks: [...this.tanks.values()].map((t) => ({
        id: t.id, gateway: t.gateway, deviceKey: t.deviceKey, ...t.data,
        stale: !!this._store.get(`${t.deviceKey}/stale`), overflow: !!this._store.get(`${t.deviceKey}/overflow`),
      })),
      excluded: [...this.cfg.exclude],
      staleHours: this.cfg.staleHours, overflowPct: this.cfg.overflowPct, pollSeconds: this.cfg.pollSeconds,
    };
  }
}

AquiloClient.fetchState = fetchState;
module.exports = AquiloClient;
