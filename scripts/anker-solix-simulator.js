#!/usr/bin/env node
'use strict';

// Minimal Anker SOLIX Modbus TCP stand-in for testing src/anker-solix-client.js:
// FC 3 / 4 reads, FC 6 / 16 writes, register layout from src/anker-solix-maps.json
// (Anker's official map). kind 'battery' = Solarbank Max (product code DMY6),
// 'plug' = Smart Plug Gen 2 (QNA). Unmapped registers read as 0.
//
//   node scripts/anker-solix-simulator.js [port=8894] [battery|plug]
// then config.ankerSolix = { devices: [{ host: '127.0.0.1:8894' }] }

const net = require('net');

function strRegs(s, count) { const b = Buffer.alloc(count * 2); b.write(s, 'utf8'); const r = []; for (let i = 0; i < count; i++) r.push(b.readUInt16BE(i * 2)); return r }
function i32(v) { const raw = v < 0 ? v + 0x100000000 : v; return [(raw >>> 16) & 0xffff, raw & 0xffff] }

function startSimulator({ port = 8894, kind = 'battery' } = {}) {
  const regs = new Map();
  const put = (a, words) => words.forEach((w, i) => regs.set(a + i, w));
  const writes = [];
  let sn;
  if (kind === 'battery') {
    sn = 'APCDMY60123456789';                    // 17 chars → code DMY6 = Solarbank Max
    put(32768, strRegs('A17C5', 5)); put(10100, strRegs(sn, 12)); put(10112, strRegs('v1.2.3', 6));
    put(10014, [57]);                            // SOC %
    put(10002, i32(840)); put(10004, i32(0));    // PV
    put(10008, i32(-500));                       // battery: −500 = charging 500 W
    put(10010, i32(310)); put(10012, i32(-30));  // load, grid: −30 = export
    put(10208, i32(310)); put(10018, [0, 12345]); put(10262, [0, 5000]); put(10264, [0, 4000]); put(10250, [0, 27000])
    put(10001, [1]); put(10036, i32(2400)); put(10038, i32(2400));
    put(10064, [0]); put(60000, [100]); put(60001, [10]); put(60002, [20]); put(60003, [1]);
  } else {
    sn = 'XYZQNA0123456789';                     // 16 chars → code QNA = Smart Plug Gen 2
    put(32768, strRegs('A17X8', 5)); put(30005, strRegs(sn, 12));
    put(30029, [1]); put(30030, [1234]); put(30031, [2301]); put(30032, [54]); put(30033, [0, 4567]); put(30037, [215]);
  }
  const server = net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7 && buf.length >= 6 + buf.readUInt16BE(4)) {
        const len = buf.readUInt16BE(4), f = buf.subarray(0, 6 + len); buf = buf.subarray(6 + len);
        const tid = f.readUInt16BE(0), unit = f[6], fc = f[7], a = f.readUInt16BE(8);
        const reply = (pdu) => { const h = Buffer.alloc(7); h.writeUInt16BE(tid, 0); h.writeUInt16BE(0, 2); h.writeUInt16BE(pdu.length + 1, 4); h[6] = unit; s.write(Buffer.concat([h, pdu])) };
        if (fc === 3 || fc === 4) {
          const n = f.readUInt16BE(10);
          if (kind === 'plug' && a < 30000 && a !== 32768) { reply(Buffer.from([fc | 0x80, 2])); continue } // illegal address
          const out = Buffer.alloc(2 + n * 2); out[0] = fc; out[1] = n * 2;
          for (let i = 0; i < n; i++) out.writeUInt16BE(regs.get(a + i) || 0, 2 + i * 2);
          reply(out);
        } else if (fc === 6) {
          const v = f.readUInt16BE(10); regs.set(a, v); writes.push([a, [v]]);
          if (kind === 'plug' && a === 30047) regs.set(30029, v);
          reply(f.subarray(7, 12));
        } else if (fc === 16) {
          const n = f.readUInt16BE(10), vals = []; for (let i = 0; i < n; i++) vals.push(f.readUInt16BE(13 + i * 2));
          vals.forEach((v, i) => regs.set(a + i, v)); writes.push([a, vals]);
          reply(f.subarray(7, 12));
        } else reply(Buffer.from([fc | 0x80, 1]));
      }
    });
    s.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, sn, regs, writes, close: () => new Promise((r) => server.close(r)) })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8894;
  startSimulator({ port, kind: process.argv[3] || 'battery' }).then((s) => console.log(`Anker SOLIX Modbus simulator on 127.0.0.1:${s.port} (sn ${s.sn})`));
}

module.exports = { startSimulator };
