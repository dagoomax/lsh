'use strict';

// Modbus scanner — Settings → System → Modbus scan (tool module lsh-modbus).
// Read-only: finds Modbus TCP servers on this host's LAN (port 502) and unit
// IDs behind them or on an RS-485 bus (Modbus RTU via a USB adapter),
// identifies what it can (FC 0x2B Device Identification, SunSpec, Victron GX,
// Eastron-style energy meters, Huawei SUN2000) and reads register ranges for
// the explorer. Only read function codes (1, 2, 3, 4, 0x2B) are ever sent.

const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const EXCEPTIONS = {
  1: 'Illegal function', 2: 'Illegal data address', 3: 'Illegal data value', 4: 'Server device failure',
  5: 'Acknowledge', 6: 'Server busy', 10: 'Gateway path unavailable', 11: 'Gateway target failed to respond',
};

class ModbusError extends Error {
  constructor(code) { super(`Modbus exception ${code}: ${EXCEPTIONS[code] || 'unknown'}`); this.code = code; this.exception = true }
}

// ── CRC16 (Modbus RTU) ─────────────────────────────────────────────────────
function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

// ── Transports: request(unit, pdu) → response PDU (function code first) ────

function tcpClient(host, port = 502, { timeout = 1500 } = {}) {
  let sock = null, buf = Buffer.alloc(0), tid = 0, pending = null, queue = Promise.resolve();
  const connect = () => new Promise((resolve, reject) => {
    if (sock) return resolve();
    const s = net.createConnection({ host, port });
    const t = setTimeout(() => { s.destroy(); reject(new Error(`${host}:${port} — connect timeout`)) }, timeout);
    s.once('connect', () => { clearTimeout(t); sock = s; resolve() });
    s.on('error', (e) => { clearTimeout(t); if (!sock) reject(e); if (pending) pending.reject(e); sock = null });
    s.on('close', () => { sock = null; if (pending) pending.reject(new Error('connection closed')) });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) break;
        const frame = buf.subarray(0, 6 + len); buf = buf.subarray(6 + len);
        if (pending && frame.readUInt16BE(0) === pending.tid) pending.resolve(Buffer.from(frame.subarray(7)));
      }
    });
  });
  const request = (unit, pdu) => (queue = queue.catch(() => {}).then(async () => {
    await connect();
    tid = (tid + 1) & 0xffff;
    const mbap = Buffer.alloc(7);
    mbap.writeUInt16BE(tid, 0); mbap.writeUInt16BE(0, 2); mbap.writeUInt16BE(pdu.length + 1, 4); mbap[6] = unit;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending = null; reject(Object.assign(new Error('timeout'), { timeout: true })) }, timeout);
      pending = { tid, resolve: (r) => { clearTimeout(t); pending = null; resolve(r) }, reject: (e) => { clearTimeout(t); pending = null; reject(e) } };
      sock.write(Buffer.concat([mbap, pdu]));
    });
  }));
  return { request, close: () => { try { sock?.destroy() } catch {} sock = null }, label: `${host}:${port}` };
}

// Expected RTU response length for a read PDU (function code + byte count…).
function rtuExpected(resp) {
  if (resp.length < 2) return null;
  const fc = resp[1];
  if (fc & 0x80) return 5;
  if ([1, 2, 3, 4].includes(fc)) return resp.length >= 3 ? 3 + resp[2] + 2 : null;
  return null; // 0x2B: variable — wait for silence
}

async function rtuClient(portPath, { baud = 9600, parity = 'none', timeout = 300 } = {}) {
  let SerialPortMod;
  try { SerialPortMod = require('serialport') } catch { const e = new Error('The serialport package is not installed (Modbus scan module)'); e.needsModule = true; throw e }
  const SerialPort = SerialPortMod.SerialPort || SerialPortMod;
  const port = new SerialPort({ path: portPath, baudRate: baud, parity, dataBits: 8, stopBits: parity === 'none' ? 2 : 1, autoOpen: false });
  await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
  const charMs = (11 * 1000) / baud;
  let buf = Buffer.alloc(0), pending = null, queue = Promise.resolve(), silence = null;
  port.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (!pending) return;
    const want = rtuExpected(buf);
    clearTimeout(silence);
    if (want != null && buf.length >= want) pending.done();
    else silence = setTimeout(() => pending?.done(), Math.max(5, charMs * 4));
  });
  const request = (unit, pdu) => (queue = queue.catch(() => {}).then(() => new Promise((resolve, reject) => {
    buf = Buffer.alloc(0);
    const adu = Buffer.concat([Buffer.from([unit]), pdu, Buffer.alloc(2)]);
    adu.writeUInt16LE(crc16(adu.subarray(0, adu.length - 2)), adu.length - 2);
    const t = setTimeout(() => { pending = null; reject(Object.assign(new Error('timeout'), { timeout: true })) }, timeout + adu.length * charMs);
    pending = {
      done: () => {
        clearTimeout(t); clearTimeout(silence); pending = null;
        const f = buf;
        if (f.length < 4 || f[0] !== unit) return reject(Object.assign(new Error('no valid reply'), { timeout: true }));
        if (crc16(f.subarray(0, f.length - 2)) !== f.readUInt16LE(f.length - 2)) return reject(new Error('CRC error (wrong baud/parity, or bus noise)'));
        resolve(Buffer.from(f.subarray(1, f.length - 2)));
      },
    };
    // 3.5 character times of silence before a frame
    setTimeout(() => port.write(adu), Math.ceil(charMs * 4));
  })));
  return { request, close: () => new Promise((r) => port.close(() => r())), label: `${portPath} @ ${baud} ${parity}` };
}

// ── Read functions ─────────────────────────────────────────────────────────

async function read(client, unit, fc, address, count) {
  if (![1, 2, 3, 4].includes(fc)) throw new Error('Only read functions 1–4 are allowed');
  const pdu = Buffer.alloc(5);
  pdu[0] = fc; pdu.writeUInt16BE(address, 1); pdu.writeUInt16BE(count, 3);
  const r = await client.request(unit, pdu);
  if (r[0] === (fc | 0x80)) throw new ModbusError(r[1]);
  if (r[0] !== fc) throw new Error(`Unexpected function ${r[0]}`);
  const data = r.subarray(2, 2 + r[1]);
  if (fc <= 2) return [...Array(count)].map((_, i) => (data[i >> 3] >> (i & 7)) & 1);
  const regs = [];
  for (let i = 0; i < count && i * 2 + 1 < data.length; i++) regs.push(data.readUInt16BE(i * 2));
  return regs;
}

// FC 0x2B / MEI 0x0E — basic device identification (vendor, product code,
// revision), following the "more follows" chain.
async function deviceId(client, unit) {
  const out = {};
  let next = 0;
  for (let guard = 0; guard < 4; guard++) {
    const r = await client.request(unit, Buffer.from([0x2b, 0x0e, 0x01, next]));
    if (r[0] === 0xab) throw new ModbusError(r[1]);
    if (r[0] !== 0x2b || r[1] !== 0x0e) throw new Error('bad device id reply');
    const more = r[4], nextId = r[5], n = r[6];
    let o = 7;
    for (let i = 0; i < n && o + 2 <= r.length; i++) {
      const id = r[o], len = r[o + 1];
      out[id] = r.toString('latin1', o + 2, o + 2 + len).replace(/\0+$/, '').trim();
      o += 2 + len;
    }
    if (more !== 0xff) break;
    next = nextId;
  }
  const names = { 0: 'vendor', 1: 'product', 2: 'revision', 3: 'url', 4: 'productName', 5: 'model', 6: 'application' };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [names[k] || `object${k}`, v]));
}

// ── Decoding helpers ───────────────────────────────────────────────────────

const regsToString = (regs) => Buffer.from(regs.flatMap((r) => [r >> 8, r & 0xff])).toString('latin1').replace(/\0.*$/s, '').trim();
const f32 = (hi, lo) => { const b = Buffer.alloc(4); b.writeUInt16BE(hi, 0); b.writeUInt16BE(lo, 2); return b.readFloatBE(0) };
const i16 = (v) => (v > 0x7fff ? v - 0x10000 : v);
const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// A float32 reading only when it looks like a plausible measurement.
const sensibleFloat = (x) => (Number.isFinite(x) && (x === 0 || (Math.abs(x) >= 1e-4 && Math.abs(x) < 1e9)) ? r2(x, 4) : null);

// Every reasonable reading of a register block, for the explorer.
function interpret(regs) {
  return regs.map((v, i) => ({
    u16: v, i16: i16(v), hex: v.toString(16).padStart(4, '0'),
    ascii: [v >> 8, v & 0xff].map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '·')).join(''),
    u32: i + 1 < regs.length ? (v * 65536 + regs[i + 1]) >>> 0 : null,
    f32: i + 1 < regs.length ? sensibleFloat(f32(v, regs[i + 1])) : null,
  }));
}

// ── Identification ─────────────────────────────────────────────────────────

const SUNSPEC_BASES = [40000, 0, 50000];

async function sunspec(client, unit) {
  for (const base of SUNSPEC_BASES) {
    let regs;
    try { regs = await read(client, unit, 3, base, 2) } catch { continue }
    if (regs[0] !== 0x5375 || regs[1] !== 0x6e53) continue; // "SunS"
    const out = { base, models: [] };
    let addr = base + 2;
    for (let n = 0; n < 20; n++) {
      const [id, len] = await read(client, unit, 3, addr, 2);
      if (id === 0xffff || len == null) break;
      out.models.push(id);
      if (id === 1) { // common model
        const c = await read(client, unit, 3, addr + 2, Math.min(len, 66));
        out.manufacturer = regsToString(c.slice(0, 16)); out.model = regsToString(c.slice(16, 32));
        out.version = regsToString(c.slice(40, 48)); out.serial = regsToString(c.slice(48, 64));
      }
      addr += 2 + len;
    }
    return out;
  }
  return null;
}

// Victron GX (Cerbo/Venus): unit 100 = com.victronenergy.system
async function victronGx(client, unit) {
  if (unit !== 100) return null;
  const s = await read(client, unit, 3, 800, 6);
  const serial = regsToString(s);
  if (!/^[0-9a-f]{12}$/i.test(serial)) return null;
  const b = await read(client, unit, 3, 840, 4).catch(() => null);
  return {
    serial,
    values: b ? [
      { label: 'Battery voltage', value: r2(b[0] / 10, 1), unit: 'V' },
      { label: 'Battery current', value: r2(i16(b[1]) / 10, 1), unit: 'A' },
      { label: 'Battery power', value: i16(b[2]), unit: 'W' },
      { label: 'State of charge', value: b[3], unit: '%' },
    ] : [],
  };
}

// Eastron SDM-style meters: input registers, float32 — voltage at 0, frequency at 0x46
async function energyMeter(client, unit) {
  const v = await read(client, unit, 4, 0, 2).catch(() => null);
  if (!v) return null;
  const volts = f32(v[0], v[1]);
  if (!(volts > 80 && volts < 300)) return null;
  const f = await read(client, unit, 4, 0x46, 2).catch(() => null);
  const hz = f ? f32(f[0], f[1]) : null;
  if (hz != null && !(hz > 45 && hz < 65)) return null;
  const p = await read(client, unit, 4, 0x0c, 2).catch(() => null);
  const e = await read(client, unit, 4, 0x156, 2).catch(() => null);
  return {
    values: [
      { label: 'Voltage L1', value: r2(volts, 1), unit: 'V' },
      hz != null && { label: 'Frequency', value: r2(hz, 2), unit: 'Hz' },
      p && { label: 'Active power L1', value: r2(f32(p[0], p[1]), 0), unit: 'W' },
      e && { label: 'Total energy', value: r2(f32(e[0], e[1]), 1), unit: 'kWh' },
    ].filter(Boolean),
  };
}

// Huawei SUN2000 inverters: model string at holding register 30000
async function huawei(client, unit) {
  const m = await read(client, unit, 3, 30000, 15).catch(() => null);
  if (!m) return null;
  const model = regsToString(m);
  if (!/^SUN\d{3,4}/i.test(model)) return null;
  const sn = await read(client, unit, 3, 30015, 10).catch(() => null);
  return { model, serial: sn ? regsToString(sn) : null };
}

async function identify(client, unit) {
  const id = { unit, kind: 'unknown', label: null, details: {}, values: [] };
  try {
    const d = await deviceId(client, unit);
    if (Object.keys(d).length) { id.details.deviceId = d; id.label = [d.vendor, d.product || d.productName || d.model].filter(Boolean).join(' '); id.kind = 'device-id' }
  } catch {}
  try {
    const ss = await sunspec(client, unit);
    if (ss) { id.kind = 'sunspec'; id.details.sunspec = ss; id.label = [ss.manufacturer, ss.model].filter(Boolean).join(' ') || id.label || 'SunSpec device' }
  } catch {}
  if (id.kind === 'unknown' || id.kind === 'device-id') {
    try { const v = await victronGx(client, unit); if (v) { id.kind = 'victron-gx'; id.label = `Victron GX (${v.serial})`; id.values = v.values } } catch {}
  }
  if (id.kind === 'unknown') {
    try { const h = await huawei(client, unit); if (h) { id.kind = 'huawei'; id.label = `Huawei ${h.model}`; id.details.huawei = h } } catch {}
  }
  if (id.kind === 'unknown') {
    try { const m = await energyMeter(client, unit); if (m) { id.kind = 'energy-meter'; id.label = 'Energy meter (Eastron SDM-style)'; id.values = m.values } } catch {}
  }
  return id;
}

// Is a unit there? Any reply — data or an exception other than the gateway
// "no device" ones — means yes.
async function probeUnit(client, unit) {
  for (const [fc, addr] of [[3, 0], [4, 0], [3, 40000]]) {
    try { await read(client, unit, fc, addr, 1); return { present: true, fc, addr } }
    catch (e) {
      if (e.exception && (e.code === 10 || e.code === 11)) return { present: false, gateway: true };
      if (e.exception) return { present: true, exception: e.code };
      if (e.timeout) return { present: false };
      throw e;
    }
  }
  return { present: false };
}

// ── Discovery ──────────────────────────────────────────────────────────────

function localSubnets() {
  const out = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || /^(100\.|169\.254\.|172\.(1[7-9]|2\d|3[01])\.)/.test(a.address) || /^(docker|br-|veth|tailscale)/.test(iface)) continue;
      out.push({ iface, address: a.address, cidr: `${a.address.split('.').slice(0, 3).join('.')}.0/24` });
    }
  }
  return out;
}

function tcpOpen(host, port, timeout = 600) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    const done = (ok) => { clearTimeout(t); s.destroy(); resolve(ok) };
    const t = setTimeout(() => done(false), timeout);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function sweep(cidr, port) {
  const m = /^(\d+\.\d+\.\d+)\.\d+\/24$/.exec(cidr || '');
  if (!m) throw new Error('Only /24 networks are swept');
  const ips = [...Array(254)].map((_, i) => `${m[1]}.${i + 1}`);
  const open = [];
  let next = 0;
  await Promise.all([...Array(64)].map(async () => {
    while (next < ips.length) { const ip = ips[next++]; if (await tcpOpen(ip, port)) open.push(ip) }
  }));
  return open.sort((a, b) => Number(a.split('.')[3]) - Number(b.split('.')[3]));
}

function serialPorts() {
  const out = [], seen = new Set();
  try {
    for (const f of fs.readdirSync('/dev/serial/by-id')) {
      const real = fs.realpathSync(path.join('/dev/serial/by-id', f));
      seen.add(real);
      out.push({ path: path.join('/dev/serial/by-id', f), device: real, label: f.replace(/^usb-/, '').replace(/-if\d+.*$/, '').replace(/_/g, ' '), rs485Likely: /485|ftdi|ch34|cp210|pl2303|modbus|waveshare/i.test(f) });
    }
  } catch {}
  try {
    for (const f of fs.readdirSync('/dev').filter((x) => /^tty(USB|ACM)\d+$/.test(x))) {
      if (!seen.has(`/dev/${f}`)) out.push({ path: `/dev/${f}`, device: `/dev/${f}`, label: f, rs485Likely: /USB/.test(f) });
    }
  } catch {}
  return out;
}

function parseUnits(spec, fallback) {
  if (!spec) return fallback;
  const set = new Set();
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    for (let u = Math.max(0, Math.min(a, b)); u <= Math.min(255, Math.max(a, b)); u++) set.add(u);
  }
  return [...set].slice(0, 256);
}

const TCP_UNITS = [1, 2, 3, 100, 126, 247, 255, 0];

// mode 'tcp': { hosts?: [ip], cidr?, port=502, units? }  ·  mode 'rtu': { serialPort, baud, parity, units? }
async function scan(opts = {}, onProgress = () => {}) {
  const t0 = Date.now();
  const devices = [];
  if (opts.mode === 'rtu') {
    if (!/^\/dev\/[\w./:+-]+$/.test(opts.serialPort || '')) throw new Error('Pick a serial port');
    const client = await rtuClient(opts.serialPort, { baud: Number(opts.baud) || 9600, parity: ['none', 'even', 'odd'].includes(opts.parity) ? opts.parity : 'none', timeout: Number(opts.timeout) || 200 });
    try {
      const units = parseUnits(opts.units, [...Array(247)].map((_, i) => i + 1)).filter((u) => u >= 1 && u <= 247);
      for (const unit of units) {
        onProgress({ unit });
        const p = await probeUnit(client, unit).catch(() => ({ present: false }));
        if (p.present) devices.push({ transport: 'rtu', target: client.label, ...(await identify(client, unit)), probe: p });
      }
    } finally { await client.close() }
    return { mode: 'rtu', target: client.label, durationMs: Date.now() - t0, hosts: [], devices };
  }
  const port = Number(opts.port) || 502;
  let hosts = (opts.hosts || []).filter((h) => /^[\w.-]+$/.test(h));
  if (!hosts.length) {
    const nets = opts.cidr ? [{ cidr: opts.cidr }] : localSubnets();
    for (const n of nets) hosts.push(...(await sweep(n.cidr, port)));
  }
  const units = parseUnits(opts.units, TCP_UNITS);
  for (const host of hosts) {
    const client = tcpClient(host, port, { timeout: Number(opts.timeout) || 1200 });
    try {
      for (const unit of units) {
        onProgress({ host, unit });
        let p;
        try { p = await probeUnit(client, unit) } catch (e) { if (devices.every((d) => d.host !== host)) devices.push({ transport: 'tcp', host, port, unit: null, kind: 'error', label: e.message, values: [] }); break }
        if (p.present) devices.push({ transport: 'tcp', host, port, ...(await identify(client, unit)), probe: p });
      }
    } finally { client.close() }
  }
  return { mode: 'tcp', port, durationMs: Date.now() - t0, hosts, devices };
}

// Register explorer: { mode, host, port, serialPort, baud, parity, unit, fc, address, count }
async function readRange(opts) {
  const fc = Number(opts.fc) || 3, address = Number(opts.address) || 0, count = Math.min(Math.max(Number(opts.count) || 10, 1), 125);
  const unit = Number(opts.unit);
  if (!(unit >= 0 && unit <= 255)) throw new Error('Unit ID must be 0–255');
  const client = opts.mode === 'rtu'
    ? await rtuClient(opts.serialPort, { baud: Number(opts.baud) || 9600, parity: opts.parity || 'none' })
    : tcpClient(opts.host, Number(opts.port) || 502);
  try {
    const regs = await read(client, unit, fc, address, fc <= 2 ? Math.min(count * 8, 2000) : count);
    return { fc, address, count: regs.length, values: fc <= 2 ? regs : interpret(regs) };
  } finally { await client.close() }
}

module.exports = { scan, readRange, read, deviceId, identify, probeUnit, tcpClient, crc16, interpret, parseUnits, localSubnets, serialPorts, EXCEPTIONS };
