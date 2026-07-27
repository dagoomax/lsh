'use strict';

const platformStatus = require('./platform-status');

// ── CAN bus integration ─────────────────────────────────────────────────────
// Reads/writes a CAN (Controller Area Network) bus and maps frames to dashboard
// sensors. Two transports:
//   • socketcan  — Linux kernel SocketCAN (e.g. can0 from a USB-CAN adapter).
//                  Needs the optional `socketcan` npm package on the host.
//   • slcan      — a serial USB-CAN adapter (USBtin / CANable) speaking SLCAN.
//                  Needs the optional `serialport` npm package.
// Both deliver raw frames { id, ext, data:Buffer }. Higher-level buses are just
// CAN underneath, so NMEA 2000 / Victron VE.Can (29-bit extended IDs) and
// CANopen are supported by mapping a signal's byte layout per its PGN / object.
//
// A signal maps part of a frame to a value:
//   { name, id, extended, start, length, endian:'little'|'big', signed,
//     scale, offset, unit, writable }
//
// SLCAN bitrate codes.
const SLCAN_RATE = { 10000:'S0', 20000:'S1', 50000:'S2', 100000:'S3',
  125000:'S4', 250000:'S5', 500000:'S6', 800000:'S7', 1000000:'S8' };

class CanClient {
  constructor(config, store, sensorRegistry) {
    this._cfg      = config.can || {};
    this._store    = store;
    this._registry = sensorRegistry;
    this._signals  = [];
    this._channel  = null; // socketcan raw channel
    this._port     = null; // slcan serial port
    this._rxBuf    = '';    // slcan line buffer
  }

  async start() {
    // Normalise signals (parse hex ids once)
    this._signals = (this._cfg.signals || []).map((s, i) => ({
      ...s,
      _id:  typeof s.id === 'string' ? parseInt(s.id, 16) : Number(s.id),
      _ext: !!s.extended,
      path: s.path || `sig${i}`,
    }));

    const dev = {
      key:      `can/${this._cfg.name || this._cfg.interface || 'bus'}`,
      label:    this._cfg.label || `CAN (${this._cfg.transport || 'socketcan'})`,
      type:     'can',
      homekit:  [],
      sensors:  this._signals.map((s) => this._descriptor(s)),
      _writeCapability: (capId, command, args) => this._write(capId, command, args),
    };
    this._registry.registerDevice(dev);
    this._deviceKey = dev.key;

    try {
      if (this._cfg.transport === 'slcan') await this._startSlcan();
      else await this._startSocketcan();
      platformStatus.set('can', true);
      console.log(`[CAN] Started (${this._cfg.transport || 'socketcan'}) — ${this._signals.length} signal(s)`);
    } catch (err) {
      console.error(`[CAN] Start failed: ${err.message}`);
      platformStatus.set('can', false);
    }
  }

  stop() {
    try { this._channel?.stop(); } catch {}
    try { if (this._port) { this._port.write('C\r'); this._port.close(); } } catch {}
    this._channel = null; this._port = null;
  }

  _descriptor(s) {
    if (s.writable) {
      return { path: s.path, label: s.name || s.path, sensorType: 'can', unit: s.unit || '',
        controllable: true, type: 'range', min: s.min ?? 0, max: s.max ?? 100,
        writeCmd: 'set', capabilityId: s.path };
    }
    return { path: s.path, label: s.name || s.path, sensorType: 'can', unit: s.unit || '', controllable: false };
  }

  // ── Transports ────────────────────────────────────────────────────────────
  async _startSocketcan() {
    let socketcan;
    try { socketcan = require('socketcan'); }
    catch { throw new Error('socketcan package not installed — run `npm install socketcan` on the Linux host'); }
    const iface = this._cfg.interface || 'can0';
    this._channel = socketcan.createRawChannel(iface, true);
    this._channel.addListener('onMessage', (msg) => {
      try { this._onFrame(msg.id, !!msg.ext, msg.data); } catch (e) { console.error(`[CAN] ${e.message}`); }
    });
    this._channel.start();
  }

  async _startSlcan() {
    let SerialPortMod;
    try { SerialPortMod = require('serialport'); }
    catch { throw new Error('serialport package not installed — run `npm install serialport` on the host'); }
    const SerialPort = SerialPortMod.SerialPort || SerialPortMod;
    const path = this._cfg.serialPort;
    if (!path) throw new Error('slcan transport needs "serialPort"');
    const rate = SLCAN_RATE[this._cfg.bitrate || 500000] || 'S6';

    this._port = new SerialPort({ path, baudRate: 115200 });
    this._port.on('open', () => {
      // close, set bitrate, open (normal mode)
      this._port.write('C\r');
      this._port.write(rate + '\r');
      this._port.write('O\r');
    });
    this._port.on('data', (buf) => {
      this._rxBuf += buf.toString('ascii');
      let idx;
      while ((idx = this._rxBuf.indexOf('\r')) >= 0) {
        const line = this._rxBuf.slice(0, idx);
        this._rxBuf = this._rxBuf.slice(idx + 1);
        const f = parseSlcanFrame(line);
        if (f) { try { this._onFrame(f.id, f.ext, f.data); } catch (e) { console.error(`[CAN] ${e.message}`); } }
      }
    });
    this._port.on('error', (e) => console.error(`[CAN] serial: ${e.message}`));
  }

  // ── RX → decode → store ─────────────────────────────────────────────────────
  _onFrame(id, ext, data) {
    for (const s of this._signals) {
      if (s._id !== id || s._ext !== ext) continue;
      const v = decodeSignal(s, data);
      if (v != null) this._store.set(`${this._deviceKey}/${s.path}`, v);
    }
  }

  // ── Write (send a frame) ────────────────────────────────────────────────────
  async _write(capId, command, args) {
    const s = this._signals.find((x) => x.path === capId);
    if (!s || !s.writable) throw new Error('signal not writable');
    const value = command === 'set' ? Number(args?.[0]) : (command === 'on' ? 1 : 0);
    const data = encodeSignal(s, value);
    if (this._channel) {
      this._channel.send({ id: s._id, ext: s._ext, data });
    } else if (this._port) {
      this._port.write(buildSlcanFrame(s._id, s._ext, data) + '\r');
    } else {
      throw new Error('CAN bus not connected');
    }
    this._store.set(`${this._deviceKey}/${s.path}`, value);
  }
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Decode `length` bytes at `start` from a CAN frame into a scaled value. */
function decodeSignal(sig, data) {
  const start = sig.start || 0, len = sig.length || 1;
  if (!data || start + len > data.length) return null;
  let raw = 0;
  if ((sig.endian || 'little') === 'little') {
    for (let i = len - 1; i >= 0; i--) raw = raw * 256 + data[start + i];
  } else {
    for (let i = 0; i < len; i++) raw = raw * 256 + data[start + i];
  }
  if (sig.signed) {
    const bits = len * 8;
    if (raw >= 2 ** (bits - 1)) raw -= 2 ** bits;
  }
  const v = raw * (sig.scale ?? 1) + (sig.offset ?? 0);
  return Math.round(v * 1e6) / 1e6; // tidy float noise
}

/** Encode a scaled value back into an 8-byte frame buffer (inverse of decode). */
function encodeSignal(sig, value) {
  const start = sig.start || 0, len = sig.length || 1;
  const data = Buffer.alloc(8);
  let raw = Math.round((value - (sig.offset ?? 0)) / (sig.scale ?? 1));
  if (raw < 0) raw += 2 ** (len * 8); // two's complement
  const bytes = [];
  for (let i = 0; i < len; i++) { bytes.push(raw & 0xff); raw = Math.floor(raw / 256); }
  if ((sig.endian || 'little') !== 'little') bytes.reverse();
  for (let i = 0; i < len; i++) data[start + i] = bytes[i];
  return data.subarray(0, Math.max(start + len, 1));
}

/** Parse an SLCAN RX line: `t<id3><dlc><data>` (std) or `T<id8><dlc><data>` (ext). */
function parseSlcanFrame(line) {
  if (!line) return null;
  const kind = line[0];
  const ext = kind === 'T';
  if (kind !== 't' && kind !== 'T') return null; // ignore r/R (RTR), status, etc.
  const idLen = ext ? 8 : 3;
  const id = parseInt(line.slice(1, 1 + idLen), 16);
  const dlc = parseInt(line[1 + idLen], 16);
  if (Number.isNaN(id) || Number.isNaN(dlc)) return null;
  const hex = line.slice(2 + idLen, 2 + idLen + dlc * 2);
  const data = Buffer.alloc(dlc);
  for (let i = 0; i < dlc; i++) data[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  return { id, ext, data };
}

/** Build an SLCAN TX line for a frame (without trailing CR). */
function buildSlcanFrame(id, ext, data) {
  const idHex = id.toString(16).toUpperCase().padStart(ext ? 8 : 3, '0');
  let s = (ext ? 'T' : 't') + idHex + data.length.toString(16);
  for (const b of data) s += b.toString(16).toUpperCase().padStart(2, '0');
  return s;
}

module.exports = CanClient;
module.exports._test = { decodeSignal, encodeSignal, parseSlcanFrame, buildSlcanFrame };
