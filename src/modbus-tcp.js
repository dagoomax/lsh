'use strict';

// Minimal Modbus TCP client for integrations that talk to one device over
// Modbus TCP (Anker SOLIX, Zehnder ComfoConnect Pro): one socket, one
// request at a time (queued), reconnects on demand. No npm dependency.
//
// A Modbus exception answer rejects with an Error whose `code` is the
// exception number (a number); socket / timeout errors carry no numeric code
// — test with `typeof err.code === 'number'`.

const net = require('net');

class ModbusTcp {
  constructor({ host, port = 502, unitId = 1, timeout = 5000 }) {
    Object.assign(this, { host, port: Number(port) || 502, unitId, timeout });
    this.sock = null;
    this.tid = 0;
    this.queue = Promise.resolve();
    this.buf = Buffer.alloc(0);
    this.pending = null;
  }

  _connect() {
    if (this.sock && !this.sock.destroyed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: this.host, port: this.port });
      s.setTimeout(this.timeout, () => s.destroy(new Error(`Timeout connecting to ${this.host}:${this.port}`)));
      s.once('connect', () => { s.setTimeout(0); resolve() });
      s.on('error', (e) => { reject(e); if (this.sock === s) this._fail(e) });
      s.on('close', () => { if (this.sock === s) { this.sock = null; this._fail(new Error('Connection closed')) } });
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
      if (pdu[0] & 0x80) {
        const e = new Error(`Modbus exception ${pdu[1]} (function ${pdu[0] & 0x7f})`);
        e.code = pdu[1];
        p.reject(e);
      } else p.resolve(pdu);
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
        const t = setTimeout(() => { this.pending = null; reject(new Error(`No Modbus answer from ${this.host}`)); this.close() }, this.timeout);
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
    return Array.from({ length: Math.min(count, r[1] >> 1) }, (_, i) => r.readUInt16BE(2 + i * 2));
  }

  writeCoil(addr, on) {
    const q = Buffer.alloc(5); q[0] = 5; q.writeUInt16BE(addr, 1); q.writeUInt16BE(on ? 0xff00 : 0, 3);
    return this.request(q);
  }

  writeReg(addr, value) {
    const q = Buffer.alloc(5); q[0] = 6; q.writeUInt16BE(addr, 1); q.writeUInt16BE(value & 0xffff, 3);
    return this.request(q);
  }

  writeRegs(addr, values) {
    const q = Buffer.alloc(6 + values.length * 2);
    q[0] = 16; q.writeUInt16BE(addr, 1); q.writeUInt16BE(values.length, 3); q[5] = values.length * 2;
    values.forEach((v, i) => q.writeUInt16BE(v & 0xffff, 6 + i * 2));
    return this.request(q);
  }

  close() { const s = this.sock; this.sock = null; s?.destroy(); this._fail(new Error('Connection closed')) }
}

module.exports = ModbusTcp;
