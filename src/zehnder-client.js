'use strict';

// Zehnder heat-recovery ventilation (rekuperacja) — one LSH device per unit,
// whichever way it's reached:
//   type 'lanc'  ComfoAir Q / Flex via ComfoConnect LAN C (src/zehnder/lanc.js)
//   type 'pro'   ComfoAir Q via ComfoConnect Pro, Modbus TCP (src/zehnder/pro.js)
//   type 'ca350' ComfoAir 350 / 550 (WHR930…) via RS232 (src/zehnder/ca350.js)
//
// config.zehnder = { units: [{ type, host, name?, port?, pin?, uuid?, unitId?,
//   serialPort?, rs232Mode?, pollSeconds? }], boostMinutes: 60, awayHours: 0 (= until cancelled) }
//
// Common paths (each unit gets the ones its interface provides): speed 0–3
// (away / low / medium / high), auto, boost, away, profile (0 normal, 1 cool,
// 2 warm), bypassMode (0 auto, 1 open, 2 closed), targetTemp, temperatures /
// humidities of the four air streams, flows, fan duty / rpm, power, energy,
// filter days / alarm, errors. For HomeKit the unit is a fan: on = not away,
// rotation speed = level (33 / 67 / 100 %).

const fs             = require('fs');
const path           = require('path');
const platformStatus = require('./platform-status');

const BACKENDS = {
  lanc:  () => require('./zehnder/lanc'),
  pro:   () => require('./zehnder/pro'),
  ca350: () => require('./zehnder/ca350'),
};
const TYPE_LABEL = { lanc: 'ComfoConnect LAN C', pro: 'ComfoConnect Pro', ca350: 'ComfoAir RS232' };
const STATE_FILE = process.env.LSH_ZEHNDER_STATE || path.join(__dirname, '..', 'persist', 'zehnder.json');

const t = (unit) => ({ sensorType: 'temperature', unit: '°C', ...unit });
const h = (extra) => ({ sensorType: 'humidity', unit: '%', ...extra });
const DESCR = {
  speed:      { label: 'Ventilation level', controllable: true, type: 'range', min: 0, max: 3, rangeFormat: 'raw', writeCmd: 'set', capabilityId: 'speed' },
  auto:       { label: 'Auto mode', sensorType: 'switch', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'auto' },
  boost:      { label: 'Boost', sensorType: 'switch', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'boost' },
  away:       { label: 'Away', sensorType: 'switch', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'away' },
  profile:    { label: 'Temperature profile', controllable: true, type: 'range', min: 0, max: 2, rangeFormat: 'raw', writeCmd: 'set', capabilityId: 'profile' },
  bypassMode: { label: 'Bypass mode', controllable: true, type: 'range', min: 0, max: 2, rangeFormat: 'raw', writeCmd: 'set', capabilityId: 'bypassMode' },
  targetTemp: { label: 'Comfort temperature', ...t() },
  resetErrors:{ label: 'Reset errors', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'resetErrors' },
  resetFilter:{ label: 'Filter replaced', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'resetFilter' },
  outdoorTemp:{ label: 'Outdoor air', ...t() },
  supplyTemp: { label: 'Supply air', ...t() },
  extractTemp:{ label: 'Extract air (room)', ...t({ homekit: 'temperature' }) },
  exhaustTemp:{ label: 'Exhaust air', ...t() },
  roomTemp:   { label: 'Room', ...t() },
  outdoorHumidity: { label: 'Outdoor humidity', ...h() },
  supplyHumidity:  { label: 'Supply humidity', ...h() },
  extractHumidity: { label: 'Extract humidity (room)', ...h({ homekit: 'humidity' }) },
  exhaustHumidity: { label: 'Exhaust humidity', ...h() },
  roomHumidity:    { label: 'Room humidity', ...h() },
  airflow:    { label: 'Air flow', sensorType: 'sensor', unit: 'm³/h' },
  supplyFlow: { label: 'Supply flow', sensorType: 'sensor', unit: 'm³/h' },
  exhaustFlow:{ label: 'Exhaust flow', sensorType: 'sensor', unit: 'm³/h' },
  supplyFanDuty:  { label: 'Supply fan', sensorType: 'sensor', unit: '%' },
  exhaustFanDuty: { label: 'Exhaust fan', sensorType: 'sensor', unit: '%' },
  supplyFanRpm:   { label: 'Supply fan speed', sensorType: 'sensor', unit: 'rpm' },
  exhaustFanRpm:  { label: 'Exhaust fan speed', sensorType: 'sensor', unit: 'rpm' },
  power:      { label: 'Power', sensorType: 'power', unit: 'W' },
  energy:     { label: 'Energy (total)', sensorType: 'energy', unit: 'kWh' },
  energyYear: { label: 'Energy (this year)', sensorType: 'energy', unit: 'kWh' },
  preheaterPower: { label: 'Pre-heater', sensorType: 'power', unit: 'W' },
  bypass:     { label: 'Bypass', sensorType: 'sensor', unit: '%' },
  filterDays: { label: 'Filter change in', sensorType: 'sensor', unit: 'd' },
  filterAlarm:{ label: 'Filter alarm', sensorType: 'alarm' },
  error:      { label: 'Error', sensorType: 'alarm' },
  errors:     { label: 'Messages', sensorType: 'sensor' },
  standby:    { label: 'Standby', sensorType: 'sensor' },
  connection: { label: 'Unit connection', sensorType: 'sensor' },
};
const co2 = (z) => ({ label: `CO₂ zone ${z}`, sensorType: 'sensor', unit: 'ppm' });
const TOGGLES = new Set(['auto', 'boost', 'away', 'error', 'filterAlarm', 'standby']);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} } }
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

class ZehnderClient {
  constructor(config, store, sensorRegistry) {
    this._store    = store;
    this._registry = sensorRegistry;
    this.cfg       = config.zehnder || {};
    this.units     = new Map(); // id → { id, cfg, backend, deviceKey, error, values }
  }

  // The LAN C gateway registers apps by a uuid — keep ours stable across restarts
  _localUuid() {
    if (this.cfg.localUuid) return this.cfg.localUuid;
    const s = loadState();
    if (!s.localUuid) { s.localUuid = BACKENDS.lanc().newLocalUuid(); saveState(s) }
    return s.localUuid;
  }

  async start() {
    const list = (this.cfg.units || this.cfg.devices || []).filter((u) => u && BACKENDS[u.type || 'lanc'] && (u.host || u.serialPort));
    await Promise.all(list.map((u) => this._startUnit(u)));
    this._status();
  }

  stop() { for (const u of this.units.values()) try { u.backend.stop() } catch {} }

  _status() { platformStatus.set('zehnder', [...this.units.values()].some((u) => u.backend.connected)) }

  async _startUnit(cfg) {
    const type = cfg.type || 'lanc';
    const id = slug(cfg.id || cfg.host || cfg.serialPort);
    const Backend = BACKENDS[type]();
    const opts = { ...cfg, pollSeconds: Number(cfg.pollSeconds) || undefined };
    if (type === 'lanc') Object.assign(opts, { localUuid: this._localUuid(), name: cfg.appName || 'LSH', port: Number(cfg.port) || undefined });
    if (type === 'pro') Object.assign(opts, { port: Number(cfg.port) || 502, unitId: Number(cfg.unitId) || 1 });
    for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
    const backend = new Backend(opts);
    const u = { id, type, cfg, backend, deviceKey: `zehnder/${id}`, error: null, values: {} };
    this.units.set(id, u);
    this._register(u);

    backend.on('data', (d) => this._apply(u, d));
    backend.on('state', (on) => { this._store.set(`${u.deviceKey}/online`, on ? 1 : 0); if (on) u.error = null; this._status() });
    backend.on('debug', (m) => { u.error = m; console.log(`[Zehnder] ${id}: ${m}`) });
    try {
      await backend.start();
      console.log(`[Zehnder] ${u.label} connected (${TYPE_LABEL[type]})`);
    } catch (err) {
      u.error = err.message;
      this._store.set(`${u.deviceKey}/online`, 0);
      console.error(`[Zehnder] ${id} (${TYPE_LABEL[type]}): ${err.message}`);
    }
  }

  _register(u) {
    u.label = u.cfg.name || `Zehnder ${u.type === 'ca350' ? 'ComfoAir' : 'ComfoAir Q'}`;
    const sensors = u.backend.paths.filter((p) => DESCR[p]).map((p) => ({ path: p, ...DESCR[p] }));
    // ComfoAir 350: comfort temperature is a setting there
    if (u.type === 'ca350') Object.assign(sensors.find((s) => s.path === 'targetTemp'), { controllable: true, type: 'range', min: 12, max: 28, rangeFormat: 'raw', writeCmd: 'set', capabilityId: 'targetTemp' });
    sensors.push(
      { path: 'switch', label: 'Ventilation on', hidden: true, controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch' },
      { path: 'level', label: 'Fan level', unit: '%', hidden: true, controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setLevel', capabilityId: 'switchLevel' },
      { path: 'online', label: 'Online', sensorType: 'connectivity', hidden: true },
    );
    const homekit = ['fan-rw'];
    if (sensors.some((s) => s.homekit === 'temperature')) homekit.push('temperature');
    if (sensors.some((s) => s.homekit === 'humidity')) homekit.push('humidity');
    this._registry.registerDevice({
      key: u.deviceKey, label: u.label, type: 'zehnder', category: 'ventilation', model: TYPE_LABEL[u.type],
      sensors, homekit,
      _writeCapability: (capId, command, args = []) => this.command(u.id, capId, command, args),
    });
  }

  _apply(u, d) {
    const dev = this._registry.devices?.get(u.deviceKey);
    for (const [k, raw] of Object.entries(d)) {
      if (raw === null || raw === undefined) continue;
      const v = TOGGLES.has(k) ? (raw ? 1 : 0) : raw;
      u.values[k] = v;
      // readings that only some units report (CO₂ zones, connection) join the device when first seen
      if (dev && !dev.sensors.some((s) => s.path === k)) {
        const m = /^co2Zone(\d)$/.exec(k);
        const desc = m ? co2(m[1]) : DESCR[k];
        if (desc) dev.sensors.push({ path: k, ...desc });
      }
      this._store.set(`${u.deviceKey}/${k}`, v);
    }
    // HomeKit fan view
    const speed = u.values.speed, away = u.values.away;
    if (speed !== undefined) {
      this._store.set(`${u.deviceKey}/switch`, speed > 0 && away !== 1 ? 1 : 0);
      this._store.set(`${u.deviceKey}/level`, Math.round((speed * 100) / 3));
    }
  }

  async command(id, capId, command, args = []) {
    const u = this.units.get(id);
    if (!u) throw new Error(`Unknown Zehnder unit ${id}`);
    if (!u.backend.connected && u.type === 'lanc') throw new Error(`${u.label} is not connected${u.error ? ` (${u.error})` : ''}`);
    const arg = args[0];
    // away: indefinite unless awayHours is set (LAN C takes -1 as "until cancelled"); boost: boostMinutes
    const awaySeconds = Number(this.cfg.awayHours) > 0 ? Number(this.cfg.awayHours) * 3600 : -1;
    const seconds = capId === 'boost' ? (Number(this.cfg.boostMinutes) || 60) * 60 : awaySeconds;
    let out;
    switch (capId) {
      case 'switch': // HomeKit Active: off = away, on = leave away (or step up from level 0)
        if (command === 'off') out = u.backend.paths.includes('away') ? await u.backend.set('away', 1, { seconds }) : await u.backend.set('speed', 0);
        else if (u.values.away === 1) out = await u.backend.set('away', 0, { seconds });
        else if (!u.values.speed) out = await u.backend.set('speed', 1);
        break;
      case 'switchLevel': {
        const step = Math.max(0, Math.min(3, Math.round(Number(arg) / (100 / 3))));
        if (step > 0 && u.values.away === 1 && u.backend.paths.includes('away')) await u.backend.set('away', 0, { seconds });
        out = await u.backend.set('speed', step);
        break;
      }
      case 'auto': case 'boost': case 'away':
        out = await u.backend.set(capId, command === 'on' ? 1 : 0, { seconds });
        break;
      case 'resetErrors': case 'resetFilter':
        out = await u.backend.set(capId, 1);
        break;
      default:
        out = await u.backend.set(capId, Number(arg));
    }
    if (out && typeof out === 'object') this._apply(u, out);
  }

  status() {
    return [...this.units.values()].map((u) => ({
      id: u.id, type: u.type, typeLabel: TYPE_LABEL[u.type], label: u.label, deviceKey: u.deviceKey,
      host: u.cfg.host || null, serialPort: u.cfg.serialPort || null,
      connected: !!u.backend.connected, error: u.backend.connected ? null : u.error, info: u.backend.info || {},
      values: u.values,
    }));
  }
}

ZehnderClient.BACKENDS = BACKENDS;
module.exports = ZehnderClient;
