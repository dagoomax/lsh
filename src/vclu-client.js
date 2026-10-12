'use strict';

// vCLU (Virtual CLU, github.com/Domktorymysli/vclu) — smart-home runtime with
// a Grenton CLU emulator, Lua automations and Satel / MQTT / HomeKit.
//
// LSH talks to vCLU's MCP endpoint (POST /mcp, stateless streamable HTTP,
// JSON-RPC `tools/call`), the same interface vCLU offers AI agents. Its REST
// API can only read the registry; MCP is the supported way to control
// devices. Auth: an MCP bot token (vCLU → MCP → bots) as `Authorization:
// Bearer …`. The bot's access profile decides what LSH sees and may control
// (read-only devices come back `readonly: true`).
//
// Tools used: vclu_devices (every exposed device + state, polled),
// vclu_device_set (value), vclu_device_execute (method), vclu_scenes,
// vclu_scene_execute. Each exposed device becomes `vclu/<path>` in its vCLU
// area. Types (vCLU ExposedObjects): switch, light, dimmer (0..1), cover
// (0..100), number, fan, lock, garage_door, sensor / binary_sensor / motion,
// temperature / humidity / illuminance, climate (current temperature,
// read-only here). Scenes → `vclu/scenes`.
//
// config.vclu = { host (e.g. 192.168.1.20:8080 or http://vclu.local), token, pollInterval = 5 (s) }
// Tested against scripts/vclu-simulator.js (test/vclu.test.js) only — not
// yet against a real vCLU.

const PollingClient = require('./polling-client');

const TIMEOUT_MS = 15000;
const num = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : Number.isFinite(Number(v)) ? Number(v) : null);
const truthy = (v) => (v === true || v === 1 || v === '1' || v === 'ON' || v === 'on' || v === 'open' || v === 'LOCKED' ? 1 : 0);
const keyFor = (p) => `vclu/${String(p).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
const clampPct = (v) => Math.round(Math.max(0, Math.min(100, Number(v) || 0)));

const toggle = (path, label, extra = {}) => ({ path, label, format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: path, ...extra });
const reading = (path, label, unit, extra = {}) => ({ path, label, format: 'number', ...(unit ? { unit } : {}), ...extra });

// type → { icon, homekit, sensors(dev), read(dev) → {path: value}, write(dev, cap, cmd, args) → { set } | { exec, args } }
const TYPES = {
  switch: {
    icon: '🔌', homekit: ['switch-rw'],
    sensors: () => [toggle('switch', 'On', { homekit: 'switch-rw' })],
    read: (d) => ({ switch: truthy(d.state) }),
    write: (d, cap, cmd) => ({ set: cmd === 'on' ? 1 : 0 }),
  },
  light: {
    icon: '💡', homekit: ['light-rw'],
    sensors: (d) => [
      { ...toggle('switch', 'On'), capabilityId: 'switch' },
      ...(dimmable(d) ? [{ path: 'level', label: 'Brightness', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setLevel', capabilityId: 'switchLevel' }] : []),
    ],
    read: (d) => {
      const v = num(d.state) ?? 0;
      // dimmers report 0..1; an on/off light 0/1
      return dimmable(d) ? { switch: v > 0 ? 1 : 0, level: Math.round(v * 100) } : { switch: v > 0 ? 1 : 0 };
    },
    write: (d, cap, cmd, args) => {
      if (cap === 'switch') {
        if (cmd === 'on' && (d.methods || []).includes('switchOn')) return { exec: 'switchOn' };
        if (cmd === 'off' && (d.methods || []).includes('switchOff')) return { exec: 'switchOff' };
        return { set: cmd === 'on' ? 1 : 0 };
      }
      const pct = clampPct(args[0]);
      return (d.methods || []).includes('setBrightness') ? { exec: 'setBrightness', args: [pct] } : { set: pct / 100 };
    },
  },
  cover: {
    icon: '🪟', homekit: ['cover-rw'],
    sensors: (d) => [
      { path: 'level', label: 'Position', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setLevel', capabilityId: 'windowShade' },
      { path: 'windowShade', label: 'Open', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'open', writeOff: 'close', capabilityId: 'windowShade' },
      ...(stopMethod(d) ? [{ path: 'stop', label: 'Stop', type: 'trigger', controllable: true, writeOn: 'stop', writeOff: null, capabilityId: 'windowShade' }] : []),
    ],
    read: (d) => { const v = num(d.state); return v === null ? {} : { level: v, windowShade: v > 0 ? 1 : 0 } },
    write: (d, cap, cmd, args) => (cmd === 'stop' ? stopMethod(d)
      : { set: cmd === 'open' ? 100 : cmd === 'close' ? 0 : clampPct(args[0]) }),
  },
  number: {
    icon: '🎚', homekit: [],
    sensors: () => [{ path: 'value', label: 'Value', controllable: true, type: 'range', min: 0, max: 100, writeCmd: 'set', capabilityId: 'value' }],
    read: (d) => ({ value: num(d.state) }),
    write: (d, cap, cmd, args) => ({ set: Number(args[0]) || 0 }),
  },
  fan: {
    icon: '🌀', homekit: [],
    sensors: () => [{ path: 'speed', label: 'Speed', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'set', capabilityId: 'speed' }],
    read: (d) => ({ speed: num(d.state) }),
    write: (d, cap, cmd, args) => ({ set: clampPct(args[0]) }),
  },
  lock: {
    icon: '🔒', homekit: ['lock-rw'],
    sensors: () => [{ path: 'lock', label: 'Locked', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'lock', writeOff: 'unlock', capabilityId: 'lock' }],
    read: (d) => ({ lock: truthy(d.state) }),
    write: (d, cap, cmd) => ({ set: cmd === 'lock' ? 1 : 0 }),
  },
  garage_door: {
    icon: '🚗', homekit: [],
    sensors: () => [toggle('open', 'Open')],
    read: (d) => ({ open: truthy(d.state) }),
    write: (d, cap, cmd) => ({ set: cmd === 'on' ? 1 : 0 }),
  },
  climate: {
    icon: '🌡', homekit: ['temperature'],
    sensors: () => [reading('temperature', 'Temperature', '°C', { homekit: 'temperature' })],
    read: (d) => ({ temperature: num(d.state) }),
  },
  temperature: { icon: '🌡', homekit: ['temperature'], sensors: () => [reading('temperature', 'Temperature', '°C', { homekit: 'temperature' })], read: (d) => ({ temperature: num(d.state) }) },
  humidity: { icon: '💧', homekit: ['humidity'], sensors: () => [reading('humidity', 'Humidity', '%', { homekit: 'humidity' })], read: (d) => ({ humidity: num(d.state) }) },
  illuminance: { icon: '☀️', homekit: ['lux'], sensors: () => [reading('illuminance', 'Illuminance', 'lx')], read: (d) => ({ illuminance: num(d.state) }) },
  motion: { icon: '🏃', homekit: ['motion'], sensors: () => [{ path: 'state', label: 'Motion', type: 'boolean', format: 'on-off', homekit: 'motion' }], read: (d) => ({ state: truthy(d.state) }) },
  sensor: { icon: '🔘', homekit: [], sensors: () => [{ path: 'state', label: 'State', type: 'boolean', format: 'on-off' }], read: (d) => ({ state: truthy(d.state) }) },
};
TYPES.dimmer = TYPES.light;
TYPES.binary_sensor = TYPES.sensor;

function dimmable(d) { return d.type === 'dimmer' || (d.methods || []).includes('setBrightness') || (d.methods || []).includes('getBrightness') }
function stopMethod(d) {
  const m = d.methods || [];
  return m.includes('stop') ? { exec: 'stop' } : null;
}

class VcluClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'vclu', logTag: 'vCLU' });
    this.cfg = config.vclu || {};
    this.store = store;
    this.registry = sensorRegistry;
    const h = String(this.cfg.host || '').replace(/\/+$/, '');
    this.url = `${/^https?:\/\//.test(h) ? h : `http://${h}`}/mcp`;
    this.devices = new Map(); // LSH key → { path, map, dev }
    this.rpcId = 0;
    this.initialized = false;
    this.scenesLoaded = false;
  }

  async start() {
    if (!this.cfg.host || !this.cfg.token) throw new Error('config.vclu needs host and token (an MCP bot token from vCLU)');
    await this.startPolling(Math.max(2, Number(this.cfg.pollInterval) || 5) * 1000);
  }

  // ── MCP over HTTP ──────────────────────────────────────────────────────────
  async _rpc(method, params) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.cfg.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.rpcId, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new Error('vCLU rejected the MCP token — check the bot token in vCLU → MCP');
    if (!res.ok) throw new Error(`vCLU MCP HTTP ${res.status}`);
    const text = await res.text();
    // Streamable HTTP may answer as JSON or as a one-event SSE stream
    const payload = /^\s*[{[]/.test(text) ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
    let j; try { j = JSON.parse(payload) } catch { throw new Error('vCLU sent an unreadable MCP response') }
    if (j.error) throw new Error(`vCLU: ${j.error.message || 'MCP error'}`);
    return j.result;
  }

  async tool(name, args = {}) {
    if (!this.initialized) {
      await this._rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'LSH', version: '1' } });
      this.initialized = true;
    }
    const r = await this._rpc('tools/call', { name, arguments: args });
    const text = (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (r?.isError) throw new Error(`vCLU: ${text || `${name} failed`}`);
    try { return text ? JSON.parse(text) : null } catch { return text }
  }

  // ── Poll ───────────────────────────────────────────────────────────────────
  async _pollImpl() {
    const out = await this.tool('vclu_devices');
    if (!out || !Array.isArray(out.devices)) throw new Error('vCLU returned no device list');
    for (const d of out.devices) this._apply(d);
    if (!this.scenesLoaded) {
      this.scenesLoaded = true;
      try {
        const scenes = await this.tool('vclu_scenes');
        const list = Array.isArray(scenes) ? scenes : scenes?.scenes;
        if (Array.isArray(list) && list.length) this._registerScenes(list);
      } catch (err) { console.warn(`[vCLU] Scenes unavailable: ${err.message}`) }
    }
  }

  _apply(d) {
    if (!d?.path || d.type === 'scene' || d.type === 'button') return;
    const key = keyFor(d.path);
    let e = this.devices.get(key);
    if (!e) {
      const map = TYPES[d.type];
      if (!map) return;
      const writable = !!map.write && !d.readonly;
      const sensors = map.sensors(d).map((s) => (writable ? s : { ...s, controllable: false }));
      e = { path: d.path, map, dev: d };
      this.devices.set(key, e);
      this.registry.registerDevice({
        key, label: d.name || d.path, type: 'vclu', icon: map.icon, homekit: writable ? map.homekit : map.homekit.filter((h) => !h.endsWith('-rw')),
        ...(d.area ? { room: d.area } : {}), vcluPath: d.path, vcluType: d.type,
        sensors,
        ...(writable ? { _writeCapability: (cap, cmd, args) => this._write(key, cap, cmd, args) } : {}),
      });
    }
    e.dev = d;
    for (const [k, v] of Object.entries(e.map.read(d))) if (v !== null && v !== undefined) this.store.update(`${key}/${k}`, v);
  }

  async _write(key, cap, cmd, args = []) {
    const e = this.devices.get(key);
    const op = e?.map.write?.(e.dev, cap, cmd, args);
    if (!op) throw new Error(`vCLU: ${key} has no command ${cap} ${cmd}`);
    if (op.exec) {
      await this.tool('vclu_device_execute', { path: e.path, method: op.exec, ...(op.args ? { args: op.args } : {}) });
      setTimeout(() => this._poll().catch(() => {}), 500).unref?.();
      return;
    }
    const r = await this.tool('vclu_device_set', { path: e.path, value: op.set });
    // vclu_device_set answers with the state it reads back
    const state = r && typeof r === 'object' ? (r.new_state ?? r.newState ?? r.NewState) : undefined;
    if (state !== undefined) this._apply({ ...e.dev, state });
  }

  _registerScenes(list) {
    const scenes = list.filter((s) => s?.path);
    this.registry.registerDevice({
      key: 'vclu/scenes', label: 'vCLU scenes', type: 'vclu', icon: '🎬', homekit: [],
      sensors: scenes.map((s, i) => ({ path: `scene${i + 1}`, label: s.name || s.path, type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: s.path })),
      _writeCapability: (scenePath) => this.tool('vclu_scene_execute', { path: scenePath }),
    });
  }
}

module.exports = VcluClient;
module.exports.TYPES = TYPES;
