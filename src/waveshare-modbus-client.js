'use strict';

/**
 * Waveshare Modbus TCP relay board client.
 *
 * Speaks raw Modbus TCP (RFC 1683) over a persistent TCP socket.
 * No external library required — frames are built and parsed manually.
 *
 * Supported boards: any Waveshare Modbus relay module reachable via TCP/IP,
 * including boards connected through a serial-to-Ethernet converter.
 *
 * Config:
 *   "waveshare": {
 *     "devices": [
 *       { "name": "Gate Controller", "host": "192.168.1.x", "port": 502, "slaveId": 1, "relayCount": 8 }
 *     ]
 *   }
 *
 * Each relay is registered in the sensor registry as a controllable toggle
 * sensor. Commands arrive via POST /api/device/:key/command.
 */

const net            = require('net');
const platformStatus = require('./platform-status');

const POLL_MS       = 5_000;
const TIMEOUT_MS    = 3_000;
const RECONNECT_MS  = 15_000;

// Modbus TCP function codes
const FC_READ_COILS        = 0x01;
const FC_WRITE_SINGLE_COIL = 0x05;

// ── Modbus TCP frame helpers ───────────────────────────────────────────────

let _txId = 0;
function nextTxId() { _txId = (_txId + 1) & 0xFFFF; return _txId; }

/** Build a Modbus TCP ADU (MBAP + PDU). */
function buildFrame(unitId, pdu) {
  const txId = nextTxId();
  const buf  = Buffer.alloc(6 + 1 + pdu.length);
  buf.writeUInt16BE(txId,          0); // Transaction ID
  buf.writeUInt16BE(0x0000,        2); // Protocol ID (always 0)
  buf.writeUInt16BE(1 + pdu.length, 4); // Length (unit + PDU)
  buf.writeUInt8(unitId,           6); // Unit ID
  pdu.copy(buf, 7);
  return buf;
}

/** FC01: Read Coils request. */
function readCoilsReq(unitId, startAddr, count) {
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FC_READ_COILS, 0);
  pdu.writeUInt16BE(startAddr,  1);
  pdu.writeUInt16BE(count,      3);
  return buildFrame(unitId, pdu);
}

/** FC05: Write Single Coil request. */
function writeSingleCoilReq(unitId, addr, on) {
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FC_WRITE_SINGLE_COIL, 0);
  pdu.writeUInt16BE(addr,              1);
  pdu.writeUInt16BE(on ? 0xFF00 : 0x0000, 3);
  return buildFrame(unitId, pdu);
}

/** Parse coil states from an FC01 response PDU (after MBAP stripped). */
function parseCoils(pdu, count) {
  // pdu[0] = fc, pdu[1] = byte count, pdu[2..] = coil bytes
  const states = [];
  for (let i = 0; i < count; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx  = i % 8;
    states.push(!!(pdu[2 + byteIdx] & (1 << bitIdx)));
  }
  return states;
}

// ── Per-device TCP connection ─────────────────────────────────────────────

class ModbusDevice {
  constructor(cfg, onState) {
    this.host       = cfg.host;
    this.port       = cfg.port || 502;
    this.slaveId    = cfg.slaveId || 1;
    this.relayCount = Math.min(cfg.relayCount || 8, 64);
    this.name       = cfg.name || `Waveshare ${this.host}`;
    this._onState   = onState; // (index, on) => void
    this._socket    = null;
    this._rxBuf     = Buffer.alloc(0);
    this._pending   = null;  // { resolve, reject, timer }
    this._reconnTimer = null;
    this._pollTimer   = null;
    this.connected  = false;
  }

  start() { this._connect(); }

  stop() {
    clearTimeout(this._reconnTimer);
    clearInterval(this._pollTimer);
    if (this._socket) { this._socket.destroy(); this._socket = null; }
  }

  /** Send FC05, returns Promise that resolves when echo arrives. */
  writeCoil(index, on) {
    return this._request(writeSingleCoilReq(this.slaveId, index, on));
  }

  // ── Internals ─────────────────────────────────────────────────────────

  _connect() {
    if (this._socket) return;
    const sock = new net.Socket();
    this._socket = sock;
    this._rxBuf  = Buffer.alloc(0);

    sock.setTimeout(TIMEOUT_MS);
    sock.connect(this.port, this.host, () => {
      this.connected = true;
      platformStatus.set(`waveshare-${this.host}`, true);
      console.log(`[Waveshare] Connected to ${this.name} (${this.host}:${this.port})`);
      this._startPoll();
    });

    sock.on('data', (chunk) => {
      this._rxBuf = Buffer.concat([this._rxBuf, chunk]);
      this._drain();
    });

    const cleanup = (reason) => {
      if (!this._socket) return;
      this.connected = false;
      platformStatus.set(`waveshare-${this.host}`, false);
      clearInterval(this._pollTimer);
      this._pollTimer = null;
      if (this._pending) {
        clearTimeout(this._pending.timer);
        this._pending.reject(new Error(reason));
        this._pending = null;
      }
      sock.destroy();
      this._socket = null;
      console.warn(`[Waveshare] ${this.name}: ${reason} — reconnecting in ${RECONNECT_MS / 1000}s`);
      this._reconnTimer = setTimeout(() => this._connect(), RECONNECT_MS);
    };

    sock.on('timeout', () => cleanup('Timeout'));
    sock.on('error',   (err) => cleanup(err.message));
    sock.on('close',   () => cleanup('Connection closed'));
  }

  _startPoll() {
    clearInterval(this._pollTimer);
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), POLL_MS);
  }

  async _poll() {
    if (!this.connected || this._pending) return;
    try {
      const resp = await this._request(readCoilsReq(this.slaveId, 0, this.relayCount));
      const states = parseCoils(resp, this.relayCount);
      states.forEach((on, i) => this._onState(i, on));
    } catch {
      // reconnect already triggered in cleanup
    }
  }

  /** Send a frame and wait for the matching response. */
  _request(frame) {
    return new Promise((resolve, reject) => {
      if (!this._socket || !this.connected) {
        return reject(new Error('Not connected'));
      }
      if (this._pending) {
        return reject(new Error('Request in progress'));
      }
      const timer = setTimeout(() => {
        this._pending = null;
        reject(new Error('Response timeout'));
        this._socket?.destroy();
      }, TIMEOUT_MS);

      this._pending = { resolve, reject, timer };
      this._socket.write(frame);
    });
  }

  /** Try to consume complete Modbus TCP responses from the receive buffer. */
  _drain() {
    while (this._rxBuf.length >= 6) {
      const length = this._rxBuf.readUInt16BE(4); // MBAP length field
      const total  = 6 + length;
      if (this._rxBuf.length < total) break;

      const frame = this._rxBuf.slice(0, total);
      this._rxBuf = this._rxBuf.slice(total);

      if (this._pending) {
        const { resolve, timer } = this._pending;
        this._pending = null;
        clearTimeout(timer);
        resolve(frame.slice(7)); // return PDU (after MBAP + unit ID)
      }
    }
  }
}

// ── Main client ───────────────────────────────────────────────────────────

class WaveshareModbusClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._devices  = [];
  }

  async start() {
    const cfgDevices = this._config.waveshare?.devices || [];
    for (const cfg of cfgDevices) {
      if (!cfg.host) continue;
      this._addDevice(cfg);
    }
  }

  _addDevice(cfg) {
    const key = `waveshare/${cfg.host.replace(/\./g, '_')}`;

    const dev = new ModbusDevice(cfg, (index, on) => {
      const path    = `relay_${index}`;
      const fullKey = `${key}/${path}`;
      this._store.set(fullKey, on ? 1 : 0);

      const regDev = this._registry.devices.get(key);
      if (regDev) {
        const sensor = regDev.sensors.find(s => s.path === path);
        if (sensor) {
          this._registry.emit('sensor-update', { deviceKey: key, sensorPath: path, value: on ? 1 : 0 });
        }
      }
    });

    const relayCount = Math.min(cfg.relayCount || 8, 64);
    const sensors = Array.from({ length: relayCount }, (_, i) => ({
      path:        `relay_${i}`,
      name:        `Relay ${i + 1}`,
      format:      'on-off',
      controllable: true,
      type:        'toggle',
      writeOn:     true,
      writeOff:    false,
      capabilityId: `relay_${i}`,
    }));

    this._registry.registerDevice({
      key,
      type:     'waveshare',
      instance: cfg.host,
      label:    cfg.name || `Waveshare ${cfg.host}`,
      icon:     '🔌',
      color:    'blue',
      sensors,
      homekit:  [],
      _writeCapability: async (capId, command) => {
        const index = parseInt(capId.replace('relay_', ''), 10);
        const on    = command === true;
        await dev.writeCoil(index, on);
      },
    });

    dev.start();
    this._devices.push(dev);
    console.log(`[Waveshare] Starting: ${cfg.name || cfg.host} (${cfg.host}:${cfg.port || 502}, slave ${cfg.slaveId || 1}, ${relayCount} relays)`);
  }
}

module.exports = WaveshareModbusClient;
