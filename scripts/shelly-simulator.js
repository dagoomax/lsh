#!/usr/bin/env node
'use strict';

// Fake Shelly 2.5 (SHSW-25) — a 2-relay/2-meter Gen1 device — for developing/
// demoing src/shelly-client.js without real hardware. Implements just enough
// of the real Gen1 HTTP API (/shelly, /status, /relay/:id) for shelly-client.js
// to discover it, poll it, and toggle its relays from the dashboard.
//
// shelly-client.js hardcodes port 80 for every device (see src/shelly-client.js
// _get/_postForm/_postJson) — there is no way to point it at another port, so
// this simulator must listen on 80 too. On macOS/Linux that means running it
// with elevated privileges:
//
//   sudo node scripts/shelly-simulator.js
//
// Then add it in Settings → Lighting → Shelly (or directly in config.json's
// shelly.devices) as: { "host": "localhost", "name": "Sim Shelly 2.5" }
//
// Env vars: SHELLY_SIM_PORT (default 80 — only lower it for manual curl/browser
//           testing; the real client won't be able to reach a non-80 port).

const http = require('http');

const PORT = Number(process.env.SHELLY_SIM_PORT) || 80;
const MAC  = '3494547AB123';

// Two channels styled after a common real-world SHSW-25 wiring: one steady
// load (a pump-like appliance), one lighting-style load that also idles at a
// small standby draw when "off" — so the dashboard has something to look at
// even before you flip anything.
const relays = [
  { name: 'Garden Pump',  ison: false, basePower: 550 },
  { name: 'Patio Lights', ison: false, basePower: 38  },
];

function jitter(base, spreadPct = 0.08) {
  return Math.max(0, base * (1 + (Math.random() - 0.5) * 2 * spreadPct));
}

function currentPower(i) {
  return relays[i].ison ? Math.round(jitter(relays[i].basePower) * 10) / 10 : 0;
}

function shellyInfo() {
  return {
    type: 'SHSW-25', mac: MAC, auth: false,
    fw: '20230913-112003/v1.14.0-gcb84623', longid: 1, num_outputs: 2,
  };
}

function statusPayload() {
  return {
    relays: relays.map((r) => ({ ison: r.ison, has_timer: false, overpower: false, source: 'http' })),
    meters: relays.map((r, i) => ({ power: currentPower(i), is_valid: true, timestamp: Math.floor(Date.now() / 1000) })),
    temperature: Math.round((22 + (Math.random() - 0.5) * 2) * 10) / 10,
    overtemperature: false,
    tmp: { tC: Math.round((22 + (Math.random() - 0.5) * 2) * 10) / 10, is_valid: true },
    uptime: Math.floor(process.uptime()),
  };
}

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function log(...args) { console.log('[ShellySim]', ...args); }

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/shelly') return sendJson(res, shellyInfo());
  if (url.pathname === '/status') return sendJson(res, statusPayload());

  const relayMatch = url.pathname.match(/^\/relay\/(\d+)$/);
  if (relayMatch) {
    const i = Number(relayMatch[1]);
    if (!relays[i]) { res.writeHead(404); return res.end(); }
    // The real Gen1 API (and shelly-client.js's _postForm) sends `turn` as a
    // form-encoded POST body, not a query param — a plain GET with
    // ?turn=on/off (handy for manual curl testing) is also accepted.
    let turn = url.searchParams.get('turn');
    if (!turn && req.method === 'POST') {
      const body = await readBody(req);
      turn = new URLSearchParams(body).get('turn');
    }
    if (turn === 'on' || turn === 'off') {
      relays[i].ison = turn === 'on';
      log(`relay ${i} (${relays[i].name}) -> ${turn}`);
    }
    return sendJson(res, { ison: relays[i].ison, has_timer: false });
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error(`[ShellySim] Permission denied binding port ${PORT}. shelly-client.js hardcodes port 80, so run this with: sudo node scripts/shelly-simulator.js`);
  } else if (err.code === 'EADDRINUSE') {
    console.error(`[ShellySim] Port ${PORT} is already in use.`);
  } else {
    console.error(`[ShellySim] ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  log(`Fake Shelly 2.5 listening on http://localhost:${PORT}`);
  log(`Relays: ${relays.map((r) => r.name).join(', ')}`);
  log(`Add to config.json: "shelly": { "devices": [{ "host": "localhost", "name": "Sim Shelly 2.5" }] }`);
});
