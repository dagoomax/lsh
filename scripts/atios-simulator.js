#!/usr/bin/env node
'use strict';

// Minimal Atios SmartCore stand-in for testing src/atios-client.js: the DALI
// interface (lamps answer QUERY ACTUAL LEVEL and follow DAPC / OFF / last
// active / scenes), the NVM device list, /settings, and the bus monitor
// WebSocket on / (sim.emit(bits, data) pushes an external frame).
//
//   node scripts/atios-simulator.js [port=8907] [lamps=64]
// then config.atios = { host: '127.0.0.1:8907' }
// From the command line it simulates a full DALI line (64 lamps in groups of
// eight, a button panel and a sensor per group); startSimulator() without
// `lamps` keeps the small fixed set test/atios.test.js relies on.

const http = require('http');
const WebSocket = require('ws');

const ROOMS = ['Living room', 'Kitchen', 'Dining room', 'Hall', 'Bedroom', 'Bathroom', 'Office', 'Garage',
  'Stairs', 'Guest room', 'Terrace', 'Garden', 'Cellar', 'Laundry', 'Attic', 'Entrance'];

// A DALI line of `count` lamps (short addresses 0…count-1, max 64), eight per
// group, plus one push-button panel and one occupancy/light sensor per group.
function buildBus(count) {
  const n = Math.max(1, Math.min(64, Math.floor(count)));
  const lamps = {}, groupOf = {}, controls = [], inputs = [];
  const groups = Math.ceil(n / 8);
  for (let a = 0; a < n; a++) {
    const g = Math.floor(a / 8);
    const last = 64 + ((a * 37) % 191);            // a spread of levels, 64…254
    lamps[a] = { level: a % 3 === 0 ? 0 : last, last };
    groupOf[a] = [g];
    controls.push({ name: `${ROOMS[g]} ${(a % 8) + 1}`, address: a });
  }
  for (let g = 0; g < groups; g++) {
    controls.push({ name: ROOMS[g], address: 128 + g, is_group: true });
    inputs.push({ name: `${ROOMS[g]} buttons`, address: g, instances: [0, 1, 2, 3].map((number) => ({ number, type: 1, active: true })) });
    inputs.push({ name: `${ROOMS[g]} sensor`, address: 32 + g, instances: [{ number: 0, type: 3, active: true }, { number: 1, type: 4, active: true }] });
  }
  return { lamps, groupOf, controls, inputs };
}

function fixtureBus() {
  return {
    lamps: { 1: { level: 254, last: 254 }, 2: { level: 0, last: 128 } },
    groupOf: { 1: [0], 2: [0] },
    controls: [
      { name: 'Kitchen', address: 1 }, { name: 'Hall', address: 2 },
      { name: 'Ground floor', address: 128, is_group: true },
    ],
    inputs: [
      { name: 'Hall buttons', address: 10, instances: [{ number: 0, type: 1, active: true }, { number: 1, type: 1, active: true }] },
      { name: 'Hall sensor', address: 11, instances: [{ number: 0, type: 3, active: true }, { number: 1, type: 4, active: true }] },
    ],
  };
}

function startSimulator({ port = 8907, lamps: count } = {}) {
  const calls = [];
  const { lamps, groupOf, controls, inputs } = count ? buildBus(count) : fixtureBus();
  const targets = (a) => {
    if (a >= 0xfe) return Object.keys(lamps);
    if (a & 0x80) { const g = (a >> 1) & 0x0f; return Object.keys(lamps).filter((k) => groupOf[k]?.includes(g)) }
    const s = (a >> 1) & 0x3f; return lamps[s] ? [String(s)] : [];
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: u.pathname + u.search, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
      if (u.pathname === '/settings') return json(200, { dali_ip_interface: true });
      if (u.pathname === '/ota_status') return json(200, { serial: 'SC-0001', version: '3.2.3' });
      if (u.pathname === '/api/dali/nvm') {
        const section = u.searchParams.get('section'), off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit')) || 4;
        const all = section === 'control_devices' ? controls : section === 'input_devices' ? inputs : [];
        return json(200, { success: true, data: { [section]: all.slice(off, off + lim) }, pagination: { has_more: off + lim < all.length, limit: lim } });
      }
      if (u.pathname === '/api/dali/iface' && req.method === 'POST') {
        const b = JSON.parse(body || '{}');
        const [a, x] = b.data || [];
        const ts = targets(a);
        if (!(a & 1)) for (const t of ts) { lamps[t].level = x; if (x > 0) lamps[t].last = x }
        else if (x === 0x00) for (const t of ts) lamps[t].level = 0;
        else if (x === 0x0a) for (const t of ts) lamps[t].level = lamps[t].last;
        else if (x >= 0x10 && x <= 0x1f) for (const t of ts) lamps[t].level = 100;
        else if (x === 0xa0) {
          if (!ts.length) return json(200, { success: true, bus_busy: false, collision_detected: false, data: null });
          return json(200, { success: true, bus_busy: false, collision_detected: false, data: lamps[ts[0]].level });
        }
        return json(200, { success: true });
      }
      json(404, {});
    });
  });
  const wss = new WebSocket.Server({ server });
  wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'info', data: { name: 'dali-iot', protocolVersion: '3.0' } })));
  const emit = (bits, data) => {
    const msg = JSON.stringify({ type: 'daliMonitor', data: { line: 0, bits, externalSource: true, data } });
    for (const c of wss.clients) c.send(msg);
  };
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, calls, lamps, emit, clients: () => wss.clients.size,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(); server.close(r) }),
  })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8907;
  const lamps = Number(process.argv[3]) || 64;
  startSimulator({ port, lamps }).then((s) => console.log(`Atios SmartCore simulator on http://127.0.0.1:${s.port} — ${Object.keys(s.lamps).length} lamp(s)`));
}

module.exports = { startSimulator, buildBus };
