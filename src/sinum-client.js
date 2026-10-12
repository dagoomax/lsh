'use strict';

// TECH Sterowniki Sinum — local REST API of the Sinum central unit (EH-01).
// Docs: https://apidocs.sinum.tech/ and techsterowniki.pl → Baza wiedzy Sinum →
// "Instrukcja korzystania z HTTP API centrali Sinum".
//
// Auth: an API token created in the Sinum web panel (preferred — never
// expires), or a local user's login + password (POST /api/v1/login → JWT
// `session`, logged in again on 401). Every response is wrapped in { data }.
// The hub's embedded firmware copes badly with parallel requests, so buses
// are read one after another; 408 means "bus busy" and is retried once.
//
// Each Sinum device becomes one LSH device `sinum/<bus>-<id>` (room taken
// from Sinum's rooms): thermostats / temperature regulators (HomeKit
// thermostat), relays (switch), dimmers / RGB (light), blinds (cover), gates,
// wickets, and sensors. Unknown device types still show their numeric and
// on/off readings. Scenes become `sinum/scenes`, one trigger per scene.
// Temperatures and humidity come from Sinum ×10 (220 = 22.0 °C).
//
// config.sinum = { host, token | username + password, pollInterval = 10 (s),
//                  buses = ['virtual','wtp','sbus','slink','lora','modbus'] }
// Tested against scripts/sinum-simulator.js (test/sinum.test.js) only — not
// yet against a real hub; field names follow the Sinum API docs.

const PollingClient = require('./polling-client');

const BUSES = ['virtual', 'wtp', 'sbus', 'slink', 'lora', 'modbus'];
const TIMEOUT_MS = 15000;
const x10 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) / 10 : null);
const on = (v) => (v === true || v === 1 || v === 'on' || v === 'open' || v === 'unlocked' ? 1 : 0);

// ── Per-type mapping: LSH sensors, readings from a Sinum device, writes back ──
const thermostatSensors = [
  { path: 'temperature', label: 'Temperature', unit: '°C', format: 'number' },
  { path: 'heatingSetpoint', label: 'Target', unit: '°C', controllable: true, type: 'range', min: 5, max: 35, step: 0.5, writeCmd: 'setHeatingSetpoint', capabilityId: 'thermostatHeatingSetpoint' },
  { path: 'humidity', label: 'Humidity', unit: '%', format: 'number', homekit: 'humidity' },
  { path: 'thermostatMode', label: 'Mode', type: 'label' },
  { path: 'thermostatOperatingState', label: 'State', type: 'label' },
];
const toHkMode = (m) => (m === 'cooling' ? 'cool' : m === 'off' ? 'off' : 'heat');
const toSinumMode = (m) => (m === 'cool' ? 'cooling' : m === 'off' ? 'off' : 'heating');
const setpoint = (args) => {
  const v = Number(args[0]);
  if (!Number.isFinite(v)) throw new Error('Give a temperature');
  return { target_temperature: Math.round(Math.max(5, Math.min(35, v)) * 10) };
};

const lightSensors = (dev) => [
  { path: 'switch', label: 'On', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch' },
  ...('brightness' in dev ? [{ path: 'level', label: 'Brightness', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setLevel', capabilityId: 'switchLevel' }] : []),
];

const TYPES = {
  thermostat: {
    icon: '🌡', homekit: ['thermostat', 'humidity'],
    sensors: () => thermostatSensors,
    read: (d) => ({
      temperature: x10(d.temperature), heatingSetpoint: x10(d.target_temperature), coolingSetpoint: x10(d.target_temperature), humidity: x10(d.humidity),
      thermostatMode: toHkMode(d.mode), thermostatOperatingState: d.state ? (d.mode === 'cooling' ? 'cooling' : 'heating') : 'idle',
    }),
    write: (cap, cmd, args) => (cap === 'thermostatMode' ? { mode: toSinumMode(args[0]) }
      : /Setpoint$/.test(cap) ? setpoint(args) : null),
  },
  temperature_regulator: {
    icon: '🌡', homekit: ['thermostat'],
    sensors: () => thermostatSensors.filter((s) => s.path !== 'humidity'),
    read: (d) => ({
      temperature: x10(d.temperature ?? d.current_temperature), heatingSetpoint: x10(d.target_temperature), coolingSetpoint: x10(d.target_temperature),
      thermostatMode: toHkMode(d.system_mode), thermostatOperatingState: d.system_mode === 'off' ? 'idle' : d.system_mode || 'idle',
    }),
    write: (cap, cmd, args) => (cap === 'thermostatMode' ? { system_mode: toSinumMode(args[0]) }
      : /Setpoint$/.test(cap) ? setpoint(args) : null),
  },
  relay: {
    icon: '🔌', homekit: ['switch-rw'],
    sensors: () => [{ path: 'switch', label: 'On', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch', homekit: 'switch-rw' }],
    read: (d) => ({ switch: on(d.state) }),
    write: (cap, cmd) => (cap === 'switch' ? { state: cmd === 'on' } : null),
  },
  dimmer: {
    icon: '💡', homekit: ['light-rw'],
    sensors: lightSensors,
    read: (d) => ({ switch: on(d.state), ...('brightness' in d ? { level: Number(d.brightness) || 0 } : {}) }),
    write: (cap, cmd, args) => (cap === 'switch' ? { state: cmd === 'on' }
      : cap === 'switchLevel' ? (Number(args[0]) > 0 ? { state: true, brightness: Math.round(Math.max(0, Math.min(100, Number(args[0])))) } : { state: false }) : null),
  },
  blind: {
    icon: '🪟', homekit: ['cover-rw'],
    sensors: () => [
      { path: 'level', label: 'Position', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setLevel', capabilityId: 'windowShade' },
      { path: 'windowShade', label: 'Open', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'open', writeOff: 'close', capabilityId: 'windowShade' },
      { path: 'stop', label: 'Stop', type: 'trigger', controllable: true, writeOn: 'stop', writeOff: null, capabilityId: 'windowShade' },
    ],
    read: (d) => {
      const pos = Number(d.current_opening ?? d.target_opening ?? d.last_set_target_opening);
      return Number.isFinite(pos) ? { level: pos, windowShade: pos > 0 ? 1 : 0 } : {};
    },
    write: (cap, cmd, args) => (cap !== 'windowShade' ? null
      : cmd === 'stop' ? { command: 'stop' }
        : { command: 'open', opening_percentage: cmd === 'open' ? 100 : cmd === 'close' ? 0 : Math.round(Math.max(0, Math.min(100, Number(args[0]) || 0))) }),
  },
  gate: {
    icon: '🚧', homekit: [],
    sensors: () => [
      { path: 'state', label: 'State', type: 'label' },
      { path: 'open', label: 'Open', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'open' },
      { path: 'close', label: 'Close', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'close' },
      { path: 'stop', label: 'Stop', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'stop' },
    ],
    read: (d) => ({ state: String(d.state ?? '') }),
    write: (cap) => ({ open: { command: 'full_open' }, close: { command: 'close' }, stop: { command: 'stop' } })[cap] || null,
  },
  wicket: {
    icon: '🚪', homekit: [],
    sensors: () => [
      { path: 'state', label: 'State', type: 'label' },
      { path: 'unlock', label: 'Unlock', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'unlock' },
    ],
    read: (d) => ({ state: String(d.state ?? '') }),
    write: (cap) => (cap === 'unlock' ? { command: 'unlock' } : null),
  },
  climate_sensor: {
    icon: '🌡', homekit: ['temperature', 'humidity'],
    sensors: (d) => [
      ...('temperature' in d ? [{ path: 'temperature', label: 'Temperature', unit: '°C', format: 'number', homekit: 'temperature' }] : []),
      ...('humidity' in d ? [{ path: 'humidity', label: 'Humidity', unit: '%', format: 'number', homekit: 'humidity' }] : []),
    ],
    read: (d) => ({ ...('temperature' in d ? { temperature: x10(d.temperature) } : {}), ...('humidity' in d ? { humidity: x10(d.humidity) } : {}) }),
  },
  ...Object.fromEntries([
    ['motion_sensor', 'motion', '🏃', 'Motion'], ['opening_sensor', 'contact', '🚪', 'Open'],
    ['flood_sensor', 'leak', '💧', 'Flood'], ['smoke_sensor', 'smoke', '🔥', 'Smoke'],
    ['two_state_input_sensor', null, '🔘', 'Input'],
  ].map(([t, hk, icon, label]) => [t, {
    icon, homekit: hk ? [hk] : [],
    sensors: () => [{ path: 'state', label, type: 'boolean', format: 'on-off', ...(hk ? { homekit: hk } : {}) }],
    read: (d) => ({ state: on(d.state) }),
  }])),
};
const ALIASES = {
  relay_integrator: 'relay', dimmer_rgb_controller_integrator: 'dimmer', dimmer_rgb_integrator: 'dimmer', rgb_controller: 'dimmer',
  blind_controller: 'blind', blind_controller_integrator: 'blind', temperature_sensor: 'climate_sensor', humidity_sensor: 'climate_sensor',
};

// Anything else: its plain numeric / boolean fields, read-only
const SKIP = new Set(['id', 'room_id', 'parent_id', 'address', 'serial', 'serial_number', 'version', 'software_version', 'hardware_version', 'icon', 'position']);
const X10_FIELDS = /temperature|humidity/;
const genericType = (d) => {
  const fields = Object.keys(d).filter((k) => !SKIP.has(k) && (typeof d[k] === 'number' || typeof d[k] === 'boolean'));
  return {
    icon: '📟', homekit: [],
    sensors: () => fields.map((k) => (typeof d[k] === 'boolean'
      ? { path: k, label: k.replace(/_/g, ' '), type: 'boolean', format: 'on-off' }
      : { path: k, label: k.replace(/_/g, ' '), format: 'number', ...(X10_FIELDS.test(k) ? { unit: /humidity/.test(k) ? '%' : '°C' } : {}) })),
    read: (dd) => Object.fromEntries(fields.filter((k) => k in dd).map((k) => [k, typeof dd[k] === 'boolean' ? (dd[k] ? 1 : 0) : X10_FIELDS.test(k) ? x10(dd[k]) : dd[k]])),
  };
};

class SinumClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'sinum', logTag: 'Sinum' });
    this.cfg = config.sinum || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.base = /^https?:\/\//.test(this.cfg.host || '') ? this.cfg.host.replace(/\/$/, '') : `http://${this.cfg.host}`;
    this.jwt = null;
    this.devices = new Map(); // LSH key → { bus, id, map }
    this.buses = new Set(Array.isArray(this.cfg.buses) && this.cfg.buses.length ? this.cfg.buses : BUSES);
    this.rooms = new Map();   // `${class}-${id}` → room name
    this.scenes = null;
    this.polls = 0;
  }

  async start() {
    if (!this.cfg.host) throw new Error('config.sinum.host is required');
    if (!this.cfg.token && !(this.cfg.username && this.cfg.password)) throw new Error('Give config.sinum.token, or username + password');
    await this.startPolling(Math.max(3, Number(this.cfg.pollInterval) || 10) * 1000);
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────
  async _login() {
    const res = await this._fetch('POST', '/api/v1/login', {
      username: this.cfg.username, password: this.cfg.password, os_info: 'LSH', device_info: 'LSH', uuid_device: 'lsh-sinum-client',
    }, false);
    if (res.status === 401) throw new Error('Sinum rejected the login / password');
    if (!res.ok) throw new Error(`Sinum login failed (HTTP ${res.status})`);
    const body = await res.json().catch(() => ({}));
    this.jwt = (body.data || body).session;
    if (!this.jwt) throw new Error('Sinum login returned no session token');
  }

  _fetch(method, p, body, auth = true) {
    const token = this.cfg.token || this.jwt;
    return fetch(`${this.base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async call(method, p, body) {
    if (!this.cfg.token && !this.jwt) await this._login();
    let res = await this._fetch(method, p, body);
    if (res.status === 401) {
      if (this.cfg.token) throw new Error('Sinum rejected the API token');
      await this._login();
      res = await this._fetch(method, p, body);
    }
    if (res.status === 408) { // bus busy
      await new Promise((r) => setTimeout(r, 1000));
      res = await this._fetch(method, p, body);
    }
    if (res.status === 304) return null;
    const text = await res.text();
    let j = null; try { j = text ? JSON.parse(text) : null } catch {}
    if (!res.ok) {
      const e = new Error(`Sinum ${method} ${p}: HTTP ${res.status}${j?.message ? ` — ${j.message}` : ''}`);
      e.status = res.status;
      throw e;
    }
    return j && typeof j === 'object' && 'data' in j ? j.data : j;
  }

  // ── Poll ───────────────────────────────────────────────────────────────────
  async _pollImpl() {
    // Rooms and scenes change rarely — every 30th poll (~5 min)
    if (this.polls++ % 30 === 0) await this._loadMeta();
    let seen = 0;
    for (const bus of [...this.buses]) {
      let list;
      try { list = await this.call('GET', `/api/v1/devices/${bus}`) }
      catch (err) {
        if (err.status === 404) { this.buses.delete(bus); continue } // no such bus on this hub / firmware
        throw err;
      }
      for (const d of Array.isArray(list) ? list : []) { this._apply(bus, d); seen++ }
    }
    if (!seen && !this.devices.size) throw new Error('Sinum returned no devices');
  }

  async _loadMeta() {
    try {
      const rooms = await this.call('GET', '/api/v1/rooms');
      this.rooms.clear();
      for (const r of Array.isArray(rooms) ? rooms : []) for (const d of r.devices || []) this.rooms.set(`${d.class}-${d.id}`, r.name);
    } catch (err) { console.warn(`[Sinum] Rooms unavailable: ${err.message}`) }
    try {
      const scenes = await this.call('GET', '/api/v1/scenes');
      if (Array.isArray(scenes) && scenes.length && !this.scenes) this._registerScenes(scenes);
    } catch (err) { console.warn(`[Sinum] Scenes unavailable: ${err.message}`) }
  }

  _apply(bus, d) {
    if (d?.id == null) return;
    const key = `sinum/${bus}-${d.id}`;
    let entry = this.devices.get(key);
    if (!entry) {
      const map = TYPES[ALIASES[d.type] || d.type] || genericType(d);
      const sensors = map.sensors(d);
      if (!sensors.length) return;
      entry = { bus, id: d.id, map };
      this.devices.set(key, entry);
      const room = this.rooms.get(`${d.class || bus}-${d.id}`);
      this.registry.registerDevice({
        key, label: d.name || `${d.type || 'Device'} ${d.id}`, type: 'sinum', icon: map.icon, homekit: map.homekit,
        ...(room ? { room } : {}), sinumType: d.type,
        sensors,
        ...(map.write ? { _writeCapability: (cap, cmd, args) => this._write(key, cap, cmd, args) } : {}),
      });
    }
    for (const [k, v] of Object.entries(entry.map.read(d))) if (v !== null && v !== undefined) this.store.update(`${key}/${k}`, v);
  }

  async _write(key, cap, cmd, args = []) {
    const e = this.devices.get(key);
    const body = e?.map.write?.(cap, cmd, args);
    if (!body) throw new Error(`Sinum: ${key} has no command ${cap}`);
    const updated = await this.call('PATCH', `/api/v1/devices/${e.bus}/${e.id}`, body);
    if (updated && typeof updated === 'object' && !Array.isArray(updated) && updated.id != null) this._apply(e.bus, updated);
  }

  _registerScenes(scenes) {
    this.scenes = new Map(scenes.filter((s) => s?.id != null).map((s) => [String(s.id), s]));
    this.registry.registerDevice({
      key: 'sinum/scenes', label: 'Sinum scenes', type: 'sinum', icon: '🎬', homekit: [],
      sensors: [...this.scenes.values()].map((s) => ({ path: `scene${s.id}`, label: s.name || `Scene ${s.id}`, type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: String(s.id) })),
      _writeCapability: (id) => this.call('POST', `/api/v1/scenes/${encodeURIComponent(id)}/activate`),
    });
  }
}

module.exports = SinumClient;
module.exports.TYPES = TYPES;
