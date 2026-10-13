#!/usr/bin/env node
'use strict';

// Minimal Zendure SolarFlow stand-in (zenSDK local HTTP API) for testing
// src/zendure-client.js: GET /properties/report, POST /properties/write
// ({ sn, properties }, sn must match). Field names follow
// github.com/Zendure/zenSDK docs/en_properties.md.
//
//   node scripts/zendure-simulator.js [port=8892]
// then config.zendure = { devices: [{ host: '127.0.0.1:8892' }] }

const http = require('http');

function startSimulator({ port = 8892, sn = 'WOB1NHMAMXX00001', product = 'solarFlow800Pro' } = {}) {
  const calls = [];
  const props = {
    electricLevel: 64, solarInputPower: 712, outputHomePower: 400, outputPackPower: 312, packInputPower: 0,
    gridInputPower: 0, remainOutTime: 380, packNum: 1, BatVolt: 5120, is_error: 0, packState: 1,
    acMode: 1, inputLimit: 0, outputLimit: 400, socSet: 100, minSoc: 10, smartMode: 0,
  };
  const packData = [{ sn: 'PACK0001', socLevel: 64, state: 1, power: 312, maxTemp: 2981, totalVol: 51 }];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
      if (req.method === 'GET' && req.url === '/properties/report') return json(200, { timestamp: Math.floor(Date.now() / 1000), messageId: calls.length, sn, version: 2, product, properties: props, packData });
      if (req.method === 'POST' && req.url === '/properties/write') {
        let b; try { b = JSON.parse(body) } catch { return json(400, { success: false }) }
        if (b.sn !== sn) return json(400, { success: false, error: 'sn mismatch' });
        Object.assign(props, b.properties || {});
        return json(200, { timestamp: Math.floor(Date.now() / 1000), messageId: calls.length, success: true, code: 200, sn });
      }
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, calls, props, packData, sn, close: () => new Promise((r) => server.close(r)) })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8892;
  startSimulator({ port }).then((s) => console.log(`Zendure SolarFlow simulator on http://127.0.0.1:${s.port} (sn ${s.sn})`));
}

module.exports = { startSimulator };
