'use strict';

// Zendure SolarFlow — official local API (zenSDK, github.com/Zendure/zenSDK).
// Each device runs an HTTP server on the LAN: GET /properties/report returns
// { sn, product, properties: {…}, packData: [{…}] }, POST /properties/write
// takes { sn, properties: { name: value } }. Supported (per Zendure):
// SolarFlow 800 / 800 Plus / 800 Pro / 1600 AC+ / 2400 AC / AC+ / Pro and
// SmartMeter 3CT. Newer firmware (EN 18031) keeps HTTP off until a HEMS is
// added in the Zendure app — add one, then leave the HEMS screen to apply.
//
// One LSH device per unit, `zendure/<sn>`: state of charge, PV / home / grid /
// battery power, remaining time, per-pack SOC and temperature, plus controls
// — AC mode (1 charge, 2 discharge), output and AC-charge limits (written with
// smartMode=1 so frequent changes don't wear the flash), target / minimum SOC.
//
// config.zendure = { devices: [{ host, name? }], pollInterval = 10 (s) }
// Tested against scripts/zendure-simulator.js (test/zendure.test.js) — not yet
// against a real unit.

const PollingClient = require('./polling-client');

const TIMEOUT_MS = 8000;
const kelvin10 = (v) => (Number.isFinite(Number(v)) ? Math.round((Number(v) - 2731)) / 10 : null);

// LSH sensors for a unit (packs added per pack index)
function sensorsFor(props, packs) {
  const has = (k) => k in props;
  const S = [
    { path: 'soc', label: 'Battery', unit: '%', format: 'number', homekit: 'battery-level' },
    { path: 'solar', label: 'Solar input', unit: 'W', format: 'number' },
    { path: 'home', label: 'Output to home', unit: 'W', format: 'number' },
    { path: 'charge', label: 'Battery charging', unit: 'W', format: 'number' },
    { path: 'discharge', label: 'Battery discharging', unit: 'W', format: 'number' },
    ...(has('gridInputPower') ? [{ path: 'gridInput', label: 'Grid input', unit: 'W', format: 'number' }] : []),
    ...(has('gridOffPower') ? [{ path: 'offGrid', label: 'Off-grid output', unit: 'W', format: 'number' }] : []),
    ...(has('remainOutTime') ? [{ path: 'remaining', label: 'Remaining time', unit: 'min', format: 'number' }] : []),
    ...(has('BatVolt') ? [{ path: 'voltage', label: 'Battery voltage', unit: 'V', format: 'number' }] : []),
    { path: 'error', label: 'Error', type: 'boolean', format: 'on-off' },
    // Controls
    { path: 'acMode', label: 'AC mode (1 charge, 2 discharge)', controllable: true, type: 'range', min: 1, max: 2, step: 1, writeCmd: 'set', capabilityId: 'acMode' },
    { path: 'outputLimit', label: 'Output limit', unit: 'W', controllable: true, type: 'range', min: 0, max: 2400, step: 10, writeCmd: 'set', capabilityId: 'outputLimit' },
    ...(has('inputLimit') ? [{ path: 'inputLimit', label: 'AC charge limit', unit: 'W', controllable: true, type: 'range', min: 0, max: 2400, step: 10, writeCmd: 'set', capabilityId: 'inputLimit' }] : []),
    { path: 'socSet', label: 'Target SOC', unit: '%', controllable: true, type: 'range', min: 70, max: 100, step: 1, writeCmd: 'set', capabilityId: 'socSet' },
    { path: 'minSoc', label: 'Minimum SOC', unit: '%', controllable: true, type: 'range', min: 0, max: 50, step: 1, writeCmd: 'set', capabilityId: 'minSoc' },
  ];
  packs.forEach((p, i) => {
    S.push({ path: `pack${i + 1}Soc`, label: `Pack ${i + 1} SOC`, unit: '%', format: 'number' });
    if ('maxTemp' in p) S.push({ path: `pack${i + 1}Temp`, label: `Pack ${i + 1} temperature`, unit: '°C', format: 'number' });
  });
  return S;
}

// Writable properties: LSH path → { zenSDK name, range, smartMode? }
const WRITES = {
  acMode: { prop: 'acMode', min: 1, max: 2 },
  outputLimit: { prop: 'outputLimit', min: 0, max: 2400, smart: true },
  inputLimit: { prop: 'inputLimit', min: 0, max: 2400, smart: true },
  socSet: { prop: 'socSet', min: 70, max: 100 },
  minSoc: { prop: 'minSoc', min: 0, max: 50 },
};

class ZendureClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'zendure', logTag: 'Zendure' });
    this.cfg = config.zendure || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.units = new Map(); // host → { sn, key }
  }

  async start() {
    const devs = Array.isArray(this.cfg.devices) ? this.cfg.devices.filter((d) => d?.host) : [];
    if (!devs.length) throw new Error('config.zendure.devices needs at least one { host }');
    this.devices = devs;
    await this.startPolling(Math.max(3, Number(this.cfg.pollInterval) || 10) * 1000);
  }

  _url(host, p) { return `${/^https?:\/\//.test(host) ? host.replace(/\/+$/, '') : `http://${host}`}${p}` }

  async _report(host) {
    const res = await fetch(this._url(host, '/properties/report'), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
    const j = await res.json();
    if (!j || typeof j.properties !== 'object') throw new Error(`${host}: no properties in the report — is the local API enabled (add a HEMS in the Zendure app)?`);
    return j;
  }

  async _pollImpl() {
    let ok = 0;
    const errors = [];
    for (const d of this.devices) {
      try { this._apply(d, await this._report(d.host)); ok++ }
      catch (err) { errors.push(err.message) }
    }
    if (!ok) throw new Error(errors.join('; '));
    if (errors.length) console.warn(`[Zendure] ${errors.join('; ')}`);
  }

  _apply(d, r) {
    const p = r.properties || {};
    const packs = Array.isArray(r.packData) ? r.packData : [];
    const sn = String(r.sn || d.host).replace(/[^A-Za-z0-9_-]/g, '');
    let u = this.units.get(d.host);
    if (!u) {
      u = { sn, key: `zendure/${sn}`, host: d.host };
      this.units.set(d.host, u);
      this.registry.registerDevice({
        key: u.key, label: d.name || `Zendure ${r.product || 'SolarFlow'}`, type: 'zendure', icon: '🔋', homekit: ['battery-level'],
        sensors: sensorsFor(p, packs),
        _writeCapability: (cap, cmd, args) => this.write(d.host, cap, args[0]),
      });
    }
    const k = (x, v) => { if (v !== null && v !== undefined && !Number.isNaN(v)) this.store.update(`${u.key}/${x}`, v) };
    k('soc', p.electricLevel);
    k('solar', p.solarInputPower);
    k('home', p.outputHomePower);
    k('charge', p.outputPackPower);
    k('discharge', p.packInputPower);
    k('gridInput', p.gridInputPower);
    k('offGrid', p.gridOffPower);
    k('remaining', p.remainOutTime);
    if (p.BatVolt != null) k('voltage', Number(p.BatVolt) / 100);
    k('error', p.is_error ? 1 : 0);
    for (const x of ['acMode', 'outputLimit', 'inputLimit', 'socSet', 'minSoc']) k(x, p[x]);
    packs.forEach((pk, i) => {
      k(`pack${i + 1}Soc`, pk.socLevel);
      if (pk.maxTemp != null) k(`pack${i + 1}Temp`, kelvin10(pk.maxTemp));
    });
  }

  async write(host, cap, value) {
    const w = WRITES[cap];
    const u = this.units.get(host);
    if (!w || !u) throw new Error(`Zendure: can't set ${cap}`);
    const v = Math.round(Number(value));
    if (!Number.isFinite(v) || v < w.min || v > w.max) throw new Error(`Zendure: ${cap} must be ${w.min}–${w.max}`);
    const properties = { [w.prop]: v, ...(w.smart ? { smartMode: 1 } : {}) };
    const res = await fetch(this._url(host, '/properties/write'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sn: u.sn, properties }), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Zendure: write ${cap} failed (HTTP ${res.status})`);
    this.store.update(`${u.key}/${cap}`, v);
    setTimeout(() => this._poll().catch(() => {}), 1500).unref?.();
  }
}

module.exports = ZendureClient;
