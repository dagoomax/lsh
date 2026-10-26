'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const L = require('../src/locations');

// A stand-in for another LSH: admin login → session cookie, API tokens, devices,
// plus the real /site/summary and /auth/handoff from src/routes/locations.js
function remoteLsh() {
  const tokens = [];
  const commands = [];
  const sessions = new Set();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.path === '/api/auth/login' || req.path.startsWith('/api/auth/handoff/')) return next();
    const b = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (tokens.some((t) => t.token === b)) { req.user = { id: 'api-token', role: 'admin' }; return next() }
    if (sessions.has(b)) { req.user = { id: 'u1', username: 'admin', role: 'admin' }; return next() }
    const c = /lsh-session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (c && c.startsWith('jwt:')) { req.user = JSON.parse(Buffer.from(c.slice(4), 'base64url')); return next() }
    res.status(401).json({ success: false, error: 'Authentication required' });
  });
  const router = express.Router();
  router.post('/auth/login', (req, res) => {
    if (req.body.username !== 'admin' || req.body.password !== 'pw') return res.status(401).json({ success: false, error: 'Invalid username or password' });
    const s = `sess${sessions.size}`; sessions.add(s);
    res.cookie('lsh-session', s).json({ success: true, user: { id: 'u1', username: 'admin', role: 'admin' } });
  });
  router.post('/auth/logout', (req, res) => res.json({ success: true }));
  router.post('/auth/tokens', (req, res) => { const t = { id: `t${tokens.length}`, name: req.body.name, token: `tok${tokens.length}x`, createdAt: new Date().toISOString() }; tokens.push(t); res.json({ success: true, token: t.token }) });
  router.get('/auth/tokens', (req, res) => res.json({ success: true, data: tokens.map(({ token, ...t }) => t) }));
  router.delete('/auth/tokens/:id', (req, res) => { const i = tokens.findIndex((t) => t.id === req.params.id); if (i >= 0) tokens.splice(i, 1); res.json({ success: true }) });
  router.get('/devices', (req, res) => res.json({ success: true, data: [{ key: 'shelly/lamp', label: 'Lamp' }] }));
  router.post('/device/:key(*)/command', (req, res) => { commands.push({ key: req.params.key, ...req.body, hubUser: req.headers['x-lsh-hub-user'] }); res.json({ success: true }) });
  require('../src/routes/locations')(router, {
    clients: {}, requireAdmin: (req, res, next) => next(), sensorRegistry: { getDevices: () => [{ key: 'shelly/lamp' }] }, reqIsSecure: () => false,
    auth: { signToken: (u, o) => `jwt:${Buffer.from(JSON.stringify({ ...u, ...o.extra })).toString('base64url')}`, setCookie: (res, t) => res.cookie('lsh-session', t) },
  });
  app.use('/api', router);
  return new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${s.address().port}`, tokens, commands, close: () => s.close() })) });
}

function hub(role = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 'h1', username: 'anna', role: req.headers['x-role'] || role }; next() });
  const router = express.Router();
  const requireAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ success: false, error: 'Admin access required' }));
  require('../src/routes/locations')(router, { clients: {}, requireAdmin, sensorRegistry: { getDevices: () => [] }, auth: null });
  app.use('/api', router);
  return new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() })) });
}

const call = async (base, method, p, body, headers = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data, headers: r.headers };
};

test('locations: url normalising, token never shown', () => {
  assert.equal(L.normalizeUrl('http://192.168.1.49:3000/react/'), 'http://192.168.1.49:3000');
  assert.throws(() => L.normalizeUrl('ftp://x'), /http/);
  assert.throws(() => L.normalizeUrl('https://a:b@x'), /password/);
  assert.deepEqual(L.publicView({ id: '1', token: 'secret', name: 'x' }), { id: '1', name: 'x', hasToken: true });
});

test('locations: pairing, overview, proxy with inherited role, handoff, revoke', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-'));
  L.setFile(path.join(dir, 'locations.json'));
  const remote = await remoteLsh();
  const h = await hub();
  try {
    // wrong login → nothing saved
    let r = await call(h.url, 'POST', '/api/locations', { name: 'Wrocław', url: remote.url, username: 'admin', password: 'nope' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Invalid username/);
    assert.equal(L.load().length, 0);

    // pairing: the location issues a token to this hub; the password isn't kept
    r = await call(h.url, 'POST', '/api/locations', { name: 'Wrocław', url: `${remote.url}/react/`, username: 'admin', password: 'pw' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.data.hasToken, true);
    assert.equal(r.data.data.token, undefined, 'token never returned');
    const saved = L.load()[0];
    assert.equal(saved.url, remote.url);
    assert.equal(saved.tokenName, `LSH hub: ${os.hostname()}`);
    assert.equal(saved.token, remote.tokens[0].token);
    assert.ok(!JSON.stringify(saved).includes('"pw"'), 'password not stored');
    assert.equal((fs.statSync(path.join(dir, 'locations.json')).mode & 0o777).toString(8), '600');

    r = await call(h.url, 'GET', '/api/locations/overview');
    const s = r.data.data[0].summary;
    assert.equal(s.state, 'online');
    assert.equal(s.devices, 1);
    assert.ok(s.version);

    // proxy: reads for everyone, commands for admins, account management never
    r = await call(h.url, 'GET', `/api/locations/${saved.id}/api/devices`, null, { 'x-role': 'viewer' });
    assert.deepEqual(r.data.data, [{ key: 'shelly/lamp', label: 'Lamp' }]);
    r = await call(h.url, 'POST', `/api/locations/${saved.id}/api/device/shelly%2Flamp/command`, { sensor: 'switch', value: 1 }, { 'x-role': 'viewer' });
    assert.equal(r.status, 403);
    r = await call(h.url, 'POST', `/api/locations/${saved.id}/api/device/shelly%2Flamp/command`, { sensor: 'switch', value: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(remote.commands[0], { key: 'shelly/lamp', sensor: 'switch', value: 1, hubUser: `anna@${os.hostname()}` });
    r = await call(h.url, 'GET', `/api/locations/${saved.id}/api/auth/tokens`);
    assert.equal(r.status, 403, 'token list not reachable through the hub');

    // "Open": a one-time link signing the browser in as anna@<hub> with her role
    r = await call(h.url, 'POST', `/api/locations/${saved.id}/open`, null, { 'x-role': 'viewer' });
    assert.equal(r.data.data.handoff, true);
    const link = r.data.data.url;
    const first = await fetch(link, { redirect: 'manual' });
    assert.equal(first.status, 302);
    const jwt = /lsh-session=jwt%3A([^;]+)|lsh-session=jwt:([^;]+)/.exec(first.headers.get('set-cookie'));
    const claims = JSON.parse(Buffer.from(decodeURIComponent(jwt[1] || jwt[2]), 'base64url'));
    assert.deepEqual([claims.username, claims.role, claims.hub], [`anna@${os.hostname()}`, 'viewer', os.hostname()]);
    assert.equal((await fetch(link, { redirect: 'manual' })).status, 401, 'single use');

    // the handoff can't be minted with a user session, only a hub token
    r = await call(remote.url, 'POST', '/api/auth/handoff', { username: 'x' }, { Authorization: 'Bearer sess0' });
    assert.equal(r.status, 403);

    // remove + revoke the hub's token on the location
    r = await call(h.url, 'DELETE', `/api/locations/${saved.id}?revoke=1`);
    assert.match(r.data.message, /revoked/);
    assert.equal(remote.tokens.length, 0);
    assert.equal(L.load().length, 0);

    // pasted token: a bad one is refused
    r = await call(h.url, 'POST', '/api/locations', { url: remote.url, token: 'wrong' });
    assert.match(r.data.error, /rejected/);
  } finally { h.close(); remote.close() }
});
