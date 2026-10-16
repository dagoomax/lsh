#!/usr/bin/env node
'use strict';

// EZVIZ cloud stand-in for testing src/ezviz-client.js — the calls pyEzviz
// makes: sign-in (region redirect, e-mail code), session refresh, the device
// page list, latest alarm, switches, defence (motion detection), siren, PTZ.
// Devices: a PTZ camera, a battery camera, a doorbell and a smart plug.
//
//   node scripts/ezviz-simulator.js [port=8909]
// then config.ezviz = { username: 'user@example.com', password: 'secret', apiBase: 'http://127.0.0.1:8909' }

const http = require('http');
const crypto = require('crypto');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function startSimulator({ port = 8909, password = 'secret', mfa = false } = {}) {
  const sim = { calls: [], sessions: new Set(), mfa, alarms: {}, passwordMd5: md5(password) };
  const devices = [
    { deviceSerial: 'C6N111', name: 'Salon', deviceCategory: 'IPC', deviceType: 'CS-C6N', status: 1, version: 'V5.3.0', supportExt: JSON.stringify({ 154: '1' }) },
    { deviceSerial: 'BC1222', name: 'Ogród', deviceCategory: 'BatteryCamera', deviceType: 'CS-BC1C', status: 1, version: 'V5.3.4', supportExt: '{}' },
    { deviceSerial: 'DB1333', name: 'Drzwi', deviceCategory: 'BDoorBell', deviceType: 'CS-DB1C', status: 0, version: 'V5.2.4', supportExt: '{}' },
    { deviceSerial: 'T30444', name: 'Gniazdko', deviceCategory: 'Socket', deviceType: 'CS-T30', status: 1, version: 'V1.0.2', supportExt: '{}' },
  ];
  const state = {
    switches: { C6N111: { 7: false, 21: false, 3: true, 303: false }, BC1222: { 21: false }, DB1333: { 3: true }, T30444: { 14: true } },
    defence: { C6N111: 1, BC1222: 0, DB1333: 1 },
    siren: {},
  };
  sim.state = state;
  sim.alarms.C6N111 = { alarmStartTimeStr: 'Today 10:00:00', alarmStartTime: Date.now() - 20000, sampleName: 'Motion', picUrl: 'https://example.invalid/alarm.jpg' };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const form = Object.fromEntries(new URLSearchParams(body));
      sim.calls.push({ method: req.method, path: u.pathname, form, query: Object.fromEntries(u.searchParams) });
      const json = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
      const ok = (extra = {}) => json({ meta: { code: 200, message: 'OK' }, ...extra });
      if (u.pathname === '/v3/users/login/v5') {
        if (form.password !== sim.passwordMd5) return json({ meta: { code: 1014, message: 'password error' } });
        if (sim.mfa && form.smsCode !== '123456') return json({ meta: { code: form.smsCode ? 1012 : 6002, message: 'verify' } });
        const sid = `s-${crypto.randomBytes(4).toString('hex')}`;
        sim.sessions.add(sid);
        return ok({ loginSession: { sessionId: sid, rfSessionId: `rf-${sid}` }, loginUser: { username: 'user' }, loginArea: { apiDomain: `127.0.0.1:${server.address().port}` } });
      }
      if (u.pathname === '/v3/sms/nologin/checkcode') return ok();
      if (u.pathname === '/v3/apigateway/login') {
        const sid = `s-${crypto.randomBytes(4).toString('hex')}`;
        sim.sessions.add(sid);
        return ok({ sessionInfo: { sessionId: sid, refreshSessionId: `rf-${sid}` } });
      }
      if (!sim.sessions.has(req.headers.sessionid)) return json({ meta: { code: 401, message: 'session invalid' } }, 401);
      if (u.pathname === '/v3/userdevices/v1/resources/pagelist') {
        const by = (fn) => Object.fromEntries(devices.map((d) => [d.deviceSerial, fn(d)]));
        return ok({
          deviceInfos: devices,
          STATUS: by((d) => ({ globalStatus: state.defence[d.deviceSerial] || 0, optionals: d.deviceCategory === 'BatteryCamera' ? JSON.stringify({ powerRemaining: 78 }) : {} })),
          SWITCH: by((d) => Object.entries(state.switches[d.deviceSerial] || {}).map(([type, enable]) => ({ type: Number(type), enable }))),
          CONNECTION: by((d) => ({ localIp: d.deviceSerial === 'C6N111' ? '192.168.1.60' : '0.0.0.0', localRtspPort: 554 })),
          WIFI: by(() => ({ address: '0.0.0.0' })),
        });
      }
      if (u.pathname === '/v3/alarms/v2/advanced') {
        const a = sim.alarms[u.searchParams.get('deviceSerials')];
        return ok({ page: { totalResults: a ? 1 : 0 }, alarms: a ? [a] : [] });
      }
      let m = /^\/v3\/devices\/(\w+)\/(\d+)\/(\d)\/(\d+)\/switchStatus$/.exec(u.pathname);
      if (m && req.method === 'PUT') { (state.switches[m[1]] ||= {})[m[4]] = m[3] === '1'; return ok() }
      m = /^\/v3\/devices\/(\w+)\/1\/changeDefenceStatusReq$/.exec(u.pathname);
      if (m) { state.defence[m[1]] = Number(form.status); return ok() }
      m = /^\/v3\/devices\/(\w+)\/0\/sendAlarm$/.exec(u.pathname);
      if (m) { state.siren[m[1]] = Number(form.enable); return ok() }
      m = /^\/v3\/devices\/(\w+)\/ptzControl$/.exec(u.pathname);
      if (m) return ok();
      json({ meta: { code: 404, message: `no such API ${u.pathname}` } });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    sim.port = server.address().port;
    sim.expireSessions = () => sim.sessions.clear();
    sim.close = () => new Promise((r) => server.close(() => r()));
    resolve(sim);
  }));
}

module.exports = { startSimulator };
if (require.main === module) startSimulator({ port: Number(process.argv[2]) || 8909 }).then((s) => console.log(`EZVIZ simulator on http://127.0.0.1:${s.port}`));
