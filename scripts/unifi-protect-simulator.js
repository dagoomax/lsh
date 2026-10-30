#!/usr/bin/env node
'use strict';

// Minimal UniFi Protect console stand-in (Integration API, Protect 6.x) for
// testing src/unifi-protect-client.js: HTTPS with a throwaway self-signed
// certificate (needs the `openssl` CLI), X-API-Key "simkey".
//
//   GET  /proxy/protect/integration/v1/meta/info | cameras | sensors | lights | sirens | relays
//   GET/POST /cameras/{id}/rtsps-stream   GET /cameras/{id}/snapshot
//   PATCH /lights/{id}   POST /sirens/{id}/play|stop   POST /relays/{id}/outputs/{n}/activate
//   POST /alarm-manager/webhook/{id}
//   WSS  /subscribe/events, /subscribe/devices   (sim.event(msg), sim.device(msg) push frames)
//
// Shapes follow the public API as used by uiprotect (MIT); values are made up.
//
//   node scripts/unifi-protect-simulator.js [port=7443]
// then config.unifi = { host: '127.0.0.1:7443', apiKey: 'simkey' }

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const WS = require('ws');
const WebSocketServer = WS.WebSocketServer || WS.Server; // ws 7 has only .Server

const BASE = '/proxy/protect/integration/v1';

function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unifi-sim-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=unifi-sim',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
}

function startSimulator({ port = 7443, createdStreams = false } = {}) {
  const calls = [];
  const sim = { alarms: [] };
  const cameras = [
    { id: 'cam-door', name: 'Front door', type: 'G4 Doorbell Pro', isMotionDetected: false, featureFlags: { smartDetectTypes: ['person', 'package'] } },
    { id: 'cam-drive', name: 'Driveway', type: 'G5 Bullet', isMotionDetected: false, featureFlags: { smartDetectTypes: ['person', 'vehicle'] } },
    { id: 'cam-plain', name: 'Garage', type: 'G3 Instant', isMotionDetected: false, featureFlags: { smartDetectTypes: [] } },
  ];
  const streams = { 'cam-door': { high: `rtsps://127.0.0.1:7441/doorHIGH?enableSrtp`, medium: null, low: null }, 'cam-drive': { high: null }, 'cam-plain': createdStreams ? { high: null } : { high: null } };
  const sensors = [
    { id: 'sen-hall', name: 'Hall sensor', mountType: 'door', isOpened: false, isMotionDetected: false, stats: { temperature: { value: 21.5 }, humidity: { value: 40 }, light: { value: 12 } }, batteryStatus: { percentage: 90 } },
    // SuperLink (USL-*) — field shapes from a Protect 6.x bootstrap dump of a USL Environmental
    { id: 'usl-bath', name: 'Bathroom leak', type: 'USL-Environmental-EU', marketName: 'USL Environmental', mountType: 'leak', isOpened: null, isMotionDetected: false,
      leakDetectedAt: null, tamperingDetectedAt: null, stats: { temperature: { value: null }, humidity: { value: null }, light: { value: null } },
      batteryStatus: { percentage: 92, isLow: false }, bluetoothConnectionState: { signalQuality: 100, signalStrength: -38 }, bridge: 'usl-gw-1' },
    { id: 'usl-door', name: 'Back door', type: 'USL-Entry', marketName: 'USL Entry', mountType: 'door', isOpened: false, tamperingDetectedAt: null,
      batteryStatus: { percentage: 80, isLow: false }, bluetoothConnectionState: { signalStrength: -61 }, bridge: 'usl-gw-1' },
  ];
  const lights = [{ id: 'light-yard', name: 'Yard floodlight', isLightOn: false, isLightForceEnabled: false, isPirMotionDetected: false, isDark: true, lightModeSettings: { mode: 'motion' }, lightDeviceSettings: { ledLevel: 6 } }];
  const sirens = [{ id: 'siren-1', name: 'Siren', volume: 100, sirenStatus: { isActive: false } }];
  const relays = [{ id: 'relay-1', name: 'Gate relay', outputs: [{ id: 1, name: 'Gate', state: 'off' }, { id: 2, name: 'Lamp', state: 'off' }], inputs: [] }];
  const lists = { cameras, sensors, lights, sirens, relays };

  const server = https.createServer(selfSignedCert(), (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, body, key: req.headers['x-api-key'] || null });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) };
      if (req.headers['x-api-key'] !== 'simkey') return json(401, { error: 'Unauthorized' });
      if (!req.url.startsWith(BASE)) return json(404, { error: 'Not found' });
      const p = req.url.slice(BASE.length).split('?')[0];
      let b = {}; try { b = body ? JSON.parse(body) : {} } catch {}
      let m;
      if (p === '/meta/info') return json(200, { applicationVersion: '6.2.72' });
      if (req.method === 'GET' && lists[p.slice(1)]) return json(200, lists[p.slice(1)]);
      if ((m = p.match(/^\/cameras\/([^/]+)\/rtsps-stream$/))) {
        if (!streams[m[1]]) return json(404, { error: 'No camera' });
        if (req.method === 'POST') { for (const q of b.qualities || []) streams[m[1]][q] = `rtsps://127.0.0.1:7441/${m[1]}${q.toUpperCase()}?enableSrtp`; return json(200, streams[m[1]]) }
        return json(200, streams[m[1]]);
      }
      if ((m = p.match(/^\/cameras\/([^/]+)\/snapshot$/))) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])) }
      if ((m = p.match(/^\/lights\/([^/]+)$/)) && req.method === 'PATCH') {
        const l = lights.find((x) => x.id === m[1]); if (!l) return json(404, {});
        Object.assign(l, b); if ('isLightForceEnabled' in b) l.isLightOn = !!b.isLightForceEnabled;
        return json(200, l);
      }
      if ((m = p.match(/^\/sirens\/([^/]+)\/(play|stop)$/)) && req.method === 'POST') {
        const s = sirens.find((x) => x.id === m[1]); if (!s) return json(404, {});
        if (m[2] === 'play' && ![5, 10, 20, 30].includes(b.duration)) return json(400, { error: 'bad duration' });
        s.sirenStatus = m[2] === 'play' ? { isActive: true, duration: b.duration } : { isActive: false };
        return json(204);
      }
      if ((m = p.match(/^\/relays\/([^/]+)\/outputs\/(\d+)\/activate$/)) && req.method === 'POST') {
        const o = relays.find((x) => x.id === m[1])?.outputs.find((x) => x.id === Number(m[2])); if (!o) return json(404, {});
        o.state = b.state || (o.state === 'on' ? 'off' : 'on');
        return json(204);
      }
      if ((m = p.match(/^\/alarm-manager\/webhook\/(.+)$/)) && req.method === 'POST') { sim.alarms.push(decodeURIComponent(m[1])); return json(204) }
      json(404, { error: 'Not found' });
    });
  });

  const wssEvents = new WebSocketServer({ noServer: true });
  const wssDevices = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.headers['x-api-key'] !== 'simkey') { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy() }
    const wss = req.url === `${BASE}/subscribe/events` ? wssEvents : req.url === `${BASE}/subscribe/devices` ? wssDevices : null;
    if (!wss) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  const push = (wss, msg) => { for (const c of wss.clients) c.send(JSON.stringify(msg)) };
  sim.event = (msg) => push(wssEvents, msg);
  sim.device = (msg) => push(wssDevices, msg);
  sim.connected = () => wssEvents.clients.size + wssDevices.clients.size;

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(Object.assign(sim, {
    port: server.address().port, calls, lists, streams,
    close: () => new Promise((r) => { for (const w of [wssEvents, wssDevices]) for (const c of w.clients) c.terminate(); server.close(r) }),
  }))));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 7443;
  startSimulator({ port }).then((s) => console.log(`UniFi Protect simulator on https://127.0.0.1:${s.port} (X-API-Key "simkey")`));
}

module.exports = { startSimulator };
