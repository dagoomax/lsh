'use strict';

// Zehnder ComfoAir 350 / 550 (also StorkAir WHR930, Wernig G90-380, Paul
// Santos 370 DC) over the unit's RS232 port, 9600 8N1. Protocol from the
// reverse-engineered "Protokollbeschreibung Zehnder ComfoAir" (see-solutions.de):
//
//   frame  07 F0 | cmd (2) | n | data (n, 0x07 doubled) | checksum | 07 0F
//   ack    07 F3            checksum = (cmd + n + data + 173) & 0xFF
//   the answer to command X is X + 1; every frame is acknowledged
//
// Reached through a serial-to-TCP bridge (ser2net, USR-TCP232, ESP-Link… —
// `host` + `port`) or a local serial port (`serialPort`, needs the
// `serialport` npm package that other LSH modules already install).

const net          = require('net');
const EventEmitter = require('events');

const START = [0x07, 0xf0], END = [0x07, 0x0f], ACK = Buffer.from([0x07, 0xf3]);

function checksum(cmd, data) {
  let s = (cmd >> 8) + (cmd & 0xff) + data.length + 173;
  for (const b of data) s += b;
  return s & 0xff;
}

function encode(cmd, data = []) {
  const body = [];
  for (const b of data) { body.push(b); if (b === 0x07) body.push(0x07) }
  return Buffer.from([...START, cmd >> 8, cmd & 0xff, data.length, ...body, checksum(cmd, data), ...END]);
}

// Pull frames / acks out of a byte stream → { items: [{ack} | {cmd, data, ok}], rest }
function parse(buf) {
  const items = [];
  let i = 0;
  for (;;) {
    while (i < buf.length && buf[i] !== 0x07) i++;
    if (i + 1 >= buf.length) break;
    const t = buf[i + 1];
    if (t === 0xf3) { items.push({ ack: true }); i += 2; continue }
    if (t !== 0xf0) { i++; continue }
    // header: cmd (2) + n
    let j = i + 2;
    if (j + 3 > buf.length) break;
    const cmd = (buf[j] << 8) | buf[j + 1], n = buf[j + 2];
    j += 3;
    const data = [];
    while (data.length < n && j < buf.length) {
      if (buf[j] === 0x07) { if (j + 1 >= buf.length) break; if (buf[j + 1] === 0x07) { data.push(0x07); j += 2; continue } }
      data.push(buf[j++]);
    }
    if (data.length < n || j + 3 > buf.length) break; // incomplete
    const sum = buf[j];
    if (buf[j + 1] !== 0x07 || buf[j + 2] !== 0x0f) { i += 2; continue } // garbage — resync
    items.push({ cmd, data: Buffer.from(data), ok: sum === checksum(cmd, data) });
    i = j + 3;
  }
  return { items, rest: buf.subarray(i) };
}

const temp = (b) => b / 2 - 20;

class CA350 extends EventEmitter {
  // opts: { host, port, serialPort, baudRate = 9600, pollSeconds = 30, rs232Mode: null | 'log' | 'master' }
  constructor(opts) {
    super();
    this.o = { baudRate: 9600, pollSeconds: 30, timeout: 2500, ...opts };
    this.connected = false;
    this.info = {};
    this.buf = Buffer.alloc(0);
    this.queue = Promise.resolve();
    this.waiters = [];
    this.paths = ['speed', 'away', 'targetTemp', 'error', 'errors', 'filterAlarm', 'resetErrors', 'resetFilter',
      'outdoorTemp', 'supplyTemp', 'extractTemp', 'exhaustTemp', 'supplyFanDuty', 'exhaustFanDuty', 'supplyFanRpm', 'exhaustFanRpm', 'bypass'];
  }

  async _open() {
    if (this.port && !this.port.destroyed && this.port.writable !== false) return;
    if (this.o.serialPort) {
      let SerialPort;
      try { ({ SerialPort } = require(['serial', 'port'].join(''))) } catch { throw new Error('Serial port access needs the "serialport" npm package — install it (npm i serialport) or use a serial-to-TCP bridge') }
      await new Promise((resolve, reject) => {
        const p = new SerialPort({ path: this.o.serialPort, baudRate: this.o.baudRate }, (err) => (err ? reject(err) : resolve()));
        p.on('data', (d) => this._onData(d));
        p.on('close', () => { this.port = null });
        p.on('error', (e) => this.emit('debug', e.message));
        this.port = p;
      });
    } else {
      await new Promise((resolve, reject) => {
        const s = net.connect({ host: this.o.host, port: Number(this.o.port) });
        s.setTimeout(8000, () => s.destroy(new Error(`Timeout connecting to ${this.o.host}:${this.o.port}`)));
        s.once('connect', () => { s.setTimeout(0); resolve() });
        s.on('error', (e) => { reject(e); this.emit('debug', e.message) });
        s.on('close', () => { if (this.port === s) this.port = null });
        s.on('data', (d) => this._onData(d));
        this.port = s;
      });
    }
    this.buf = Buffer.alloc(0);
    // already inside a queued _exchange — send directly, going through the queue would wait on itself
    if (this.o.rs232Mode) await this._send(0x9b, [this.o.rs232Mode === 'master' ? 0x03 : 0x04], true).catch(() => {});
  }

  _onData(d) {
    const { items, rest } = parse(Buffer.concat([this.buf, d]));
    this.buf = rest.length > 4096 ? Buffer.alloc(0) : rest;
    for (const it of items) {
      if (!it.ack) { try { this.port.write(ACK) } catch {} }
      if (!it.ack && !it.ok) continue;
      const w = this.waiters.find((x) => (it.ack ? x.wantAck : x.reply === it.cmd));
      if (w) { this.waiters.splice(this.waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(it) }
    }
  }

  // send cmd on the open port; wait for its answer (cmd + 1), or only the ack for set commands
  _send(cmd, data = [], ackOnly = false) {
    return new Promise((resolve, reject) => {
      const w = { reply: cmd + 1, wantAck: ackOnly, resolve, reject };
      w.t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error(`No answer from the ComfoAir to command 0x${cmd.toString(16).padStart(4, '0')}`)) }, this.o.timeout);
      this.waiters.push(w);
      this.port.write(encode(cmd, data));
    });
  }

  // one exchange at a time, opening the port first
  _exchange(cmd, data = [], ackOnly = false) {
    const run = async () => {
      await this._open();
      return this._send(cmd, data, ackOnly);
    };
    const r = this.queue.then(run, run);
    this.queue = r.catch(() => {});
    return r;
  }

  async start() {
    this._stopped = false;
    try { await this.poll() } finally {
      clearInterval(this._t);
      this._t = setInterval(() => this.poll().catch(() => {}), this.o.pollSeconds * 1000);
      this._t.unref?.();
    }
  }

  stop() { this._stopped = true; clearInterval(this._t); try { this.port?.destroy ? this.port.destroy() : this.port?.close() } catch {} this.port = null }

  async poll() {
    const out = {};
    try {
      const lv = (await this._exchange(0xcd)).data;            // ventilation levels
      if (lv.length >= 9) {
        out.exhaustFanDuty = lv[6]; out.supplyFanDuty = lv[7];
        const level = lv[8];                                      // 1 away, 2 low, 3 medium, 4 high
        if (level >= 1 && level <= 4) { out.speed = level - 1; out.away = level === 1; if (level > 1) this._lastActive = level }
      }
      const t = (await this._exchange(0xd1)).data;             // temperatures
      if (t.length >= 5) {
        out.targetTemp = temp(t[0]);
        const present = t.length >= 6 ? t[5] : 0x0f;
        if (present & 1) out.outdoorTemp = temp(t[1]);
        if (present & 2) out.supplyTemp = temp(t[2]);
        if (present & 4) out.extractTemp = temp(t[3]);
        if (present & 8) out.exhaustTemp = temp(t[4]);
      }
      const f = (await this._exchange(0x0b)).data;             // fans
      if (f.length >= 6) {
        const rpm = (hi, lo) => { const r = (hi << 8) | lo; return r ? Math.round(1875000 / r) : 0 };
        out.supplyFanRpm = rpm(f[2], f[3]); out.exhaustFanRpm = rpm(f[4], f[5]);
      }
      const v = (await this._exchange(0x0d)).data;             // bypass valve
      if (v.length >= 1 && v[0] !== 0xff) out.bypass = v[0];
      const e = (await this._exchange(0xd9)).data;             // faults
      if (e.length >= 9) {
        const list = [];
        const bits = (byte, prefix, base = 1) => { for (let i = 0; i < 8; i++) if (byte & (1 << i)) list.push(`${prefix}${base + i}`) };
        bits(e[0], 'A'); bits(e[1], 'E');
        if (e.length >= 10) bits(e[9], 'EA');
        if (e.length >= 17) for (let i = 0; i < 8; i++) if (e[16] & (1 << i)) list.push(i === 7 ? 'A0' : `A${9 + i}`);
        out.error = list.length > 0;
        out.filterAlarm = e[8] === 1;
        out.errors = [...list, ...(out.filterAlarm ? ['Filter full'] : [])].join('; ') || 'OK';
      }
      if (!this.connected) { this.connected = true; this.emit('state', true) }
      this.emit('data', out);
      return out;
    } catch (err) {
      if (Object.keys(out).length) this.emit('data', out);
      if (this.connected) { this.connected = false; this.emit('state', false) }
      throw err;
    }
  }

  async set(path, value) {
    const v = Number(value), on = value === true || v === 1;
    switch (path) {
      case 'speed':
        if (!(v >= 0 && v <= 3)) throw new Error('speed is 0 (away) – 3 (high)');
        await this._exchange(0x99, [Math.round(v) + 1], true); break;
      case 'away':
        await this._exchange(0x99, [on ? 1 : (this._lastActive || 2)], true); break;
      case 'targetTemp':
        if (!(v >= 12 && v <= 28)) throw new Error('comfort temperature is 12–28 °C');
        await this._exchange(0xd3, [Math.round((v + 20) * 2)], true); break;
      case 'resetErrors': await this._exchange(0xdb, [1, 0, 0, 0], true); break;
      case 'resetFilter': await this._exchange(0xdb, [0, 0, 0, 1], true); break;
      default: throw new Error(`${path} can't be set on a ComfoAir 350`);
    }
    return this.poll().catch(() => ({}));
  }
}

CA350._internal = { encode, parse, checksum };
module.exports = CA350;
