#!/usr/bin/env node
'use strict';

// Minimal UniFi Access console stand-in (Developer API, port 12445) for
// testing src/unifi-access-client.js: HTTPS with a throwaway self-signed
// certificate (needs the `openssl` CLI), Bearer token "simtoken".
//
//   GET  /api/v1/developer/doors[/{id}] | devices   PUT /doors/{id}/unlock
//   GET/PUT /doors/{id}/lock_rule                   GET/PUT /doors/settings/emergency
//   WSS  /api/v1/developer/devices/notifications    (sim.push(msg) sends a frame)
//
// Shapes follow the UniFi Access API reference (v4); values are made up.
//
//   node scripts/unifi-access-simulator.js [port=12445]
// then config.unifiAccess = { host: '127.0.0.1:12445', apiKey: 'simtoken' }

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const WS = require('ws');
const WebSocketServer = WS.WebSocketServer || WS.Server;

const BASE = '/api/v1/developer';

function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-sim-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=access-sim',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
}

function startSimulator({ port = 12445 } = {}) {
  const calls = [];
  const doors = [
    { id: 'door-main', name: 'Main Door', full_name: 'UDM - 1F - Main Door', floor_id: 'f1', type: 'door', is_bind_hub: true, door_lock_relay_status: 'lock', door_position_status: 'close' },
    { id: 'door-gate', name: 'Gate', full_name: 'UDM - 1F - Gate', floor_id: 'f1', type: 'door', is_bind_hub: true, door_lock_relay_status: 'lock', door_position_status: '' },
  ];
  const devices = [
    { id: '7483c2773855', name: 'UA-HUB-3855', alias: 'Hub', type: 'UAH' },
    { id: 'e4388386be1d', name: 'UA-G2-PRO-BE1D', alias: 'Front intercom', type: 'UA-G2-PRO' },
  ];
  const rules = { 'door-main': { type: '', ended_time: 0 }, 'door-gate': { type: '', ended_time: 0 } };
  const emergency = { lockdown: false, evacuation: false };
  const ok = (data) => ({ code: 'SUCCESS', msg: 'success', data });

  const server = https.createServer(selfSignedCert(), (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
      if (req.headers.authorization !== 'Bearer simtoken') return json(401, { code: 'CODE_UNAUTHORIZED', msg: 'Unauthorized' });
      const p = req.url.split('?')[0];
      let b = {}; try { b = body ? JSON.parse(body) : {} } catch {}
      let m;
      if (req.method === 'GET' && p === `${BASE}/doors`) return json(200, ok(doors));
      if (req.method === 'GET' && p === `${BASE}/devices`) return json(200, ok([devices]));
      if (req.method === 'GET' && (m = p.match(/^\/api\/v1\/developer\/doors\/([^/]+)$/)) && m[1] !== 'settings') {
        const d = doors.find((x) => x.id === m[1]);
        return d ? json(200, ok(d)) : json(404, { code: 'CODE_NOT_EXISTS', msg: 'No door' });
      }
      if (p === `${BASE}/doors/settings/emergency`) {
        if (req.method === 'PUT') { Object.assign(emergency, { lockdown: !!b.lockdown, evacuation: !!b.evacuation }); return json(200, ok('success')) }
        return json(200, ok(emergency));
      }
      if ((m = p.match(/^\/api\/v1\/developer\/doors\/([^/]+)\/unlock$/)) && req.method === 'PUT') {
        const d = doors.find((x) => x.id === m[1]); if (!d) return json(404, { code: 'CODE_NOT_EXISTS', msg: 'No door' });
        d.door_lock_relay_status = 'unlock';
        return json(200, ok('success'));
      }
      if ((m = p.match(/^\/api\/v1\/developer\/doors\/([^/]+)\/lock_rule$/))) {
        const d = doors.find((x) => x.id === m[1]); if (!d) return json(404, { code: 'CODE_NOT_EXISTS', msg: 'No door' });
        if (req.method === 'GET') return json(200, ok(rules[d.id]));
        const now = Math.floor(Date.now() / 1000);
        if (b.type === 'reset' || b.type === 'lock_now' || b.type === 'lock_early') { rules[d.id] = { type: '', ended_time: 0 }; d.door_lock_relay_status = 'lock' }
        else if (b.type === 'keep_lock' || b.type === 'keep_unlock') rules[d.id] = { type: b.type, ended_time: 3602128309 };
        else if (b.type === 'custom') rules[d.id] = { type: 'custom', ended_time: now + 60 * (b.interval || 10) };
        else return json(400, { code: 'CODE_PARAMS_INVALID', msg: 'bad type' });
        d.door_lock_relay_status = b.type === 'keep_unlock' || b.type === 'custom' ? 'unlock' : 'lock';
        return json(200, ok('success'));
      }
      json(404, { code: 'CODE_NOT_EXISTS', msg: 'Not found' });
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.headers.authorization !== 'Bearer simtoken') { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy() }
    if (req.url !== `${BASE}/devices/notifications`) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => { ws.send('Hello'); wss.emit('connection', ws) });
  });
  const sim = {
    calls, doors, rules, emergency,
    push: (msg) => { for (const c of wss.clients) c.send(JSON.stringify(msg)) },
    connected: () => wss.clients.size,
  };
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(Object.assign(sim, {
    port: server.address().port,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); server.close(r) }),
  }))));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 12445;
  startSimulator({ port }).then((s) => console.log(`UniFi Access simulator on https://127.0.0.1:${s.port} (Bearer "simtoken")`));
}

module.exports = { startSimulator };
