#!/usr/bin/env node
'use strict';

// Minimal Daikin Wi-Fi adapter stand-in (BRP069 / BRP072A local HTTP API) for
// testing src/daikin-client.js: /common/basic_info, /aircon/get_control_info,
// /aircon/get_sensor_info, /aircon/set_control_info. With `key`, behaves like
// a BRP072C: every request needs a registered X-Daikin-uuid (served over plain
// HTTP here — the client's https handling isn't exercised).
//
//   node scripts/daikin-simulator.js [port=8901]
// then config.daikin = { devices: [{ host: '127.0.0.1:8901' }] }

const http = require('http');

function startSimulator({ port = 8901, key = null } = {}) {
  const calls = [];
  const uuids = new Set();
  const ctl = { pow: '1', mode: '3', adv: '', stemp: '24.0', shum: '0', f_rate: 'A', f_dir: '0',
    dt1: '25.0', dt2: 'M', dt3: '24.0', dt4: '21.0', dt5: '25.0', dt7: '25.0', dh1: 'AUTO', dh2: '50', dh3: '0', dh4: '0', dh5: '0', dh7: 'AUTO' };
  const sensor = { htemp: '23.5', hhum: '-', otemp: '31.0', err: '0', cmpfreq: '22' };
  const fmt = (o) => `ret=OK,${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(',')}`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams) });
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(body) };
    if (key) {
      const id = req.headers['x-daikin-uuid'];
      if (!id) return send(403, 'Forbidden');
      if (u.pathname === '/common/register_terminal') {
        if (u.searchParams.get('key') !== key) return send(403, 'ret=PARAM NG');
        uuids.add(id); return send(200, 'ret=OK');
      }
      if (!uuids.has(id)) return send(403, 'Forbidden');
    }
    if (u.pathname === '/common/basic_info') return send(200, fmt({ type: 'aircon', reg: 'eu', ver: '3_3_9', pow: ctl.pow, err: '0', name: '%4c%69%76%69%6e%67', mac: 'A0B1C2D3E4F5', adp_kind: '3' }));
    if (u.pathname === '/aircon/get_control_info') return send(200, fmt(ctl));
    if (u.pathname === '/aircon/get_sensor_info') return send(200, fmt(sensor));
    if (u.pathname === '/aircon/set_control_info') {
      const q = Object.fromEntries(u.searchParams);
      for (const k of ['pow', 'mode', 'stemp', 'shum', 'f_rate', 'f_dir']) if (q[k] === undefined) return send(200, 'ret=PARAM NG');
      Object.assign(ctl, q);
      if (ctl[`dt${q.mode}`] !== undefined) ctl[`dt${q.mode}`] = q.stemp;
      return send(200, 'ret=OK,adv=');
    }
    send(404, 'ret=NG');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, calls, ctl, sensor, close: () => new Promise((r) => server.close(r)) })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8901;
  startSimulator({ port }).then((s) => console.log(`Daikin adapter simulator on http://127.0.0.1:${s.port}`));
}

module.exports = { startSimulator };
