'use strict';

// Other LSH sites this one manages ("locations") — Settings → Locations,
// src/routes/locations.js. Each location is another LSH reached over its own
// REST API with an API token that location issued to this hub:
//
//   pairing   this hub signs in to the remote once with an admin login, asks
//             it for an API token named "LSH hub: <this site>" and keeps only
//             that token — the password is never stored. Or paste a token
//             made by hand (remote Settings → Security → API tokens).
//   inherited a hub user's own role carries over: what they may do on this
//             LSH (viewer: read, admin: control) is what they may do on every
//             location through it, and "Open" signs them in to the remote
//             dashboard as "<user>@<hub>" with that role (POST /auth/handoff)
//   nesting   a location can be a hub itself — its locations are reachable
//             through /api/locations/<id>/api/locations/<id2>/api/…
//
// persist/locations.json holds the tokens in plain text (mode 600, like
// persist/api-tokens.json) and is never returned by the API.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

let FILE = path.join(__dirname, '..', 'persist', 'locations.json');
const TIMEOUT = 8000;

function load(file = FILE) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}

function save(list, file = FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

// http(s)://host[:port] — no path, query or credentials
function normalizeUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Address like https://lsh.example.com or http://192.168.1.49:3000'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('The address must start with http:// or https://');
  if (u.username || u.password) throw new Error('No user name or password in the address');
  return `${u.protocol}//${u.host}`;
}

// The parts of a location the API may show
const publicView = ({ token, ...l }) => ({ ...l, hasToken: !!token });

// One HTTP call to a location. `stream: true` resolves with the raw response
// (for the proxy); otherwise the body is read and parsed when it's JSON.
function request(loc, method, apiPath, { body, headers = {}, bearer, stream = false, timeout = TIMEOUT } = {}) {
  const base = new URL(loc.url);
  const lib = base.protocol === 'https:' ? https : http;
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: base.protocol, hostname: base.hostname, port: base.port || undefined,
      path: apiPath, method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': headers['content-type'] || 'application/json', 'Content-Length': payload.length } : {}),
        ...headers,
        ...(bearer !== null ? { Authorization: `Bearer ${bearer || loc.token}` } : {}),
      },
      rejectUnauthorized: !loc.insecure,
      timeout,
    }, (res) => {
      if (stream) return resolve(res);
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size <= 20 * 1024 * 1024) chunks.push(c); });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = raw;
        if (/json/.test(res.headers['content-type'] || '')) { try { data = JSON.parse(raw); } catch { /* keep text */ } }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${base.host} did not answer in ${Math.round(timeout / 1000)} s`)));
    req.on('error', (err) => reject(new Error(err.code === 'ECONNREFUSED' ? `${base.host} refused the connection` : err.code === 'ENOTFOUND' ? `${base.hostname} not found` : err.message)));
    if (payload) req.write(payload);
    req.end();
  });
}

// Pairing: admin login on the remote → a token it issues to this hub
async function pair(loc, { username, password }, hubName) {
  const login = await request(loc, 'POST', '/api/auth/login', { body: { username, password }, bearer: null });
  if (login.status === 429) throw new Error('The location blocked logins for a few minutes (too many attempts)');
  if (login.status !== 200 || !login.data?.success) throw new Error(login.data?.error || `Login failed (HTTP ${login.status})`);
  if (login.data.user?.role !== 'admin') throw new Error('That user is not an admin on the location');
  const cookie = [].concat(login.headers['set-cookie'] || []).map((c) => /lsh-session=([^;]+)/.exec(c)?.[1]).find(Boolean);
  if (!cookie) throw new Error('The location did not return a session');
  const session = decodeURIComponent(cookie);
  const tokenName = `LSH hub: ${hubName}`.slice(0, 80);
  const made = await request(loc, 'POST', '/api/auth/tokens', { body: { name: tokenName }, bearer: session });
  if (made.status !== 200 || !made.data?.token) throw new Error(made.data?.error || `Could not create a token (HTTP ${made.status})`);
  // its id, to revoke it when the location is removed — the newest one with our name
  const list = await request(loc, 'GET', '/api/auth/tokens', { bearer: session }).catch(() => null);
  const mine = (list?.data?.data || []).filter((t) => t.name === tokenName).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  request(loc, 'POST', '/api/auth/logout', { bearer: session }).catch(() => {});
  return { token: made.data.token, tokenId: mine?.id || null, tokenName };
}

// What the overview shows: GET /api/site/summary, or (older LSH) the device list
async function summary(loc) {
  const t0 = Date.now();
  try {
    const r = await request(loc, 'GET', '/api/site/summary');
    const ms = Date.now() - t0;
    if (r.status === 401 || r.status === 403) return { state: 'unauthorized', ms, error: 'The location rejected this hub’s token' };
    if (r.status === 200 && r.data?.success) return { state: 'online', ms, ...r.data.data };
    if (r.status === 404) {
      const d = await request(loc, 'GET', '/api/devices');
      if (d.status === 200 && d.data?.success) return { state: 'online', ms, devices: d.data.data.length, legacy: true };
    }
    return { state: 'error', ms, error: `HTTP ${r.status}` };
  } catch (err) {
    return { state: 'offline', ms: Date.now() - t0, error: err.message };
  }
}

const newId = () => crypto.randomBytes(6).toString('hex');

// tests point the store at a temp file
const setFile = (f) => { FILE = f; };

module.exports = { setFile, load, save, normalizeUrl, publicView, request, pair, summary, newId };
