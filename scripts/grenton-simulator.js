#!/usr/bin/env node
'use strict';

// Grenton GATE HTTP simulator — emulates the LSH listener protocol
// (docs/grenton-gate-lsh.lua) for developing/testing src/grenton-client.js
// without real Grenton hardware. Run: node scripts/grenton-simulator.js [port]

const http = require('http');
const PORT = Number(process.argv[2]) || 8199;

// simulated CLU objects: NAME:index → value
const state = {
  'DOU8272:0': 0,     // light (on/off)
  'DIM1234:0': 0,     // dimmer (0..1)
  'ROL4321:0': 100,   // roller (position %, 100 = open)
  'TEMP1:0':   21.4,  // temperature sensor
};

// temperature drifts a little so the dashboard shows a live series
setInterval(() => {
  state['TEMP1:0'] = Math.round((21 + Math.random() * 2) * 10) / 10;
}, 15000);

// blind motion simulation
let blindTimer = null;
function moveBlind(dir) {
  clearInterval(blindTimer);
  if (dir === 'stop') return;
  blindTimer = setInterval(() => {
    const v = state['ROL4321:0'] + (dir === 'up' ? 5 : -5);
    state['ROL4321:0'] = Math.max(0, Math.min(100, v));
    if (state['ROL4321:0'] === 0 || state['ROL4321:0'] === 100) clearInterval(blindTimer);
  }, 300);
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => body += d);
  req.on('end', () => {
    let out = {};
    try {
      const j = JSON.parse(body || '{}');
      if (j.cmd === 'status') {
        for (const o of j.objects || []) if (o in state) out[o] = state[o];
      } else if (j.cmd === 'set') {
        state[`${j.object}:${j.index ?? 0}`] = j.value;
        console.log(`[sim] set ${j.object}:${j.index ?? 0} = ${j.value}`);
        out = { ok: true };
      } else if (j.cmd === 'exec') {
        console.log(`[sim] exec ${j.code}`);
        const m = j.code.match(/ROL4321:execute\((\d)/);
        if (m) moveBlind(m[1] === '0' ? 'up' : m[1] === '1' ? 'down' : 'stop');
        out = { ok: true };
      } else {
        out = { error: 'unknown cmd' };
      }
    } catch (e) { out = { error: e.message }; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(out));
  });
}).listen(PORT, () => console.log(`[sim] Grenton GATE simulator on :${PORT}`));
