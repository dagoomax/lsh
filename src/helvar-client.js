'use strict';

const net            = require('net');
const platformStatus = require('./platform-status');

// Helvar lighting (DALI / Digidim / Imagine routers 905, 910, 920, 950) over
// HelvarNet — the router's own Ethernet I/O protocol, TCP port 50000, ASCII:
//
//   >V:2,C:<command>[,G:..,B:..,S:..,L:..,F:..][,@c.r.s.d]#     command / query
//   ?V:2,C:<command>,...=<reply>#                               reply
//   !V:2,C:<command>,...=<error code>#                          error
//
// Addresses are @cluster.router.subnet.device[.subdevice] (cluster/router =
// 3rd/4th octet of the router's IP: 10.254.1.2 → @1.2). Fade times are in
// 1/100 s. Reference: Helvar Designer help, "HelvarNet" (Designer 4.2.18).
//
// What LSH builds from it:
//   helvar/group-<n>       every group: level (13 Direct Level), on/off,
//                          scene recall (11 Recall Scene), last scene (109),
//                          power (161)
//   helvar/<c>_<r>_<s>_<d> every load (ballast, dimmer, relay): level (14),
//                          on/off, power (160), lamp failure / fault (110)
//   …                      Digidim multisensors (312, 320, 321): motion (151)
//                          and light level (150); 444 input units: inputs
//
// Changes made on the lighting side (panels, sensors, schedules) arrive live
// when "Push Messages" is on in Designer (root node → HelvarNet); otherwise
// the poll (loads/groups every `pollSeconds`, sensors every `sensorSeconds`)
// catches them. Untested against a real router — `scripts/helvar-simulator.js`.
//
// config.helvar = { host: '10.254.1.1', port: 50000, fade: 1 (s),
//                   pollSeconds: 30, sensorSeconds: 5, cluster?, router? }

const PORT = 50000;
const TIMEOUT = 5000;

const PROTOCOL = { 1: 'DALI', 2: 'Digidim', 4: 'Imagine', 8: 'DMX' };
const DALI_TYPES = {
  0: 'Fluorescent ballast', 1: 'Emergency light', 2: 'Discharge lamp', 3: 'Halogen', 4: 'Incandescent',
  5: '1–10 V converter', 6: 'LED driver', 7: 'Relay', 8: 'Colour control', 9: 'Sequencer',
};
// Digidim: bytes 3..1 of the type word → part number, name, load / sensor / input
const DIGIDIM = {
  0x001008: ['100', 'Rotary'], 0x001107: ['110', 'Single Slider'], 0x001114: ['111', 'Double Slider'],
  0x001213: ['121', '2 Button + IR'], 0x001220: ['122', '2 Button modifier + IR'], 0x001244: ['124', '5 Button + IR'],
  0x001251: ['125', '5 Button + modifier + IR'], 0x001268: ['126', '8 Button + IR'], 0x001701: ['170', 'IR Receiver'],
  0x003125: ['312', 'Multisensor', 'sensor'], 0x003202: ['320', 'Occupancy Sensor', 'sensor'], 0x003210: ['321', 'Multisensor (Occupancy)', 'sensor'],
  0x004108: ['410', '1–10 V Converter', 'load'], 0x004160: ['416S', '16 A Dimmer', 'load'], 0x004252: ['425S', '25 A Dimmer', 'load'],
  0x004443: ['444', 'Mini Input Unit', 'input'], 0x004504: ['450', '800 W Dimmer', 'load'], 0x004528: ['452', '1000 W Universal Dimmer', 'load'],
  0x004559: ['455', '500 W Thyristor Dimmer', 'load'], 0x004580: ['458/DIM8', '8 Channel Dimmer', 'load'],
  0x744581: ['458/CTR8', '8 Channel Ballast Controller', 'load'], 0x044583: ['458/SW8', '8 Channel Relay Module', 'load'],
  0x004586: ['458/OPT4', '4 Channel Options Module', 'load'], 0x004603: ['460', 'DALI to SDIM Converter', 'load'],
  0x004726: ['472', 'DIN Rail 1–10 V / DSI Converter', 'load'], 0x004740: ['474', '4 Channel Ballast Controller', 'load'],
  0x004741: ['474', '4 Channel Relay Unit', 'load'], 0x004900: ['490', 'Blinds Unit', 'load'], 0x004948: ['494', 'Relay Unit', 'load'],
  0x004986: ['498', 'Relay Unit', 'load'], 0x008045: ['804', 'Digidim 4'], 0x009240: ['924', 'LCD TouchPanel'],
  0x009356: ['935', 'Scene Commander (6 buttons)'], 0x009394: ['939', 'Scene Commander (10 buttons)'], 0x009424: ['942', 'Analogue Input Unit'],
};
const ERRORS = {
  1: 'Invalid group', 2: 'Invalid cluster', 3: 'Invalid router', 4: 'Invalid subnet', 5: 'Invalid device', 6: 'Invalid subdevice',
  7: 'Invalid block', 8: 'Invalid scene', 9: 'Cluster does not exist', 10: 'Router does not exist', 11: 'Device does not exist',
  12: 'Property does not exist', 13: 'Invalid RAW message size', 14: 'Invalid message type', 15: 'Invalid message command',
  16: 'Missing ASCII terminator', 17: 'Missing ASCII parameter', 18: 'Incompatible version',
};
// Device state (110) flags that mean "needs attention"
const STATE_LAMP_FAILURE = 0x2, STATE_MISSING = 0x4, STATE_FAULTY = 0x8;

// The ASCII type word is decimal on routers (aiohelvar reads it so); the help
// file shows it as 8 hex digits ("00100802") — take both
function decodeType(raw) {
  const s = String(raw || '').trim();
  let n = /^0[0-9a-f]{7}$/i.test(s) ? parseInt(s, 16) : Number(s);
  if (!Number.isFinite(n)) n = 0;
  const protocol = PROTOCOL[n & 0xff] || 'Unknown';
  if (protocol === 'DALI') return { protocol, kind: 'load', model: DALI_TYPES[(n >> 8) & 0xff] || 'DALI device' };
  if (protocol === 'Digidim') {
    const d = DIGIDIM[(n >>> 8) & 0xffffff];
    return d ? { protocol, kind: d[2] || 'control', model: `${d[0]} ${d[1]}` } : { protocol, kind: 'control', model: 'Digidim device' };
  }
  if (protocol === 'Imagine' || protocol === 'DMX') return { protocol, kind: 'load', model: `${protocol} channel` };
  return { protocol, kind: 'unknown', model: 'Unknown' };
}

// ">V:2,C:11,G:3,B:1,S:2,F:100#" → { type: '>', command: 11, params: { G: '3', … }, address: '1.1.1.4', value }
function parseMessage(text) {
  const m = /^([<>?!])V:(\d+),C:(\d+)((?:,[A-Z]:[^,=@#]*)*)(?:,?@([\d.]+))?(?:=(.*))?$/.exec(text.trim());
  if (!m) return null;
  const params = {};
  for (const p of (m[4] || '').split(',').filter(Boolean)) { const [k, v] = p.split(':'); params[k] = v; }
  return { type: m[1], version: Number(m[2]), command: Number(m[3]), params, address: m[5] || null, value: m[6] ?? null };
}

function formatCommand(command, params = {}, address = null) {
  const parts = ['V:2', `C:${command}`, ...Object.entries(params).map(([k, v]) => `${k}:${v}`)];
  if (address) parts.push(`@${address}`);
  return `>${parts.join(',')}#`;
}

const slug = (addr) => addr.replace(/\./g, '_');

class HelvarClient {
  constructor(config, store, sensorRegistry) {
    this.cfg = config.helvar || {};
    this.store = store;
    this.registry = sensorRegistry;
    this._sock = null;
    this._buf = '';
    this._queue = [];       // pending { text, match, resolve, reject }
    this._inflight = null;
    this._groups = new Map(); // id → { name, members: [addr], scenes: {num: name} }
    this._devices = new Map(); // addr → { name, kind, model, key, subLux, subPir }
    this._stopped = false;
    this._timers = [];
  }

  get fadeHs() { return Math.round(Math.max(0, Math.min(6553.5, Number(this.cfg.fade ?? 1))) * 100); }

  async start() {
    if (!this.cfg.host) throw new Error('helvar.host is required');
    await this._connect();
    await this._discover();
    platformStatus.set('helvar', true);
    await this._pollLoads().catch(() => {});
    await this._pollSensors().catch(() => {});
    const every = (ms, fn) => { const t = setInterval(() => fn().catch(() => {}), ms); this._timers.push(t); };
    every(Math.max(10, Number(this.cfg.pollSeconds) || 30) * 1000, () => this._pollLoads());
    every(Math.max(2, Number(this.cfg.sensorSeconds) || 5) * 1000, () => this._pollSensors());
    console.log(`[Helvar] Started — ${this._groups.size} group(s), ${[...this._devices.values()].filter((d) => d.kind === 'load').length} load(s), ${[...this._devices.values()].filter((d) => d.kind === 'sensor' || d.kind === 'input').length} sensor(s)`);
  }

  stop() {
    this._stopped = true;
    for (const t of this._timers) clearInterval(t);
    clearTimeout(this._reconnectTimer);
    try { this._sock?.destroy(); } catch { /* closed */ }
  }

  // ── Connection ────────────────────────────────────────────

  _connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.cfg.host, port: Number(this.cfg.port) || PORT });
      let settled = false;
      sock.setEncoding('latin1');
      sock.setKeepAlive(true, 30_000);
      sock.setTimeout(10_000, () => { if (!settled) sock.destroy(new Error('Connection timed out')); });
      sock.on('connect', () => { settled = true; sock.setTimeout(0); this._sock = sock; resolve(); });
      sock.on('data', (d) => this._onData(d));
      sock.on('error', (err) => { if (!settled) { settled = true; reject(err); } else console.error(`[Helvar] ${err.message}`); });
      sock.on('close', () => {
        if (this._sock === sock) this._sock = null;
        this._failAll(new Error('Connection closed'));
        if (!settled || this._stopped) return;
        platformStatus.set('helvar', false);
        console.warn('[Helvar] Connection closed — reconnecting in 10 s');
        this._reconnectTimer = setTimeout(() => this._reconnect(), 10_000);
      });
    });
  }

  async _reconnect() {
    if (this._stopped) return;
    try {
      await this._connect();
      platformStatus.set('helvar', true);
      console.log('[Helvar] Reconnected');
      this._pollLoads().catch(() => {});
    } catch (err) {
      this._reconnectTimer = setTimeout(() => this._reconnect(), 30_000);
    }
  }

  // Messages end in '#'; '$' also ends one (aiohelvar treats it as a separator)
  _onData(chunk) {
    this._buf += chunk;
    if (this._buf.length > 65536) this._buf = this._buf.slice(-8192);
    let i;
    while ((i = this._buf.search(/[#$]/)) >= 0) {
      const text = this._buf.slice(0, i);
      this._buf = this._buf.slice(i + 1);
      const msg = parseMessage(text);
      if (msg) this._onMessage(msg);
    }
  }

  _onMessage(msg) {
    if (msg.type === '>') return this._onPush(msg);
    const q = this._inflight;
    // one query in flight, so the command number is enough (some replies
    // quote the address differently from the query, e.g. 100 → @c.r.s.1)
    if (q && q.command === msg.command) {
      this._inflight = null;
      clearTimeout(q.timer);
      if (msg.type === '!') {
        const e = new Error(ERRORS[Number(msg.value)] || `Error ${msg.value}`); e.code = Number(msg.value); q.reject(e);
      } else q.resolve(msg.value ?? '');
      this._next();
    }
  }

  // One query at a time: replies carry no sequence number, so this keeps
  // them matched to their question
  _query(command, params = {}, address = null) {
    return new Promise((resolve, reject) => {
      this._queue.push({ text: formatCommand(command, params, address), command, address, resolve, reject });
      if (!this._inflight) this._next();
    });
  }

  _next() {
    const q = this._queue.shift();
    if (!q) return;
    if (!this._sock) { q.reject(new Error('Not connected')); return this._next(); }
    this._inflight = q;
    q.timer = setTimeout(() => {
      if (this._inflight !== q) return;
      this._inflight = null;
      q.reject(new Error(`No reply to C:${q.command}`));
      this._next();
    }, TIMEOUT);
    this._sock.write(q.text);
  }

  // Control commands get no reply (no "A:1" acknowledgement asked)
  _send(command, params = {}, address = null) {
    if (!this._sock) throw new Error('Helvar router not connected');
    this._sock.write(formatCommand(command, params, address));
  }

  _failAll(err) {
    const all = [this._inflight, ...this._queue].filter(Boolean);
    this._inflight = null; this._queue = [];
    for (const q of all) { clearTimeout(q.timer); q.reject(err); }
  }

  // ── Discovery ─────────────────────────────────────────────

  _clusterRouter(ip) {
    const o = String(ip).split('.');
    return `${this.cfg.cluster ?? Number(o[2])}.${this.cfg.router ?? Number(o[3])}`;
  }

  async _discover() {
    const workgroup = await this._query(107).catch(() => '');
    this._workgroup = workgroup;
    // every router of the workgroup; just ours if the query isn't supported
    let routers = [];
    const members = await this._query(108).catch(() => '');
    for (const m of members.split(',')) { const ip = m.replace(/^@/, '').trim(); if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) routers.push(ip); }
    if (!routers.length) routers = [this.cfg.host];
    if (this.cfg.cluster != null || this.cfg.router != null) routers = [this.cfg.host];

    for (const ip of routers) {
      const cr = /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? this._clusterRouter(ip) : `${this.cfg.cluster ?? 1}.${this.cfg.router ?? 1}`;
      for (let subnet = 1; subnet <= 4; subnet++) {
        const list = await this._query(100, {}, `${cr}.${subnet}`).catch(() => '');
        for (const entry of list.split(',')) {
          const [type, idx] = entry.split('@');
          if (!idx || !/^\d+$/.test(idx)) continue;
          const addr = `${cr}.${subnet}.${idx}`;
          const t = decodeType(type);
          if (t.kind === 'control' || t.kind === 'unknown') continue; // panels, buttons, IR — nothing to show
          const name = await this._query(106, {}, addr).catch(() => '') || `${t.model} ${addr}`;
          this._registerDevice(addr, name, t);
        }
      }
    }

    const ids = (await this._query(165).catch(() => '')).split(',').map(Number).filter((n) => n > 0);
    const sceneNames = await this._query(166).catch(() => '');
    for (const g of ids) {
      const name = await this._query(105, { G: g }).catch(() => '') || `Group ${g}`;
      const members = (await this._query(164, { G: g }).catch(() => '')).split(',').map((a) => a.replace(/^@/, '').trim()).filter(Boolean);
      const scenes = {};
      for (const m of sceneNames.matchAll(/@(\d+)\.(\d+)\.(\d+):([^@]*)/g)) {
        if (Number(m[1]) === g && m[4].trim()) scenes[`${m[2]}.${m[3]}`] = m[4].trim();
      }
      this._registerGroup(g, name, members, scenes);
    }
  }

  _registerGroup(id, name, members, scenes) {
    const key = `helvar/group-${id}`;
    this._groups.set(id, { id, key, name, members, scenes });
    this.registry.registerDevice({
      key, type: 'helvar', instance: `group-${id}`, label: name, model: 'Helvar group', icon: '💡', color: 'yellow',
      sensors: [
        { path: 'switch', name: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch', homekit: 'light-rw' },
        { path: 'level', name: 'Brightness', format: 'percent', controllable: true, type: 'range', capabilityId: 'switchLevel', writeCmd: 'setLevel', min: 0, max: 100, step: 1 },
        // "3" = scene 3 of block 1, "2.5" = block 2 scene 5, or a scene's name
        { path: 'scene', name: 'Scene', format: 'text', controllable: true, type: 'text', capabilityId: 'scene', writeCmd: 'recall' },
        { path: 'lastScene', name: 'Last scene', format: 'text' },
        { path: 'power', name: 'Power use', format: 'number', unit: 'W' },
        { path: 'scenes', name: 'Scenes', format: 'object', hidden: true },
      ],
      homekit: ['light-rw'],
      _writeCapability: (cap, cmd, args) => this._writeGroup(id, cap, cmd, args),
    });
    this.store.update(`${key}/scenes`, scenes);
  }

  _registerDevice(addr, name, t) {
    const key = `helvar/${slug(addr)}`;
    const dev = { addr, key, name, ...t };
    this._devices.set(addr, dev);
    const base = { key, type: 'helvar', instance: slug(addr), label: name, model: `${t.model} (${t.protocol} @${addr})`, color: 'yellow' };
    if (t.kind === 'load') {
      this.registry.registerDevice({
        ...base, icon: '💡',
        sensors: [
          { path: 'switch', name: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch', homekit: 'light-rw' },
          { path: 'level', name: 'Brightness', format: 'percent', controllable: true, type: 'range', capabilityId: 'switchLevel', writeCmd: 'setLevel', min: 0, max: 100, step: 1 },
          { path: 'power', name: 'Power use', format: 'number', unit: 'W' },
          { path: 'fault', name: 'Fault', format: 'on-off' },
        ],
        homekit: ['light-rw'],
        _writeCapability: (cap, cmd, args) => this._writeDevice(addr, cap, cmd, args),
      });
    } else if (t.kind === 'sensor') {
      this.registry.registerDevice({
        ...base, icon: '👁',
        sensors: [
          { path: 'motion', name: 'Motion', format: 'on-off', homekit: 'motion' },
          { path: 'lux', name: 'Light level', format: 'percent' },
        ],
        homekit: ['motion'],
      });
    } else if (t.kind === 'input') {
      this.registry.registerDevice({
        ...base, icon: '🔘',
        sensors: Array.from({ length: 8 }, (_, i) => ({ path: `input${i + 1}`, name: `Input ${i + 1}`, format: 'on-off' })),
        homekit: [],
      });
    }
  }

  // ── Polling ───────────────────────────────────────────────

  async _pollLoads() {
    if (!this._sock) throw new Error('Not connected');
    for (const d of this._devices.values()) {
      if (d.kind !== 'load') continue;
      const lvl = Number(await this._query(152, {}, d.addr).catch(() => NaN));
      if (Number.isFinite(lvl)) this._setLevel(d.key, lvl);
      const st = Number(await this._query(110, {}, d.addr).catch(() => NaN));
      if (Number.isFinite(st)) this.store.update(`${d.key}/fault`, st & (STATE_LAMP_FAILURE | STATE_MISSING | STATE_FAULTY) ? 1 : 0);
      const w = Number(await this._query(160, {}, d.addr).catch(() => NaN));
      if (Number.isFinite(w)) this.store.update(`${d.key}/power`, w);
    }
    for (const g of this._groups.values()) {
      const ls = Number(await this._query(109, { G: g.id }).catch(() => NaN));
      if (Number.isFinite(ls)) this._applyLastScene(g, ls);
      const w = Number(await this._query(161, { G: g.id }).catch(() => NaN));
      if (Number.isFinite(w)) this.store.update(`${g.key}/power`, w);
    }
  }

  async _pollSensors() {
    if (!this._sock) return;
    for (const d of this._devices.values()) {
      if (d.kind === 'sensor') {
        const pir = Number(await this._query(151, {}, d.addr).catch(() => NaN));
        if (Number.isFinite(pir)) this.store.update(`${d.key}/motion`, pir ? 1 : 0);
        // the light sensor is one of the subdevices — found once, then remembered
        if (d.luxSub === undefined) {
          d.luxSub = null;
          for (let sub = 1; sub <= 4 && d.luxSub === null; sub++) {
            if (Number.isFinite(Number(await this._query(150, {}, `${d.addr}.${sub}`).catch(() => NaN)))) d.luxSub = sub;
          }
        }
        if (d.luxSub) {
          const lux = Number(await this._query(150, {}, `${d.addr}.${d.luxSub}`).catch(() => NaN));
          if (Number.isFinite(lux)) this.store.update(`${d.key}/lux`, lux);
        }
      } else if (d.kind === 'input') {
        const bits = Number(await this._query(151, {}, d.addr).catch(() => NaN));
        if (Number.isFinite(bits)) for (let i = 0; i < 8; i++) this.store.update(`${d.key}/input${i + 1}`, (bits >> i) & 1);
      }
    }
  }

  _setLevel(key, lvl) {
    const v = Math.max(0, Math.min(100, Math.round(lvl)));
    this.store.update(`${key}/level`, v);
    this.store.update(`${key}/switch`, v > 0 ? 1 : 0);
  }

  // 109: 1..128 = scene (block-1)*16+scene; 128 off, 129 min, 130 max,
  // 137..237 = a direct level 0..100 %
  _applyLastScene(g, v) {
    if (v >= 1 && v <= 127) {
      const block = Math.floor((v - 1) / 16) + 1, scene = ((v - 1) % 16) + 1;
      this.store.update(`${g.key}/lastScene`, g.scenes[`${block}.${scene}`] || `${block}.${scene}`);
    } else if (v === 128) { this.store.update(`${g.key}/lastScene`, 'off'); this._setLevel(g.key, 0); }
    else if (v === 130) { this.store.update(`${g.key}/lastScene`, 'max'); this._setLevel(g.key, 100); }
    else if (v === 129) this.store.update(`${g.key}/lastScene`, 'min');
    else if (v >= 137 && v <= 237) { this.store.update(`${g.key}/lastScene`, `${v - 137}%`); this._setLevel(g.key, v - 137); }
  }

  // ── Push messages (Designer: Push Messages = True) ────────

  _onPush(msg) {
    const p = msg.params;
    if (msg.command === 11 && p.G) {
      const g = this._groups.get(Number(p.G));
      if (!g) return;
      const block = Number(p.B || 1), scene = Number(p.S || 1);
      this.store.update(`${g.key}/lastScene`, g.scenes[`${block}.${scene}`] || `${block}.${scene}`);
      this._refreshMembers(g, Number(p.F || 0));
    } else if (msg.command === 13 && p.G) {
      const g = this._groups.get(Number(p.G));
      if (!g) return;
      this._setLevel(g.key, Number(p.L));
      for (const a of g.members) { const d = this._devices.get(a); if (d?.kind === 'load') this._setLevel(d.key, Number(p.L)); }
    } else if (msg.command === 14 && msg.address) {
      const d = this._devices.get(msg.address);
      if (d) this._setLevel(d.key, Number(p.L));
    } else if (msg.command === 12 && msg.address) {
      const d = this._devices.get(msg.address);
      if (d) setTimeout(() => this._query(152, {}, d.addr).then((v) => this._setLevel(d.key, Number(v))).catch(() => {}), 300);
    }
  }

  // After a scene the members' levels are the scene's — read them back once the fade is done
  _refreshMembers(g, fadeHs) {
    setTimeout(async () => {
      let max = 0;
      for (const a of g.members) {
        const d = this._devices.get(a);
        if (d?.kind !== 'load') continue;
        const v = Number(await this._query(152, {}, a).catch(() => NaN));
        if (Number.isFinite(v)) { this._setLevel(d.key, v); max = Math.max(max, v); }
      }
      this._setLevel(g.key, max);
    }, Math.min(fadeHs * 10, 60_000) + 300);
  }

  // ── Commands ──────────────────────────────────────────────

  _levelArg(cap, cmd, args) {
    if (cap === 'switch') return cmd === 'on' ? 100 : 0;
    const v = Math.round(Number(args?.[0]));
    if (!(v >= 0 && v <= 100)) throw new Error('Level: 0–100');
    return v;
  }

  async _writeGroup(id, cap, cmd, args) {
    const g = this._groups.get(id);
    if (cap === 'scene') return this.recallScene(id, args?.[0]);
    const level = this._levelArg(cap, cmd, args);
    this._send(13, { G: id, L: level, F: this.fadeHs });
    this._setLevel(g.key, level);
    for (const a of g.members) { const d = this._devices.get(a); if (d?.kind === 'load') this._setLevel(d.key, level); }
  }

  async _writeDevice(addr, cap, cmd, args) {
    const d = this._devices.get(addr);
    const level = this._levelArg(cap, cmd, args);
    this._send(14, { L: level, F: this.fadeHs }, addr);
    this._setLevel(d.key, level);
  }

  // "3" → block 1 scene 3; "2.5" → block 2 scene 5; otherwise a scene name
  recallScene(groupId, what) {
    const g = this._groups.get(Number(groupId));
    if (!g) throw new Error(`No Helvar group ${groupId}`);
    const s = String(what ?? '').trim();
    let block, scene;
    let m;
    if ((m = /^(\d+)$/.exec(s))) { block = 1; scene = Number(m[1]); }
    else if ((m = /^(\d+)\.(\d+)$/.exec(s))) { block = Number(m[1]); scene = Number(m[2]); }
    else {
      const hit = Object.entries(g.scenes).find(([, n]) => n.toLowerCase() === s.toLowerCase());
      if (!hit) throw new Error(`No scene "${s}" in ${g.name}${Object.keys(g.scenes).length ? ` (${Object.values(g.scenes).join(', ')})` : ''}`);
      [block, scene] = hit[0].split('.').map(Number);
    }
    if (!(block >= 1 && block <= 8 && scene >= 1 && scene <= 16)) throw new Error('Scene: block 1–8, scene 1–16');
    this._send(11, { G: g.id, B: block, S: scene, F: this.fadeHs });
    this.store.update(`${g.key}/lastScene`, g.scenes[`${block}.${scene}`] || `${block}.${scene}`);
    this._refreshMembers(g, this.fadeHs);
  }

  status() {
    return {
      connected: !!this._sock, workgroup: this._workgroup || null,
      groups: [...this._groups.values()].map((g) => ({ id: g.id, name: g.name, members: g.members.length, scenes: g.scenes })),
      devices: [...this._devices.values()].map((d) => ({ address: d.addr, name: d.name, kind: d.kind, model: d.model, protocol: d.protocol })),
    };
  }
}

HelvarClient.parseMessage = parseMessage;
HelvarClient.formatCommand = formatCommand;
HelvarClient.decodeType = decodeType;
module.exports = HelvarClient;
