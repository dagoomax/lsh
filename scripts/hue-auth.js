#!/usr/bin/env node
'use strict';

// One-off Hue bridge pairing: press the round link button on the bridge, then
// run `node scripts/hue-auth.js <bridge-ip> [port]` within 30 s. Prints the
// API username to put in config.hue.username.

const http = require('http');

const HOST = process.argv[2];
const PORT = Number(process.argv[3]) || 80;
if (!HOST) { console.error('Usage: node scripts/hue-auth.js <bridge-ip> [port]'); process.exit(1); }

function tryPair() {
  const body = JSON.stringify({ devicetype: 'lsh#server' });
  const req = http.request({ hostname: HOST, port: PORT, path: '/api', method: 'POST', timeout: 5000,
    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      try {
        const j = JSON.parse(data)[0];
        if (j.success?.username) {
          console.log(`\nPaired! Add to config.json:\n  "hue": { "host": "${HOST}", "username": "${j.success.username}" }`);
          process.exit(0);
        }
        if (j.error?.type === 101) {
          process.stdout.write('.');   // link button not pressed yet — retrying
          return setTimeout(tryPair, 2000);
        }
        console.error(`\nBridge error: ${j.error?.description || data}`);
        process.exit(1);
      } catch { console.error(`\nUnexpected response: ${data}`); process.exit(1); }
    });
  });
  req.on('error', (e) => { console.error(`\n${e.message}`); process.exit(1); });
  req.end(body);
}

console.log(`Press the link button on the bridge at ${HOST} — waiting`);
tryPair();
