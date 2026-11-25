#!/usr/bin/env node
'use strict';

// Minimal tado° stand-in for testing src/tado-client.js: the OAuth
// device-code sign-in (login.tado.com/oauth2) and the my.tado.com/api/v2
// calls the client makes, with a home of three zones — heating, hot water,
// Smart AC — and the ratelimit headers tado sends.
//
//   node scripts/tado-simulator.js [port=8905]
// then config.tado = { enabled: true, apiBase: 'http://127.0.0.1:8905/api/v2',
//   authBase: 'http://127.0.0.1:8905/oauth2' } and sign in from Settings; the
//   simulator confirms a code once it has been asked about twice.

const http = require('http');

function startSimulator({ port = 8905, dailyLimit = 100, bulk = true } = {}) {
  const calls = [];
  let remaining = dailyLimit;
  let tokenN = 0;
  const tokens = { access: new Set(), refresh: new Set() };
  const pending = new Map(); // device_code → polls so far
  const home = { id: 4711, name: 'Dom' };
  const presence = { presence: 'HOME', presenceLocked: false };
  const zones = [
    { id: 1, name: 'Salon', type: 'HEATING', devices: [{ deviceType: 'VA02', serialNo: 'VA1', batteryState: 'NORMAL' }, { deviceType: 'RU02', serialNo: 'RU1', batteryState: 'LOW' }] },
    { id: 2, name: 'Sypialnia', type: 'HEATING', devices: [{ deviceType: 'VA02', serialNo: 'VA2', batteryState: 'NORMAL' }] },
    { id: 0, name: 'Ciepła woda', type: 'HOT_WATER', devices: [{ deviceType: 'BX02', serialNo: 'BX1' }] },
    { id: 3, name: 'Sypialnia AC', type: 'AIR_CONDITIONING', devices: [{ deviceType: 'WR02', serialNo: 'WR1' }] },
  ];
  const caps = {
    0: { type: 'HOT_WATER', canSetTemperature: true, temperatures: { celsius: { min: 30, max: 65, step: 1 } } },
    3: {
      type: 'AIR_CONDITIONING',
      COOL: { temperatures: { celsius: { min: 16, max: 30, step: 1 } }, fanLevel: ['LEVEL1', 'LEVEL2', 'LEVEL3', 'AUTO'], verticalSwing: ['OFF', 'ON'] },
      HEAT: { temperatures: { celsius: { min: 16, max: 30, step: 1 } }, fanLevel: ['LEVEL1', 'LEVEL2', 'LEVEL3', 'AUTO'], verticalSwing: ['OFF', 'ON'] },
      DRY: { verticalSwing: ['OFF', 'ON'] },
      FAN: { fanLevel: ['LEVEL1', 'LEVEL2', 'LEVEL3', 'AUTO'], verticalSwing: ['OFF', 'ON'] },
    },
  };
  const schedule = {
    1: { type: 'HEATING', power: 'ON', temperature: { celsius: 20 } },
    2: { type: 'HEATING', power: 'ON', temperature: { celsius: 18 } },
    0: { type: 'HOT_WATER', power: 'ON', temperature: { celsius: 50 } },
    3: { type: 'AIR_CONDITIONING', power: 'OFF' },
  };
  const overlays = {};
  const state = (z) => {
    const ov = overlays[z.id];
    const s = {
      tadoMode: presence.presence, setting: ov ? ov.setting : schedule[z.id], overlayType: ov ? 'MANUAL' : null, overlay: ov || null,
      openWindow: null, link: { state: 'ONLINE' },
    };
    if (z.type === 'HEATING') {
      s.sensorDataPoints = { insideTemperature: { celsius: 19.4 }, humidity: { percentage: 52.3 } };
      s.activityDataPoints = { heatingPower: { percentage: s.setting.power === 'ON' ? 35 : 0 } };
    }
    if (z.type === 'AIR_CONDITIONING') s.sensorDataPoints = { insideTemperature: { celsius: 24.8 }, humidity: { percentage: 45 } };
    return s;
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: u.pathname, body });
      const json = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)) };

      // ── OAuth ──
      if (u.pathname.startsWith('/oauth2/')) {
        const f = new URLSearchParams(body);
        if (f.get('client_id') !== '1bb50063-6b0c-4d11-bd99-387f4a91cc46') return json(400, { error: 'invalid_client' });
        const issue = () => {
          const a = `acc-${++tokenN}`, r = `ref-${tokenN}`;
          tokens.access.add(a); tokens.refresh.add(r);
          return json(200, { access_token: a, refresh_token: r, expires_in: 599, token_type: 'Bearer' });
        };
        if (u.pathname === '/oauth2/device_authorize') {
          const code = `dev-${pending.size + 1}`;
          pending.set(code, 0);
          return json(200, { device_code: code, user_code: 'ABC123', verification_uri: 'https://login.tado.com/oauth2/device', verification_uri_complete: 'https://login.tado.com/oauth2/device?user_code=ABC123', expires_in: 300, interval: 0 });
        }
        if (u.pathname === '/oauth2/token') {
          if (f.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
            const n = pending.get(f.get('device_code'));
            if (n === undefined) return json(400, { error: 'expired_token' });
            pending.set(f.get('device_code'), n + 1);
            if (n < 1) return json(400, { error: 'authorization_pending' });
            pending.delete(f.get('device_code'));
            return issue();
          }
          if (f.get('grant_type') === 'refresh_token') {
            // rotating: each refresh token works once
            if (!tokens.refresh.delete(f.get('refresh_token'))) return json(400, { error: 'invalid_grant' });
            return issue();
          }
        }
        return json(400, { error: 'unsupported_grant_type' });
      }

      // ── API ──
      const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (!auth || !tokens.access.has(auth[1])) return json(401, { errors: [{ code: 'unauthorized', title: 'Unauthorized' }] });
      if (remaining <= 0) return json(429, { errors: [{ title: 'Too many requests' }] });
      remaining--;
      const rl = { 'ratelimit-policy': `"perday";q=${dailyLimit};w=86400`, ratelimit: `"perday";r=${remaining};t=3600` };
      const ok = (obj, code = 200) => json(code, obj, rl);
      const p = u.pathname.replace(/^\/api\/v2/, '');
      let m;
      if (req.method === 'GET' && p === '/me') return ok({ name: 'Test', email: 'test@example.com', homes: [home] });
      if (req.method === 'GET' && p === `/homes/${home.id}/zones`) return ok(zones);
      if (req.method === 'GET' && p === `/homes/${home.id}/zoneStates`) return ok({ zoneStates: Object.fromEntries(zones.map((z) => [String(z.id), state(z)])) });
      if (req.method === 'GET' && p === `/homes/${home.id}/state`) return ok(presence);
      if ((m = /^\/homes\/\d+\/zones\/(\d+)\/capabilities$/.exec(p))) return caps[m[1]] ? ok(caps[m[1]]) : ok({ type: 'HEATING' });
      if ((m = /^\/homes\/\d+\/zones\/(\d+)\/overlay$/.exec(p))) {
        if (req.method === 'DELETE') { delete overlays[m[1]]; return json(204, undefined, rl) }
        if (req.method === 'PUT') {
          const b = JSON.parse(body || '{}');
          const z = zones.find((x) => String(x.id) === m[1]);
          if (!z || b.setting?.type !== z.type) return ok({ errors: [{ title: 'wrong setting type' }] }, 422);
          if (z.type === 'AIR_CONDITIONING' && b.setting.power === 'ON') {
            const c = caps[3][b.setting.mode];
            if (!c) return ok({ errors: [{ title: `mode ${b.setting.mode}` }] }, 422);
            if (b.setting.fanLevel && !(c.fanLevel || []).includes(b.setting.fanLevel)) return ok({ errors: [{ title: `fanLevel ${b.setting.fanLevel}` }] }, 422);
            if (b.setting.temperature && !c.temperatures) return ok({ errors: [{ title: 'no temperature in this mode' }] }, 422);
          }
          overlays[m[1]] = { type: 'MANUAL', setting: b.setting, termination: { type: b.termination?.typeSkillBasedApp || 'MANUAL' } };
          return ok(overlays[m[1]]);
        }
      }
      // several rooms at once (bulk: false = an account where tado refuses it)
      if (p === `/homes/${home.id}/overlay` && bulk) {
        if (req.method === 'DELETE') { for (const r of (u.searchParams.get('rooms') || '').split(',')) delete overlays[r]; return json(204, undefined, rl) }
        if (req.method === 'POST') {
          const b = JSON.parse(body || '{}');
          for (const { room, overlay } of b.overlays || []) {
            const z = zones.find((x) => String(x.id) === String(room));
            if (!z || overlay?.setting?.type !== z.type) return ok({ errors: [{ title: `room ${room}: wrong setting type` }] }, 422);
          }
          for (const { room, overlay } of b.overlays) overlays[room] = { type: 'MANUAL', setting: overlay.setting, termination: { type: overlay.termination?.typeSkillBasedApp || 'MANUAL' } };
          return json(204, undefined, rl);
        }
      }
      if (p === `/homes/${home.id}/presenceLock`) {
        if (req.method === 'DELETE') { presence.presenceLocked = false; return json(204, undefined, rl) }
        if (req.method === 'PUT') { const b = JSON.parse(body || '{}'); presence.presence = b.homePresence; presence.presenceLocked = true; return json(204, undefined, rl) }
      }
      json(404, { errors: [{ title: 'not found' }] }, rl);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, calls, home, zones, overlays, presence, tokens,
    get remaining() { return remaining },
    close: () => new Promise((r) => server.close(r)),
  })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8905;
  startSimulator({ port }).then((s) => console.log(`tado simulator on http://127.0.0.1:${s.port} (apiBase /api/v2, authBase /oauth2)`));
}

module.exports = { startSimulator };
