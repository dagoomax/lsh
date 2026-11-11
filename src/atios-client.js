'use strict';

// Atios SmartCore (DIN-rail Matter controller with a DALI-2 bus, 12 relays,
// 12 inputs) over its local web API — the one Atios' own Home Assistant
// integration (github.com/Atios-AG/homeassistant-smartcore) uses. No auth
// (unless a web password is set — then only the web UI is locked, not this).
//
//   POST /api/dali/iface {repeat_twice, wait_response, bits: 16|24|25, data: [bytes]}
//        → {success, bus_busy, collision_detected, data: answer|[answer]}
//   GET  /api/dali/nvm?section=control_devices|input_devices&offset&limit=4
//        → {success, data: {<section>: […]}, pagination: {has_more, limit}}
//   GET  /settings → {dali_ip_interface, …}      GET /ota_status → serial, firmware
//   ws://<host>/  Lunatone-style JSON; {"type":"daliMonitor","data":{bits, data:[…],
//        externalSource, framingError}} for every frame on the bus — only while
//        "DALI IP Interface" is on (web UI → System → DALI). The socket serves ONE
//        client: a second one (another LSH, Home Assistant) silently takes it over.
//
// DALI forward frames (IEC 62386-102): address byte 0AAAAAAS short, 100GGGGS
// group, 1111111S broadcast (S=0 → direct arc power level 0–254 in the second
// byte, S=1 → command). Commands: OFF 0x00, RECALL MAX 0x05, GO TO LAST
// ACTIVE LEVEL 0x0A, GO TO SCENE 0x10+n, QUERY ACTUAL LEVEL 0xA0.
// 24-bit input-device events (IEC 62386-103): byte0 0AAAAAA0, byte1 S TTTTT DD
// (S=1 → TTTTT is the instance number, else the instance type), event info =
// DD + byte2 (10 bits). Push button (-301) 0x00 released, 0x01 pressed, 0x02
// short, 0x05 double, 0x09 long start, 0x0B long repeat, 0x0C long stop;
// occupancy (-303) bit1 occupied, bit0 movement; light sensor (-304) raw level.
//
// Colour lamps (DT8, IEC 62386-209) with RGBWAF channels — an NVM entry with
// device_types ∋ 8 and color_type_features >> 5 ≥ 3 — also get colour and, with
// a fourth channel, white. A colour is written as DTR0/1/2 (special commands
// 0xA3 / 0xC3 / 0xC5) + ENABLE DEVICE TYPE 8 (0xC1) + SET TEMPORARY RGB
// DIMLEVEL (235) or WAF DIMLEVEL (236), then ENABLE DEVICE TYPE 8 + ACTIVATE
// (226); channels are 0–254, 255 = MASK (leave as is). Read back with
// DTR0 = 9…12 (red, green, blue, white) + QUERY COLOUR VALUE (250).
//
// Devices (from the commissioning stored in the SmartCore, NVM):
//   atios/all        broadcast: on/off, brightness, scene 0–15
//   atios/l<addr>    each DALI lamp (short address): on/off, brightness, colour
//                    and white on RGB(W) lamps — polled
//                    with QUERY ACTUAL LEVEL, and re-read right after another
//                    controller (a DALI button, Matter, the web UI) sends to the bus
//   atios/g<n>       each DALI group: on/off, brightness, scene (state as last set)
//   atios/in<addr>   each input device: buttons (last event, pressed), occupancy
//                    (HomeKit motion), light level (raw 0–1023)
// The 12 relays and 12 inputs of the SmartCore itself have no local API —
// they are only reachable over Matter (pair the SmartCore with LSH's Matter
// controller, config.matter).
//
// config.atios = { host, pollInterval = 30 (s), lights?: [short addresses]
//   (only when the NVM can't be read), monitor = true }
// Tested against scripts/atios-simulator.js (test/atios.test.js) — not yet
// against a real SmartCore; the colour commands in particular follow the DALI
// standard, not anything observed on a real DT8 lamp.

const PollingClient = require('./polling-client');

let WebSocketLib = null;
try { WebSocketLib = require('ws'); } catch { /* no live events, polling only */ }

const TIMEOUT_MS = 5000;
const OP = { OFF: 0x00, RECALL_MAX: 0x05, LAST_ACTIVE: 0x0a, SCENE: 0x10, QUERY_LEVEL: 0xa0,
  ACTIVATE: 226, SET_RGB: 235, SET_WAF: 236, QUERY_COLOUR: 250 };
const SPECIAL = { DTR0: 0xa3, DTR1: 0xc3, DTR2: 0xc5, ENABLE_DT: 0xc1 };
const DT8 = 8, MASK = 255;
const COLOUR_VALUE = { red: 9, green: 10, blue: 11, white: 12 }; // DTR0 for QUERY COLOUR VALUE
const BUTTON_EVENTS = {
  0x00: 'released', 0x01: 'pressed', 0x02: 'short press', 0x05: 'double press',
  0x09: 'long press', 0x0b: 'long press repeat', 0x0c: 'long press stop', 0x0e: 'free', 0x0f: 'stuck',
};
const INSTANCE = { BUTTON: 1, ABSOLUTE: 2, OCCUPANCY: 3, LIGHT: 4, GENERAL: 6 };

// address byte for a target: { short } | { group } | {} (broadcast)
function addressByte(t, command) {
  const s = command ? 1 : 0;
  if (t.short !== undefined) return ((t.short & 0x3f) << 1) | s;
  if (t.group !== undefined) return 0x80 | ((t.group & 0x0f) << 1) | s;
  return 0xfe | s;
}

// percent 0–100 ↔ DALI arc power 0–254 (1–254 when on)
const toDali = (pct) => (pct <= 0 ? 0 : Math.max(1, Math.min(254, Math.round(1 + (pct * 253) / 100))));
const fromDali = (lvl) => (lvl <= 0 ? 0 : Math.max(1, Math.min(100, Math.round(((lvl - 1) * 100) / 253))));

// hue 0–360, saturation 0–100 at full value ↔ RGB channel levels 0–254
function hsToRgb(h, sat) {
  const s = Math.max(0, Math.min(100, sat)) / 100, hh = (((h % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((hh % 2) - 1);
  const [r, g, b] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(hh) % 6];
  return [r, g, b].map((c) => Math.round((1 - s + s * c) * 254));
}
function rgbToHs(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = 60 * (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return { h: (h + 360) % 360, s: max ? (d / max) * 100 : 0 };
}

// 24-bit event frame → { shortAddress, instanceType?, instanceNumber?, info } | null
function decodeEvent(data, bits) {
  if (bits !== 24 || !Array.isArray(data) || data.length < 3) return null;
  const [b0, b1, b2] = data.map((b) => b & 0xff);
  if (b0 & 0x01) return null; // a 24-bit command to another device, not an event
  const info = ((b1 & 0x03) << 8) | b2;
  const field = (b1 >> 2) & 0x1f;
  if (b0 & 0x80) return { shortAddress: null, info }; // group / instance addressed
  const shortAddress = (b0 >> 1) & 0x3f;
  return b1 & 0x80 ? { shortAddress, instanceNumber: field, info } : { shortAddress, instanceType: field, info };
}

class AtiosClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'atios', logTag: 'Atios' });
    this.cfg = config.atios || {};
    this.store = store;
    this.registry = sensorRegistry;
    const host = String(this.cfg.host || '').trim().replace(/\/+$/, '');
    this.base = /^https?:\/\//.test(host) ? host : `http://${host}`;
    this.lights = new Map();  // short address → { addr, key, name }
    this.groups = new Map();  // group → { group, key, name }
    this.inputs = new Map();  // short address → { addr, key, name, instances: [{ number, type, path }] }
    this.ws = null;
    this._wsTimer = null;
    this._wsDelay = 2000;
    this._refreshTimer = null;
    this._discovered = false;
    this._bus = Promise.resolve(); // one frame sequence on the bus at a time
  }

  // DTRs and ENABLE DEVICE TYPE are shared by the whole bus and the latter
  // only covers the very next frame — so a multi-frame sequence must not be
  // interleaved with the poll's queries.
  _seq(fn) {
    const p = this._bus.then(fn);
    this._bus = p.catch(() => {});
    return p;
  }

  async start() {
    if (!this.cfg.host) throw new Error('config.atios needs host (the SmartCore IP)');
    await this.startPolling(Math.max(5, Number(this.cfg.pollInterval) || 30) * 1000);
    if (this.cfg.monitor !== false) this._connectWs();
  }

  stop() {
    super.stop();
    clearTimeout(this._wsTimer); clearTimeout(this._refreshTimer);
    this._wsTimer = this._refreshTimer = null;
    try { this.ws?.terminate?.() ?? this.ws?.close() } catch {}
    this.ws = null;
  }

  // ── HTTP ────────────────────────────────────────────────────────────────

  async _get(p) {
    const res = await fetch(`${this.base}${p}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Atios ${p}: HTTP ${res.status}`);
    return res.json();
  }

  async send(data, { wait = false, bits = 16, twice = false } = {}) {
    const res = await fetch(`${this.base}/api/dali/iface`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repeat_twice: twice, wait_response: wait, bits, data }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Atios DALI send: HTTP ${res.status}`);
    if (!wait) return null;
    const r = await res.json().catch(() => ({}));
    if (r.collision_detected) throw new Error('DALI collision');
    const a = Array.isArray(r.data) ? r.data[0] : r.data;
    return Number.isInteger(a) ? a : null;
  }

  async _nvm(section) {
    const out = [];
    for (let offset = 0, page = 0; page < 32; page++) {
      const r = await this._get(`/api/dali/nvm?section=${section}&offset=${offset}&limit=4`);
      const items = r?.data?.[section];
      if (!Array.isArray(items)) break;
      out.push(...items);
      if (!r.pagination?.has_more) break;
      offset += r.pagination.limit || 4;
    }
    return out;
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  async _discover() {
    let controls = [], inputs = [];
    try { controls = await this._nvm('control_devices') } catch (err) { console.warn(`[Atios] Device list not readable (${err.message})`) }
    try { inputs = await this._nvm('input_devices') } catch { /* older firmware */ }
    if (!controls.length && Array.isArray(this.cfg.lights)) controls = this.cfg.lights.map((a) => ({ address: Number(a) }));

    this._registerLight({ key: 'atios/all', name: this.cfg.name || 'SmartCore — all lights', target: {}, scenes: true, model: 'DALI broadcast' });
    for (const c of controls) {
      const a = Number(c.address);
      if (!Number.isInteger(a)) continue;
      if (c.is_group || a >= 128) {
        const g = a >= 128 ? a - 128 : a;
        if (g > 15 || this.groups.has(g)) continue;
        const grp = { group: g, key: `atios/g${g}`, name: c.name || `DALI group ${g}` };
        this.groups.set(g, grp);
        this._registerLight({ key: grp.key, name: grp.name, target: { group: g }, scenes: true, model: `DALI group ${g}` });
      } else if (a <= 63 && !this.lights.has(a)) {
        const channels = Array.isArray(c.device_types) && c.device_types.includes(DT8) ? (Number(c.color_type_features) >> 5) & 7 : 0;
        const l = { addr: a, key: `atios/l${a}`, name: c.name || `DALI lamp ${a}`, rgb: channels >= 3, white: channels >= 4 };
        this.lights.set(a, l);
        this._registerLight({ key: l.key, name: l.name, target: { short: a }, scenes: false, polled: true, rgb: l.rgb, white: l.white,
          model: `DALI ${l.white ? 'RGBW ' : l.rgb ? 'RGB ' : ''}lamp, address ${a}` });
      }
    }
    for (const d of inputs) this._registerInput(d);
    this._discovered = true;
    console.log(`[Atios] ${this.lights.size} lamp(s), ${this.groups.size} group(s), ${this.inputs.size} input device(s)`);
  }

  _registerLight({ key, name, target, scenes, model, polled, rgb, white }) {
    this.registry.registerDevice({
      key, type: 'atios', label: name, model: `Atios SmartCore · ${model}`, icon: '💡', color: 'yellow',
      sensors: [
        { path: 'switch', name: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch', homekit: 'light-rw' },
        { path: 'level', name: 'Brightness', format: 'percent', controllable: true, type: 'range', capabilityId: 'switchLevel', writeCmd: 'setLevel', min: 0, max: 100, step: 1 },
        ...(rgb ? [
          { path: 'hue', name: 'Hue', format: 'number', hidden: true },
          { path: 'saturation', name: 'Saturation', format: 'number', hidden: true },
          { path: 'color', name: 'Color', format: 'color', controllable: true, type: 'color', capabilityId: 'colorControl' },
        ] : []),
        ...(white ? [{ path: 'white', name: 'White', format: 'percent', controllable: true, type: 'range', capabilityId: 'white', writeCmd: 'setWhite', min: 0, max: 100, step: 1 }] : []),
        ...(scenes ? [{ path: 'scene', name: 'Scene', format: 'number', controllable: true, type: 'range', min: 0, max: 15, step: 1, capabilityId: 'scene', writeCmd: 'recall' }] : []),
        ...(polled ? [{ path: 'online', name: 'Online', sensorType: 'connectivity', hidden: true }] : []),
      ],
      homekit: ['light-rw'],
      _writeCapability: (cap, cmd, args = []) => this._seq(() => this._write(key, target, cap, cmd, args)),
    });
  }

  _registerInput(d) {
    const addr = Number(d.address);
    if (!Number.isInteger(addr) || addr > 63 || this.inputs.has(addr)) return;
    const key = `atios/in${addr}`, name = d.name || `DALI input ${addr}`;
    const instances = (Array.isArray(d.instances) ? d.instances : []).filter((i) => i && i.active !== false)
      .map((i) => ({ number: Number(i.number), type: Number(i.type) }));
    const sensors = [], homekit = [];
    for (const i of instances) {
      const n = i.number;
      if (i.type === INSTANCE.BUTTON) {
        i.path = `button${n}`;
        sensors.push({ path: `button${n}`, name: `Button ${n + 1}`, type: 'label' });
        sensors.push({ path: `button${n}Pressed`, name: `Button ${n + 1} pressed`, format: 'on-off', type: 'boolean' });
      } else if (i.type === INSTANCE.OCCUPANCY) {
        i.path = `occupancy${n}`;
        sensors.push({ path: `occupancy${n}`, name: 'Occupancy', format: 'on-off', type: 'boolean', homekit: 'motion' });
        if (!homekit.includes('motion')) homekit.push('motion');
      } else if (i.type === INSTANCE.LIGHT) {
        i.path = `light${n}`;
        sensors.push({ path: `light${n}`, name: 'Light level', format: 'number', unit: 'raw' });
      } else {
        i.path = `input${n}`;
        sensors.push({ path: `input${n}`, name: `Input ${n + 1}`, format: 'number' });
      }
    }
    sensors.push({ path: 'event', name: 'Last event', type: 'label' });
    this.inputs.set(addr, { addr, key, name, instances });
    this.registry.registerDevice({ key, type: 'atios', label: name, model: 'Atios SmartCore · DALI input device', icon: '🔘', sensors, homekit });
  }

  // ── Control ─────────────────────────────────────────────────────────────

  async _write(key, target, cap, cmd, args) {
    const v = args[0];
    if (cap === 'switch') {
      const on = cmd === 'on' || v === true || v === 1;
      await this.send([addressByte(target, true), on ? OP.LAST_ACTIVE : OP.OFF]);
      this.store.update(`${key}/switch`, on ? 1 : 0);
      if (!on) this.store.update(`${key}/level`, 0);
    } else if (cap === 'switchLevel') {
      const pct = Math.max(0, Math.min(100, Number(v)));
      if (!Number.isFinite(pct)) throw new Error('level must be 0–100');
      await this.send(pct > 0 ? [addressByte(target, false), toDali(pct)] : [addressByte(target, true), OP.OFF]);
      this.store.update(`${key}/level`, pct);
      this.store.update(`${key}/switch`, pct > 0 ? 1 : 0);
    } else if (cap === 'scene') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 15) throw new Error('scene must be 0–15');
      await this.send([addressByte(target, true), OP.SCENE + n]);
      this.store.update(`${key}/scene`, n);
    } else if (cap === 'colorControl') {
      const hue = Number(v?.hue), sat = Number(v?.saturation ?? 100);
      if (!Number.isFinite(hue) || !Number.isFinite(sat)) throw new Error('colour needs { hue: 0–100, saturation: 0–100 }');
      await this._setColour(target, OP.SET_RGB, hsToRgb(hue * 3.6, sat));
      this.store.update(`${key}/hue`, Math.round(hue));
      this.store.update(`${key}/saturation`, Math.round(sat));
    } else if (cap === 'white') {
      const pct = Math.max(0, Math.min(100, Number(v)));
      if (!Number.isFinite(pct)) throw new Error('white must be 0–100');
      await this._setColour(target, OP.SET_WAF, [Math.round((pct * 254) / 100), MASK, MASK]);
      this.store.update(`${key}/white`, pct);
    } else {
      throw new Error(`can't set ${cap}`);
    }
    // a broadcast / group command changes the lamps in it
    if (target.short === undefined) this._scheduleRefresh(500);
  }

  // three channel levels into DTR0–2, into the lamp's temporary colour, then
  // ACTIVATE — the channels left at MASK keep their value
  async _setColour(target, op, [a, b, c]) {
    const addr = addressByte(target, true);
    await this.send([SPECIAL.DTR0, a]);
    await this.send([SPECIAL.DTR1, b]);
    await this.send([SPECIAL.DTR2, c]);
    await this.send([SPECIAL.ENABLE_DT, DT8]);
    await this.send([addr, op]);
    await this.send([SPECIAL.ENABLE_DT, DT8]);
    await this.send([addr, OP.ACTIVATE]);
  }

  async _queryColour(addr, which) {
    await this.send([SPECIAL.DTR0, which]);
    await this.send([SPECIAL.ENABLE_DT, DT8]);
    const v = await this.send([addressByte({ short: addr }, true), OP.QUERY_COLOUR], { wait: true });
    return v === null || v === MASK ? null : v;
  }

  async _readColour(l) {
    const r = await this._queryColour(l.addr, COLOUR_VALUE.red);
    const g = await this._queryColour(l.addr, COLOUR_VALUE.green);
    const b = await this._queryColour(l.addr, COLOUR_VALUE.blue);
    if (r !== null && g !== null && b !== null && r + g + b > 0) {
      const { h, s } = rgbToHs(r, g, b);
      this.store.update(`${l.key}/hue`, Math.round(h / 3.6));
      this.store.update(`${l.key}/saturation`, Math.round(s));
    }
    if (!l.white) return;
    const w = await this._queryColour(l.addr, COLOUR_VALUE.white);
    if (w !== null) this.store.update(`${l.key}/white`, Math.round((w * 100) / 254));
  }

  // ── Polling ─────────────────────────────────────────────────────────────

  async _pollImpl() {
    if (!this._discovered) await this._discover();
    const settings = await this._get('/settings');
    if (!settings || typeof settings !== 'object') throw new Error('Atios: no answer from /settings');
    this.store.update('atios/all/ipInterface', settings.dali_ip_interface ? 1 : 0);
    await this._readLevels();
  }

  async _readLevels() {
    for (const l of this.lights.values()) {
      let lvl = null;
      try { lvl = await this._seq(() => this.send([addressByte({ short: l.addr }, true), OP.QUERY_LEVEL], { wait: true })) } catch { /* collision / busy */ }
      if (lvl === null) { this.store.update(`${l.key}/online`, 0); continue }
      this.store.update(`${l.key}/online`, 1);
      if (lvl !== 255) { // 255 = MASK — level unknown
        this.store.update(`${l.key}/level`, fromDali(lvl));
        this.store.update(`${l.key}/switch`, lvl > 0 ? 1 : 0);
      }
      if (l.rgb) await this._seq(() => this._readColour(l)).catch(() => { /* collision / busy */ });
    }
  }

  _scheduleRefresh(ms = 1000) {
    if (this._refreshTimer || this._stopped) return;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this._readLevels().catch(() => {});
    }, ms);
  }

  // ── Live bus monitor ────────────────────────────────────────────────────

  _connectWs() {
    if (!WebSocketLib || this._stopped) return;
    const url = `${this.base.replace(/^http/, 'ws')}/`;
    const ws = new WebSocketLib(url, { handshakeTimeout: 10000 });
    this.ws = ws;
    ws.on('open', () => { this._wsDelay = 2000; console.log('[Atios] Bus monitor connected') });
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(String(buf)) } catch { return }
      if (m?.type === 'daliMonitor') this._onFrame(m.data || {});
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (this.ws !== ws || this._stopped) return;
      this.ws = null;
      this._wsTimer = setTimeout(() => this._connectWs(), this._wsDelay);
      this._wsDelay = Math.min(60000, this._wsDelay * 2);
    });
  }

  _onFrame(f) {
    if (!f.externalSource || f.framingError || !Array.isArray(f.data) || !f.data.length) return;
    if (f.bits === 16) { this._scheduleRefresh(); return } // another controller drove the lamps
    const e = decodeEvent(f.data, f.bits);
    if (!e || e.shortAddress === null) return;
    const dev = this.inputs.get(e.shortAddress);
    if (!dev) return;
    const inst = e.instanceNumber !== undefined
      ? dev.instances.find((i) => i.number === e.instanceNumber)
      : dev.instances.find((i) => i.type === e.instanceType);
    const type = inst?.type ?? e.instanceType;
    const put = (p, v) => this.store.update(`${dev.key}/${p}`, v);
    let text;
    if (type === INSTANCE.BUTTON) {
      text = BUTTON_EVENTS[e.info] || `event ${e.info}`;
      if (inst) {
        put(inst.path, text);
        if (e.info === 0x01) put(`${inst.path}Pressed`, 1);
        if (e.info === 0x00) put(`${inst.path}Pressed`, 0);
      }
    } else if (type === INSTANCE.OCCUPANCY) {
      text = e.info & 0b10 ? 'occupied' : 'vacant';
      if (inst) put(inst.path, e.info & 0b10 ? 1 : 0);
    } else {
      text = `value ${e.info}`;
      if (inst) put(inst.path, e.info);
    }
    put('event', `${inst ? `#${inst.number + 1} ` : ''}${text}`);
  }
}

module.exports = AtiosClient;
module.exports.decodeEvent = decodeEvent;
module.exports.addressByte = addressByte;
module.exports.hsToRgb = hsToRgb;
module.exports.rgbToHs = rgbToHs;
