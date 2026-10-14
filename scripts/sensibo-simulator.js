#!/usr/bin/env node
'use strict';

// Minimal Sensibo API stand-in for testing src/sensibo-client.js:
// GET /users/me/pods, POST /pods/<id>/acStates (apiKey query parameter).
//
//   node scripts/sensibo-simulator.js [port=8903]
// then config.sensibo = { apiKey: 'test-key', apiBase: 'http://127.0.0.1:8903' }

const http = require('http');

function startSimulator({ port = 8903, apiKey = 'test-key' } = {}) {
  const calls = [];
  const fanLevels = ['quiet', 'low', 'medium', 'high', 'auto'];
  const pod = {
    id: 'aBcD1234', room: { name: 'Office', icon: 'office' },
    acState: { on: false, mode: 'cool', targetTemperature: 24, temperatureUnit: 'C', fanLevel: 'auto', swing: 'stopped' },
    measurements: { temperature: 26.4, humidity: 48 },
    connectionStatus: { isAlive: true },
    remoteCapabilities: { modes: {
      cool: { temperatures: { C: { isNative: true, values: [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] } }, fanLevels, swing: ['stopped', 'rangeFull'] },
      heat: { temperatures: { C: { isNative: true, values: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] } }, fanLevels, swing: ['stopped', 'rangeFull'] },
      fan: { fanLevels, swing: ['stopped', 'rangeFull'] },
      dry: { temperatures: { C: { isNative: true, values: [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] } }, swing: ['stopped', 'rangeFull'] },
    } },
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: u.pathname, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
      if (u.searchParams.get('apiKey') !== apiKey) return json(401, { status: 'failure', reason: 'Unauthorized' });
      if (req.method === 'GET' && u.pathname === '/users/me/pods') return json(200, { status: 'success', result: [pod] });
      if (req.method === 'POST' && u.pathname === `/pods/${pod.id}/acStates`) {
        const s = JSON.parse(body || '{}').acState || {};
        const caps = pod.remoteCapabilities.modes[s.mode];
        if (!caps) return json(400, { status: 'failure', reason: `mode ${s.mode} not supported` });
        if (s.fanLevel && !(caps.fanLevels || []).includes(s.fanLevel)) return json(400, { status: 'failure', reason: `fanLevel ${s.fanLevel} not supported` });
        Object.assign(pod.acState, s);
        return json(200, { status: 'success', result: { acState: pod.acState, changedProperties: Object.keys(s), status: 'Success' } });
      }
      json(404, { status: 'failure', reason: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, calls, pod, apiKey, close: () => new Promise((r) => server.close(r)) })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8903;
  startSimulator({ port }).then((s) => console.log(`Sensibo API simulator on http://127.0.0.1:${s.port} (apiKey ${s.apiKey})`));
}

module.exports = { startSimulator };
