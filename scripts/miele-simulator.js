#!/usr/bin/env node
'use strict';

// Miele 3rd Party API simulator — emulates the endpoints used by
// src/miele-client.js (token grant, /v1/devices, SSE event stream, actions)
// for development without real Miele@home appliances.
// Run: node scripts/miele-simulator.js [port]   (default 8299)
// Point LSH at it with:  "miele": { "host": "127.0.0.1", "port": 8299,
//   "clientId": "sim", "clientSecret": "sim", "username": "sim", "password": "sim" }

const http = require('http');
const PORT = Number(process.argv[2]) || 8299;

const loc = (raw, name) => ({ value_raw: raw, value_localized: name });

// simulated appliances (Miele /v1/devices shape)
const devices = {
  '000111222333': {
    ident: { type: loc(1, 'Washing machine'), deviceName: 'Pralka Miele',
             deviceIdentLabel: { techType: 'WWE860' } },
    state: {
      status: loc(5, 'In use'),
      ProgramID: loc(1, 'Cottons'),
      programPhase: loc(261, 'Main wash'),
      remainingTime: [1, 24],
      temperature: [{ value_raw: 4000, unit: 'Celsius' }],
      targetTemperature: [{ value_raw: 4000, unit: 'Celsius' }],
      signalDoor: false, signalFailure: false,
    },
  },
  '000444555666': {
    ident: { type: loc(12, 'Oven'), deviceName: 'Piekarnik Miele',
             deviceIdentLabel: { techType: 'H7660BP' } },
    state: {
      status: loc(2, 'On'),
      ProgramID: loc(13, 'Fan plus'),
      programPhase: loc(3073, 'Heating'),
      remainingTime: [0, 35],
      temperature: [{ value_raw: 14550, unit: 'Celsius' }],
      targetTemperature: [{ value_raw: 18000, unit: 'Celsius' }],
      signalDoor: false, signalFailure: false,
    },
  },
  '000777888999': {
    ident: { type: loc(19, 'Refrigerator'), deviceName: 'Lodówka Miele',
             deviceIdentLabel: { techType: 'K7743' } },
    state: {
      status: loc(2, 'On'),
      temperature: [{ value_raw: 400, unit: 'Celsius' }],
      targetTemperature: [{ value_raw: 400, unit: 'Celsius' }],
      signalDoor: false, signalFailure: false,
    },
  },
};

// live simulation: washer counts down + phases, oven heats toward target
setInterval(() => {
  const w = devices['000111222333'].state;
  if (w.status.value_raw === 5) {
    let [h, m] = w.remainingTime;
    m -= 1; if (m < 0) { m = 59; h -= 1; }
    if (h <= 0 && m <= 0) { w.status = loc(7, 'Finished'); w.remainingTime = [0, 0]; }
    else w.remainingTime = [Math.max(0, h), m];
  }
  const o = devices['000444555666'].state;
  if (o.status.value_raw === 2 && o.temperature[0].value_raw < o.targetTemperature[0].value_raw) {
    o.temperature[0].value_raw = Math.min(o.targetTemperature[0].value_raw, o.temperature[0].value_raw + 500);
  }
  broadcast();
}, 10000);

// SSE clients
const clients = new Set();
function broadcast() {
  const payload = `event: devices\ndata: ${JSON.stringify(devices)}\n\n`;
  for (const res of clients) res.write(payload);
}
setInterval(() => { for (const res of clients) res.write('event: ping\ndata: -\n\n'); }, 5000);

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => body += d);
  req.on('end', () => {
    if (req.url === '/thirdparty/token' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ access_token: 'sim-at', refresh_token: 'sim-rt', expires_in: 3600 }));
    }
    if (req.url === '/v1/devices/all/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      clients.add(res);
      // NB: req 'close' fires when the *message* completes (immediately for a
      // GET) — listen on the response, which closes with the connection
      res.on('close', () => clients.delete(res));
      res.write(`event: devices\ndata: ${JSON.stringify(devices)}\n\n`);
      return;
    }
    if (req.url === '/v1/devices' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(devices));
    }
    const act = req.url.match(/^\/v1\/devices\/(\d+)\/actions$/);
    if (act && req.method === 'PUT') {
      const dev = devices[act[1]];
      if (!dev) { res.statusCode = 404; return res.end('{}'); }
      const j = JSON.parse(body || '{}');
      if (j.powerOff) { dev.state.status = loc(1, 'Off'); delete dev.state.ProgramID; }
      if (j.powerOn)  dev.state.status = loc(2, 'On');
      console.log(`[sim] action ${JSON.stringify(j)} → ${act[1]}`);
      broadcast();
      res.setHeader('Content-Type', 'application/json');
      return res.end('{}');
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'not found' }));
  });
}).listen(PORT, () => console.log(`[sim] Miele API simulator on :${PORT}`));
