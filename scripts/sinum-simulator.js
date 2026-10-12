#!/usr/bin/env node
'use strict';

// Minimal TECH Sinum central (EH-01) stand-in for testing src/sinum-client.js:
// POST /api/v1/login (admin / admin → JWT-like session), API token "simtoken",
// GET /api/v1/rooms, /api/v1/scenes, /api/v1/devices/<bus> (virtual, wtp,
// sbus — others 404), PATCH /api/v1/devices/<bus>/<id>,
// POST /api/v1/scenes/<id>/activate. Responses wrapped in { data } like the
// real hub; temperatures ×10. Shapes follow apidocs.sinum.tech.
//
//   node scripts/sinum-simulator.js [port=8890]
// then config.sinum = { host: '127.0.0.1:8890', token: 'simtoken' }
//   (or username 'admin' / password 'admin').

const http = require('http');
const crypto = require('crypto');

function startSimulator({ port = 8890 } = {}) {
  const sessions = new Set();
  const calls = [];
  const sim = { busyNext: false, expireSessions: () => sessions.clear(), activated: [] };
  const devices = {
    virtual: [
      { id: 10, name: 'Salon termostat', type: 'thermostat', class: 'virtual', state: true, mode: 'heating', temperature: 215, target_temperature: 220, humidity: 450, room_id: 1 },
      { id: 11, name: 'Salon światło', type: 'dimmer_rgb_controller_integrator', class: 'virtual', state: false, brightness: 0, led_color: '#FFFFFF', room_id: 1 },
      { id: 12, name: 'Gniazdko', type: 'relay_integrator', class: 'virtual', state: false, room_id: 2 },
      { id: 13, name: 'Roleta kuchnia', type: 'blind_controller_integrator', class: 'virtual', state: false, last_set_target_opening: 100, action_in_progress: false, room_id: 2 },
      { id: 14, name: 'Brama', type: 'gate', class: 'virtual', state: 'closed', room_id: 3 },
      { id: 15, name: 'Furtka', type: 'wicket', class: 'virtual', state: 'locked', room_id: 3 },
    ],
    wtp: [
      { id: 20, name: 'Czujnik sypialnia', type: 'temperature_sensor', class: 'wtp', temperature: 198, humidity: 520, room_id: 4 },
      { id: 21, name: 'Ruch korytarz', type: 'motion_sensor', class: 'wtp', state: false, room_id: 4 },
      { id: 22, name: 'Okno sypialnia', type: 'opening_sensor', class: 'wtp', state: true, room_id: 4 },
      { id: 23, name: 'Regulator strefa 1', type: 'temperature_regulator', class: 'wtp', target_temperature: 210, system_mode: 'heating', room_id: 4 },
    ],
    sbus: [
      { id: 30, name: 'Licznik energii', type: 'energy_meter', class: 'sbus', active_power: 1530, energy: 123456, voltage: 2301, room_id: 2 },
    ],
  };
  const rooms = [
    { id: 1, name: 'Salon', devices: [{ id: 10, class: 'virtual' }, { id: 11, class: 'virtual' }] },
    { id: 2, name: 'Kuchnia', devices: [{ id: 12, class: 'virtual' }, { id: 13, class: 'virtual' }, { id: 30, class: 'sbus' }] },
    { id: 3, name: 'Wejście', devices: [{ id: 14, class: 'virtual' }, { id: 15, class: 'virtual' }] },
    { id: 4, name: 'Sypialnia', devices: [{ id: 20, class: 'wtp' }, { id: 21, class: 'wtp' }, { id: 22, class: 'wtp' }, { id: 23, class: 'wtp' }] },
  ];
  const scenes = [{ id: 1, name: 'Dzień dobry' }, { id: 2, name: 'Wyjście z domu' }];

  // PATCH semantics as documented (fields set directly; commands for blinds / gates / wickets)
  function patch(d, b) {
    if (b.command === 'open' && 'opening_percentage' in b) { d.last_set_target_opening = b.opening_percentage; d.current_opening = b.opening_percentage; return d }
    if (b.command === 'stop') { d.action_in_progress = false; if (d.type === 'gate') d.state = 'no_move'; return d }
    if (b.command === 'full_open') { d.state = 'opening'; return null } // the hub answers gate commands with 304
    if (b.command === 'close') { d.state = 'closing'; return null }
    if (b.command === 'unlock') { d.state = 'unlocked'; return d }
    for (const [k, v] of Object.entries(b)) if (k !== 'command') d[k] = v;
    return d;
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      calls.push({ method: req.method, path: u.pathname, body, auth: req.headers.authorization || null });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) };
      let b = {}; try { b = body ? JSON.parse(body) : {} } catch { return json(400, { message: 'Bad JSON' }) }

      if (req.method === 'POST' && u.pathname === '/api/v1/login') {
        if (b.username !== 'admin' || b.password !== 'admin') return json(401, { message: 'Invalid credentials' });
        const s = crypto.randomBytes(12).toString('hex'); sessions.add(s);
        return json(200, { data: { session: s, refresh_token: crypto.randomBytes(12).toString('hex') } });
      }
      const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (tok !== 'simtoken' && !sessions.has(tok)) return json(401, { message: 'Unauthorized' });
      if (sim.busyNext) { sim.busyNext = false; return json(408, { message: 'Bus busy' }) }

      if (req.method === 'GET' && u.pathname === '/api/v1/rooms') return json(200, { data: rooms });
      if (req.method === 'GET' && u.pathname === '/api/v1/scenes') return json(200, { data: scenes });
      let m = u.pathname.match(/^\/api\/v1\/scenes\/(\d+)\/activate$/);
      if (m && req.method === 'POST') {
        if (!scenes.some((s) => s.id === Number(m[1]))) return json(404, { message: 'No scene' });
        sim.activated.push(Number(m[1])); return json(200, { data: {} });
      }
      m = u.pathname.match(/^\/api\/v1\/devices\/([a-z-]+)(?:\/(\d+))?$/);
      if (m) {
        const list = devices[m[1]];
        if (!list) return json(404, { message: 'Unknown bus' });
        if (!m[2] && req.method === 'GET') return json(200, { data: list });
        const d = list.find((x) => x.id === Number(m[2]));
        if (!d) return json(404, { message: 'No device' });
        if (req.method === 'GET') return json(200, { data: d });
        if (req.method === 'PATCH') {
          const out = patch(d, b);
          return out ? json(200, { data: out }) : json(304);
        }
      }
      json(404, { message: 'Not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(Object.assign(sim, {
    port: server.address().port, calls, devices,
    close: () => new Promise((r) => server.close(r)),
  }))));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8890;
  startSimulator({ port }).then((s) => console.log(`Sinum simulator on http://127.0.0.1:${s.port} (token "simtoken", or admin / admin)`));
}

module.exports = { startSimulator };
