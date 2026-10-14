#!/usr/bin/env node
'use strict';

// Minimal Gree Wi-Fi AC stand-in (local UDP protocol) for testing
// src/gree-client.js: scan, bind (generic key → device key), status, cmd —
// AES-128-ECB, or AES-128-GCM with `encryption: 'gcm'`.
//
//   node scripts/gree-simulator.js [port=7000] [ecb|gcm]
// then config.gree = { devices: [{ host: '127.0.0.1:7000' }] }

const dgram = require('dgram');
const { encrypt, decrypt } = require('../src/gree-client');

const GENERIC = { ecb: 'a3K8Bx%2r8Y7#xDh', gcm: '{yxAHAY_Lm6pbC/<' };

function startSimulator({ port = 7000, encryption = 'ecb', mac = 'f4911e0a1b2c', ver = 'V1.2.1' } = {}) {
  const enc = encryption;
  const devKey = 'Ab12Cd34Ef56Gh78';
  const calls = [];
  const state = { Pow: 1, Mod: 1, SetTem: 24, TemUn: 0, WdSpd: 0, Tur: 0, Quiet: 0, SwUpDn: 0, TemSen: 66 };
  const s = dgram.createSocket('udp4');
  s.on('message', (raw, rinfo) => {
    let m; try { m = JSON.parse(raw.toString()) } catch { return }
    const reply = (obj) => s.send(Buffer.from(JSON.stringify(obj)), rinfo.port, rinfo.address);
    if (m.t === 'scan') {
      calls.push({ t: 'scan' });
      return reply({ t: 'pack', i: 1, uid: 0, cid: mac, tcid: '', ...encrypt({ t: 'dev', cid: mac, bc: 'gree', brand: 'gree', catalog: 'gree', mac, mid: '10001', model: 'gree', name: 'Bedroom AC', ver, lock: 0 }, GENERIC[enc], enc) });
    }
    if (m.t !== 'pack') return;
    const key = m.i === 1 ? GENERIC[enc] : devKey;
    let p; try { p = decrypt(m, key, enc) } catch { return } // wrong key / cipher: a real unit stays silent
    calls.push(p);
    if (p.t === 'bind') return reply({ t: 'pack', i: 1, uid: 0, cid: mac, tcid: 'app', ...encrypt({ t: 'bindok', mac, key: devKey, r: 200 }, GENERIC[enc], enc) });
    if (p.t === 'status') return reply({ t: 'pack', i: 0, uid: 0, cid: mac, tcid: 'app', ...encrypt({ t: 'dat', mac, r: 200, cols: p.cols, dat: p.cols.map((c) => state[c] ?? 0) }, devKey, enc) });
    if (p.t === 'cmd') {
      p.opt.forEach((k, i) => { state[k] = p.p[i] });
      return reply({ t: 'pack', i: 0, uid: 0, cid: mac, tcid: 'app', ...encrypt({ t: 'res', mac, r: 200, opt: p.opt, p: p.p, val: p.p }, devKey, enc) });
    }
  });
  return new Promise((resolve) => s.bind(port, '127.0.0.1', () => resolve({ port: s.address().port, mac, devKey, state, calls, close: () => new Promise((r) => s.close(r)) })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 7000;
  startSimulator({ port, encryption: process.argv[3] || 'ecb' }).then((x) => console.log(`Gree AC simulator on udp 127.0.0.1:${x.port} (mac ${x.mac})`));
}

module.exports = { startSimulator };
