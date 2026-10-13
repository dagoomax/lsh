#!/usr/bin/env node
'use strict';

// Fake Zehnder units for the three interfaces src/zehnder-client.js speaks:
//   startLanC({ port, pin })   ComfoConnect LAN C gateway (UDP discovery + TCP, same port)
//   startPro({ port })         ComfoConnect Pro, Modbus TCP
//   startCA350({ port })       ComfoAir 350 behind a serial-to-TCP bridge
//   node scripts/zehnder-simulator.js   → LAN C on 56747, Pro on 5020, CA350 on 5021

const net   = require('net');
const dgram = require('dgram');
const { _internal: L } = require('../src/zehnder/lanc');
const { _internal: C } = require('../src/zehnder/ca350');
const { pbEncode, pbDecode, frame, unframe, OP } = L;

// ── LAN C ──────────────────────────────────────────────────────────────────
function startLanC({ port = 56747, pin = 0, uuid = '0000000000251010800170b3d54264b4' } = {}) {
  const sim = {
    uuid, pin, registered: new Set(), rmi: [], sessions: 0,
    state: { speed: 2, mode: 255, profile: 0, boost: 0, away: 0, bypassMode: 0 },
    pdo: { 117: 31, 118: 33, 119: 160, 120: 158, 121: 1520, 122: 1490, 128: 24, 129: 98, 130: 512, 146: 0, 192: 87,
      212: 215, 221: 196, 227: 0, 274: 228, 275: 61, 276: 32, 290: 48, 291: 81, 292: 77, 294: 41 },
    types: {},
  };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0), client = null, session = false;
    sim.sock = sock;
    const send = (type, msg = Buffer.alloc(0), extra = {}) => {
      const op = pbEncode([[1, 'v', type], [2, 'v', extra.result || undefined], [3, 'b', extra.desc], [4, 'v', extra.ref]]);
      if (!sock.destroyed) sock.write(frame(Buffer.from(sim.uuid, 'hex'), client || Buffer.alloc(16), op, msg));
    };
    const pdoValue = (pdid) => {
      const st = sim.state;
      const v = pdid === 65 ? st.speed : pdid === 56 ? st.mode : pdid === 67 ? st.profile : sim.pdo[pdid];
      const t = sim.types[pdid] ?? 1;
      const b = Buffer.alloc(t === 1 || t === 5 || t === 0 ? 1 : t === 3 ? 4 : 2);
      if (b.length === 1) b.writeUInt8(v & 0xff); else if (b.length === 2) (t === 6 ? b.writeInt16LE(v) : b.writeUInt16LE(v)); else b.writeUInt32LE(v);
      return b;
    };
    sim.notify = (pdid) => send(OP.CnRpdoNotification, pbEncode([[1, 'v', pdid], [2, 'b', pdoValue(pdid)]]));
    sim.alarm = (bits, sw = 3222278145) => {
      const errs = Buffer.alloc(16);
      for (const b of bits) errs[b >> 3] |= 1 << (b & 7);
      send(OP.CnAlarmNotification, pbEncode([[1, 'v', 1], [5, 'v', sw], [6, 'b', errs], [8, 'v', 1]]));
    };
    sim.takeover = () => send(OP.CloseSessionRequest);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
        const len = buf.readUInt32BE(0);
        const { src, op, msg } = unframe(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
        client = Buffer.from(src);
        const type = op[1], ref = op[4], m = pbDecode(msg);
        const id = client.toString('hex');
        if (type === OP.StartSessionRequest) {
          if (!sim.registered.has(id)) { send(53, Buffer.alloc(0), { ref, result: 5, desc: 'not registered' }); continue }
          session = true; sim.sessions++;
          send(53, pbEncode([[1, 'b', 'LSH']]), { ref });
          send(OP.CnNodeNotification, pbEncode([[1, 'v', 1], [2, 'v', 1], [3, 'v', 1], [4, 'v', 2]]));
        } else if (type === OP.RegisterAppRequest) {
          if (Number(m[2] || 0) !== Number(sim.pin)) { send(52, Buffer.alloc(0), { ref, result: 5 }); continue }
          sim.registered.add(Buffer.from(m[1]).toString('hex'));
          send(52, Buffer.alloc(0), { ref });
        } else if (!session) {
          send(type + 1, Buffer.alloc(0), { ref, result: 5 });
        } else if (type === OP.CnRpdoRequest) {
          sim.types[m[1]] = m[3];
          send(OP.CnRpdoConfirm, Buffer.alloc(0), { ref });
          setImmediate(() => sim.notify(m[1]));
        } else if (type === OP.CnNodeRequest) {
          send(OP.CnNodeNotification, pbEncode([[1, 'v', 1], [2, 'v', 1], [3, 'v', 1], [4, 'v', 2]]));
        } else if (type === OP.CnTimeRequest) {
          send(OP.CnTimeConfirm, pbEncode([[1, 'v', 12345]]), { ref });
        } else if (type === OP.VersionRequest) {
          send(OP.VersionConfirm, pbEncode([[1, 'v', 1049604], [2, 'b', 'DEM0116372001'], [3, 'v', 268451840]]), { ref });
        } else if (type === OP.CnRmiRequest) {
          const r = [...m[2]];
          sim.rmi.push(Buffer.from(r).toString('hex'));
          const st = sim.state, [cmd, unit, sub, prop] = r, last = r[r.length - 1];
          let reply = Buffer.alloc(0);
          if (cmd === 0x84 && unit === 0x15) {
            if (sub === 1 && prop === 1) { st.speed = last; st.mode = 1; setImmediate(() => { sim.notify(65); sim.notify(56) }) }
            if (sub === 8) { st.mode = 1; setImmediate(() => sim.notify(56)) }
            if (sub === 1 && prop === 6) { st.boost = 1; st.speed = 3; setImmediate(() => sim.notify(65)) }
            if (sub === 1 && prop === 0x0b) { st.away = 1; st.speed = 0; setImmediate(() => sim.notify(65)) }
            if (sub === 2) st.bypassMode = last;
            if (sub === 3) { st.profile = last; setImmediate(() => sim.notify(67)) }
          } else if (cmd === 0x85 && unit === 0x15) {
            if (sub === 8) { st.mode = 255; setImmediate(() => sim.notify(56)) }
            if (sub === 1 && prop === 6) st.boost = 0;
            if (sub === 1 && prop === 0x0b) { st.away = 0; st.speed = 1; setImmediate(() => sim.notify(65)) }
            if (sub === 2) st.bypassMode = 0;
          } else if (cmd === 0x83 && unit === 0x15) {
            if (sub === 1 && prop === 6) reply = Buffer.from([st.boost, 0, 0, 0, 0, 0x58, 2, 0, 0, 0, 0, 0, 0, 3]);
            else if (sub === 1 && prop === 0x0b) reply = Buffer.from([st.away, 0, 0, 0, 0, 0xb0, 4, 0, 0, 0, 0, 0, 0, 0]);
            else if (sub === 2) reply = Buffer.from([st.bypassMode ? 1 : 0, 0, 0, 0, 0, 8, 7, 0, 0, 0, 0, 0, 0, st.bypassMode]);
          }
          send(OP.CnRmiResponse, pbEncode([[2, 'b', reply]]), { ref });
        } else if (type === OP.CloseSessionRequest) {
          sock.end();
        }
      }
    });
    sock.on('error', () => {});
  });
  const udp = dgram.createSocket('udp4');
  udp.on('message', (m, rinfo) => {
    if (m.length !== 2 || m[0] !== 0x0a) return;
    const resp = pbEncode([[1, 'b', '127.0.0.1'], [2, 'b', Buffer.from(sim.uuid, 'hex')], [3, 'v', 1], [4, 'v', 0]]);
    udp.send(pbEncode([[2, 'b', resp]]), rinfo.port, rinfo.address);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    sim.port = server.address().port;
    udp.bind(sim.port, '127.0.0.1', () => {
      sim.close = () => new Promise((r) => { try { udp.close() } catch {} sim.sock?.destroy(); server.close(() => r()) });
      resolve(sim);
    });
  }));
}

// ── ComfoConnect Pro (Modbus TCP) ───────────────────────────────────────────
function startPro({ port = 5020 } = {}) {
  const sim = {
    writes: [],
    ir: Object.assign(new Array(26).fill(0), { 6: 155, 7: 215, 8: 226, 9: 58, 10: 0xffec /* -2.0 */, 11: 194, 12: 0, 13: 47, 14: 80, 15: 76, 16: 40, 17: 612, 25: 63 }),
    di: [false, false, false, false],
    coils: [false, false, false, false, false, true, false, false, true],
    hr: [2, 0, 0, 210, 0],
  };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7 && buf.length >= 6 + buf.readUInt16BE(4)) {
        const len = buf.readUInt16BE(4), head = buf.subarray(0, 7), pdu = buf.subarray(7, 6 + len);
        buf = buf.subarray(6 + len);
        const fc = pdu[0], addr = pdu.readUInt16BE(1), val = pdu.readUInt16BE(3);
        let out;
        const bits = (arr) => { const n = Math.ceil(val / 8), b = Buffer.alloc(2 + n); b[0] = fc; b[1] = n; for (let i = 0; i < val; i++) if (arr[addr + i]) b[2 + (i >> 3)] |= 1 << (i & 7); return b };
        const regs = (arr) => { const b = Buffer.alloc(2 + val * 2); b[0] = fc; b[1] = val * 2; for (let i = 0; i < val; i++) b.writeUInt16BE((arr[addr + i] ?? 0) & 0xffff, 2 + i * 2); return b };
        if (fc === 1) out = bits(sim.coils);
        else if (fc === 2) out = bits(sim.di);
        else if (fc === 3) out = regs(sim.hr);
        else if (fc === 4) out = regs(sim.ir);
        else if (fc === 5) {
          const on = val === 0xff00;
          sim.writes.push(`coil${addr}=${+on}`);
          if (addr === 0) sim.di[0] = false;
          else if (addr >= 1 && addr <= 4) { if (on) { sim.hr[0] = addr - 1; sim.coils[7] = addr === 1 } }
          else { sim.coils[addr] = on; if (addr === 7) sim.hr[0] = on ? 0 : 1 }
          out = Buffer.from(pdu);
        } else if (fc === 6) {
          sim.writes.push(`hr${addr}=${val}`);
          if (addr === 0 && val > 3) out = Buffer.from([0x86, 3]);
          else { sim.hr[addr] = val; if (addr === 0) sim.coils[7] = val === 0; out = Buffer.from(pdu) }
        } else out = Buffer.from([fc | 0x80, 1]);
        const h = Buffer.from(head); h.writeUInt16BE(out.length + 1, 4);
        sock.write(Buffer.concat([h, out]));
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    sim.port = server.address().port;
    sim.close = () => new Promise((r) => server.close(() => r()));
    resolve(sim);
  }));
}

// ── ComfoAir 350 (RS232 behind a TCP bridge) ───────────────────────────────
function startCA350({ port = 5021 } = {}) {
  const sim = { level: 3, comfort: 21.5, errorsA: 0, filter: 0, sets: [], silent: false };
  const tb = (c) => Math.round((c + 20) * 2);
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      const { items, rest } = C.parse(Buffer.concat([buf, d]));
      buf = rest;
      for (const it of items) {
        if (it.ack || !it.ok || sim.silent) continue;
        sock.write(Buffer.from([0x07, 0xf3]));
        const reply = (data) => sock.write(C.encode(it.cmd + 1, data));
        switch (it.cmd) {
          case 0xcd: reply([15, 35, 50, 15, 35, 50, sim.level * 15, sim.level * 15 + 2, sim.level, 1, 70, 70, 0, 0]); break;
          case 0xd1: reply([tb(sim.comfort), tb(3.5), tb(19), tb(22.5), tb(6), 0x0f, 0, 0, 0]); break;
          case 0x0b: { const r = Math.round(1875000 / 1500); reply([45, 47, r >> 8, r & 0xff, r >> 8, r & 0xff]); break }
          case 0x0d: reply([0, 1, 0, 0]); break;
          case 0xd9: reply([sim.errorsA, 0, 0, 0, 0, 0, 0, 0, sim.filter, 0, 0, 0, 0, 0, 0, 0, 0]); break;
          case 0x99: sim.sets.push(`level=${it.data[0]}`); if (it.data[0] >= 1 && it.data[0] <= 4) sim.level = it.data[0]; break;
          case 0xd3: sim.sets.push(`comfort=${it.data[0]}`); sim.comfort = it.data[0] / 2 - 20; break;
          case 0xdb: sim.sets.push(`reset=${[...it.data].join('')}`); if (it.data[0]) sim.errorsA = 0; if (it.data[3]) sim.filter = 0; break;
          case 0x9b: break;
          default: break;
        }
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    sim.port = server.address().port;
    sim.close = () => new Promise((r) => server.close(() => r()));
    resolve(sim);
  }));
}

if (require.main === module) {
  (async () => {
    const a = await startLanC({ port: 56747 }); console.log(`LAN C gateway (PIN 0000) on 127.0.0.1:${a.port}`);
    const b = await startPro({ port: 5020 }); console.log(`ComfoConnect Pro (Modbus TCP) on 127.0.0.1:${b.port}`);
    const c = await startCA350({ port: 5021 }); console.log(`ComfoAir 350 serial bridge on 127.0.0.1:${c.port}`);
  })();
}

module.exports = { startLanC, startPro, startCA350 };
