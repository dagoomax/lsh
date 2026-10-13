#!/usr/bin/env node
'use strict';

// Minimal UGREEN PowerRoam cloud stand-in for testing src/ugreen-client.js:
// GET /app/v1/sa/encrypt/key (RSA key, PKCS#1 v1.5), POST /app/v1/login
// (account / password decrypted and checked: a@b.c / secret), GET
// /app/v1/device/list, POST /app/v1/device/setDeviceInfo, and the telemetry
// WebSocket /app/device/websocket/<userId>/<device> (header token) that answers
// the subscribe message and then pushes frames (sim.push()). Shapes follow
// github.com/tanka8/ugreen-powerroam (MIT) docs/sample_telemetry_frame.json.
//
//   node scripts/ugreen-simulator.js [port=8893]
// then config.ugreen = { email: 'a@b.c', password: 'secret',
//   apiBase: 'http://127.0.0.1:8893', wsBase: 'ws://127.0.0.1:8893' }

const http = require('http');
const crypto = require('crypto');
const WS = require('ws');
const WebSocketServer = WS.WebSocketServer || WS.Server;

function startSimulator({ port = 8893 } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const calls = [];
  const tokens = new Set();
  const dec = (b64) => crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(b64, 'base64')).toString();
  const device = { deviceModelName: 'G00XX0000000001', sn: 'G00XX0000000001', deviceAlias: 'PowerRoam 1200' };
  const state = {
    battery_percentage: 76, discharge_pow: 320, ac_discharge_pow: 300, car_discharge_pow: 0, usb_discharge_pow: 20, charge_power_all: 0,
    discharge_remain_time: 9840, charge_remain_time: 0, bat_temp1: 26, bat_temp2: 27, inverter_temp1: 33, inverter_temp2: 32,
    bat_health: 100, bat_cycle_num: 12, cell1_vol: 3299, cell2_vol: 3301, cell3_vol: 3300, cell4_vol: 3300, cell5_vol: 3300, cell6_vol: 3299, cell7_vol: 3300,
    switch_ac: 1, switch_dc: 0, usb_sw: 1, lamp_sw: 0, deviceModelName: device.deviceModelName,
  };
  const sim = { state, calls, device, expireTokens: () => tokens.clear() };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, body });
      const ok = (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ errcode: 200, errmsg: 'success', result })) };
      const err = (code, msg) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ errcode: code, errmsg: msg })) };
      if (req.url === '/app/v1/sa/encrypt/key') return ok({ encryptKey: der, uuid: crypto.randomUUID() });
      if (req.url === '/app/v1/login') {
        const b = JSON.parse(body || '{}');
        let a, p; try { a = dec(b.account); p = dec(b.password) } catch { return err(400, 'decrypt failed') }
        if (a !== 'a@b.c' || p !== 'secret') return err(10003, 'account or password error');
        const t = crypto.randomBytes(16).toString('hex'); tokens.add(t);
        return ok({ token: t, userId: '12345', device: [] });
      }
      if (!tokens.has(req.headers.token)) return err(401, 'token invalid');
      if (req.url.startsWith('/app/v1/device/list')) return ok([device]);
      if (req.url === '/app/v1/device/setDeviceInfo') {
        const b = JSON.parse(body || '{}');
        if (b.deviceName !== device.deviceModelName) return err(400, 'no device');
        Object.assign(state, b.map); return ok(null);
      }
      err(404, 'not found');
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const m = req.url.match(/^\/app\/device\/websocket\/([^/]+)\/([^/]+)$/);
    if (!m || !tokens.has(req.headers.token) || m[2] !== device.deviceModelName) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy() }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw) } catch { return }
        if (msg.content === 'ugreenSocketConnection') { ws.send(JSON.stringify({ message: 'success' })); ws.send(JSON.stringify(state)) }
      });
    });
  });
  sim.push = () => { for (const c of wss.clients) c.send(JSON.stringify(state)) };
  sim.dropSockets = () => { for (const c of wss.clients) c.terminate() };
  sim.connected = () => wss.clients.size;
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(Object.assign(sim, {
    port: server.address().port, close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); server.close(r) }),
  }))));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8893;
  startSimulator({ port }).then((s) => console.log(`UGREEN cloud simulator on http://127.0.0.1:${s.port} (a@b.c / secret)`));
}

module.exports = { startSimulator };
