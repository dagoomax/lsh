'use strict';

// Sensibo Sky / Air / Air Pro / Elements — the official Sensibo cloud API
// (home.sensibo.com/api/v2, API key from home.sensibo.com/me/api). A Sensibo
// drives almost any IR-remote air conditioner, so this is also the way to
// bring brands with no open API (Fujitsu, Panasonic, Toshiba, Hitachi,
// Haier, Hisense, Sharp…) into LSH.
//
//   GET  /users/me/pods?fields=id,room,acState,measurements,connectionStatus,remoteCapabilities
//   POST /pods/<id>/acStates  { acState: { on, mode, targetTemperature, temperatureUnit, fanLevel, swing } }
//
//   mode cool / heat / fan / dry / auto · fanLevel quiet, low, medium_low,
//   medium, medium_high, high, strong, auto (what the remote has: remoteCapabilities)
//   swing stopped / rangeFull / …
//
// One LSH device per pod, `sensibo/<id>`:
//   Sky / Air / Air Pro   the shared AC model of src/ac-common.js; humidity
//                         from the pod, CO₂ + TVOC on the Air Pro, Climate
//                         React on/off (PUT /pods/<id>/smartmode), filter alert
//   Pure                  air purifier: power, fan (auto/low/high), PM2.5
//                         index → HomeKit air quality, filter alert
//   Elements              air-quality monitor: CO₂, TVOC, PM2.5, temperature,
//                         humidity → HomeKit air quality + CO₂
// and one per Room Sensor (Sky / Air accessory), `sensibo/<sensorId>`:
//   motion (HomeKit), temperature, humidity.
//
// config.sensibo = { apiKey, pollInterval = 60 (s) }   (apiBase overrides for tests)
// Tested against scripts/sensibo-simulator.js (test/sensibo.test.js) — not
// yet against a real pod; the Pure / Elements / Room Sensor fields follow
// Sensibo's API docs and community integrations, unchecked on hardware.

const PollingClient = require('./polling-client');
const { registerAc, publishAc } = require('./ac-common');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIELDS = 'id,room,productModel,acState,measurements,connectionStatus,remoteCapabilities,smartMode,filtersCleaning,motionSensors';
const isPure = (p) => /^pure/i.test(p.productModel || '');
const isElements = (p) => /^elements/i.test(p.productModel || '');
// Pure purifier fan: LSH 0 auto, 1 low, 2 high
const PURE_FAN = ['auto', 'low', 'high'];
// HomeKit air quality (homekit-bridge.js reads an AQI-like 0–500 number)
// from PM2.5 µg/m³, or from the Pure's 1 good / 2 moderate / 3 bad index
function aqiFromPm25(v) {
  if (v == null) return undefined;
  return v <= 12 ? 25 : v <= 35 ? 75 : v <= 55 ? 125 : v <= 150 ? 175 : 250;
}
const aqiFromIndex = (v) => (v == null ? undefined : ({ 1: 25, 2: 75, 3: 175 })[v] ?? 250);
const opt = (m, k) => m && m[k] !== undefined && m[k] !== null;

const TIMEOUT_MS = 15000;
// LSH fan 0–5 → Sensibo levels to try, in order
const FAN_PREF = [['auto'], ['quiet', 'low'], ['low', 'medium_low', 'quiet'], ['medium', 'medium_low', 'medium_high'], ['high', 'medium_high', 'strong'], ['strong', 'high']];
const FAN_FROM = { auto: 0, quiet: 1, low: 2, medium_low: 2, medium: 3, medium_high: 4, high: 4, strong: 5 };

class SensiboClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'sensibo', logTag: 'Sensibo' });
    this.cfg = config.sensibo || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || 'https://home.sensibo.com/api/v2').replace(/\/+$/, '');
    this.pods = new Map(); // id → { id, key, state, caps }
    // Sensibo's cloud rate-limits bursts — a scene that sets several AC units
    // at once used to fire all the POSTs in the same tick and get 429s. Space
    // every request out through one serial gate, and retry a 429 once after a
    // pause, so bursts drain smoothly instead of failing. 0 disables (tests).
    this._minGap = this.cfg.minRequestGapMs != null ? Number(this.cfg.minRequestGapMs) : 350;
    this._retry429Ms = this.cfg.retry429Ms != null ? Number(this.cfg.retry429Ms) : 1500;
    this._gate = Promise.resolve();
    this._lastCall = 0;
  }

  // Serialize requests and keep them ≥ _minGap apart (chained so concurrent
  // callers queue rather than all fire at once).
  _throttle() {
    const run = this._gate.then(async () => {
      const wait = this._minGap - (Date.now() - this._lastCall);
      if (wait > 0) await sleep(wait);
      this._lastCall = Date.now();
    });
    this._gate = run.catch(() => {});
    return run;
  }

  async start() {
    if (!this.cfg.apiKey) throw new Error('config.sensibo needs apiKey (home.sensibo.com/me/api)');
    await this.startPolling(Math.max(30, Number(this.cfg.pollInterval) || 60) * 1000);
  }

  async _call(method, p, body, _retried = false) {
    if (this._minGap > 0) await this._throttle();
    const sep = p.includes('?') ? '&' : '?';
    const res = await fetch(`${this.api}${p}${sep}apiKey=${encodeURIComponent(this.cfg.apiKey)}`, {
      method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Sensibo: API key rejected');
    if (res.status === 429) {
      if (!_retried) { await sleep(this._retry429Ms); return this._call(method, p, body, true); }
      throw new Error('Sensibo: too many requests — raise pollInterval');
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.status !== 'success') throw new Error(`Sensibo ${p.split('?')[0]}: ${j.reason || j.message || `HTTP ${res.status}`}`);
    return j.result;
  }

  async _pollImpl() {
    const pods = await this._call('GET', `/users/me/pods?fields=${FIELDS}`);
    if (!Array.isArray(pods) || !pods.length) throw new Error('Sensibo: no devices on this account');
    for (const p of pods) {
      for (const ms of p.motionSensors || []) this._roomSensor(p, ms);
      if (isPure(p)) { this._pure(p); continue }
      if (isElements(p)) { this._elements(p); continue }
      let u = this.pods.get(p.id);
      if (!u) {
        u = { id: p.id, key: `sensibo/${String(p.id).replace(/[^A-Za-z0-9_-]/g, '')}` };
        this.pods.set(p.id, u);
        const temps = Object.values(p.remoteCapabilities?.modes || {}).flatMap((m) => m.temperatures?.C?.values || []);
        const m0 = p.measurements || {};
        const extraSensors = [
          ...(p.smartMode !== undefined ? [{ path: 'climateReact', label: 'Climate React', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'climateReact' }] : []),
          ...(opt(m0, 'co2') ? [{ path: 'carbonDioxide', label: 'CO₂', unit: 'ppm', format: 'number' }] : []),
          ...(opt(m0, 'tvoc') ? [{ path: 'tvocLevel', label: 'TVOC', unit: 'ppb', format: 'number' }] : []),
          ...(p.filtersCleaning !== undefined ? [{ path: 'filterClean', label: 'Clean the filter', format: 'on-off', type: 'boolean' }] : []),
        ];
        registerAc(this.registry, {
          key: u.key, label: p.room?.name || `Sensibo ${p.id}`, type: 'sensibo', model: 'Sensibo',
          features: {
            swing: Object.values(p.remoteCapabilities?.modes || {}).some((m) => (m.swing || []).length > 1), humidity: true,
            minTemp: temps.length ? Math.min(...temps) : 16, maxTemp: temps.length ? Math.max(...temps) : 30, step: 1,
          },
          set: (patch) => this.set(u, patch),
          extraSensors,
          extraWrite: (cap, cmd) => this.setClimateReact(u, cmd === 'on'),
          homekit: opt(m0, 'co2') ? ['co2-sensor'] : [],
        });
        console.log(`[Sensibo] ${p.room?.name || p.id}`);
      }
      u.state = p.acState || {};
      u.caps = p.remoteCapabilities || {};
      const a = u.state, m = p.measurements || {};
      const toC = (v) => (v == null ? undefined : a.temperatureUnit === 'F' ? Math.round(((v - 32) * 5) / 9 * 2) / 2 : v);
      publishAc(this.store, u.key, {
        online: p.connectionStatus?.isAlive !== false, power: !!a.on, mode: a.mode, targetTemp: toC(a.targetTemperature),
        fan: FAN_FROM[a.fanLevel], swing: a.swing !== undefined ? a.swing !== 'stopped' : undefined,
        temperature: m.temperature, humidity: m.humidity,
      });
      const put = (k, v) => { if (v !== undefined && v !== null) this.store.update(`${u.key}/${k}`, v) };
      if (p.smartMode !== undefined) put('climateReact', p.smartMode?.enabled ? 1 : 0);
      put('carbonDioxide', m.co2);
      put('tvocLevel', m.tvoc);
      if (p.filtersCleaning !== undefined) put('filterClean', p.filtersCleaning?.shouldCleanFilters ? 1 : 0);
    }
  }

  async setClimateReact(u, enabled) {
    await this._call('PUT', `/pods/${encodeURIComponent(u.id)}/smartmode`, { enabled });
    this.store.update(`${u.key}/climateReact`, enabled ? 1 : 0);
  }

  _key(id) { return `sensibo/${String(id).replace(/[^A-Za-z0-9_-]/g, '')}` }

  // Sensibo Pure air purifier
  _pure(p) {
    let u = this.pods.get(p.id);
    if (!u) {
      u = { id: p.id, key: this._key(p.id), pure: true };
      this.pods.set(p.id, u);
      this.registry.registerDevice({
        key: u.key, label: p.room?.name || `Sensibo Pure ${p.id}`, type: 'sensibo', category: 'climate', icon: '🌬️', model: 'Sensibo Pure',
        homekit: ['air-quality'],
        sensors: [
          { path: 'power', label: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power' },
          { path: 'fan', label: 'Fan speed', controllable: true, type: 'range', min: 0, max: 2, step: 1, writeCmd: 'set', capabilityId: 'fan', hint: PURE_FAN.map((f, i) => `${i} ${f}`).join(', ') },
          { path: 'pm25Index', label: 'PM2.5 (1 good, 2 moderate, 3 bad)', format: 'number' },
          { path: 'airQuality', label: 'Air quality index', format: 'number', hidden: true },
          { path: 'filterClean', label: 'Clean the filter', format: 'on-off', type: 'boolean' },
          { path: 'online', label: 'Online', sensorType: 'connectivity', hidden: true },
        ],
        _writeCapability: async (cap, cmd, args = []) => {
          const a = { on: u.state?.on ?? false, mode: 'fan', fanLevel: u.state?.fanLevel || 'auto' };
          if (cap === 'power') a.on = cmd === 'on';
          else if (cap === 'fan') {
            const n = Math.round(Number(args[0]));
            if (!(n >= 0 && n <= 2)) throw new Error(`fan is ${PURE_FAN.map((f, i) => `${i} ${f}`).join(', ')}`);
            a.fanLevel = PURE_FAN[n]; a.on = true;
          } else throw new Error(`can't set ${cap}`);
          await this._call('POST', `/pods/${encodeURIComponent(u.id)}/acStates`, { acState: a });
          u.state = { ...u.state, ...a };
          this._publishPure(u, u.state, null);
        },
      });
      console.log(`[Sensibo] ${p.room?.name || p.id} (Pure)`);
    }
    u.state = p.acState || {};
    this._publishPure(u, u.state, p);
  }

  _publishPure(u, a, p) {
    const put = (k, v) => { if (v !== undefined && v !== null) this.store.update(`${u.key}/${k}`, v) };
    put('power', a.on ? 1 : 0);
    put('fan', PURE_FAN.indexOf(a.fanLevel) >= 0 ? PURE_FAN.indexOf(a.fanLevel) : undefined);
    if (!p) return;
    put('online', p.connectionStatus?.isAlive === false ? 0 : 1);
    put('pm25Index', p.measurements?.pm25);
    put('airQuality', aqiFromIndex(p.measurements?.pm25));
    if (p.filtersCleaning !== undefined) put('filterClean', p.filtersCleaning?.shouldCleanFilters ? 1 : 0);
  }

  // Sensibo Elements air-quality monitor
  _elements(p) {
    let u = this.pods.get(p.id);
    if (!u) {
      u = { id: p.id, key: this._key(p.id) };
      this.pods.set(p.id, u);
      this.registry.registerDevice({
        key: u.key, label: p.room?.name || `Sensibo Elements ${p.id}`, type: 'sensibo', category: 'climate', icon: '🌿', model: 'Sensibo Elements',
        homekit: ['air-quality', 'co2-sensor'],
        sensors: [
          { path: 'temperature', label: 'Temperature', unit: '°C', format: 'number' },
          { path: 'humidity', label: 'Humidity', unit: '%', format: 'number' },
          { path: 'carbonDioxide', label: 'CO₂', unit: 'ppm', format: 'number' },
          { path: 'tvocLevel', label: 'TVOC', unit: 'ppb', format: 'number' },
          { path: 'fineDustLevel', label: 'PM2.5', unit: 'µg/m³', format: 'number' },
          { path: 'airQuality', label: 'Air quality index', format: 'number', hidden: true },
          { path: 'online', label: 'Online', sensorType: 'connectivity', hidden: true },
        ],
      });
      console.log(`[Sensibo] ${p.room?.name || p.id} (Elements)`);
    }
    const m = p.measurements || {}, put = (k, v) => { if (v !== undefined && v !== null) this.store.update(`${u.key}/${k}`, v) };
    put('online', p.connectionStatus?.isAlive === false ? 0 : 1);
    put('temperature', m.temperature);
    put('humidity', m.humidity);
    put('carbonDioxide', m.co2);
    put('tvocLevel', m.tvoc);
    put('fineDustLevel', m.pm25);
    put('airQuality', aqiFromPm25(m.pm25));
  }

  // Room Sensor paired to a Sky / Air pod
  _roomSensor(p, ms) {
    const key = this._key(ms.id);
    this._rooms ||= new Set();
    if (!this._rooms.has(key)) {
      this._rooms.add(key);
      this.registry.registerDevice({
        key, label: `${p.room?.name || 'Sensibo'} room sensor`, type: 'sensibo', category: 'sensor', icon: '📡', model: 'Sensibo Room Sensor',
        homekit: ['motion'],
        sensors: [
          { path: 'motion', label: 'Motion', format: 'on-off', type: 'boolean', sensorType: 'motion', homekit: 'motion' },
          { path: 'temperature', label: 'Temperature', unit: '°C', format: 'number' },
          { path: 'humidity', label: 'Humidity', unit: '%', format: 'number' },
          { path: 'online', label: 'Online', sensorType: 'connectivity', hidden: true },
        ],
      });
    }
    const m = ms.measurements || {}, put = (k, v) => { if (v !== undefined && v !== null) this.store.update(`${key}/${k}`, v) };
    put('online', ms.connectionStatus?.isAlive === false ? 0 : 1);
    put('motion', m.motion === undefined ? undefined : m.motion ? 1 : 0);
    put('temperature', m.temperature);
    put('humidity', m.humidity);
  }

  async set(u, patch) {
    if (!u.state) throw new Error('Sensibo: no state read yet');
    const a = { ...u.state };
    if (patch.power !== undefined) a.on = patch.power;
    if (patch.mode) {
      if (u.caps.modes && !u.caps.modes[patch.mode]) throw new Error(`Sensibo: this AC has no ${patch.mode} mode`);
      a.mode = patch.mode;
    }
    const caps = u.caps.modes?.[a.mode] || {};
    if (patch.targetTemp !== undefined) { a.targetTemperature = Math.round(patch.targetTemp); a.temperatureUnit = 'C' }
    if (patch.fan !== undefined) {
      const have = caps.fanLevels || [];
      a.fanLevel = FAN_PREF[patch.fan].find((l) => !have.length || have.includes(l)) || have[0];
    }
    if (patch.swing !== undefined) a.swing = patch.swing ? ((caps.swing || []).find((s) => s !== 'stopped') || 'rangeFull') : 'stopped';
    // keep only what the API takes, dropping fields the mode doesn't support
    const acState = { on: a.on, mode: a.mode, targetTemperature: a.targetTemperature, temperatureUnit: a.temperatureUnit || 'C', fanLevel: a.fanLevel, swing: a.swing };
    if (!(caps.fanLevels || []).includes(acState.fanLevel)) delete acState.fanLevel;
    if (!(caps.swing || []).includes(acState.swing)) delete acState.swing;
    if (!caps.temperatures) delete acState.targetTemperature;
    for (const k of Object.keys(acState)) if (acState[k] === undefined) delete acState[k];
    await this._call('POST', `/pods/${encodeURIComponent(u.id)}/acStates`, { acState });
    u.state = { ...u.state, ...acState };
    publishAc(this.store, u.key, patch);
  }
}

module.exports = SensiboClient;
module.exports.aqiFromPm25 = aqiFromPm25;
