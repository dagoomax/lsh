#!/usr/bin/env node
'use strict';

// Minimal Helvar router stand-in (HelvarNet ASCII over TCP) for testing
// src/helvar-client.js. One router, cluster 1 router 1, workgroup "Office":
//
//   subnet 1: @1.1.1.1 LED driver "Desk", @1.1.1.2 LED driver "Wall",
//             @1.1.1.3 312 Multisensor "Hall sensor" (light on subdevice 2),
//             @1.1.1.4 121 button panel (ignored by LSH)
//   groups:   1 "Office" (1.1.1.1 + 1.1.1.2), scenes 1.1 "Bright", 1.2 "Relax"
//
// Answers 100, 104, 105, 106, 107, 108, 109, 110, 150, 151, 152, 160, 161,
// 164, 165, 166; applies 11, 13, 14 and pushes them to every other client
// (Push Messages on). sim.motion(on), sim.pushScene(g, b, s) for tests.
//
//   node scripts/helvar-simulator.js [port=50000]
// then config.helvar = { host: '127.0.0.1', port: 50000, cluster: 1, router: 1 }

const net = require('net');

function startSimulator({ port = 50000 } = {}) {
  const devices = {
    '1.1.1.1': { type: 0x0601, name: 'Desk', level: 0, watts: 12, state: 0 },
    '1.1.1.2': { type: 0x0601, name: 'Wall', level: 0, watts: 8, state: 0x2 },
    '1.1.1.3': { type: 0x00312502, name: 'Hall sensor', pir: 0, lux: { 2: 42 } },
    '1.1.1.4': { type: 0x00121302, name: 'Door panel' },
  };
  const groups = { 1: { name: 'Office', members: ['1.1.1.1', '1.1.1.2'], last: 128 } };
  const scenes = { '1.1.1': ['Bright', 100], '1.1.2': ['Relax', 30] };
  const received = [];
  const clients = new Set();

  const reply = (sock, text, value) => sock.write(`?${text.slice(1)}=${value}#`);
  const error = (sock, text, code) => sock.write(`!${text.slice(1)}=${code}#`);
  const push = (from, text) => { for (const c of clients) if (c !== from) c.write(`${text}#`) };

  const handle = (sock, text) => {
    received.push(text);
    const m = /^>V:\d+,C:(\d+)((?:,[A-Z]:[^,@]*)*)(?:,?@([\d.]+))?$/.exec(text);
    if (!m) return error(sock, text, 16);
    const c = Number(m[1]);
    const p = Object.fromEntries((m[2] || '').split(',').filter(Boolean).map((x) => x.split(':')));
    const a = m[3];
    const dev = devices[a];
    const g = groups[p.G];
    switch (c) {
      case 107: return reply(sock, text, 'Office');
      case 108: return reply(sock, text, '@127.0.0.1');
      case 100: {
        if (a !== '1.1.1') return reply(sock, text, '');
        return reply(sock, text, Object.entries(devices).map(([k, d]) => `${d.type}@${k.split('.')[3]}`).join(','));
      }
      case 104: return dev ? reply(sock, text, dev.type) : error(sock, text, 11);
      case 106: return dev ? reply(sock, text, dev.name) : error(sock, text, 11);
      case 110: return dev ? reply(sock, text, dev.state || 0) : error(sock, text, 11);
      case 152: return dev?.level !== undefined ? reply(sock, text, dev.level) : error(sock, text, 12);
      case 160: return dev?.watts !== undefined ? reply(sock, text, dev.level ? dev.watts : 0) : error(sock, text, 12);
      case 151: return dev?.pir !== undefined ? reply(sock, text, dev.pir) : error(sock, text, 12);
      case 150: {
        const [base, sub] = [a.split('.').slice(0, 4).join('.'), a.split('.')[4]];
        const v = devices[base]?.lux?.[sub];
        return v !== undefined ? reply(sock, text, v) : error(sock, text, 12);
      }
      case 165: return reply(sock, text, Object.keys(groups).join(','));
      case 164: return g ? reply(sock, text, g.members.map((x) => `@${x}`).join(',')) : error(sock, text, 1);
      case 105: return g ? reply(sock, text, g.name) : error(sock, text, 1);
      case 109: return g ? reply(sock, text, g.last) : error(sock, text, 1);
      case 161: return g ? reply(sock, text, g.members.reduce((w, x) => w + (devices[x].level ? devices[x].watts : 0), 0)) : error(sock, text, 1);
      case 166: return reply(sock, text, Object.entries(scenes).map(([k, [n]]) => `@${k}:${n}`).join(''));
      case 11: {
        if (!g) return;
        const s = scenes[`${p.G}.${p.B}.${p.S}`];
        if (s) for (const x of g.members) devices[x].level = s[1];
        g.last = (Number(p.B) - 1) * 16 + Number(p.S);
        return push(sock, text);
      }
      case 13: {
        if (!g) return;
        for (const x of g.members) devices[x].level = Number(p.L);
        g.last = Number(p.L) === 0 ? 128 : 137 + Number(p.L);
        return push(sock, text);
      }
      case 14: {
        if (!dev) return;
        dev.level = Number(p.L);
        return push(sock, text);
      }
      default: return error(sock, text, 15);
    }
  };

  const server = net.createServer((sock) => {
    clients.add(sock);
    sock.setEncoding('latin1');
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('#')) >= 0) { const t = buf.slice(0, i); buf = buf.slice(i + 1); if (t) handle(sock, t) }
    });
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => {});
  });

  const sim = {
    devices, groups, received,
    motion: (on) => { devices['1.1.1.3'].pir = on ? 1 : 0 },
    // what a wall panel's scene recall looks like to a connected client
    pushScene: (gid, b, s) => {
      const g = groups[gid]; const sc = scenes[`${gid}.${b}.${s}`];
      if (sc) for (const x of g.members) devices[x].level = sc[1];
      g.last = (b - 1) * 16 + s;
      push(null, `>V:2,C:11,G:${gid},B:${b},S:${s},F:0`);
    },
    connected: () => clients.size,
  };
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(Object.assign(sim, {
    port: server.address().port,
    close: () => new Promise((r) => { for (const c of clients) c.destroy(); server.close(r) }),
  }))));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 50000;
  startSimulator({ port }).then((s) => console.log(`Helvar router simulator on 127.0.0.1:${s.port}`));
}

module.exports = { startSimulator };
