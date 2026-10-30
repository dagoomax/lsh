'use strict';

// TECH Sterowniki controllers (EU-L-4X WiFi, EU-L-12, EU-WiFi RS, EU-505,
// ST-16s WiFi, boiler / heat-pump controllers with a WiFi module…) through
// eModule — the TECH cloud behind emodul.eu / emodul.pl and the eModul app.
// Not an official public API: it's the one the web app uses, as read from
// the Home Assistant "tech-controllers" integration; it can change.
//
//   POST authentication {username, password}         → {authenticated, user_id, token}
//   GET  users/<uid>/modules                         → [{udid, name, version, …}]
//   GET  users/<uid>/modules/<udid>                  → {zones: {elements: […]}, tiles: […]}
//   GET  i18n/<lang>                                  → tile/status names by txtId
//   POST users/<uid>/modules/<udid>/zones
//        {mode: {id, parentId: zoneId, mode: 'constantTemp', constTempTime, setTemperature: °C×10, scheduleIndex: 0}}
//        {zone: {id, zoneState: 'zoneOn' | 'zoneOff'}}
//
// Temperatures come in tenths of °C. Zone elements: zone {id, currentTemperature,
// setTemperature, humidity, zoneState, visibility, duringChange, batteryLevel,
// signalStrength, flags {relayState, algorithm}}, description {name}, mode {id},
// windowsSensors[] {windowState}. Tiles: type 1 temperature sensor, 2 fire
// sensor, 6 widget pair, 11 relay, 21 extra pump, 22 fan, 23 valve, 24 mixing
// valve, 31 fuel supply, 32 disinfection, 40 text, 252 OpenTherm.
//
// Devices: `emodule/<udid>-<zoneId>` per zone (thermostat, HomeKit), and
// `emodule/<udid>` per controller with its tiles (temperatures, pumps,
// valves…) as read-only sensors. The cloud rate-limits — keep pollInterval
// ≥ 60 s (default 60).
//
// config.emodule = { username, password, pollInterval = 60 (s), lang = 'en',
//   constTempTime = 60 (minutes a manual setpoint holds; 0 = until changed),
//   modules?: [udid…] (default: all on the account) }   (apiBase overrides for tests)
// Tested against scripts/emodule-simulator.js (test/emodule.test.js) — not
// yet against a real account.

const PollingClient = require('./polling-client');

const TIMEOUT_MS = 30000;
const LANGS = ['en', 'fr', 'it', 'es', 'nl', 'pl', 'de', 'cs', 'sk', 'hu', 'ro', 'lt', 'et', 'ru', 'si', 'hr'];
// tile type → fallback name txtId
const TXT_BY_TYPE = { 2: 205, 21: 576, 22: 4135, 23: 991, 24: 5731, 31: 961, 32: 246, 252: 4633 };
// widget unit code → [divisor, unit]
const WIDGET_UNITS = {
  0: [1, ''], 4: [10, ''], 5: [100, ''], 6: [1, '°C'], 7: [10, '°C'], 8: [1, '%'], 10: [1, 'kW'], 11: [1, 'kWh'], 12: [1, 'V'],
  14: [1, 'd'], 16: [1, 's'], 17: [1, 'min'], 19: [10, 'kWh'], 20: [1, 'MWh'], 21: [10, 'MWh'], 22: [10, 'L/min'], 23: [10, 'bar'],
  25: [1, 's'], 26: [10, 'kW'], 27: [1, 'rpm'], 29: [1, 'W'], 30: [100, 'L/h'], 31: [1, 'h'], 32: [1, 'K'], 33: [10, '%'], 34: [1, 'Wh'],
  36: [100, 'kWh'], 38: [10, ''], 39: [1, 'L/h'], 40: [1000, 'kWh'], 41: [1, 'L'], 42: [1, 'm³'],
};

const tenth = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v) / 10);
const onOff = (v) => (v === true || v === 1 || v === 'on' || v === 'true' ? 1 : 0);

// The readable values of one tile → [{ path, label, unit, format, type, value, temp }]
function tileReadings(tile, name) {
  const p = tile.params || {}, id = tile.id, out = [];
  const add = (suffix, label, value, extra = {}) => { if (value !== undefined && value !== null) out.push({ path: `tile${id}${suffix}`, label, value, ...extra }) };
  const temp = (suffix, label, v) => add(suffix, label, tenth(v), { unit: '°C', format: 'number', temp: true });
  const pct = (suffix, label, v) => add(suffix, label, Number.isFinite(Number(v)) ? Number(v) : undefined, { unit: '%', format: 'number' });
  switch (tile.type) {
    case 1: temp('', name, p.value); break;
    case 2: case 11: case 21: add('', name, onOff(p.workingStatus), { format: 'on-off', type: 'boolean' }); break;
    case 22: pct('', name, p.gear); break;
    case 23:
      pct('', name, p.openingPercentage);
      temp('Current', `${name} temperature`, p.currentTemp);
      temp('Return', `${name} return`, p.returnTemp);
      add('Set', `${name} set`, Number.isFinite(Number(p.setTemp)) ? Number(p.setTemp) : undefined, { unit: '°C', format: 'number' });
      break;
    case 24: pct('', name, p.openingPercentage); break;
    case 31: case 32: pct('', name, p.percentage); break;
    case 252:
      temp('Current', `${name} flow`, p.currentTemp);
      temp('SetCurrent', `${name} flow set`, p.setCurrentTemp);
      temp('Dhw', `${name} hot water`, p.currentTempDHW);
      temp('SetDhw', `${name} hot water set`, p.setTempDHW);
      pct('Modulation', `${name} modulation`, p.modulationPercentage);
      break;
    case 6:
      ['widget1', 'widget2'].forEach((w, i) => {
        const x = p[w];
        if (!x || x.unit === -1 || x.unit === 28 || x.unit === 13 || !Number.isFinite(Number(x.value))) return;
        if (!x.txtId && !(p[i ? 'widget1' : 'widget2']?.txtId)) return;
        const [div, unit] = x.type === 2 ? [1, '%'] : WIDGET_UNITS[x.unit] || [1, ''];
        add(`W${i + 1}`, x.label || `${name} ${i + 1}`, Number(x.value) / div, { unit, format: 'number', temp: unit === '°C' });
      });
      break;
    default: break;
  }
  return out;
}

class EmoduleClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'emodule', logTag: 'eModule' });
    this.cfg = config.emodule || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || 'https://emodul.eu/api/v1').replace(/\/+$/, '');
    this.lang = LANGS.includes(this.cfg.lang) ? this.cfg.lang : 'en';
    this.token = null;
    this.userId = null;
    this.texts = null;            // txtId → text
    this.modules = new Map();     // udid → { udid, name, key, registered }
    this.zones = new Map();       // `${udid}-${zoneId}` → { udid, id, key, modeId }
  }

  async start() {
    if (!this.cfg.username || !this.cfg.password) throw new Error('config.emodule needs username and password (the eModule account)');
    await this.startPolling(Math.max(30, Number(this.cfg.pollInterval) || 60) * 1000);
  }

  async _call(method, p, body, retry = true) {
    if (!this.token && p !== 'authentication') await this.login();
    const res = await fetch(`${this.api}/${p}`, {
      method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 && p === 'authentication') throw new Error('eModule login failed — check the username and password');
    if (res.status === 401 && retry) { this.token = null; return this._call(method, p, body, false) }
    if (res.status === 429) throw new Error('eModule: too many requests — raise pollInterval');
    if (!res.ok) throw new Error(`eModule ${p.replace(/^users\/[^/]+/, 'users/…')}: HTTP ${res.status}`);
    return res.json();
  }

  async login() {
    const r = await this._call('POST', 'authentication', { username: this.cfg.username, password: this.cfg.password });
    if (!r?.authenticated || !r.token) throw new Error('eModule login failed — check the username and password');
    this.token = r.token;
    this.userId = String(r.user_id);
  }

  async _loadTexts() {
    try {
      const r = await this._call('GET', `i18n/${this.lang}`);
      const d = r?.data && typeof r.data === 'object' ? r.data : r;
      this.texts = d && typeof d === 'object' ? d : {};
    } catch (err) {
      console.warn(`[eModule] No translations (${err.message}) — tiles keep their numbers`);
      this.texts = {};
    }
  }

  _text(id) { return id ? this.texts?.[id] ?? this.texts?.[String(id)] : undefined }

  async _pollImpl() {
    if (!this.token) await this.login();
    if (!this.modules.size) {
      const list = await this._call('GET', `users/${this.userId}/modules`);
      const want = Array.isArray(this.cfg.modules) && this.cfg.modules.length ? new Set(this.cfg.modules.map(String)) : null;
      for (const m of Array.isArray(list) ? list : list?.elements || []) {
        if (!m?.udid || (want && !want.has(String(m.udid)))) continue;
        this.modules.set(m.udid, { udid: m.udid, name: m.name || m.udid, version: m.version, key: `emodule/${m.udid}`, registered: false });
      }
      if (!this.modules.size) throw new Error('eModule: no controllers on this account');
    }
    if (!this.texts) await this._loadTexts();
    for (const m of this.modules.values()) {
      const data = await this._call('GET', `users/${this.userId}/modules/${m.udid}`);
      if (!data || (!data.zones && !data.tiles)) throw new Error(`eModule: no data for ${m.name}`);
      this._publishZones(m, data.zones?.elements || []);
      this._publishTiles(m, data.tiles || []);
    }
  }

  _publishZones(m, elements) {
    for (const el of elements) {
      const z = el?.zone;
      if (!z || !z.visibility || z.zoneState === 'zoneUnregistered') continue;
      const id = `${m.udid}-${z.id}`;
      let zone = this.zones.get(id);
      if (!zone) {
        zone = { udid: m.udid, id: z.id, key: `emodule/${id}`, modeId: el.mode?.id };
        this.zones.set(id, zone);
        this._registerZone(zone, el.description?.name || `Zone ${z.id}`, m, Array.isArray(el.windowsSensors) && el.windowsSensors.length > 0);
      }
      if (el.mode?.id !== undefined) zone.modeId = el.mode.id;
      const put = (p, v) => { if (v !== undefined && v !== null) this.store.update(`${zone.key}/${p}`, v) };
      const on = z.zoneState === 'zoneOn' || z.zoneState === 'noAlarm';
      const relay = z.flags?.relayState === 'on';
      const cooling = z.flags?.algorithm === 'cooling';
      put('power', on ? 1 : 0);
      put('temperature', tenth(z.currentTemperature));
      if (!z.duringChange) {
        const t = tenth(z.setTemperature);
        put('targetTemp', t); put('heatingSetpoint', t); put('coolingSetpoint', t);
      }
      if (Number(z.humidity) > 0) put('humidity', Number(z.humidity));
      put('heating', relay ? 1 : 0);
      if (Array.isArray(el.windowsSensors) && el.windowsSensors.length) put('openWindow', el.windowsSensors.some((w) => w?.windowState === 'open') ? 1 : 0);
      if (z.batteryLevel != null && Number.isFinite(Number(z.batteryLevel))) put('battery', Number(z.batteryLevel));
      if (z.signalStrength != null && Number.isFinite(Number(z.signalStrength))) put('signal', Number(z.signalStrength));
      put('zoneState', z.zoneState);
      put('thermostatMode', on ? (cooling ? 'cool' : 'heat') : 'off');
      put('thermostatOperatingState', relay ? (cooling ? 'cooling' : 'heating') : 'idle');
    }
  }

  _registerZone(zone, name, m, hasWindow) {
    this.registry.registerDevice({
      key: zone.key, label: name, type: 'emodule', category: 'climate', icon: '🔥', model: `TECH ${m.name}`,
      homekit: ['thermostat'],
      sensors: [
        { path: 'power', label: 'Zone on', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power' },
        { path: 'targetTemp', label: 'Set temperature', unit: '°C', controllable: true, type: 'range', min: 5, max: 35, step: 0.5, writeCmd: 'set', capabilityId: 'targetTemp' },
        { path: 'temperature', label: 'Room temperature', unit: '°C', format: 'number' },
        { path: 'humidity', label: 'Humidity', unit: '%', format: 'number' },
        { path: 'heating', label: 'Heating', format: 'on-off', type: 'boolean' },
        ...(hasWindow ? [{ path: 'openWindow', label: 'Open window', format: 'on-off', type: 'boolean', sensorType: 'window' }] : []),
        { path: 'battery', label: 'Battery', unit: '%', format: 'number' },
        { path: 'signal', label: 'Signal', unit: '%', format: 'number' },
        { path: 'zoneState', label: 'Zone state', type: 'label', hidden: true },
        { path: 'thermostatMode', label: 'Thermostat mode', type: 'label', hidden: true },
        { path: 'thermostatOperatingState', label: 'Operating state', type: 'label', hidden: true },
        { path: 'heatingSetpoint', label: 'Heating setpoint', unit: '°C', hidden: true },
        { path: 'coolingSetpoint', label: 'Cooling setpoint', unit: '°C', hidden: true },
      ],
      _writeCapability: async (cap, cmd, args = []) => {
        const v = args[0];
        switch (cap) {
          case 'power': return this.setZone(zone, cmd === 'on' || v === true || v === 1);
          case 'targetTemp': case 'thermostatHeatingSetpoint': case 'thermostatCoolingSetpoint': {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 5 || n > 35) throw new Error('temperature must be 5–35 °C');
            return this.setTemp(zone, n);
          }
          // HomeKit: off → zone off, heat / cool / auto → zone on
          case 'thermostatMode': return this.setZone(zone, v !== 'off');
          default: throw new Error(`can't set ${cap}`);
        }
      },
    });
    console.log(`[eModule] ${m.name}: zone ${name} (${zone.key})`);
  }

  async setTemp(zone, celsius) {
    if (zone.modeId === undefined) throw new Error('eModule: zone mode not known yet — wait for the next poll');
    const minutes = Number.isFinite(Number(this.cfg.constTempTime)) ? Number(this.cfg.constTempTime) : 60;
    await this._call('POST', `users/${this.userId}/modules/${zone.udid}/zones`, {
      mode: { id: zone.modeId, parentId: zone.id, mode: 'constantTemp', constTempTime: minutes, setTemperature: Math.round(celsius * 10), scheduleIndex: 0 },
    });
    for (const p of ['targetTemp', 'heatingSetpoint', 'coolingSetpoint']) this.store.update(`${zone.key}/${p}`, celsius);
  }

  async setZone(zone, on) {
    await this._call('POST', `users/${this.userId}/modules/${zone.udid}/zones`, { zone: { id: zone.id, zoneState: on ? 'zoneOn' : 'zoneOff' } });
    this.store.update(`${zone.key}/power`, on ? 1 : 0);
    if (!on) this.store.update(`${zone.key}/thermostatMode`, 'off');
    else if (this.store.get(`${zone.key}/thermostatMode`) === 'off') this.store.update(`${zone.key}/thermostatMode`, 'heat');
  }

  _tileName(t) {
    const p = t.params || {};
    return p.description || this._text(p.txtId) || this._text(TXT_BY_TYPE[t.type]) || `Tile ${t.id}`;
  }

  _publishTiles(m, tiles) {
    const readings = [];
    for (const t of tiles) {
      if (!t?.params || !t.visibility) continue;
      const p = t.params;
      if (t.type === 6) for (const w of ['widget1', 'widget2']) if (p[w]?.txtId) p[w].label = this._text(p[w].txtId);
      readings.push(...tileReadings(t, this._tileName(t)));
      if (t.type === 40 && p.statusId !== undefined) {
        readings.push({ path: `tile${t.id}`, label: this._text(p.headerId) || this._tileName(t), value: this._text(p.statusId) ?? String(p.statusId), type: 'label' });
      }
    }
    if (!m.registered) {
      m.registered = true;
      const temps = readings.filter((r) => r.temp);
      this.registry.registerDevice({
        key: m.key, label: m.name, type: 'emodule', category: 'climate', icon: '🔥', model: `TECH ${m.name}${m.version ? ` ${m.version}` : ''}`,
        homekit: temps.length ? ['temperature'] : [],
        sensors: [
          ...readings.map(({ path, label, unit, format, type, temp }) => ({
            path, label, ...(unit ? { unit } : {}), ...(format ? { format } : {}), ...(type ? { type } : {}),
            ...(temp ? { homekit: 'temperature', hkName: label } : {}),
          })),
          { path: 'zones', label: 'Zones', format: 'number' },
        ],
      });
      console.log(`[eModule] ${m.name} (${m.udid}): ${readings.length} tile reading(s)`);
    }
    for (const r of readings) this.store.update(`${m.key}/${r.path}`, r.value);
    this.store.update(`${m.key}/zones`, [...this.zones.values()].filter((z) => z.udid === m.udid).length);
  }
}

module.exports = EmoduleClient;
module.exports.tileReadings = tileReadings;
