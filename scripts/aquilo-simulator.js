#!/usr/bin/env node
'use strict';

// Fake Aquilo WiFi gateway — answers GET /state like the real receiver.
//   node scripts/aquilo-simulator.js [port]      (default 8095)
// Tests: const sim = await startSimulator({ port: 0 }); sim.tanks[0].pct = 95; sim.close()

const http = require('http');

function startSimulator({ port = 8095, tanks } = {}) {
  const now = Date.now();
  const sim = {
    calls: 0,
    from: 'node-1',
    fail: false,
    tanks: tanks || [
      { id: '0A1B2C', name: 'SZAMBO', lvl: 125.6, pct: 34, bat: 76, lstRead: new Date(now - 20 * 60e3).toISOString(),
        lstEmpty: new Date(now - 30 * 86400e3).toISOString(), daysLeft: 48, lvlToFull: 121 },
      // old firmware: only id / lvl / pct / lstRead
      { id: '3D4E5F', lvl: 80, pct: 61, lstRead: new Date(now - 3 * 86400e3).toISOString() },
    ],
  };
  const server = http.createServer((req, res) => {
    sim.calls++;
    if (req.method !== 'GET' || req.url.split('?')[0] !== '/state') { res.writeHead(404); return res.end('not found') }
    if (sim.fail) { res.writeHead(500); return res.end('error') }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sensors: sim.tanks, from: sim.from }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    sim.port = server.address().port;
    sim.close = () => new Promise((r) => server.close(r));
    resolve(sim);
  }));
}

if (require.main === module) {
  startSimulator({ port: Number(process.argv[2]) || 8095 }).then((s) => console.log(`Aquilo gateway simulator on http://127.0.0.1:${s.port}/state`));
}

module.exports = { startSimulator };
