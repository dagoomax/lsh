#!/usr/bin/env node
'use strict';

// Nuki Bridge (local HTTP API) + Nuki Web API stand-in, enough for
// src/nuki-client.js to discover, poll, control and manage keypad codes.
//
//   node scripts/nuki-simulator.js [port]       (default 8080)
//   config.nuki = { bridges: [{ host: '127.0.0.1', port: 8080, token: 'simtoken' }],
//                   webToken: 'webtoken', webBase: 'http://127.0.0.1:8080/web' }

const http = require('http');
const crypto = require('crypto');

function createSimulator({ token = 'simtoken', webToken = 'webtoken' } = {}) {
  const devices = [
    { nukiId: 0x1A2B3C4D, deviceType: 4, name: 'Drzwi wejściowe', state: 1, battery: 81, door: 2, keypadLow: false },
    { nukiId: 0x0BADCAFE, deviceType: 2, name: 'Opener brama', state: 1 },
  ];
  const auths = []; // keypad codes on the first lock
  const log = [];
  const smartlockId = (d) => Number((BigInt(d.deviceType) << 32n) | BigInt(d.nukiId));
  const stateOut = (d) => (d.deviceType === 2
    ? { mode: 2, state: d.state, stateName: d.state === 3 ? 'rto active' : 'online', batteryCritical: false }
    : { mode: 2, state: d.state, stateName: { 1: 'locked', 3: 'unlocked', 5: 'unlatched' }[d.state] || 'undefined', batteryCritical: false, batteryChargeState: d.battery, keypadBatteryCritical: d.keypadLow, doorsensorState: d.door, doorsensorStateName: d.door === 2 ? 'door closed' : 'door opened' });

  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const q = Object.fromEntries(url.searchParams);
      // ── Nuki Web API ──
      if (url.pathname.startsWith('/web/')) {
        if (req.headers.authorization !== `Bearer ${webToken}`) return json(res, 401, { detailMessage: 'unauthorized' });
        const p = url.pathname.slice(4);
        if (p === '/smartlock' && req.method === 'GET') {
          return json(res, 200, devices.map((d) => ({ smartlockId: smartlockId(d), type: d.deviceType, name: d.name, state: { ...stateOut(d), batteryCharge: d.battery, doorState: d.door } })));
        }
        let m = /^\/smartlock\/(\d+)\/action$/.exec(p);
        if (m && req.method === 'POST') {
          const d = devices.find((x) => smartlockId(x) === Number(m[1]));
          if (!d) return json(res, 404);
          const { action } = JSON.parse(body || '{}');
          log.push(`web:${d.nukiId}:${action}`);
          d.state = d.deviceType === 2 ? (action === 1 ? 3 : 1) : ({ 1: 3, 2: 1, 3: 5 }[action] ?? d.state);
          return json(res, 204);
        }
        m = /^\/smartlock\/(\d+)\/auth(?:\/([\w-]+))?$/.exec(p);
        if (m) {
          if (req.method === 'GET') return json(res, 200, auths);
          if (req.method === 'PUT') {
            const a = JSON.parse(body || '{}');
            if (!/^[1-9]{6}$/.test(String(a.code)) || String(a.code).startsWith('12')) return json(res, 400, { detailMessage: 'invalid code' });
            auths.push({ id: crypto.randomUUID(), smartlockId: Number(m[1]), enabled: true, remoteAllowed: false, lockCount: 0, ...a });
            return json(res, 204);
          }
          if (req.method === 'DELETE') {
            const i = auths.findIndex((a) => a.id === m[2]);
            if (i < 0) return json(res, 404);
            auths.splice(i, 1);
            return json(res, 204);
          }
        }
        return json(res, 404);
      }
      // ── Bridge HTTP API: hashed token (ts, rnr, hash) or plain token ──
      const hashOk = q.ts && q.rnr && q.hash === crypto.createHash('sha256').update(`${q.ts},${q.rnr},${token}`).digest('hex');
      if (!(hashOk || q.token === token)) return json(res, 401, { success: false });
      if (url.pathname === '/list') {
        return json(res, 200, devices.map((d) => ({ nukiId: d.nukiId, deviceType: d.deviceType, name: d.name, firmwareVersion: '4.1.6', lastKnownState: { ...stateOut(d), timestamp: new Date().toISOString() } })));
      }
      if (url.pathname === '/lockAction') {
        const d = devices.find((x) => x.nukiId === Number(q.nukiId) && x.deviceType === Number(q.deviceType));
        if (!d) return json(res, 404, { success: false });
        const action = Number(q.action);
        log.push(`bridge:${d.nukiId}:${action}`);
        d.state = d.deviceType === 2 ? (action === 1 ? 3 : 1) : ({ 1: 3, 2: 1, 3: 5 }[action] ?? d.state);
        return json(res, 200, { success: true, batteryCritical: false });
      }
      json(res, 404);
    });
  });
  return { server, devices, auths, log, smartlockId };
}

module.exports = { createSimulator };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8080;
  const { server } = createSimulator();
  server.listen(port, () => console.log(`Nuki simulator: Bridge on :${port} (token "simtoken"), Web API at http://127.0.0.1:${port}/web (token "webtoken")`));
}
