'use strict';

/**
 * Sofar Solar inverter client (K-TLX grid-tie string inverter line) via the
 * Solarman/LSW-3 WiFi data-logger dongle.
 *
 * The LSW-3 dongle listens on TCP :8899 and speaks the "Solarman V5"
 * protocol: a thin proprietary frame (start/length/control/sequence/logger-
 * serial header, a fixed padding block, then checksum+end) wrapping a
 * standard Modbus RTU request/response addressed to the inverter behind it.
 * No cloud account, no API key — just the dongle's IP and the serial number
 * printed on its label.
 *
 * Frame layout is ported from https://github.com/jmccrohan/pysolarmanv5
 * (the de-facto reference implementation, used by many Home Assistant
 * integrations for Deye/Sofar/Growatt loggers). One detail from that
 * library doesn't reconcile on paper — the embedded Modbus response is
 * sliced at a fixed byte offset (25) that's one byte short of what the
 * request's own 15-byte padding block would suggest — but it's kept as-is
 * (not "corrected") because it was cross-checked against a real captured
 * response frame published in https://github.com/MichaluxPL/Sofar_LSW3's
 * README, which decodes perfectly at offset 25 (byte 26 lands mid-way
 * through the Modbus byte-count field otherwise). That same capture is
 * also what confirms Modbus function 0x03 (Read Holding Registers) is
 * what this inverter family uses, not 0x04.
 *
 * Register map (addresses, scaling, enums) ported from that same project's
 * SOFARMap.xml. Covers registers 0x0000-0x0027 — status, PV1/PV2, grid
 * output, temperatures, and production counters. Sofar's other lines
 * (hybrid HYD-xK-ES, three-phase KTL) are known to use different register
 * numbers and are NOT covered here.
 *
 * NOT verified against a real inverter from this codebase — ported from a
 * documented, real-hardware-tested wire protocol and register map, but
 * nobody has run this specific file against real hardware yet.
 */

const net = require('net');
const platformStatus = require('./platform-status');

const V5_PORT_DEFAULT = 8899;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const MIN_POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 5000;
// Consecutive failed poll cycles tolerated before the device goes offline —
// a dongle on Wi-Fi drops a request every so often, that's not a real outage.
const UPDATE_FAILURE_TOLERANCE = 3;

const REG_START = 0x0000;
const REG_END = 0x0027; // inclusive — 40 holding registers, one block read

const STATUS_MAP = { 0: 'Stand-by', 1: 'Self-checking', 2: 'Normal', 3: 'Fault', 4: 'Permanent Fault' };

// ── Modbus RTU (the frame embedded inside the V5 wrapper) ──────────────────

function modbusCrc16(buf) {
  let crc = 0xFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
    }
  }
  return crc;
}

function buildReadHoldingRequest(slaveId, startAddr, quantity) {
  const req = Buffer.alloc(8);
  req.writeUInt8(slaveId, 0);
  req.writeUInt8(0x03, 1); // Read Holding Registers
  req.writeUInt16BE(startAddr, 2);
  req.writeUInt16BE(quantity, 4);
  req.writeUInt16LE(modbusCrc16(req.subarray(0, 6)), 6);
  return req;
}

function parseModbusReadResponse(modbus, slaveId) {
  if (modbus[0] !== slaveId) throw new Error(`unexpected slave id ${modbus[0]}`);
  if (modbus[1] !== 0x03) throw new Error(`unexpected Modbus function 0x${modbus[1].toString(16)} (exception response?)`);
  const byteCount = modbus[2];
  const data = modbus.subarray(3, 3 + byteCount);
  if (data.length !== byteCount) throw new Error('truncated Modbus register data');
  const registers = [];
  for (let i = 0; i < byteCount; i += 2) registers.push(data.readUInt16BE(i));
  return registers;
}

// ── Solarman V5 framing ─────────────────────────────────────────────────────

let seqCounter = null;
function nextSeq() {
  seqCounter = seqCounter == null ? Math.floor(Math.random() * 0xFE) + 1 : (seqCounter + 1) & 0xFF;
  return seqCounter;
}

function v5Checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i]) & 0xFF;
  return sum;
}

function encodeV5Request(serial, seq, modbusFrame) {
  // frametype(1) + sensortype(2) + deliverytime(4) + powerontime(4) + offsettime(4) — always zero for a plain register read.
  const payloadPrefix = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(14)]);
  const length = payloadPrefix.length + modbusFrame.length; // 15 + len(modbus)
  const header = Buffer.alloc(11);
  header.writeUInt8(0xA5, 0);
  header.writeUInt16LE(length, 1);
  header.writeUInt8(0x10, 3);
  header.writeUInt8(0x45, 4); // control code: REQUEST
  header.writeUInt16LE(seq, 5);
  header.writeUInt32LE(serial >>> 0, 7);
  const body = Buffer.concat([header, payloadPrefix, modbusFrame]);
  const checksum = v5Checksum(body.subarray(1));
  return Buffer.concat([body, Buffer.from([checksum & 0xFF, 0x15])]);
}

// Modbus response is embedded at a fixed offset (25) — see file header for
// why this doesn't match the request's own padding size on paper.
function decodeV5Response(frame, expectedSeq, expectedSerial) {
  if (frame.length < 28) throw new Error(`frame too short (${frame.length} bytes)`);
  if (frame[0] !== 0xA5 || frame[frame.length - 1] !== 0x15) throw new Error('bad V5 start/end byte');
  if (frame[frame.length - 2] !== v5Checksum(frame.subarray(1, -2))) throw new Error('bad V5 checksum');
  if (frame.readUInt16LE(5) !== expectedSeq) throw new Error('V5 sequence number mismatch');
  if (frame.readUInt32LE(7) !== (expectedSerial >>> 0)) throw new Error('V5 logger serial mismatch');
  // 0x15 here is REQUEST(0x45) minus 0x30 — the response's control code, not
  // to be confused with the unrelated 0x15 end-byte value at the other end
  // of the frame. A 0x47 control code instead means a spurious keep-alive.
  if (frame[4] !== 0x15) throw new Error(`unexpected V5 control code 0x${frame[4].toString(16)}`);
  const modbus = frame.subarray(25, -2);
  if (modbus.length < 5) throw new Error('embedded Modbus frame too short');
  return modbus;
}

// ── Register decoding ───────────────────────────────────────────────────────

function s16(u) {
  return u > 0x7FFF ? u - 0x10000 : u;
}

function decodeReadings(registers) {
  const r = (addr) => registers[addr - REG_START];
  const r32 = (hiAddr, loAddr) => (r(hiAddr) << 16 | r(loAddr)) >>> 0; // high word first — not documented, assumed from Growatt/Deye-family convention

  return {
    status: STATUS_MAP[r(0x0000)] || `Unknown (${r(0x0000)})`,
    faultCode: r(0x0001),
    pv1Voltage: +(r(0x0006) * 0.1).toFixed(1),
    pv1Current: +(r(0x0007) * 0.01).toFixed(2),
    pv2Voltage: +(r(0x0008) * 0.1).toFixed(1),
    pv2Current: +(r(0x0009) * 0.01).toFixed(2),
    pv1Power: r(0x000A) * 10,
    pv2Power: r(0x000B) * 10,
    outputPower: r(0x000C) * 10,
    outputReactivePower: +(s16(r(0x000D)) * 0.01).toFixed(2),
    gridFrequency: +(r(0x000E) * 0.01).toFixed(2),
    l1Voltage: +(r(0x000F) * 0.1).toFixed(1),
    l1Current: +(r(0x0010) * 0.01).toFixed(2),
    l2Voltage: +(r(0x0011) * 0.1).toFixed(1),
    l2Current: +(r(0x0012) * 0.01).toFixed(2),
    l3Voltage: +(r(0x0013) * 0.1).toFixed(1),
    l3Current: +(r(0x0014) * 0.01).toFixed(2),
    totalProduction: r32(0x0015, 0x0016),
    totalGenerationTime: r32(0x0017, 0x0018),
    todayProduction: +(r(0x0019) * 10 / 1000).toFixed(3), // register is Wh*10 scale -> kWh
    todayGenerationTime: r(0x001A),
    moduleTemp: s16(r(0x001B)),
    innerTemp: s16(r(0x001C)),
    busVoltage: +(r(0x001D) * 0.1).toFixed(1),
  };
}

// One-shot register read over a fresh TCP connection (the dongle handles one
// request per connection reliably; a persistent socket risks the dongle
// silently dropping it between polls with no clean way to detect that).
function readRegisters({ host, port, serial, slaveId, startAddr, quantity, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const seq = nextSeq();
    const v5Req = encodeV5Request(serial, seq, buildReadHoldingRequest(slaveId, startAddr, quantity));

    const socket = net.createConnection({ host, port });
    let settled = false;
    let buf = Buffer.alloc(0);

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('timed out waiting for response')), timeoutMs);

    socket.on('connect', () => socket.write(v5Req));
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 3) return;
      const totalLen = 13 + buf.readUInt16LE(1); // start+len(2)+suffix+control+seq(2)+serial(4) + payload + checksum+end
      if (buf.length < totalLen) return;
      try {
        const modbus = decodeV5Response(buf.subarray(0, totalLen), seq, serial);
        finish(null, parseModbusReadResponse(modbus, slaveId));
      } catch (err) {
        finish(err);
      }
    });
    socket.on('error', (err) => finish(err));
    socket.on('close', () => finish(new Error('connection closed before a full response arrived')));
  });
}

class SofarClient {
  constructor(config, store, sensorRegistry) {
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._timer = null;
    this._failCount = 0;
  }

  async start() {
    const cfg = this._config.sofar;
    if (!cfg?.host || !cfg?.serialNumber) return;

    this._host = cfg.host;
    this._port = cfg.port || V5_PORT_DEFAULT;
    this._serial = Number(cfg.serialNumber);
    this._slaveId = cfg.slaveId || 1;
    this._key = `sofar/${this._serial}`;

    this._registry.registerDevice({
      key: this._key, label: cfg.name || 'Sofar Inverter', type: 'sofar', icon: '☀️',
      sensors: [
        { path: 'status', label: 'Status', sensorType: 'sensor', format: 'string' },
        { path: 'pv1Power', label: 'PV1 Power', sensorType: 'power', unit: 'W' },
        { path: 'pv2Power', label: 'PV2 Power', sensorType: 'power', unit: 'W' },
        { path: 'pv1Voltage', label: 'PV1 Voltage', sensorType: 'sensor', unit: 'V' },
        { path: 'pv1Current', label: 'PV1 Current', sensorType: 'sensor', unit: 'A' },
        { path: 'pv2Voltage', label: 'PV2 Voltage', sensorType: 'sensor', unit: 'V' },
        { path: 'pv2Current', label: 'PV2 Current', sensorType: 'sensor', unit: 'A' },
        { path: 'outputPower', label: 'Output Power', sensorType: 'power', unit: 'W' },
        { path: 'outputReactivePower', label: 'Reactive Power', sensorType: 'sensor', unit: 'kVar' },
        { path: 'gridFrequency', label: 'Grid Frequency', sensorType: 'sensor', unit: 'Hz' },
        { path: 'l1Voltage', label: 'L1 Voltage', sensorType: 'sensor', unit: 'V' },
        { path: 'l1Current', label: 'L1 Current', sensorType: 'sensor', unit: 'A' },
        { path: 'l2Voltage', label: 'L2 Voltage', sensorType: 'sensor', unit: 'V' },
        { path: 'l2Current', label: 'L2 Current', sensorType: 'sensor', unit: 'A' },
        { path: 'l3Voltage', label: 'L3 Voltage', sensorType: 'sensor', unit: 'V' },
        { path: 'l3Current', label: 'L3 Current', sensorType: 'sensor', unit: 'A' },
        { path: 'todayProduction', label: 'Today Production', sensorType: 'energy', unit: 'kWh' },
        { path: 'totalProduction', label: 'Total Production', sensorType: 'energy', unit: 'kWh' },
        { path: 'moduleTemp', label: 'Module Temperature', sensorType: 'temperature', unit: '°C' },
        { path: 'innerTemp', label: 'Inner Temperature', sensorType: 'temperature', unit: '°C' },
        { path: 'busVoltage', label: 'Bus Voltage', sensorType: 'sensor', unit: 'V' },
        { path: 'faultCode', label: 'Fault Code', sensorType: 'sensor', format: 'number' },
      ],
    });

    platformStatus.set('sofar', false);

    const interval = Math.max(cfg.pollInterval ? cfg.pollInterval * 1000 : DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS);
    this._timer = setInterval(() => this._poll(), interval);
    console.log(`[Sofar] Started — polling ${this._host}:${this._port} every ${interval / 1000}s`);
    await this._poll();
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _poll() {
    try {
      const registers = await readRegisters({
        host: this._host, port: this._port, serial: this._serial, slaveId: this._slaveId,
        startAddr: REG_START, quantity: REG_END - REG_START + 1, timeoutMs: REQUEST_TIMEOUT_MS,
      });
      const readings = decodeReadings(registers);
      for (const [path, value] of Object.entries(readings)) {
        this._store.update(`${this._key}/${path}`, value);
      }
      this._failCount = 0;
      platformStatus.set('sofar', true);
    } catch (err) {
      this._failCount++;
      console.error(`[Sofar] Poll failed: ${err.message}`);
      if (this._failCount >= UPDATE_FAILURE_TOLERANCE) platformStatus.set('sofar', false);
    }
  }
}

SofarClient.readRegisters = readRegisters; // exposed for the Settings "Test Connection" route
module.exports = SofarClient;
