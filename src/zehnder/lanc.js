'use strict';

// Zehnder ComfoAir Q / ComfoAir Flex through the ComfoConnect LAN C gateway
// (also the ComfoConnect Pro's app port). Protocol as implemented by
// michaelarnauts/aiocomfoconnect (protobuf/zehnder.proto):
//
//   TCP 56747, every message: u32 BE length | src uuid (16) | dst uuid (16) |
//   u16 BE op length | GatewayOperation (protobuf) | request (protobuf)
//
// Session: StartSession (takeover) → NOT_ALLOWED means this app isn't
// registered yet → RegisterApp (uuid + the gateway PIN, default 0000) and
// StartSession again. Readings are PDO subscriptions (CnRpdoRequest → a stream
// of CnRpdoNotification), control is RMI (CnRmiRequest to the ventilation
// node). The gateway allows ONE session: the Zehnder app taking over closes
// ours (we come back after `takeoverBackoff`). The gateway's own uuid comes
// from UDP discovery (0x0a 0x00 → port 56747) when not configured.

const net          = require('net');
const dgram        = require('dgram');
const crypto       = require('crypto');
const EventEmitter = require('events');

const PORT = 56747;

// ── minimal protobuf (varint + length-delimited is all zehnder.proto needs) ──
function varint(n) {
  const out = [];
  let v = BigInt.asUintN(64, BigInt(n));
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b) } while (v);
  return Buffer.from(out);
}
// fields: [[no, 'v' | 'b', value]] — value null/undefined is skipped
function pbEncode(fields) {
  const parts = [];
  for (const [no, kind, val] of fields) {
    if (val === undefined || val === null) continue;
    if (kind === 'v') parts.push(varint((no << 3) | 0), varint(typeof val === 'boolean' ? +val : val));
    else { const b = Buffer.isBuffer(val) ? val : Buffer.from(String(val)); parts.push(varint((no << 3) | 2), varint(b.length), b) }
  }
  return Buffer.concat(parts);
}
// → { fieldNo: number | Buffer } (last occurrence wins)
function pbDecode(buf) {
  const out = {};
  let i = 0;
  const rv = () => { let r = 0n, s = 0n, b; do { if (i >= buf.length) throw new Error('truncated varint'); b = buf[i++]; r |= BigInt(b & 0x7f) << s; s += 7n } while (b & 0x80); return r };
  while (i < buf.length) {
    const key = Number(rv()), no = key >> 3, wt = key & 7;
    if (wt === 0) { const v = rv(); out[no] = v > BigInt(Number.MAX_SAFE_INTEGER) ? Number(BigInt.asIntN(64, v)) : Number(v) }
    else if (wt === 2) { const len = Number(rv()); out[no] = buf.subarray(i, i + len); i += len }
    else if (wt === 5) { out[no] = buf.readUInt32LE(i); i += 4 }
    else if (wt === 1) { out[no] = Number(buf.readBigUInt64LE(i)); i += 8 }
    else throw new Error(`unsupported wire type ${wt}`);
  }
  return out;
}

const OP = {
  RegisterAppRequest: 2, StartSessionRequest: 3, CloseSessionRequest: 4, VersionRequest: 18,
  RegisterAppConfirm: 52, StartSessionConfirm: 53, VersionConfirm: 68,
  CnTimeRequest: 30, CnTimeConfirm: 31, CnNodeNotification: 32, CnRmiRequest: 33, CnRmiResponse: 34,
  CnRpdoRequest: 38, CnRpdoConfirm: 39, CnRpdoNotification: 40, CnAlarmNotification: 41, CnNodeRequest: 42,
  GatewayNotification: 100, KeepAlive: 101,
};
const RESULT = ['OK', 'BAD_REQUEST', 'INTERNAL_ERROR', 'NOT_REACHABLE', 'OTHER_SESSION', 'NOT_ALLOWED', 'NO_RESOURCES', 'NOT_EXIST', 'RMI_ERROR'];

function frame(src, dst, op, msg = Buffer.alloc(0)) {
  const len = Buffer.alloc(4), cl = Buffer.alloc(2);
  len.writeUInt32BE(32 + 2 + op.length + msg.length);
  cl.writeUInt16BE(op.length);
  return Buffer.concat([len, src, dst, cl, op, msg]);
}
function unframe(body) {
  const opLen = body.readUInt16BE(32);
  return { src: body.subarray(0, 16), dst: body.subarray(16, 32), op: pbDecode(body.subarray(34, 34 + opLen)), msg: body.subarray(34 + opLen) };
}

// PDO types: 1 u8, 2 u16, 3 u32, 5 i8, 6 i16, 0 bool
const T = { BOOL: 0, U8: 1, U16: 2, U32: 3, I8: 5, I16: 6 };
// pdid → [path, type, scale]
const SENSORS = {
  65:  ['speed', T.U8],            // 0 away, 1 low, 2 medium, 3 high
  56:  ['mode', T.U8],             // 255 (-1) auto, 1 / 5 manual
  67:  ['profile', T.U8],          // 0 normal, 1 cool, 2 warm
  117: ['exhaustFanDuty', T.U8],
  118: ['supplyFanDuty', T.U8],
  119: ['exhaustFlow', T.U16],
  120: ['supplyFlow', T.U16],
  121: ['exhaustFanRpm', T.U16],
  122: ['supplyFanRpm', T.U16],
  128: ['power', T.U16],
  129: ['energyYear', T.U16],
  130: ['energy', T.U16],
  146: ['preheaterPower', T.U16],
  192: ['filterDays', T.U16],
  212: ['targetTemp', T.I16, 0.1],
  221: ['supplyTemp', T.I16, 0.1],
  227: ['bypass', T.U8],
  274: ['extractTemp', T.I16, 0.1],
  275: ['exhaustTemp', T.I16, 0.1],
  276: ['outdoorTemp', T.I16, 0.1],
  290: ['extractHumidity', T.U8],
  291: ['exhaustHumidity', T.U8],
  292: ['outdoorHumidity', T.U8],
  294: ['supplyHumidity', T.U8],
};

// Alarm bit → text (same on all firmware; 70+ moved between 1.4.0 and later)
const ERRORS = {
  21: 'Overheating — ventilation stopped', 22: 'Unit temperature too high', 23: 'Extract air temperature sensor fault', 25: 'Exhaust air temperature sensor fault',
  27: 'Outdoor air temperature sensor fault', 29: 'Pre-conditioned outdoor air sensor fault', 31: 'Supply air temperature sensor fault', 33: 'Unit not commissioned',
  34: 'Front door open', 35: 'Pre-heater in the wrong position', 37: 'Pre-heater fault', 38: 'Pre-heater fault', 39: 'Extract air humidity sensor fault',
  41: 'Exhaust air humidity sensor fault', 43: 'Outdoor air humidity sensor fault', 47: 'Supply air humidity sensor fault', 49: 'Exhaust air flow sensor fault',
  50: 'Supply air flow sensor fault', 51: 'Extract air fan fault', 52: 'Supply air fan fault', 53: 'Exhaust air pressure too high', 54: 'Supply air pressure too high',
  55: 'Extract air fan fault', 56: 'Supply air fan fault', 57: 'Exhaust air flow below set point', 58: 'Supply air flow below set point',
  62: 'Air flow unbalance', 66: 'RF hardware missing', 67: 'Option box missing', 68: 'Pre-heater missing',
};
const ERRORS_NEW = { 77: 'Replace the filters now', 78: 'Replace / clean the external filter', 79: 'Order new filters', 80: 'Service mode active', 89: 'Bypass in manual mode', 101: 'ComfoNet error' };
const ERRORS_140 = { 73: 'Replace the filters now', 74: 'Replace / clean the external filter', 75: 'Order new filters', 76: 'Service mode active', 81: 'Bypass in manual mode' };
const FILTER_ERRORS = new Set(['Replace the filters now', 'Order new filters']);

const le32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b };

function uuidBuf(hex) {
  const h = String(hex || '').replace(/[^0-9a-f]/gi, '');
  if (h.length !== 32) throw new Error(`uuid must be 32 hex characters (got "${hex}")`);
  return Buffer.from(h, 'hex');
}

// UDP discovery — unicast to one host, or broadcast. → [{ host, uuid, version, type }]
function discover({ host = '255.255.255.255', timeout = 2500 } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    const done = () => { try { sock.close() } catch {} resolve([...found.values()]) };
    sock.on('error', done);
    sock.on('message', (m, rinfo) => {
      try {
        const d = pbDecode(m);
        if (!Buffer.isBuffer(d[2])) return;
        const r = pbDecode(d[2]);
        const uuid = Buffer.isBuffer(r[2]) ? r[2].toString('hex') : null;
        if (!uuid) return;
        found.set(uuid, { host: r[1] ? r[1].toString() : rinfo.address, uuid, version: r[3] ?? null, type: ['lanc', 'season', 'pro'][r[4] || 0] || 'lanc' });
        if (host !== '255.255.255.255') { clearTimeout(t); done() }
      } catch {}
    });
    const [h, p] = String(host).split(':');
    sock.bind(() => {
      try { sock.setBroadcast(true) } catch {}
      sock.send(Buffer.from([0x0a, 0x00]), Number(p) || PORT, h);
    });
    const t = setTimeout(done, timeout);
  });
}

class LanC extends EventEmitter {
  // opts: { host, port, uuid (gateway, optional), localUuid, pin, name, sensorDelay ms, keepalive ms, takeoverBackoff ms }
  constructor(opts) {
    super();
    this.o = { port: PORT, pin: 0, name: 'LSH', sensorDelay: 3000, keepalive: 30000, reconnect: 5000, takeoverBackoff: 300000, statePoll: 60000, ...opts };
    this.local = uuidBuf(this.o.localUuid);
    this.node = 1;
    this.connected = false;
    this.info = {};
    this.paths = ['speed', 'auto', 'boost', 'away', 'profile', 'bypassMode', 'resetErrors', 'error', 'errors', 'filterAlarm', ...Object.values(SENSORS).map((s) => s[0]).filter((p) => p !== 'mode')];
  }

  async start() {
    this._stopped = false;
    this._fatal = false;
    try {
      await this._connect();
    } catch (err) {
      if (err.fatal) this._fatal = true;
      else if (!this.sock) this._scheduleRetry(this.o.reconnect); // nothing to 'close' → retry from here
      throw err;
    }
  }

  _scheduleRetry(wait) {
    if (this._stopped || this._fatal) return;
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._connect().catch((err) => {
      this.emit('debug', err.message);
      if (err.fatal) this._fatal = true;
      else if (!this.sock) this._scheduleRetry(this.o.reconnect);
    }), wait);
    this._retry.unref?.();
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._retry); clearInterval(this._ka); clearInterval(this._poll);
    if (this.sock) { try { this.sock.write(this._frame(OP.CloseSessionRequest)) } catch {} this.sock.destroy() }
    this.sock = null;
  }

  async _connect() {
    if (!this.o.uuid) {
      const [g] = await discover({ host: `${this.o.host}:${this.o.port}`, timeout: 3000 });
      if (!g) { this.sock = null; throw new Error(`No ComfoConnect gateway answered at ${this.o.host} (UDP ${this.o.port})`) }
      this.o.uuid = g.uuid;
      this.info.gateway = g;
    }
    this.remote = uuidBuf(this.o.uuid);
    this.ref = 0;
    this.pending = new Map();
    this.buf = Buffer.alloc(0);
    await new Promise((resolve, reject) => {
      const s = net.connect({ host: this.o.host, port: this.o.port });
      s.setTimeout(10000, () => s.destroy(new Error(`Timeout connecting to ${this.o.host}:${this.o.port}`)));
      s.once('connect', () => { s.setTimeout(0); resolve() });
      s.on('error', (e) => { reject(e); this.emit('debug', e.message) }); // later errors end in 'close'
      s.on('data', (d) => this._onData(d));
      s.on('close', () => this._onClose());
      this.sock = s;
    });
    try {
      await this._startSession();
      this._send(OP.CnNodeRequest, Buffer.alloc(0), false);
      this._subscribedAt = Date.now();
      for (const [pdid, [, type]] of Object.entries(SENSORS)) {
        await this._send(OP.CnRpdoRequest, pbEncode([[1, 'v', +pdid], [2, 'v', 1], [3, 'v', type]]));
      }
      const v = await this._send(OP.VersionRequest).catch(() => null);
      if (v) this.info.version = { gateway: v[1], serial: v[2] ? String(v[2]) : null, comfoNet: v[3] };
      this.connected = true;
      this.emit('state', true);
      this._ka = setInterval(() => this._send(OP.CnTimeRequest).catch(() => {}), this.o.keepalive);
      this._poll = setInterval(() => this.refreshState().catch(() => {}), this.o.statePoll);
      await this.refreshState().catch(() => {});
    } catch (err) {
      if (err.fatal) this._fatal = true;
      this.sock?.destroy();
      throw err;
    }
  }

  async _startSession() {
    try {
      await this._send(OP.StartSessionRequest, pbEncode([[1, 'v', true]]));
    } catch (err) {
      if (err.result !== 'NOT_ALLOWED') throw err;
      // not registered yet: register with the PIN, then try again
      try {
        await this._send(OP.RegisterAppRequest, pbEncode([[1, 'b', this.local], [2, 'v', Number(this.o.pin) || 0], [3, 'b', this.o.name]]));
      } catch (e) {
        if (e.result === 'NOT_ALLOWED') throw Object.assign(new Error('The gateway refused the PIN — check it (default 0000; set in the ComfoControl app)'), { fatal: true });
        throw e;
      }
      await this._send(OP.StartSessionRequest, pbEncode([[1, 'v', true]]));
    }
  }

  _frame(type, msg = Buffer.alloc(0), ref) {
    return frame(this.local, this.remote, pbEncode([[1, 'v', type], [4, 'v', ref]]), msg);
  }

  _send(type, msg = Buffer.alloc(0), reply = true, timeout = 8000) {
    if (!this.sock || this.sock.destroyed) return Promise.reject(new Error('Not connected'));
    const ref = ++this.ref;
    this.sock.write(this._frame(type, msg, ref));
    if (!reply) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(ref); reject(new Error('No answer from the ComfoConnect gateway')) }, timeout);
      this.pending.set(ref, { resolve, reject, t });
    });
  }

  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > 1e6) { this.sock.destroy(new Error('Bad frame')); return }
      if (this.buf.length < 4 + len) break;
      const body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      try { this._onMessage(unframe(body)) } catch (err) { this.emit('debug', `bad message: ${err.message}`) }
    }
  }

  _onMessage({ op, msg }) {
    const type = op[1] || 0, result = RESULT[op[2] || 0] || `RESULT_${op[2]}`, ref = op[4];
    if (type === OP.CnRpdoNotification) return this._onPdo(pbDecode(msg));
    if (type === OP.CnNodeNotification) {
      const n = pbDecode(msg);
      if ((n[2] === 1 || n[2] === 8) && n[4] !== 1) this.node = n[1] || 1; // ComfoAir Q / Flex, not offline
      return;
    }
    if (type === OP.CnAlarmNotification) return this._onAlarm(pbDecode(msg));
    if (type === OP.CloseSessionRequest) {
      this.emit('debug', 'gateway closed the session (another app took over)');
      this._takenOver = true;
      this.sock?.destroy();
      return;
    }
    const p = ref && this.pending.get(ref);
    if (!p) return;
    this.pending.delete(ref); clearTimeout(p.t);
    if (result !== 'OK') {
      const desc = op[3] ? String(op[3]) : '';
      p.reject(Object.assign(new Error(`Gateway: ${result}${desc ? ` (${desc})` : ''}`), { result }));
    } else p.resolve(pbDecode(msg));
  }

  _onPdo(n) {
    const def = SENSORS[n[1]];
    if (!def || !Buffer.isBuffer(n[2])) return;
    // the gateway sends junk right after subscribing — skip the first moments
    if (Date.now() - this._subscribedAt < this.o.sensorDelay) return;
    const [path, type, scale] = def, b = n[2];
    let v;
    if (type === T.U8 || type === T.BOOL) v = b.readUInt8(0);
    else if (type === T.I8) v = b.readInt8(0);
    else if (type === T.U16) v = b.length >= 2 ? b.readUInt16LE(0) : b[0];
    else if (type === T.I16) v = b.length >= 2 ? b.readInt16LE(0) : b.readInt8(0);
    else v = b.length >= 4 ? b.readUInt32LE(0) : b.readUIntLE(0, b.length);
    if (scale) v = Math.round(v * scale * 10) / 10;
    if (path === 'mode') return this.emit('data', { auto: v === 255 });
    this.emit('data', { [path]: v });
  }

  _onAlarm(a) {
    const bits = [];
    const errs = Buffer.isBuffer(a[6]) ? a[6] : Buffer.alloc(0);
    for (let i = 0; i < errs.length * 8; i++) if (errs[i >> 3] & (1 << (i & 7))) bits.push(i);
    const table = { ...ERRORS, ...((a[5] || 0) <= 3222278144 ? ERRORS_140 : ERRORS_NEW) };
    const texts = bits.map((b) => table[b] || `Error ${b}`);
    this.emit('data', { error: texts.some((t) => !FILTER_ERRORS.has(t)), errors: texts.join('; ') || 'OK', filterAlarm: texts.some((t) => FILTER_ERRORS.has(t)) });
  }

  _onClose() {
    const was = this.connected;
    this.connected = false;
    clearInterval(this._ka); clearInterval(this._poll);
    for (const p of this.pending?.values() || []) { clearTimeout(p.t); p.reject(new Error('Connection closed')) }
    this.pending?.clear();
    if (was) this.emit('state', false);
    this.sock = null;
    const wait = this._takenOver ? this.o.takeoverBackoff : this.o.reconnect;
    this._takenOver = false;
    this._scheduleRetry(wait);
  }

  rmi(bytes) {
    return this._send(OP.CnRmiRequest, pbEncode([[1, 'v', this.node], [2, 'b', Buffer.from(bytes)]])).then((r) => {
      if (r[1]) throw new Error(`Unit refused the command (RMI ${r[1]})`);
      return Buffer.isBuffer(r[2]) ? r[2] : Buffer.alloc(0);
    });
  }

  // Override states the unit doesn't stream as PDOs
  async refreshState() {
    const out = {};
    const boost = await this.rmi([0x83, 0x15, 0x01, 0x06]).catch(() => null);
    if (boost?.length) out.boost = boost[0] === 1;
    const away = await this.rmi([0x83, 0x15, 0x01, 0x0b]).catch(() => null);
    if (away?.length) out.away = away[0] === 1;
    const bp = await this.rmi([0x83, 0x15, 0x02, 0x01]).catch(() => null);
    if (bp?.length) out.bypassMode = bp[bp.length - 1];
    if (Object.keys(out).length) this.emit('data', out);
  }

  // path ← value. Timed overrides (boost / away) last `seconds`.
  async set(path, value, { seconds = 3600 } = {}) {
    const v = Number(value);
    const timed = (sub, prop, arg, t) => [0x84, 0x15, sub, prop, 0, 0, 0, 0, ...le32(t), arg];
    switch (path) {
      case 'speed':
        if (!(v >= 0 && v <= 3)) throw new Error('speed is 0 (away) – 3 (high)');
        await this.rmi([0x84, 0x15, 0x01, 0x01, 0, 0, 0, 0, 1, 0, 0, 0, Math.round(v)]);
        return { speed: Math.round(v) };
      case 'auto':
        if (value === true || v === 1) { await this.rmi([0x85, 0x15, 0x08, 0x01]); await this.rmi([0x85, 0x15, 0x01, 0x01]) }
        else await this.rmi([0x84, 0x15, 0x08, 0x01, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
        return { auto: value === true || v === 1 };
      case 'boost':
        if (value === true || v === 1) await this.rmi(timed(0x01, 0x06, 0x03, seconds));
        else await this.rmi([0x85, 0x15, 0x01, 0x06]);
        return { boost: value === true || v === 1 };
      case 'away':
        if (value === true || v === 1) await this.rmi(timed(0x01, 0x0b, 0x00, seconds));
        else await this.rmi([0x85, 0x15, 0x01, 0x0b]);
        return { away: value === true || v === 1 };
      case 'bypassMode': // 0 auto, 1 open, 2 closed
        if (v === 0) await this.rmi([0x85, 0x15, 0x02, 0x01]);
        else if (v === 1 || v === 2) await this.rmi(timed(0x02, 0x01, v, -1));
        else throw new Error('bypass mode is 0 auto, 1 open, 2 closed');
        return { bypassMode: v };
      case 'profile': // 0 normal, 1 cool, 2 warm
        if (![0, 1, 2].includes(v)) throw new Error('profile is 0 normal, 1 cool, 2 warm');
        await this.rmi(timed(0x03, 0x01, v, -1));
        return { profile: v };
      case 'resetErrors':
        await this.rmi([0x82, 0x03, 0x01]);
        return {};
      default:
        throw new Error(`${path} can't be set on ComfoConnect LAN C`);
    }
  }
}

LanC.discover = discover;
LanC.newLocalUuid = () => crypto.randomBytes(16).toString('hex');
LanC._internal = { pbEncode, pbDecode, frame, unframe, OP, RESULT, SENSORS, T, PORT };
module.exports = LanC;
