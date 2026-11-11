#!/usr/bin/env node
'use strict';

// Minimal Atios SmartCore stand-in for testing src/atios-client.js: the DALI
// interface (lamps answer QUERY ACTUAL LEVEL and follow DAPC / OFF / last
// active / scenes; RGBW lamps also take DT8 colours — DTR0–2, ENABLE DEVICE
// TYPE 8, SET TEMPORARY RGB / WAF DIMLEVEL, ACTIVATE, QUERY COLOUR VALUE),
// the NVM device list, /settings, and the bus monitor
// WebSocket on / (sim.emit(bits, data) pushes an external frame).
//
//   node scripts/atios-simulator.js [port=8907] [lamps=64]
// then config.atios = { host: '127.0.0.1:8907' }
// From the command line it simulates a full DALI line (64 lamps in groups of
// eight — the eighth of each an RGBW lamp — and a button panel and a sensor
// per group); startSimulator() without
// `lamps` keeps the small fixed set test/atios.test.js relies on.

const http = require('http');
const WebSocket = require('ws');

const ROOMS = ['Living room', 'Kitchen', 'Dining room', 'Hall', 'Bedroom', 'Bathroom', 'Office', 'Garage',
  'Stairs', 'Guest room', 'Terrace', 'Garden', 'Cellar', 'Laundry', 'Attic', 'Entrance'];

const RGBW_FEATURES = 4 << 5; // QUERY COLOUR TYPE FEATURES: four RGBWAF channels

// A DALI line of `count` lamps (short addresses 0…count-1, max 64), eight per
// group, plus one push-button panel and one occupancy/light sensor per group.
function buildBus(count) {
  const n = Math.max(1, Math.min(64, Math.floor(count)));
  const lamps = {}, groupOf = {}, controls = [], inputs = [];
  const groups = Math.ceil(n / 8);
  for (let a = 0; a < n; a++) {
    const g = Math.floor(a / 8);
    const last = 64 + ((a * 37) % 191);            // a spread of levels, 64…254
    const rgbw = a % 8 === 7;
    lamps[a] = { level: a % 3 === 0 ? 0 : last, last };
    if (rgbw) lamps[a].colour = { r: 254, g: 120, b: 20, w: 0 };
    groupOf[a] = [g];
    controls.push(rgbw
      ? { name: `${ROOMS[g]} RGBW`, address: a, device_types: [6, 8], color_type_features: RGBW_FEATURES }
      : { name: `${ROOMS[g]} ${(a % 8) + 1}`, address: a, device_types: [6] });
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
    lamps: { 1: { level: 254, last: 254 }, 2: { level: 0, last: 128 }, 5: { level: 254, last: 254, colour: { r: 0, g: 254, b: 0, w: 127 } } },
    groupOf: { 1: [0], 2: [0] },
    controls: [
      { name: 'Kitchen', address: 1 }, { name: 'Hall', address: 2 },
      { name: 'Bar', address: 5, device_types: [6, 8], color_type_features: RGBW_FEATURES },
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
  const dtr = [0, 0, 0];           // DTR0–2, shared by the whole bus
  let enabledType = 0;             // ENABLE DEVICE TYPE — covers the next frame only
  const temp = {};                 // lamp → temporary colour, applied by ACTIVATE
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
        if ((a & 1) && a >= 0xa0 && a <= 0xfd) { // special commands
          if (a === 0xa3) dtr[0] = x; else if (a === 0xc3) dtr[1] = x; else if (a === 0xc5) dtr[2] = x;
          enabledType = a === 0xc1 ? x : 0;
          return json(200, { success: true });
        }
        const ts = targets(a), dt8 = enabledType === 8;
        enabledType = 0;
        if ((a & 1) && x >= 224) { // DT8 application extended commands
          const cs = dt8 ? ts.filter((t) => lamps[t].colour) : [];
          if (x === 235) for (const t of cs) Object.assign(temp[t] ||= {}, { r: dtr[0], g: dtr[1], b: dtr[2] });
          else if (x === 236) for (const t of cs) Object.assign(temp[t] ||= {}, { w: dtr[0] });
          else if (x === 226) for (const t of cs) {
            for (const [k, v] of Object.entries(temp[t] || {})) if (v !== 255) lamps[t].colour[k] = v;
            delete temp[t];
          } else if (x === 250) {
            const k = { 9: 'r', 10: 'g', 11: 'b', 12: 'w' }[dtr[0]];
            return json(200, { success: true, bus_busy: false, collision_detected: false, data: cs.length && k ? lamps[cs[0]].colour[k] : null });
          }
          return json(200, { success: true });
        }
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
