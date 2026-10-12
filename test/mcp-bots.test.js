'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const express = require('express');

const McpBots = require('../src/mcp-bots');
const { handleRequest } = require('../src/mcp-server');
const mountMcpOAuth = require('../src/routes/mcp-oauth');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-mcp-')), 'mcp-bots.json');

// A small house: a light in the kitchen, a lock and a light in the hall
function house() {
  const store = Object.assign(new EventEmitter(), { values: {}, get(k) { return this.values[k] ?? null }, update(k, v) { this.values[k] = v }, getHistory: (k) => [[1, k.length]] });
  const writes = [];
  const devices = [
    { key: 'shelly/kitchen', label: 'Kitchen light', type: 'shelly', room: 'Kitchen', sensors: [{ path: 'switch', type: 'toggle', controllable: true, writeOn: 'on', writeOff: 'off' }] },
    { key: 'tedee/front', label: 'Front door', type: 'tedee', room: 'Hall', homekit: ['lock-rw'], sensors: [{ path: 'lock', type: 'toggle', controllable: true }] },
    { key: 'shelly/hall', label: 'Hall light', type: 'shelly', room: 'Hall', sensors: [{ path: 'switch', type: 'toggle', controllable: true }] },
  ];
  const registry = {
    getDevices: () => devices,
    getDeviceReadings: (k) => { const d = devices.find((x) => x.key === k); return d && { ...d, readings: Object.fromEntries(d.sensors.map((s) => [s.path, { ...s, value: 0 }])) } },
    getAllReadings() { return devices.map((d) => this.getDeviceReadings(d.key)) },
    getRoomMeta: () => ({}),
    async sendCommand(k, s, v) { writes.push([k, s, v]) },
  };
  const automation = {
    scenes: [
      { id: 'evening', name: 'Evening', actions: [{ type: 'device', deviceKey: 'shelly/kitchen', sensor: 'switch', value: 1 }] },
      { id: 'leave', name: 'Leave home', actions: [{ type: 'device', deviceKey: 'shelly/hall', sensor: 'switch', value: 0 }, { type: 'scene', sceneId: 'lockup' }] },
      { id: 'lockup', name: 'Lock up', actions: [{ type: 'device', deviceKey: 'tedee/front', sensor: 'lock', value: 1 }] },
    ],
    async runScene(id) { const s = this.scenes.find((x) => x.id === id); writes.push(['scene', id]); return s },
  };
  return { store, registry, automation, writes };
}

async function startApp({ bots, mcpConfig = {}, apiToken = 'legacy-admin-token', user = { id: 'u1', username: 'admin', role: 'admin' } }) {
  const h = house();
  const auth = { verifyApiToken: (t) => t === apiToken };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { if (req.path === '/oauth/authorize') req.user = user; next() }); // stands in for the LSH login
  mountMcpOAuth(app, { bots, mcpConfig });
  app.post('/api/mcp', (req, res) => handleRequest(req, res, h.store, h.registry, h.automation, { bots, auth, mcpConfig }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) });
  const base = `http://127.0.0.1:${srv.address().port}`;

  let id = 0;
  const rpc = async (token, method, params = {}, headers = {}) => {
    const res = await fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const text = await res.text();
    const body = text.startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
    return { status: res.status, headers: res.headers, json: body ? JSON.parse(body) : null };
  };
  const call = async (token, name, args = {}) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    const result = r.json?.result;
    return { status: r.status, isError: !!result?.isError, text: result?.content?.[0]?.text, error: r.json?.error };
  };
  const tools = async (token) => (await rpc(token, 'tools/list')).json.result.tools.map((t) => t.name).sort();
  return { ...h, base, rpc, call, tools, close: () => new Promise((r) => srv.close(r)) };
}

test('bots: tokens stored only as hashes, rotate / disable / remove revoke', () => {
  const file = tmpFile();
  const bots = new McpBots(file);
  const { bot, token } = bots.create({ name: 'Claude', client: 'claude', access: 'control' });
  assert.match(token, /^lshb_[A-Za-z0-9_-]{43}$/);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(token), 'plaintext token never written to disk');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(bots.verify(token).id, bot.id);
  assert.equal(bots.verify(`${token}x`), null);
  assert.equal(bots.verify('lshb_' + 'A'.repeat(43)), null);
  bots.update(bot.id, { enabled: false });
  assert.equal(bots.verify(token), null, 'disabled bot is rejected');
  bots.update(bot.id, { enabled: true });
  const { token: t2 } = bots.rotate(bot.id);
  assert.equal(bots.verify(token), null, 'old token dead after rotation');
  assert.equal(bots.verify(t2).id, bot.id);
  assert.equal(new McpBots(file).verify(t2).id, bot.id, 'survives a restart');
  bots.remove(bot.id);
  assert.equal(bots.verify(t2), null);
  assert.ok(!('tokenHash' in bots.create({ name: 'x' }).bot), 'hash never leaves the module');
});

test('MCP: bot policy — read-only, rooms, sensitive devices, scenes, history', async () => {
  const bots = new McpBots(tmpFile());
  const reader = bots.create({ name: 'Gemini', client: 'gemini', access: 'read' }).token;
  const kitchen = bots.create({ name: 'ChatGPT', client: 'chatgpt', access: 'control', rooms: ['Kitchen'] }).token;
  const butler = bots.create({ name: 'Claude', client: 'claude', access: 'control' }).token;
  const trusted = bots.create({ name: 'Claude trusted', access: 'control', sensitive: true }).token;
  const app = await startApp({ bots });
  try {
    // Read-only bot: no write tools at all
    assert.deepEqual(await app.tools(reader), ['get_device', 'get_history', 'list_devices', 'list_platform_status', 'list_rooms', 'list_scenes']);
    assert.ok((await app.tools(butler)).includes('send_command'));

    // Rooms scope
    const seen = JSON.parse((await app.call(kitchen, 'list_devices')).text).map((d) => d.key);
    assert.deepEqual(seen, ['shelly/kitchen']);
    assert.match((await app.call(kitchen, 'get_device', { deviceKey: 'shelly/hall' })).text, /not found/);
    assert.match((await app.call(kitchen, 'send_command', { deviceKey: 'shelly/hall', sensor: 'switch', value: 1 })).text, /not found/i);
    assert.match((await app.call(kitchen, 'get_history', { key: 'shelly/hall/switch' })).text, /Not found/);
    assert.equal((await app.call(kitchen, 'send_command', { deviceKey: 'shelly/kitchen', sensor: 'switch', value: 1 })).text, 'OK');

    // Sensitive: lock is visible but not controllable without sensitive: true
    const lock = JSON.parse((await app.call(butler, 'get_device', { deviceKey: 'tedee/front' })).text);
    assert.equal(lock.sensors[0].controllable, false);
    assert.equal(lock.sensors[0].blocked, true);
    const r = await app.call(butler, 'send_command', { deviceKey: 'tedee/front', sensor: 'lock', value: 0 });
    assert.ok(r.isError); assert.match(r.text, /Locks, alarm/);
    assert.equal((await app.call(trusted, 'send_command', { deviceKey: 'tedee/front', sensor: 'lock', value: 0 })).text, 'OK');

    // Scenes may only do what the bot could do itself (nested scenes too)
    assert.equal((await app.call(butler, 'run_scene', { sceneId: 'evening' })).text, 'Ran scene: Evening');
    const leave = await app.call(butler, 'run_scene', { sceneId: 'leave' });
    assert.ok(leave.isError); assert.match(leave.text, /tedee\/front/);
    assert.match((await app.call(kitchen, 'run_scene', { sceneId: 'leave' })).text, /shelly\/hall/);

    assert.deepEqual(app.writes, [['shelly/kitchen', 'switch', 1], ['tedee/front', 'lock', 0], ['scene', 'evening']]);
    const audit = bots.recent();
    assert.ok(audit.some((e) => e.bot === 'Claude' && e.tool === 'send_command' && !e.ok));
    assert.ok(audit.every((e) => !JSON.stringify(e).includes('lshb_')), 'no tokens in the audit log');
  } finally { await app.close() }
});

test('MCP: authentication, legacy API tokens, Origin, brute force, rate limit', async () => {
  const bots = new McpBots(tmpFile());
  const { token } = bots.create({ name: 'Claude', access: 'read' });
  const app = await startApp({ bots });
  try {
    const none = await app.rpc(null, 'tools/list');
    assert.equal(none.status, 401);
    assert.match(none.headers.get('www-authenticate'), /resource_metadata=".*\/\.well-known\/oauth-protected-resource"/);
    assert.equal((await app.rpc('legacy-admin-token', 'tools/list')).status, 401, 'API tokens are refused by default');
    assert.equal((await app.rpc(token, 'tools/list', {}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await app.rpc(token, 'tools/list')).status, 200);
    for (let i = 0; i < 20; i++) await app.rpc(`lshb_wrong${i}xxxxxxxxxxxxxxxxxxxxxx`, 'tools/list');
    assert.equal((await app.rpc(token, 'tools/list')).status, 429, 'IP locked out after 20 bad tokens');
  } finally { await app.close() }

  const legacy = await startApp({ bots: new McpBots(tmpFile()), mcpConfig: { allowApiTokens: true } });
  try { assert.equal((await legacy.rpc('legacy-admin-token', 'tools/list')).status, 200, 'opt-in keeps old setups working') } finally { await legacy.close() }

  const bots2 = new McpBots(tmpFile());
  const t2 = bots2.create({ name: 'Busy', access: 'read' }).token;
  const app2 = await startApp({ bots: bots2 });
  try {
    for (let i = 0; i < 120; i++) await app2.call(t2, 'list_rooms');
    const r = await app2.call(t2, 'list_rooms');
    assert.ok(r.isError); assert.match(r.text, /Rate limit/);
  } finally { await app2.close() }
});

test('OAuth 2.1: discovery, registration, consent picks the bot, PKCE, refresh rotation', async () => {
  const bots = new McpBots(tmpFile());
  const { bot } = bots.create({ name: 'ChatGPT', client: 'chatgpt', access: 'read' });
  const app = await startApp({ bots });
  try {
    const prm = await (await fetch(`${app.base}/.well-known/oauth-protected-resource`)).json();
    assert.equal(prm.resource, `${app.base}/api/mcp`);
    const as = await (await fetch(`${app.base}/.well-known/oauth-authorization-server`)).json();
    assert.deepEqual(as.code_challenge_methods_supported, ['S256']);

    // Registration: https or loopback redirect URIs only
    const bad = await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: ['http://evil.example/cb'] }) });
    assert.equal(bad.status, 400);
    const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
    const client = await (await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [redirect] }) })).json();
    assert.match(client.client_id, /^lshc_/);

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', resource: `${app.base}/api/mcp` });

    // Unregistered redirect URI → error page, never a redirect
    const evil = await fetch(`${as.authorization_endpoint}?${new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: 'https://evil.example/cb' })}`, { redirect: 'manual' });
    assert.equal(evil.status, 400);
    // plain method instead of S256 → error sent back to the client
    const plain = await fetch(`${as.authorization_endpoint}?${new URLSearchParams({ ...Object.fromEntries(q), code_challenge_method: 'plain' })}`, { redirect: 'manual' });
    assert.match(plain.headers.get('location'), /error=invalid_request/);

    const consent = await fetch(`${as.authorization_endpoint}?${q}`);
    assert.equal(consent.headers.get('x-frame-options'), 'DENY');
    const html = await consent.text();
    assert.match(html, /Connect “ChatGPT” to LSH/);
    const requestId = html.match(/name="request_id" value="([^"]+)"/)[1];

    // Cross-site form post is refused
    const xsrf = await fetch(as.authorization_endpoint, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' }, body: new URLSearchParams({ request_id: requestId, bot_id: bot.id, decision: 'approve' }) });
    assert.equal(xsrf.status, 403);

    const approve = await fetch(as.authorization_endpoint, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: requestId, bot_id: bot.id, decision: 'approve' }) });
    const loc = new URL(approve.headers.get('location'));
    assert.equal(`${loc.origin}${loc.pathname}`, redirect);
    assert.equal(loc.searchParams.get('state'), 'st8');
    const code = loc.searchParams.get('code');

    const token = (body) => fetch(as.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    const wrongPkce = await token({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: redirect, code_verifier: 'nope'.repeat(11) });
    assert.equal(wrongPkce.status, 400);
    const reused = await token({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: redirect, code_verifier: verifier });
    assert.equal(reused.status, 400, 'a code is burnt by its first use, even a failed one');

    // Fresh approval, correct verifier
    const html2 = await (await fetch(`${as.authorization_endpoint}?${q}`)).text();
    const rid2 = html2.match(/name="request_id" value="([^"]+)"/)[1];
    const code2 = new URL((await fetch(as.authorization_endpoint, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: rid2, bot_id: bot.id, decision: 'approve' }) })).headers.get('location')).searchParams.get('code');
    const tok = await (await token({ grant_type: 'authorization_code', code: code2, client_id: client.client_id, redirect_uri: redirect, code_verifier: verifier })).json();
    assert.match(tok.access_token, /^lsha_/);
    assert.equal(tok.expires_in, 3600);

    // The connector acts as the chosen (read-only) bot
    assert.ok(!(await app.tools(tok.access_token)).includes('send_command'));

    // Refresh rotates: the old refresh token and old access token die
    const tok2 = await (await token({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id })).json();
    assert.match(tok2.access_token, /^lsha_/);
    assert.equal((await token({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id })).status, 400);
    assert.equal((await app.rpc(tok.access_token, 'tools/list')).status, 401);
    assert.equal((await app.rpc(tok2.access_token, 'tools/list')).status, 200);

    // Removing the bot signs the connector out
    bots.remove(bot.id);
    assert.equal((await app.rpc(tok2.access_token, 'tools/list')).status, 401);
  } finally { await app.close() }
});

test('OAuth: refused over plain http on a non-local host, admins only', async () => {
  const bots = new McpBots(tmpFile());
  bots.create({ name: 'x' });
  const app = await startApp({ bots, user: { id: 'api-token', username: 'api-token', role: 'admin' } });
  try {
    // fetch() won't override Host — use http.request to look like a LAN address
    const viaLan = await new Promise((resolve, reject) => {
      const u = new URL(`${app.base}/oauth/register`);
      const req = require('http').request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', Host: '192.168.1.10:3000' } }, (res) => {
        let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
      });
      req.on('error', reject); req.end('{}');
    });
    assert.equal(viaLan.status, 400);
    assert.match(viaLan.body.error_description, /HTTPS/);
    const asToken = await fetch(`${app.base}/oauth/authorize?client_id=x`);
    assert.equal(asToken.status, 403, 'an API token cannot approve connectors — only a signed-in admin');
  } finally { await app.close() }
});
