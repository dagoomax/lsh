'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const RingClient = require('../src/ring-client');
const { RingAuth, parseRefreshToken } = RingClient;

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

// A stand-in for the Ring cloud: OAuth with a verification code and rotating
// refresh tokens, the device list, events, snapshots, light and siren.
async function fakeRing() {
  const state = { n: 0, calls: [], valid: new Set(), access: new Set(), light: 'off', siren: 0, snaps: 0, expireAccess: false,
    eventAt: new Date().toISOString() };
  const issue = () => {
    const rt = `rt-${++state.n}`, at = `at-${state.n}`;
    state.valid = new Set([rt]); state.access.add(at); // the previous refresh token dies
    return { access_token: at, refresh_token: rt, expires_in: 3600 };
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c }).on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const url = new URL(req.url, 'http://x');
      state.calls.push({ method: req.method, path: url.pathname, headers: req.headers, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) };
      if (url.pathname === '/oauth/token') {
        if (body.grant_type === 'password') {
          if (body.password !== 'secret') return json(401, { error: 'access_denied', error_description: 'invalid user credentials' });
          if (!req.headers['2fa-code']) return json(412, { tsv_state: 'sms', phone: '+48•••123' });
          if (req.headers['2fa-code'] !== '123456') return json(400, { error: 'Verification Code is invalid or expired' });
          state.hid = req.headers.hardware_id;
          return json(200, issue());
        }
        if (!state.valid.has(body.refresh_token)) return json(401, { error: 'invalid_grant', error_description: 'token is invalid or has already been used' });
        return json(200, issue());
      }
      const token = String(req.headers.authorization || '').replace('Bearer ', '');
      if (state.expireAccess) { state.expireAccess = false; state.access.delete(token) }
      if (!state.access.has(token)) return json(401, {});
      if (url.pathname === '/clients_api/session') return json(200, { profile: {} });
      if (url.pathname === '/clients_api/ring_devices') {
        return json(200, {
          doorbots: [{ id: 11, description: 'Front Door', kind: 'doorbell_v4', location_id: 'loc1', battery_life: '74', battery_life_2: null,
            alerts: { connection: 'online' }, settings: { motion_detection_enabled: true } }],
          authorized_doorbots: [],
          stickup_cams: [{ id: 22, description: 'Garden', kind: 'floodlight_v2', location_id: 'loc1', battery_life: null,
            alerts: { connection: 'online' }, settings: { motion_detection_enabled: true, power_mode: 'wired' },
            led_status: state.light, siren_status: { seconds_remaining: state.siren } }],
          chimes: [{ id: 33, description: 'Hall chime' }],
        });
      }
      let m = /^\/clients_api\/locations\/loc1\/devices\/(\d+)\/events$/.exec(url.pathname);
      if (m) return json(200, { events: m[1] === '11' ? [{ created_at: state.eventAt, kind: 'ding' }] : [] });
      m = /^\/clients_api\/doorbots\/22\/(floodlight_light_(on|off)|siren_(on|off))$/.exec(url.pathname);
      if (m && req.method === 'PUT') {
        if (m[2]) state.light = m[2]; else state.siren = m[3] === 'on' ? 30 : 0;
        return json(200, {});
      }
      m = /^\/snapshots\/next\/(\d+)$/.exec(url.pathname);
      if (m && url.searchParams.get('extras') === 'force') {
        state.snaps++;
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200, state.snaps), Buffer.from([0xff, 0xd9])]));
      }
      json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    endpoints: { oauth: `${base}/oauth/token`, api: `${base}/clients_api/`, snapshots: `${base}/snapshots/next/` },
    close: () => new Promise((r) => server.close(r)),
  };
}

test('Ring: refresh token formats', () => {
  assert.deepEqual(parseRefreshToken('abc.def'), { rt: 'abc.def', hid: null });
  const wrapped = Buffer.from(JSON.stringify({ rt: 'tok', hid: 'h-1' })).toString('base64');
  assert.deepEqual(parseRefreshToken(wrapped), { rt: 'tok', hid: 'h-1' });
  assert.equal(parseRefreshToken(''), null);
});

test('Ring: sign-in with a verification code, cameras, snapshots, light and siren', async () => {
  const ring = await fakeRing();
  const authFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-ring-')), 'ring-auth.json');
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const v = (k) => store.values[`ring/${k}`];
  let c;
  try {
    const auth = new RingAuth({ authFile, endpoints: ring.endpoints });
    await assert.rejects(auth.login('me@example.com', 'wrong'), /invalid user credentials/);
    const first = await auth.login('me@example.com', 'secret');
    assert.equal(first.needs2fa, true); assert.match(first.prompt, /sent to \+48•••123 by sms/);
    await assert.rejects(auth.login('me@example.com', 'secret', '000000'), /Wrong verification code/);
    assert.deepEqual(await auth.login('me@example.com', 'secret', '123456'), { ok: true });
    // the code went out with the hardware id that asked for it, and no password was kept
    const logins = ring.state.calls.filter((x) => x.body.grant_type === 'password');
    assert.equal(new Set(logins.map((x) => x.headers.hardware_id)).size, 1);
    assert.equal(JSON.parse(fs.readFileSync(authFile, 'utf8')).rt, 'rt-1');
    assert.doesNotMatch(fs.readFileSync(authFile, 'utf8'), /secret/);

    c = new RingClient({ ring: { authFile, endpoints: ring.endpoints, pollInterval: 600 } }, store, registry);
    await c.start();
    assert.equal(JSON.parse(fs.readFileSync(authFile, 'utf8')).rt, 'rt-2'); // rotated token saved
    assert.equal(registry.devices.get('ring/11').label, 'Front Door');
    assert.equal(registry.devices.get('ring/22').label, 'Garden');
    assert.equal(registry.devices.has('ring/33'), false); // chimes are not cameras
    assert.equal(v('11/online'), 1); assert.equal(v('11/battery'), 74);
    assert.equal(v('11/ding'), 1); assert.equal(v('11/lastEvent'), 'ding'); assert.equal(v('11/motion'), 0);
    assert.equal(registry.devices.get('ring/22').sensors.some((s) => s.path === 'battery'), false);
    assert.equal(v('22/light'), 0); assert.equal(v('22/siren'), 0);
    const session = ring.state.calls.find((x) => x.path === '/clients_api/session');
    assert.equal(session.body.device.hardware_id, ring.state.hid);

    await registry.sendCommand('ring/22', 'light', 'on');
    assert.equal(ring.state.light, 'on'); assert.equal(v('22/light'), 1);
    await registry.sendCommand('ring/22', 'siren', 'on');
    assert.equal(ring.state.siren, 30);
    await registry.sendCommand('ring/22', 'siren', 'off');
    assert.equal(ring.state.siren, 0); assert.equal(v('22/siren'), 0);

    // snapshots: cached per camera (the doorbell runs on battery → minutes)
    const a = await c.getSnapshot('11'), b = await c.getSnapshot(11);
    assert.equal(a[0], 0xff); assert.equal(a, b); assert.equal(ring.state.snaps, 1);
    await assert.rejects(c.getSnapshot('99'), /Unknown Ring camera/);
    assert.deepEqual(c.getCameras().map((x) => [x.name, x.snapshotUrl]), [['Front Door', '/api/ring/snapshot/11'], ['Garden', '/api/ring/snapshot/22']]);

    // an expired access token is refreshed and the request repeated
    ring.state.expireAccess = true;
    await c._poll();
    assert.equal(JSON.parse(fs.readFileSync(authFile, 'utf8')).rt, 'rt-3');
    assert.equal(c.status().cameras.length, 2);
  } finally { c?.stop(); await ring.close() }
});
