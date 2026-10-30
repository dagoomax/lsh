#!/usr/bin/env node
'use strict';

// Minimal hydrop REST API stand-in for testing src/hydrop-client.js:
// /sensors/all/newest, /sensors/ID/<id>/status, /rate_limit_status, with the
// apikey header and a daily quota. sim.advance(m3, seconds) adds a reading.
//
//   node scripts/hydrop-simulator.js [port=8908]
// then config.hydrop = { apiKey: 'test-key', apiBase: 'http://127.0.0.1:8908' }

const http = require('http');

function startSimulator({ port = 8908, apiKey = 'test-key', limit = 400 } = {}) {
  const calls = [];
  const meter = { deviceID: 'Wasserzähler', value: 123.4567, ts: Math.floor(Date.now() / 1000) - 60 };
  let remaining = limit;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push({ path: u.pathname });
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
    if (!req.headers.apikey) return json(400, { detail: 'missing api key' });
    if (req.headers.apikey !== apiKey) return json(401, { detail: 'user not found' });
    if (u.pathname === '/rate_limit_status') return json(200, { limit, remaining, reset_time: Math.floor(Date.now() / 1000) + 3600 });
    if (remaining <= 0) return json(429, { error: `Rate limit exceeded: ${limit} per 1 day` });
    remaining--;
    if (u.pathname === '/sensors/all/newest') return json(200, { sensors: [{ deviceID: meter.deviceID, records: [{ meterValue: meter.value, timestamp: meter.ts }] }] });
    if (u.pathname === `/sensors/ID/${encodeURIComponent(meter.deviceID)}/status`) return json(200, { status: 'green', status_timestamp: meter.ts });
    json(404, { detail: 'not found' });
  });
  const advance = (m3, seconds) => { meter.value = Math.round((meter.value + m3) * 10000) / 10000; meter.ts += seconds };
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, calls, meter, apiKey, advance, close: () => new Promise((r) => server.close(r)),
  })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8908;
  startSimulator({ port }).then((s) => console.log(`hydrop API simulator on http://127.0.0.1:${s.port} (apikey ${s.apiKey})`));
}

module.exports = { startSimulator };
