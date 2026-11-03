#!/usr/bin/env node
'use strict';

// Simulated Grenton vCLU (GATE) — speaks the {cmd:status|set|exec} protocol
// src/grenton-client.js expects (docs/grenton-gate-lsh.lua). GENERIC: it bridges
// EVERY Tuya air-conditioner on LSH to Grenton objects, two-way. Each AC
// tuya/<id> is three objects:
//   AC_<id>_PWR   power    (0/1)  read+write  -> klima `switch`
//   AC_<id>_SET   setpoint (°C)   read+write  -> klima `heatingSetpoint`
//   AC_<id>_TMP   current  (°C)   read only   -> klima `temperature`
// The object name carries the Tuya id, so no per-device config here — whatever
// AC_<id>_* objects config.grenton asks about are answered by reading/writing
// tuya/<id> over the LSH REST API. scripts/grenton-klima-sync.js generates the
// matching config.grenton.devices from the ACs LSH currently has.
//   node scripts/grenton-vclu-sim.js [port]        (default 8098, path /lsh)

const http = require('http');

const PORT = Number(process.argv[2]) || 8098;
const LSH = { host: '127.0.0.1', port: 3001 };
const TOKEN = require('../persist/api-tokens.json')[0].token; // local only; never logged
const ROLE = { PWR: 'power', SET: 'setpoint', TMP: 'temp', MODE: 'mode' };
// mode is an enum; grenton-client has no enum type, so it rides a dimmer as an
// index: level 0=cold, 1=hot, 2=wet, 3=wind, 4=auto (device uses scale 100).
const MODES = ['cold', 'hot', 'wet', 'wind', 'auto'];

const lsh = (method, path, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const headers = { Authorization: 'Bearer ' + TOKEN };
  if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
  const req = http.request({ ...LSH, path, method, headers }, (res) => {
    let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ code: res.statusCode, body: d }));
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

// object "AC_<id>_<ROLE>" → { id, role }  (ids are alnum; role is the last _part)
function parseObject(name) {
  const m = /^AC_(.+)_(PWR|SET|TMP|MODE)$/.exec(String(name || ''));
  return m ? { id: m[1], role: ROLE[m[2]] } : null;
}

async function readAC(id) {
  const r = await lsh('GET', `/api/devices/tuya/${id}`);
  const d = JSON.parse(r.body).data;
  const v = (p) => d && d.readings[p] && d.readings[p].value;
  return {
    power:    (String(v('switch')) === '1' || v('switch') === true) ? 1 : 0,
    setpoint: Number(v('heatingSetpoint')) || 0,
    temp:     Number(v('temperature')) || 0,
    mode:     Math.max(0, MODES.indexOf(String(v('thermostatMode')))),
  };
}

async function writeAC(id, role, value) {
  if (role === 'power')    return lsh('POST', `/api/device/tuya/${id}/command`, { sensor: 'switch', value: Number(value) === 1 });
  if (role === 'setpoint') return lsh('POST', `/api/device/tuya/${id}/command`, { sensor: 'heatingSetpoint', value: Number(value) });
  if (role === 'mode') {
    const idx = Math.max(0, Math.min(MODES.length - 1, Math.round(Number(value))));
    return lsh('POST', `/api/device/tuya/${id}/command`, { sensor: 'thermostatMode', value: MODES[idx] });
  }
  // 'temp' is read-only
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', async () => {
    const reply = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
    let msg;
    try { msg = raw ? JSON.parse(raw) : {}; } catch { return reply({ error: 'bad json' }); }
    try {
      if (msg.cmd === 'status') {
        const out = {};
        const cache = {}; // id → values, so each AC is read once per request
        for (const entry of msg.objects || []) {
          const [name] = String(entry).split(':');
          const p = parseObject(name);
          if (!p) continue;
          if (!cache[p.id]) cache[p.id] = await readAC(p.id);
          out[entry] = cache[p.id][p.role];
        }
        return reply(out);
      }
      if (msg.cmd === 'set') {
        const p = parseObject(msg.object);
        if (p) { await writeAC(p.id, p.role, msg.value); console.log(`[vCLU] set ${msg.object} = ${msg.value}`); }
        return reply({ success: true });
      }
      if (msg.cmd === 'exec') return reply({ success: true });
      reply({ error: 'unknown cmd' });
    } catch (err) { reply({ error: err.message }); }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Grenton vCLU sim on http://127.0.0.1:${PORT}/lsh — bridges every Tuya AC as AC_<id>_{PWR,SET,TMP}`);
});
