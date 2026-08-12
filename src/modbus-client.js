'use strict';

const net            = require('net');
const platformStatus = require('./platform-status');

// Generic Modbus TCP / RTU client — reads and writes coils, discrete inputs,
// holding registers and input registers, and maps them to dashboard sensors.
// Same idea as the `can` module (arbitrary signal→sensor mapping) rather than
// a fixed-device client like src/waveshare-modbus-client.js.
//
// Two transports:
//   "tcp" — raw Modbus TCP (MBAP + PDU) over a plain socket, one connection
//           per configured device. No dependency, hand-rolled framing.
//   "rtu" — Modbus RTU (address + PDU + CRC16) over a serial port. Needs
//           `npm install serialport`, lazy-loaded like the CAN module's
//           slcan transport. Devices sharing the same `serialPort` share one
//           underlying connection and request queue (RS-485 multi-drop is
//           the normal case — the bus can only have one request in flight
//           at a time regardless of how many unit IDs live on it).
//
// Requests are issued one register at a time rather than coalescing
// contiguous ranges into a single multi-register read — simpler and robust
// at home-automation polling rates (a handful of seconds), at the cost of
// being chattier than an industrial batching implementation would be.

const FC = {
  READ_COILS:               0x01,
  READ_DISCRETE:             0x02,
  READ_HOLDING:              0x03,
  READ_INPUT:                0x04,
  WRITE_SINGLE_COIL:         0x05,
  WRITE_SINGLE_REGISTER:     0x06,
  WRITE_MULTIPLE_REGISTERS: 0x10,
};

const WORDS_PER_TYPE = { uint16: 1, int16: 1, uint32: 2, int32: 2, float32: 2 };

// ── PDU builders ─────────────────────────────────────────────────────────

function pduReadBits(fc, addr, count) {
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(fc, 0);
  pdu.writeUInt16BE(addr, 1);
  pdu.writeUInt16BE(count, 3);
  return pdu;
}
const pduReadCoils    = (addr, count) => pduReadBits(FC.READ_COILS, addr, count);
const pduReadDiscrete = (addr, count) => pduReadBits(FC.READ_DISCRETE, addr, count);

function pduReadRegisters(fc, addr, count) {
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(fc, 0);
  pdu.writeUInt16BE(addr, 1);
  pdu.writeUInt16BE(count, 3);
  return pdu;
}
const pduReadHolding = (addr, count) => pduReadRegisters(FC.READ_HOLDING, addr, count);
const pduReadInput   = (addr, count) => pduReadRegisters(FC.READ_INPUT, addr, count);

function pduWriteSingleCoil(addr, on) {
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FC.WRITE_SINGLE_COIL, 0);
  pdu.writeUInt16BE(addr, 1);
  pdu.writeUInt16BE(on ? 0xFF00 : 0x0000, 3);
  return pdu;
}

function pduWriteRegisters(addr, words) {
  if (words.length === 1) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(FC.WRITE_SINGLE_REGISTER, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(words[0], 3);
    return pdu;
  }
  const pdu = Buffer.alloc(6 + words.length * 2);
  pdu.writeUInt8(FC.WRITE_MULTIPLE_REGISTERS, 0);
  pdu.writeUInt16BE(addr, 1);
  pdu.writeUInt16BE(words.length, 3);
  pdu.writeUInt8(words.length * 2, 5);
  words.forEach((w, i) => pdu.writeUInt16BE(w, 6 + i * 2));
  return pdu;
}

// ── Response parsing ────────────────────────────────────────────────────

function decodeBits(pdu, count) {
  // pdu[0]=fc, pdu[1]=byte count, pdu[2..]=bit-packed data
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(!!(pdu[2 + (i >> 3)] & (1 << (i % 8))));
  }
  return out;
}

function decodeWords(pdu, count) {
  // pdu[0]=fc, pdu[1]=byte count, pdu[2..]=register data
  const words = [];
  for (let i = 0; i < count; i++) words.push(pdu.readUInt16BE(2 + i * 2));
  return words;
}

/** Combine 1-2 raw 16-bit words into a JS number per dataType/wordOrder. */
function wordsToValue(words, dataType, wordOrder = 'big') {
  if (WORDS_PER_TYPE[dataType] === 1) {
    const w = words[0];
    return dataType === 'int16' ? (w << 16 >> 16) : w;
  }
  const [hi, lo] = wordOrder === 'little' ? [words[1], words[0]] : [words[0], words[1]];
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(hi, 0);
  buf.writeUInt16BE(lo, 2);
  if (dataType === 'float32') return buf.readFloatBE(0);
  if (dataType === 'int32')   return buf.readInt32BE(0);
  return buf.readUInt32BE(0);
}

/** Inverse of wordsToValue — a JS number back into 1-2 raw 16-bit words. */
function valueToWords(value, dataType, wordOrder = 'big') {
  if (WORDS_PER_TYPE[dataType] === 1) return [value & 0xFFFF];
  const buf = Buffer.alloc(4);
  if (dataType === 'float32') buf.writeFloatBE(value, 0);
  else if (dataType === 'int32') buf.writeInt32BE(value, 0);
  else buf.writeUInt32BE(value >>> 0, 0);
  const hi = buf.readUInt16BE(0), lo = buf.readUInt16BE(2);
  return wordOrder === 'little' ? [lo, hi] : [hi, lo];
}

// ── Modbus RTU CRC16 ─────────────────────────────────────────────────────

function crc16modbus(buf) {
  let crc = 0xFFFF;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      const lsb = crc & 1;
      crc >>= 1;
      if (lsb) crc ^= 0xA001;
    }
  }
  return crc;
}

// ── TCP transport (one connection per device) ───────────────────────────

class TcpTransport {
  constructor({ host, port = 502, timeout = 3000 }) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
    this._socket  = null;
    this._rxBuf   = Buffer.alloc(0);
    this._pending = null;
    this._txId    = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      this._socket = sock;
      sock.setTimeout(this.timeout);
      sock.connect(this.port, this.host, () => resolve());
      sock.on('data', (chunk) => { this._rxBuf = Buffer.concat([this._rxBuf, chunk]); this._drain(); });
      sock.on('timeout', () => this._fail(new Error('timeout')));
      sock.on('error', (err) => { this._fail(err); reject(err); });
      sock.on('close', () => this._fail(new Error('connection closed')));
    });
  }

  close() { this._socket?.destroy(); this._socket = null; }

  _fail(err) {
    if (this._pending) { clearTimeout(this._pending.timer); this._pending.reject(err); this._pending = null; }
  }

  request(unitId, pdu) {
    return new Promise((resolve, reject) => {
      if (!this._socket) return reject(new Error('not connected'));
      if (this._pending) return reject(new Error('request already in flight'));
      const txId = (this._txId = (this._txId + 1) & 0xFFFF);
      const frame = Buffer.alloc(6 + 1 + pdu.length);
      frame.writeUInt16BE(txId, 0);
      frame.writeUInt16BE(0, 2);
      frame.writeUInt16BE(1 + pdu.length, 4);
      frame.writeUInt8(unitId, 6);
      pdu.copy(frame, 7);

      const timer = setTimeout(() => { this._pending = null; reject(new Error('response timeout')); }, this.timeout);
      this._pending = { txId, resolve, reject, timer };
      this._socket.write(frame);
    });
  }

  _drain() {
    while (this._rxBuf.length >= 6) {
      const length = this._rxBuf.readUInt16BE(4);
      const total  = 6 + length;
      if (this._rxBuf.length < total) break;
      const frame = this._rxBuf.subarray(0, total);
      this._rxBuf = this._rxBuf.subarray(total);
      if (this._pending) {
        const { resolve, timer } = this._pending;
        this._pending = null;
        clearTimeout(timer);
        resolve(frame.subarray(7)); // strip MBAP + unit id → PDU
      }
    }
  }
}

// ── RTU transport (shared per serial port, RS-485 multi-drop) ──────────

const rtuBuses = new Map(); // serialPort path → RtuBus

class RtuBus {
  constructor(path, baudRate) {
    this.path = path;
    this.baudRate = baudRate;
    this._port = null;
    this._rxBuf = Buffer.alloc(0);
    this._pending = null;
    this._queue = [];
  }

  connect() {
    if (this._port) return Promise.resolve();
    let SerialPortMod;
    try { SerialPortMod = require('serialport'); }
    catch { return Promise.reject(new Error('serialport package not installed — run `npm install serialport` on the host')); }
    const SerialPort = SerialPortMod.SerialPort || SerialPortMod;
    return new Promise((resolve, reject) => {
      this._port = new SerialPort({ path: this.path, baudRate: this.baudRate }, (err) => err ? reject(err) : resolve());
      this._port.on('data', (chunk) => { this._rxBuf = Buffer.concat([this._rxBuf, chunk]); this._drain(); });
      this._port.on('error', (err) => this._fail(err));
    });
  }

  _fail(err) {
    if (this._pending) { clearTimeout(this._pending.timer); this._pending.reject(err); this._pending = null; }
    this._pumpQueue();
  }

  /** RTU frame = unitId(1) + PDU + CRC16(2, little-endian). Serialized one at a time across all unit IDs on this bus. */
  request(unitId, pdu) {
    return new Promise((resolve, reject) => {
      this._queue.push({ unitId, pdu, resolve, reject });
      this._pumpQueue();
    });
  }

  _pumpQueue() {
    if (this._pending || !this._queue.length || !this._port) return;
    const { unitId, pdu, resolve, reject } = this._queue.shift();
    const body = Buffer.concat([Buffer.from([unitId]), pdu]);
    const crc  = Buffer.alloc(2);
    crc.writeUInt16LE(crc16modbus(body), 0);
    const frame = Buffer.concat([body, crc]);

    const timer = setTimeout(() => { this._pending = null; reject(new Error('response timeout')); this._pumpQueue(); }, 3000);
    this._pending = { unitId, resolve, reject, timer };
    this._rxBuf = Buffer.alloc(0);
    this._port.write(frame);
  }

  _drain() {
    // Minimum viable RTU frame: address(1) + fc(1) + byteCount(1) + ...data + crc(2).
    if (!this._pending || this._rxBuf.length < 5) return;
    const byteCount = this._rxBuf[2];
    const total = 3 + byteCount + 2;
    if (this._rxBuf.length < total) return;

    const frame = this._rxBuf.subarray(0, total);
    this._rxBuf = this._rxBuf.subarray(total);
    const body = frame.subarray(0, total - 2);
    const crcRx = frame.readUInt16LE(total - 2);

    const { unitId, resolve, reject, timer } = this._pending;
    this._pending = null;
    clearTimeout(timer);
    if (crc16modbus(body) !== crcRx || frame[0] !== unitId) {
      reject(new Error('CRC/address mismatch'));
    } else {
      resolve(body.subarray(1)); // strip address byte → PDU
    }
    this._pumpQueue();
  }
}

function getRtuBus(path, baudRate) {
  let bus = rtuBuses.get(path);
  if (!bus) { bus = new RtuBus(path, baudRate); rtuBuses.set(path, bus); }
  return bus;
}

// ── Per-device polling / write dispatch ─────────────────────────────────

class ModbusDeviceClient {
  constructor(cfg, deviceKey, store) {
    this.cfg       = cfg;
    this.deviceKey = deviceKey;
    this.store     = store;
    this.unitId    = cfg.unitId || cfg.slaveId || 1;
    this.registers = cfg.registers || [];
    this.transport = null;
    this._timer    = null;
  }

  async start() {
    if (this.cfg.transport === 'rtu') {
      this.transport = getRtuBus(this.cfg.serialPort, this.cfg.baudRate || 9600);
    } else {
      this.transport = new TcpTransport({ host: this.cfg.host, port: this.cfg.port });
    }
    await this.transport.connect();
    platformStatus.set('modbus', true);

    const ms = Math.max(this.cfg.pollInterval || 5, 2) * 1000;
    this._poll();
    this._timer = setInterval(() => this._poll(), ms);
  }

  stop() {
    clearInterval(this._timer);
    if (this.transport instanceof TcpTransport) this.transport.close();
    // RTU buses are shared — never closed by an individual device.
  }

  async _poll() {
    for (const reg of this.registers) {
      try {
        const value = await this._readOne(reg);
        this.store.update(`${this.deviceKey}/${reg.path}`, value);
      } catch (err) {
        console.error(`[Modbus] Read failed (${this.cfg.name || this.deviceKey}/${reg.name}): ${err.message}`);
      }
    }
  }

  async _readOne(reg) {
    if (reg.type === 'coil') {
      const pdu = await this.transport.request(this.unitId, pduReadCoils(reg.address, 1));
      return decodeBits(pdu, 1)[0] ? 1 : 0;
    }
    if (reg.type === 'discrete') {
      const pdu = await this.transport.request(this.unitId, pduReadDiscrete(reg.address, 1));
      return decodeBits(pdu, 1)[0] ? 1 : 0;
    }
    const dataType = reg.dataType || 'uint16';
    const words    = WORDS_PER_TYPE[dataType] || 1;
    const readPdu  = reg.type === 'input' ? pduReadInput(reg.address, words) : pduReadHolding(reg.address, words);
    const pdu      = await this.transport.request(this.unitId, readPdu);
    const raw      = wordsToValue(decodeWords(pdu, words), dataType, reg.wordOrder);
    return raw * (reg.scale ?? 1) + (reg.offset ?? 0);
  }

  async write(reg, value) {
    if (reg.type === 'coil') {
      await this.transport.request(this.unitId, pduWriteSingleCoil(reg.address, !!value));
      this.store.update(`${this.deviceKey}/${reg.path}`, value ? 1 : 0);
      return;
    }
    const dataType = reg.dataType || 'uint16';
    const raw = Math.round((value - (reg.offset ?? 0)) / (reg.scale ?? 1));
    const words = valueToWords(raw, dataType, reg.wordOrder);
    await this.transport.request(this.unitId, pduWriteRegisters(reg.address, words));
    this.store.update(`${this.deviceKey}/${reg.path}`, value);
  }
}

// ── Main client ──────────────────────────────────────────────────────────

class ModbusClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._devices  = [];
  }

  async start() {
    const list = this._config.modbus?.devices || [];
    for (const cfg of list) {
      await this._addDevice(cfg).catch((err) =>
        console.error(`[Modbus] Init failed for ${cfg.name || cfg.host || cfg.serialPort}: ${err.message}`));
    }
  }

  stop() {
    for (const d of this._devices) d.stop();
  }

  async _addDevice(cfg) {
    const id = cfg.transport === 'rtu' ? `${cfg.serialPort}_${cfg.unitId || cfg.slaveId || 1}` : cfg.host;
    if (!id) throw new Error('device needs "host" (tcp) or "serialPort" (rtu)');
    const deviceKey = `modbus/${id.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const sensors = (cfg.registers || []).map((reg, i) => {
      reg.path = reg.path || `reg_${i}`;
      const isBit = reg.type === 'coil' || reg.type === 'discrete';
      const writable = !!reg.writable && (reg.type === 'coil' || reg.type === 'holding');
      return isBit
        ? { path: reg.path, name: reg.name || reg.path, format: 'on-off', controllable: writable, type: 'toggle', writeOn: true, writeOff: false, capabilityId: reg.path }
        : { path: reg.path, name: reg.name || reg.path, unit: reg.unit || '', controllable: writable, type: writable ? 'range' : 'number', min: reg.min, max: reg.max, writeCmd: 'set', capabilityId: reg.path };
    });

    const dev = new ModbusDeviceClient(cfg, deviceKey, this._store);

    this._registry.registerDevice({
      key: deviceKey,
      type: 'modbus',
      label: cfg.name || `Modbus ${id}`,
      icon: '🔧',
      homekit: [],
      sensors,
      _writeCapability: (capId, command, args) => {
        const reg = (cfg.registers || []).find((r) => r.path === capId);
        if (!reg) return;
        const value = reg.type === 'coil' ? command === true : Number(args?.[0]);
        return dev.write(reg, value);
      },
    });

    await dev.start();
    this._devices.push(dev);
    console.log(`[Modbus] Started: ${cfg.name || id} (${cfg.transport || 'tcp'}, ${sensors.length} register(s))`);
  }
}

module.exports = ModbusClient;
