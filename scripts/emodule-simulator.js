#!/usr/bin/env node
'use strict';

// Minimal eModule (emodul.eu) stand-in for testing src/emodule-client.js:
// authentication, the module list, one module's zones + tiles, i18n, and
// zone writes (constant temperature / zone on-off).
//
//   node scripts/emodule-simulator.js [port=8906]
// then config.emodule = { username: 'user', password: 'secret', apiBase: 'http://127.0.0.1:8906/api/v1' }

const http = require('http');

function startSimulator({ port = 8906, username = 'user', password = 'secret' } = {}) {
  const calls = [];
  const token = 'TOKEN-1234';
  const udid = 'abc123';
  const zones = [
    { zone: { id: 101, currentTemperature: 214, setTemperature: 220, humidity: 45, zoneState: 'zoneOn', visibility: true, duringChange: false, batteryLevel: 80, signalStrength: 70, flags: { relayState: 'on', algorithm: 'heating' } },
      description: { id: 101, name: 'Salon' }, mode: { id: 5001, parentId: 101, mode: 'timeLimit' }, windowsSensors: [{ windowState: 'closed' }] },
    { zone: { id: 102, currentTemperature: 198, setTemperature: 190, humidity: 0, zoneState: 'zoneOff', visibility: true, flags: { relayState: 'off', algorithm: 'heating' } },
      description: { id: 102, name: 'Sypialnia' }, mode: { id: 5002, parentId: 102, mode: 'globalSchedule' } },
    { zone: { id: 103, zoneState: 'zoneUnregistered', visibility: true }, description: { name: 'Unused' }, mode: { id: 5003 } },
  ];
  const tiles = [
    { id: 1, type: 1, visibility: true, params: { description: 'Outdoor', value: -35 } },
    { id: 2, type: 11, visibility: true, params: { txtId: 900, workingStatus: true } },
    { id: 3, type: 23, visibility: true, params: { txtId: 991, openingPercentage: 40, currentTemp: 452, returnTemp: 381, setTemp: 50 } },
    { id: 4, type: 6, visibility: true, params: { widget1: { txtId: 910, value: 15, unit: 23, type: 0 }, widget2: { txtId: 0, value: 0, unit: -1, type: 0 } } },
    { id: 5, type: 1, visibility: false, params: { description: 'Hidden', value: 100 } },
  ];
  const texts = { 900: 'Pompa CO', 991: 'Zawór', 910: 'Ciśnienie' };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1\//, '');
      calls.push({ method: req.method, path: p, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
      if (p === 'authentication') {
        const b = JSON.parse(body || '{}');
        if (b.username !== username || b.password !== password) return json(401, { authenticated: false });
        return json(200, { authenticated: true, user_id: 42, token });
      }
      if (req.headers.authorization !== `Bearer ${token}`) return json(401, {});
      if (p === 'i18n/en' || p === 'i18n/pl') return json(200, { data: texts });
      if (p === 'users/42/modules') return json(200, [{ udid, name: 'EU-L-4X WiFi', version: '1.0.7' }]);
      if (p === `users/42/modules/${udid}`) return json(200, { zones: { elements: zones }, tiles });
      if (p === `users/42/modules/${udid}/zones` && req.method === 'POST') {
        const b = JSON.parse(body || '{}');
        if (b.mode) {
          const el = zones.find((z) => z.zone.id === b.mode.parentId);
          if (!el || el.mode.id !== b.mode.id) return json(400, { error: 'bad mode id' });
          el.zone.setTemperature = b.mode.setTemperature; el.mode.mode = b.mode.mode;
        } else if (b.zone) {
          const el = zones.find((z) => z.zone.id === b.zone.id);
          if (!el) return json(400, {});
          el.zone.zoneState = b.zone.zoneState;
        }
        return json(200, { ok: true });
      }
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, calls, zones, tiles, udid, username, password, close: () => new Promise((r) => server.close(r)) })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8906;
  startSimulator({ port }).then((s) => console.log(`eModule simulator on http://127.0.0.1:${s.port}/api/v1 (${s.username} / ${s.password})`));
}

module.exports = { startSimulator };
