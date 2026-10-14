#!/usr/bin/env node
'use strict';

// Minimal MELCloud stand-in for testing src/melcloud-client.js:
// /Login/ClientLogin, /User/ListDevices, /Device/Get, /Device/SetAta
// (applies only the fields named by EffectiveFlags, like the real service).
//
//   node scripts/melcloud-simulator.js [port=8902]
// then config.melcloud = { email: 'a@b.c', password: 'pw', apiBase: 'http://127.0.0.1:8902' }

const http = require('http');

function startSimulator({ port = 8902, email = 'user@example.com', password = 'secret' } = {}) {
  const calls = [];
  const token = 'CTX-1234';
  const ata = {
    DeviceID: 4711, DeviceType: 0, Power: true, OperationMode: 3, SetTemperature: 23, RoomTemperature: 25.5,
    SetFanSpeed: 0, NumberOfFanSpeeds: 5, VaneVertical: 0, VaneHorizontal: 0, Offline: false, OutdoorTemperature: 30,
    MinTempCoolDry: 16, MaxTempCoolDry: 31, MinTempHeat: 10, MaxTempHeat: 31, HasOutdoorTemperature: true,
  };
  const listDevice = () => ({
    DeviceID: ata.DeviceID, DeviceName: 'Living room', BuildingID: 99,
    Device: { ...ata, FanSpeed: ata.SetFanSpeed, VaneVerticalDirection: ata.VaneVertical },
  });
  const FLAGS = { 0x1: 'Power', 0x2: 'OperationMode', 0x4: 'SetTemperature', 0x8: 'SetFanSpeed', 0x10: 'VaneVertical', 0x100: 'VaneHorizontal' };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: u.pathname, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
      if (u.pathname === '/Login/ClientLogin') {
        const b = JSON.parse(body || '{}');
        if (b.Email !== email || b.Password !== password) return json(200, { ErrorId: 1, ErrorMessage: null, LoginData: null });
        return json(200, { ErrorId: null, LoginData: { ContextKey: token } });
      }
      if (req.headers['x-mitscontextkey'] !== token) return json(401, {});
      if (u.pathname === '/User/ListDevices') return json(200, [{ ID: 99, Name: 'Home', Structure: { Devices: [], Areas: [], Floors: [{ Devices: [listDevice()], Areas: [] }] } }]);
      if (u.pathname === '/Device/Get') return json(200, { ...ata });
      if (u.pathname === '/Device/SetAta') {
        const b = JSON.parse(body || '{}');
        for (const [bit, field] of Object.entries(FLAGS)) if (b.EffectiveFlags & Number(bit)) ata[field] = b[field];
        return json(200, { ...ata, HasPendingCommand: true });
      }
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, calls, ata, email, password, close: () => new Promise((r) => server.close(r)) })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8902;
  startSimulator({ port }).then((s) => console.log(`MELCloud simulator on http://127.0.0.1:${s.port} (${s.email} / ${s.password})`));
}

module.exports = { startSimulator };
