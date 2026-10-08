'use strict';

// Modbus device emulator — LSH answers Modbus queries as a server (TCP) or
// slave (RTU on RS-485), so PLCs, SCADA, Loxone, inverters or anything else
// that polls Modbus can read LSH values as registers.
//
// config.modbusEmu = { enabled, devices: [{
//   id, name, enabled = true,
//   transport: 'tcp' | 'rtu',
//   port = 1502, bindHost = '0.0.0.0',            (tcp; 502 needs root/CAP_NET_BIND_SERVICE)
//   serialPort, baud = 9600, parity = 'none',      (rtu; needs the serialport package)
//   unitId = 1,                                    (tcp: 0/255 also answered)
//   strict = false,  — true: reading an unmapped register → exception 2; false: reads as 0
//   registers: [{
//     table: 'holding' | 'input' | 'coil' | 'discrete',
//     address, type: 'u16'|'i16'|'u32'|'i32'|'f32'|'string'|'bool', length (string, registers),
//     wordOrder: 'be' | 'le' (32-bit types: high word first = 'be'),
//     source: '<store key>' | value: <constant>, scale = 1 (raw = value × scale),
//     writable = false, command: '<deviceKey>/<sensorPath>' (optional),
//     label,
//   }] }] }
//
// Writes (FC 5/6/15/16) are refused (exception 2) unless the register is
// writable. A write lands in emulator memory, is published to the store as
// modbus-emu/<id>/<table>/<address>, and — when `command` is set — is sent to
// that LSH device sensor (value ÷ scale). Reads of a written register return
// the written value until its source updates.

const net = require('net');
const fs = require('fs');
const path = require('path');
const platformStatus = require('./platform-status');

const LSH_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version } catch { return '?' } })();

const TEMPLATES = {
  generic: { label: 'Empty (generic)', registers: [] },
  sdm630: {
    label: 'Eastron SDM630 (3-phase energy meter)',
    note: 'Input registers, float32 big-endian, unit 1, 9600 8N1 on RS-485 by default.',
    registers: [
      [0, 'Voltage L1', 'V'], [2, 'Voltage L2', 'V'], [4, 'Voltage L3', 'V'],
      [6, 'Current L1', 'A'], [8, 'Current L2', 'A'], [10, 'Current L3', 'A'],
      [12, 'Power L1', 'W'], [14, 'Power L2', 'W'], [16, 'Power L3', 'W'],
      [52, 'Total system power', 'W'], [70, 'Frequency', 'Hz'],
      [72, 'Import energy', 'kWh'], [74, 'Export energy', 'kWh'], [342, 'Total energy', 'kWh'],
    ].map(([address, label, unit]) => ({ table: 'input', address, type: 'f32', label: `${label} (${unit})`, source: '', scale: 1 })),
  },
  sdm120: {
    label: 'Eastron SDM120 (1-phase energy meter)',
    note: 'Input registers, float32 big-endian, unit 1, 9600 8N1 on RS-485 by default.',
    registers: [
      [0, 'Voltage', 'V'], [6, 'Current', 'A'], [12, 'Active power', 'W'], [70, 'Frequency', 'Hz'],
      [72, 'Import energy', 'kWh'], [74, 'Export energy', 'kWh'], [342, 'Total energy', 'kWh'],
    ].map(([address, label, unit]) => ({ table: 'input', address, type: 'f32', label: `${label} (${unit})`, source: '', scale: 1 })),
  },
};

const WIDTH = { u16: 1, i16: 1, bool: 1, u32: 2, i32: 2, f32: 2 };
const widthOf = (r) => (r.type === 'string' ? Math.max(1, Math.min(64, Number(r.length) || 8)) : WIDTH[r.type] || 1);
const BIT_TABLES = new Set(['coil', 'discrete']);

function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1 }
  return crc;
}

// value → array of 16-bit words
function encode(r, value) {
  const scale = Number(r.scale) || 1;
  if (r.type === 'string') {
    const n = widthOf(r), b = Buffer.alloc(n * 2);
    b.write(String(value ?? ''), 'latin1');
    return [...Array(n)].map((_, i) => b.readUInt16BE(i * 2));
  }
  let v = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
  if (!Number.isFinite(v)) v = 0;
  v *= scale;
  const b = Buffer.alloc(4);
  switch (r.type) {
    case 'bool': return [v ? 1 : 0];
    case 'i16': return [Math.max(-32768, Math.min(32767, Math.round(v))) & 0xffff];
    case 'u16': return [Math.max(0, Math.min(65535, Math.round(v)))];
    case 'u32': b.writeUInt32BE(Math.max(0, Math.min(4294967295, Math.round(v))) >>> 0); break;
    case 'i32': b.writeInt32BE(Math.max(-2147483648, Math.min(2147483647, Math.round(v)))); break;
    case 'f32': b.writeFloatBE(v); break;
    default: return [0];
  }
  const words = [b.readUInt16BE(0), b.readUInt16BE(2)];
  return r.wordOrder === 'le' ? words.reverse() : words;
}

// words → value (for writes)
function decode(r, words) {
  const scale = Number(r.scale) || 1;
  if (r.type === 'string') return Buffer.from(words.flatMap((w) => [w >> 8, w & 0xff])).toString('latin1').replace(/\0.*$/s, '');
  if (r.type === 'bool') return !!words[0];
  if (r.type === 'u16') return words[0] / scale;
  if (r.type === 'i16') return (words[0] > 0x7fff ? words[0] - 0x10000 : words[0]) / scale;
  const w = r.wordOrder === 'le' ? [words[1], words[0]] : words;
  const b = Buffer.alloc(4); b.writeUInt16BE(w[0], 0); b.writeUInt16BE(w[1], 2);
  if (r.type === 'u32') return b.readUInt32BE(0) / scale;
  if (r.type === 'i32') return b.readInt32BE(0) / scale;
  if (r.type === 'f32') return b.readFloatBE(0) / scale;
  return null;
}

// One emulated device: register map + request handler (transport-agnostic).
class EmulatedDevice {
  constructor(cfg, { store, sensorRegistry }) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.store = store;
    this.registry = sensorRegistry;
    this.unitId = Number(cfg.unitId ?? 1);
    this.stats = { requests: 0, errors: 0, writes: 0, lastClient: null, lastRequestAt: null, clients: 0 };
    this.written = new Map(); // `${table}:${address}` → { value, at }
    // address → { reg, offset } per table
    this.maps = { holding: new Map(), input: new Map(), coil: new Map(), discrete: new Map() };
    for (const r of cfg.registers || []) {
      const t = this.maps[r.table];
      if (!t) continue;
      const n = BIT_TABLES.has(r.table) ? 1 : widthOf(r);
      for (let i = 0; i < n; i++) t.set(Number(r.address) + i, { reg: r, offset: i });
    }
  }

  valueOf(r) {
    const k = `${r.table}:${r.address}`;
    const w = this.written.get(k);
    if (r.source) {
      const ts = this.store.getTimestamp?.(r.source) ?? null;
      if (w && (ts == null || ts <= w.at)) return w.value;
      return this.store.get(r.source);
    }
    if (w) return w.value;
    return r.value ?? 0;
  }

  words(r) { return encode(r, this.valueOf(r)) }

  // Snapshot for the UI: every mapped register with its current value + words
  snapshot() {
    return (this.cfg.registers || []).map((r) => {
      const value = this.valueOf(r);
      return { table: r.table, address: Number(r.address), type: r.type, label: r.label || '', value: value ?? null, words: BIT_TABLES.has(r.table) ? [value ? 1 : 0] : encode(r, value) };
    });
  }

  answers(unit) {
    return unit === this.unitId || (this.cfg.transport !== 'rtu' && (unit === 0 || unit === 255));
  }

  readWords(table, address, count) {
    const map = this.maps[table];
    const out = [];
    for (let a = address; a < address + count; a++) {
      const m = map.get(a);
      if (!m) { if (this.cfg.strict) return null; out.push(0); continue }
      out.push(this.words(m.reg)[m.offset] ?? 0);
    }
    return out;
  }

  readBits(table, address, count) {
    const map = this.maps[table];
    const bits = [];
    for (let a = address; a < address + count; a++) {
      const m = map.get(a);
      if (!m) { if (this.cfg.strict) return null; bits.push(0); continue }
      bits.push(this.valueOf(m.reg) ? 1 : 0);
    }
    return bits;
  }

  async write(table, address, words) {
    const map = this.maps[table];
    // Every touched register must be writable and fully covered
    const regs = new Map();
    for (let i = 0; i < words.length; i++) {
      const m = map.get(address + i);
      if (!m || !m.reg.writable) return false;
      regs.set(m.reg, true);
    }
    for (const r of regs.keys()) {
      const base = Number(r.address) - address;
      const n = BIT_TABLES.has(table) ? 1 : widthOf(r);
      if (base < 0 || base + n > words.length) return false;
    }
    for (const r of regs.keys()) {
      const base = Number(r.address) - address;
      const n = BIT_TABLES.has(table) ? 1 : widthOf(r);
      const value = BIT_TABLES.has(table) ? !!words[base] : decode(r, words.slice(base, base + n));
      this.written.set(`${table}:${r.address}`, { value, at: Date.now() });
      this.store.update(`modbus-emu/${this.id}/${table}/${r.address}`, value);
      this.stats.writes++;
      if (r.command) {
        const i = r.command.lastIndexOf('/');
        const deviceKey = r.command.slice(0, i), sensor = r.command.slice(i + 1);
        this.registry?.sendCommand(deviceKey, sensor, value).catch((e) => console.warn(`[ModbusEmu] ${this.cfg.name}: write → ${r.command} failed: ${e.message}`));
      }
    }
    return true;
  }

  // PDU in → PDU out (or null = no reply)
  async handle(unit, pdu, client) {
    if (!this.answers(unit) || !pdu.length) return null;
    this.stats.requests++;
    this.stats.lastClient = client; this.stats.lastRequestAt = Date.now();
    const fc = pdu[0];
    const exc = (code) => { this.stats.errors++; return Buffer.from([fc | 0x80, code]) };
    const addr = pdu.length >= 3 ? pdu.readUInt16BE(1) : 0;
    try {
      switch (fc) {
        case 1: case 2: {
          const count = pdu.readUInt16BE(3);
          if (count < 1 || count > 2000) return exc(3);
          const bits = this.readBits(fc === 1 ? 'coil' : 'discrete', addr, count);
          if (!bits) return exc(2);
          const out = Buffer.alloc(2 + Math.ceil(count / 8));
          out[0] = fc; out[1] = Math.ceil(count / 8);
          bits.forEach((b, i) => { if (b) out[2 + (i >> 3)] |= 1 << (i & 7) });
          return out;
        }
        case 3: case 4: {
          const count = pdu.readUInt16BE(3);
          if (count < 1 || count > 125) return exc(3);
          const words = this.readWords(fc === 3 ? 'holding' : 'input', addr, count);
          if (!words) return exc(2);
          const out = Buffer.alloc(2 + count * 2);
          out[0] = fc; out[1] = count * 2;
          words.forEach((w, i) => out.writeUInt16BE(w & 0xffff, 2 + i * 2));
          return out;
        }
        case 5: { // write single coil
          const v = pdu.readUInt16BE(3);
          if (v !== 0 && v !== 0xff00) return exc(3);
          return (await this.write('coil', addr, [v ? 1 : 0])) ? Buffer.from(pdu.subarray(0, 5)) : exc(2);
        }
        case 6: // write single register
          return (await this.write('holding', addr, [pdu.readUInt16BE(3)])) ? Buffer.from(pdu.subarray(0, 5)) : exc(2);
        case 15: { // write multiple coils
          const count = pdu.readUInt16BE(3);
          const bits = [...Array(count)].map((_, i) => (pdu[6 + (i >> 3)] >> (i & 7)) & 1);
          return (await this.write('coil', addr, bits)) ? Buffer.from(pdu.subarray(0, 5)) : exc(2);
        }
        case 16: { // write multiple registers
          const count = pdu.readUInt16BE(3);
          if (count < 1 || count > 123 || pdu[5] !== count * 2) return exc(3);
          const words = [...Array(count)].map((_, i) => pdu.readUInt16BE(6 + i * 2));
          return (await this.write('holding', addr, words)) ? Buffer.from(pdu.subarray(0, 5)) : exc(2);
        }
        case 0x2b: { // device identification (basic)
          if (pdu[1] !== 0x0e) return exc(1);
          const objs = [['LSH'], [this.cfg.name || 'LSH Modbus device'], [LSH_VERSION]];
          const parts = objs.flatMap(([s], id) => [Buffer.from([id, Buffer.byteLength(s, 'latin1')]), Buffer.from(s, 'latin1')]);
          return Buffer.concat([Buffer.from([0x2b, 0x0e, pdu[2] || 1, 0x01, 0x00, 0x00, objs.length]), ...parts]);
        }
        default: return exc(1);
      }
    } catch { return exc(3) }
  }
}

// ── Transports ─────────────────────────────────────────────────────────────

function startTcp(dev) {
  const port = Number(dev.cfg.port ?? 1502);
  const server = net.createServer((sock) => {
    const client = `${sock.remoteAddress}:${sock.remotePort}`;
    dev.stats.clients++;
    let buf = Buffer.alloc(0);
    let chain = Promise.resolve();
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (len < 2 || len > 260) { sock.destroy(); return }
        if (buf.length < 6 + len) break;
        const frame = Buffer.from(buf.subarray(0, 6 + len)); buf = buf.subarray(6 + len);
        if (frame.readUInt16BE(2) !== 0) continue; // not Modbus protocol id
        chain = chain.then(async () => {
          const resp = await dev.handle(frame[6], frame.subarray(7), client);
          if (!resp || sock.destroyed) return;
          const mbap = Buffer.alloc(7);
          frame.copy(mbap, 0, 0, 4); mbap.writeUInt16BE(resp.length + 1, 4); mbap[6] = frame[6];
          sock.write(Buffer.concat([mbap, resp]));
        });
      }
    });
    sock.on('close', () => { dev.stats.clients-- });
    sock.on('error', () => {});
    sock.setTimeout(10 * 60 * 1000, () => sock.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, dev.cfg.bindHost || '0.0.0.0', () => {
      server.removeListener('error', reject);
      server.on('error', (e) => console.error(`[ModbusEmu] ${dev.cfg.name}: ${e.message}`));
      resolve({ close: () => new Promise((r) => server.close(() => r())), endpoint: `tcp://${dev.cfg.bindHost || '0.0.0.0'}:${server.address().port}`, port: server.address().port });
    });
  });
}

async function startRtu(dev) {
  let SerialPortMod;
  try { SerialPortMod = require('serialport') } catch { throw new Error('serialport package not installed — install the modbus-emulator module from Settings → Integration Modules') }
  const SerialPort = SerialPortMod.SerialPort || SerialPortMod;
  const baud = Number(dev.cfg.baud) || 9600, parity = dev.cfg.parity || 'none';
  const port = new SerialPort({ path: dev.cfg.serialPort, baudRate: baud, parity, dataBits: 8, stopBits: parity === 'none' ? 2 : 1, autoOpen: false });
  await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
  const gap = Math.max(2, Math.ceil((3.5 * 11 * 1000) / baud)); // t3.5
  let buf = Buffer.alloc(0), timer = null;
  const onFrame = async (f) => {
    if (f.length < 4 || crc16(f.subarray(0, f.length - 2)) !== f.readUInt16LE(f.length - 2)) return; // noise / other baud
    const unit = f[0];
    const resp = await dev.handle(unit, f.subarray(1, f.length - 2), dev.cfg.serialPort);
    if (!resp || unit === 0) return; // broadcast: act, never answer
    const adu = Buffer.concat([Buffer.from([unit]), resp, Buffer.alloc(2)]);
    adu.writeUInt16LE(crc16(adu.subarray(0, adu.length - 2)), adu.length - 2);
    setTimeout(() => port.write(adu), gap);
  };
  port.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    clearTimeout(timer);
    timer = setTimeout(() => { const f = buf; buf = Buffer.alloc(0); onFrame(f) }, gap);
  });
  port.on('error', (e) => console.error(`[ModbusEmu] ${dev.cfg.name}: ${e.message}`));
  return { close: () => new Promise((r) => port.close(() => r())), endpoint: `rtu://${dev.cfg.serialPort}@${baud}/${parity}` };
}

// ── Client (LSH integration) ───────────────────────────────────────────────

class ModbusEmulatorClient {
  constructor(config, store, sensorRegistry) {
    this.config = config;
    this.store = store;
    this.registry = sensorRegistry;
    this.running = []; // { dev, transport, error }
  }

  async start() {
    await this.reload(this.config.modbusEmu || {});
  }

  async reload(cfg) {
    await this.stop();
    this.config.modbusEmu = cfg;
    if (!cfg.enabled) { platformStatus.set('modbusEmu', false); return }
    for (const d of cfg.devices || []) {
      if (d.enabled === false) continue;
      const dev = new EmulatedDevice(d, { store: this.store, sensorRegistry: this.registry });
      const entry = { dev, transport: null, error: null };
      try {
        entry.transport = d.transport === 'rtu' ? await startRtu(dev) : await startTcp(dev);
        console.log(`[ModbusEmu] ${d.name || d.id}: unit ${dev.unitId}, ${(d.registers || []).length} register(s) on ${entry.transport.endpoint}`);
      } catch (e) {
        entry.error = e.code === 'EACCES' ? `Port ${d.port} needs root — use a port above 1024 (e.g. 1502)` : e.code === 'EADDRINUSE' ? `Port ${d.port} is already in use` : e.message;
        console.error(`[ModbusEmu] ${d.name || d.id}: ${entry.error}`);
      }
      this.running.push(entry);
    }
    platformStatus.set('modbusEmu', this.running.some((r) => r.transport));
  }

  async stop() {
    for (const r of this.running) await r.transport?.close().catch(() => {});
    this.running = [];
  }

  getStatus() {
    return this.running.map(({ dev, transport, error }) => ({
      id: dev.id, name: dev.cfg.name, unitId: dev.unitId, endpoint: transport?.endpoint || null, error,
      stats: dev.stats, registers: dev.snapshot(),
    }));
  }
}

module.exports = ModbusEmulatorClient;
module.exports.EmulatedDevice = EmulatedDevice;
module.exports.TEMPLATES = TEMPLATES;
module.exports.encode = encode;
module.exports.decode = decode;
