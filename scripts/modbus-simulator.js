#!/usr/bin/env node
'use strict';

// Modbus TCP simulator for the Modbus scan tool (src/lsh-modbus-scan.js).
//   node scripts/modbus-simulator.js [port=5020]
// Units:
//   1   SunSpec PV inverter (holding 40000: "SunS", common model 1, model 103)
//       + FC 0x2B device identification
//   2   Eastron SDM630-style energy meter (input registers, float32)
//   3   answers every read with exception 2 (present, unknown map)
//   100 Victron GX (com.victronenergy.system: serial @800, battery @840)
//   other unit IDs: no reply (like a gateway with nothing behind it)

const net = require('net');

function strRegs(s, n) {
  const b = Buffer.alloc(n * 2); b.write(s, 'latin1');
  return [...Array(n)].map((_, i) => b.readUInt16BE(i * 2));
}
function f32Regs(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); return [b.readUInt16BE(0), b.readUInt16BE(2)] }

function buildUnits() {
  const units = {};
  // 1 — SunSpec inverter
  const ss = new Map();
  const put = (map, addr, regs) => regs.forEach((v, i) => map.set(addr + i, v & 0xffff));
  put(ss, 40000, [0x5375, 0x6e53]);
  put(ss, 40002, [1, 66]);
  const common = [...strRegs('Fronius', 16), ...strRegs('Symo 8.2-3-M', 16), ...strRegs('', 8), ...strRegs('1.12.3', 8), ...strRegs('31234567', 16), 1, 0];
  put(ss, 40004, common);
  put(ss, 40070, [103, 50]);
  put(ss, 40072, [...Array(50)].map((_, i) => (i === 12 ? 4210 : i)));
  put(ss, 40122, [0xffff, 0]);
  units[1] = { holding: ss, input: new Map(), deviceId: { 0: 'Fronius', 1: 'Symo 8.2-3-M', 2: '1.12.3' } };
  // 2 — energy meter
  const em = new Map();
  put(em, 0, f32Regs(231.4)); put(em, 0x0c, f32Regs(1834)); put(em, 0x46, f32Regs(50.01)); put(em, 0x156, f32Regs(15234.7));
  units[2] = { holding: new Map(), input: em };
  units[3] = { exceptionAll: 2 };
  // 100 — Victron GX
  const gx = new Map();
  put(gx, 800, strRegs('c0619ab1c2d3', 6));
  put(gx, 840, [532, (-123) & 0xffff, (-655) & 0xffff, 87]);
  units[100] = { holding: gx, input: new Map() };
  return units;
}

function handle(units, unit, pdu) {
  const u = units[unit];
  if (!u) return null; // no reply
  const fc = pdu[0];
  const exc = (code) => Buffer.from([fc | 0x80, code]);
  if (u.exceptionAll) return exc(u.exceptionAll);
  if (fc === 0x2b && pdu[1] === 0x0e) {
    if (!u.deviceId) return exc(1);
    const objs = Object.entries(u.deviceId);
    const parts = objs.flatMap(([id, s]) => [Buffer.from([Number(id), s.length]), Buffer.from(s, 'latin1')]);
    return Buffer.concat([Buffer.from([0x2b, 0x0e, pdu[2], 0x01, 0x00, 0x00, objs.length]), ...parts]);
  }
  if (fc === 3 || fc === 4) {
    const addr = pdu.readUInt16BE(1), count = pdu.readUInt16BE(3);
    if (count < 1 || count > 125) return exc(3);
    const map = fc === 3 ? u.holding : u.input;
    const regs = [];
    for (let i = 0; i < count; i++) {
      if (!map.has(addr + i)) return exc(2);
      regs.push(map.get(addr + i));
    }
    const out = Buffer.alloc(2 + count * 2);
    out[0] = fc; out[1] = count * 2;
    regs.forEach((v, i) => out.writeUInt16BE(v, 2 + i * 2));
    return out;
  }
  return exc(1);
}

function createServer() {
  const units = buildUnits();
  return net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) break;
        const frame = buf.subarray(0, 6 + len); buf = buf.subarray(6 + len);
        const resp = handle(units, frame[6], frame.subarray(7));
        if (!resp) continue;
        const mbap = Buffer.alloc(7);
        frame.copy(mbap, 0, 0, 4); mbap.writeUInt16BE(resp.length + 1, 4); mbap[6] = frame[6];
        sock.write(Buffer.concat([mbap, resp]));
      }
    });
    sock.on('error', () => {});
  });
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 5020;
  createServer().listen(port, () => console.log(`Modbus TCP simulator on :${port} — units 1 (SunSpec), 2 (meter), 3 (exception), 100 (Victron GX)`));
}

module.exports = { createServer };
