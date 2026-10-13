'use strict';

// Zehnder ComfoAir Q through the ComfoConnect Pro — Zehnder's official
// Modbus TCP interface (Installer manual, "ComfoAirQ exposed interface",
// TCP port 502, slave id 1). Table addresses there are 1-based; on the wire
// (PDU) they are address − 1, which is what's used below.
//
//   input regs  0 connection state (0 ok, 30 not a CAQ, 40 incompatible, 50 no unit)
//               1–5 active errors, 6 airflow m³/h, 7–11 room / extract / exhaust /
//               outdoor / supply temperature (°C×10, signed), 12–16 the same
//               humidities (%), 17–24 CO₂ zone 1–8 (ppm), 25 filter days left
//   discrete    0 error, 1 standby, 2 ComfoHood, 3 filter dirty
//   coils       0 reset errors, 1–4 preset away/1/2/3, 5 auto, 6 boost, 7 away, 8 ComfoCool
//   holding     0 preset (0–3), 1 temperature profile (0 normal, 1 cool, 2 warm),
//               2 profile mode, 3 external setpoint (°C×10), 4 boost time (s)
//
// A tiny Modbus TCP client is built in (FC 1/2/3/4/5/6) — no npm dependency.

const net          = require('net');
const EventEmitter = require('events');

class ModbusTcp {
  constructor({ host, port = 502, unitId = 1, timeout = 5000 }) {
    Object.assign(this, { host, port, unitId, timeout });
    this.tid = 0;
    this.queue = Promise.resolve();
  }

  _connect() {
    if (this.sock && !this.sock.destroyed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: this.host, port: this.port });
      s.setTimeout(this.timeout, () => s.destroy(new Error(`Timeout connecting to ${this.host}:${this.port}`)));
      s.once('connect', () => { s.setTimeout(0); resolve() });
      s.on('error', (e) => { reject(e); this._fail(e) });
      s.on('close', () => this._fail(new Error('Connection closed')));
      s.on('data', (d) => this._onData(d));
      this.buf = Buffer.alloc(0);
      this.sock = s;
    });
  }

  _fail(err) {
    const p = this.pending;
    this.pending = null;
    if (p) { clearTimeout(p.t); p.reject(err) }
  }

  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 7) {
      const len = this.buf.readUInt16BE(4);
      if (this.buf.length < 6 + len) return;
      const tid = this.buf.readUInt16BE(0), pdu = this.buf.subarray(7, 6 + len);
      this.buf = this.buf.subarray(6 + len);
      const p = this.pending;
      if (!p || p.tid !== tid) continue;
      this.pending = null; clearTimeout(p.t);
      if (pdu[0] & 0x80) p.reject(new Error(`Modbus exception ${pdu[1]} (function ${pdu[0] & 0x7f})`));
      else p.resolve(pdu);
    }
  }

  // one request at a time
  request(pdu) {
    const run = async () => {
      await this._connect();
      const tid = this.tid = (this.tid + 1) & 0xffff;
      const head = Buffer.alloc(7);
      head.writeUInt16BE(tid, 0); head.writeUInt16BE(0, 2); head.writeUInt16BE(pdu.length + 1, 4); head[6] = this.unitId;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { this.pending = null; reject(new Error(`No Modbus answer from ${this.host}`)); this.sock?.destroy() }, this.timeout);
        this.pending = { tid, resolve, reject, t };
        this.sock.write(Buffer.concat([head, pdu]));
      });
    };
    const r = this.queue.then(run, run);
    this.queue = r.catch(() => {});
    return r;
  }

  async readBits(fc, addr, count) {
    const q = Buffer.alloc(5); q[0] = fc; q.writeUInt16BE(addr, 1); q.writeUInt16BE(count, 3);
    const r = await this.request(q);
    return Array.from({ length: count }, (_, i) => !!(r[2 + (i >> 3)] & (1 << (i & 7))));
  }

  async readRegs(fc, addr, count) {
    const q = Buffer.alloc(5); q[0] = fc; q.writeUInt16BE(addr, 1); q.writeUInt16BE(count, 3);
    const r = await this.request(q);
    return Array.from({ length: count }, (_, i) => r.readUInt16BE(2 + i * 2));
  }

  writeCoil(addr, on) {
    const q = Buffer.alloc(5); q[0] = 5; q.writeUInt16BE(addr, 1); q.writeUInt16BE(on ? 0xff00 : 0, 3);
    return this.request(q);
  }

  writeReg(addr, value) {
    const q = Buffer.alloc(5); q[0] = 6; q.writeUInt16BE(addr, 1); q.writeUInt16BE(value & 0xffff, 3);
    return this.request(q);
  }

  close() { this.sock?.destroy(); this.sock = null }
}

const s16 = (v) => (v > 0x7fff ? v - 0x10000 : v);
const temp = (v) => { const t = s16(v); return t <= -2000 || t >= 2000 ? null : t / 10 };
const CONNECTION = { 0: 'OK', 30: 'Not a ComfoAir Q', 40: 'Unit version not compatible', 50: 'No ventilation unit detected' };

class Pro extends EventEmitter {
  // opts: { host, port = 502, unitId = 1, pollSeconds = 15 }
  constructor(opts) {
    super();
    this.o = { port: 502, unitId: 1, pollSeconds: 15, ...opts };
    this.mb = new ModbusTcp({ host: this.o.host, port: this.o.port, unitId: this.o.unitId });
    this.connected = false;
    this.info = {};
    this.paths = ['speed', 'auto', 'boost', 'away', 'profile', 'resetErrors', 'error', 'errors', 'filterAlarm', 'standby',
      'airflow', 'roomTemp', 'extractTemp', 'exhaustTemp', 'outdoorTemp', 'supplyTemp',
      'roomHumidity', 'extractHumidity', 'exhaustHumidity', 'outdoorHumidity', 'supplyHumidity', 'filterDays'];
  }

  async start() {
    this._stopped = false;
    try { await this.poll() } finally { this._schedule() }
  }

  _schedule() {
    clearInterval(this._t);
    this._t = setInterval(() => this.poll().catch(() => {}), this.o.pollSeconds * 1000);
    this._t.unref?.();
  }

  stop() { this._stopped = true; clearInterval(this._t); this.mb.close() }

  async poll() {
    try {
      const ir = await this.mb.readRegs(4, 0, 26);
      const di = await this.mb.readBits(2, 0, 4);
      const coils = await this.mb.readBits(1, 0, 9);
      const hr = await this.mb.readRegs(3, 0, 5);
      const hum = (v) => (v > 100 ? null : v);
      const errs = ir.slice(1, 6).filter((e) => e && e !== 0xff);
      const out = {
        connection: CONNECTION[ir[0]] || `State ${ir[0]}`,
        error: di[0] || ir[0] !== 0, errors: errs.length ? errs.map((e) => `Error ${e}`).join('; ') : (ir[0] ? CONNECTION[ir[0]] || `State ${ir[0]}` : 'OK'),
        standby: di[1], filterAlarm: di[3],
        airflow: ir[6], roomTemp: temp(ir[7]), extractTemp: temp(ir[8]), exhaustTemp: temp(ir[9]), outdoorTemp: temp(ir[10]), supplyTemp: temp(ir[11]),
        roomHumidity: hum(ir[12]), extractHumidity: hum(ir[13]), exhaustHumidity: hum(ir[14]), outdoorHumidity: hum(ir[15]), supplyHumidity: hum(ir[16]),
        filterDays: ir[25],
        auto: coils[5], boost: coils[6], away: coils[7],
        speed: hr[0] <= 3 ? hr[0] : null, profile: hr[1] <= 2 ? hr[1] : null,
      };
      // CO₂ sensors: only zones that report something
      for (let z = 1; z <= 8; z++) { const v = ir[16 + z]; if (v && v !== 0xffff) out[`co2Zone${z}`] = v }
      if (!this.connected) { this.connected = true; this.emit('state', true) }
      this.emit('data', out);
      return out;
    } catch (err) {
      if (this.connected) { this.connected = false; this.emit('state', false) }
      this.mb.close();
      throw err;
    }
  }

  async set(path, value, { seconds = 3600 } = {}) {
    const v = Number(value), on = value === true || v === 1;
    switch (path) {
      case 'speed':
        if (!(v >= 0 && v <= 3)) throw new Error('speed is 0 (away) – 3 (high)');
        await this.mb.writeReg(0, Math.round(v)); break;
      case 'auto': await this.mb.writeCoil(5, on); break;
      case 'boost':
        if (on) await this.mb.writeReg(4, Math.min(65535, Math.max(60, Math.round(seconds))));
        await this.mb.writeCoil(6, on); break;
      case 'away': await this.mb.writeCoil(7, on); break;
      case 'profile':
        if (![0, 1, 2].includes(v)) throw new Error('profile is 0 normal, 1 cool, 2 warm');
        await this.mb.writeReg(1, v); break;
      case 'resetErrors': await this.mb.writeCoil(0, true); break;
      default: throw new Error(`${path} can't be set on ComfoConnect Pro`);
    }
    return this.poll().catch(() => ({}));
  }
}

Pro.ModbusTcp = ModbusTcp;
module.exports = Pro;
