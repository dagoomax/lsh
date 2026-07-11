#!/usr/bin/env node
/**
 * Somfy cover live-state refresh.
 *
 * Fetches the current state of every controllable Somfy cover from the TaHoma
 * box (local) or the Overkiz cloud, using the `somfy` section of config.json —
 * the same auth paths as src/somfy-client.js.
 *
 * Usage:
 *   node scripts/somfy-states.js            # table (default)
 *   node scripts/somfy-states.js --json     # raw JSON, one device per line
 *   node scripts/somfy-states.js --watch    # refresh every 5 s until Ctrl-C
 *   node scripts/somfy-states.js --watch=10 # refresh every 10 s
 *
 * Mode/auth are taken from config.json:
 *   somfy.mode === 'cloud'         → Overkiz SSO (email + password, region)
 *   somfy.token (local)            → Bearer token (Developer Mode)
 *   somfy.email + password (local) → JSESSIONID cookie login
 */

'use strict';

const https = require('https');
const path  = require('path');

const cfg = require(path.join(__dirname, '..', 'config.json')).somfy;
if (!cfg) { console.error('No `somfy` section in config.json'); process.exit(1); }

// ── constants (mirror src/somfy-client.js) ─────────────────────────────────
const BASE_LOCAL = '/enduser-mobile-web/1/enduserAPI';
const BASE_CLOUD = '/enduser-mobile-web/enduserAPI';
const SSO_HOST   = 'accounts.somfy.com';
const SSO_PATH   = '/oauth/oauth/v2/token/jwt';
const CLIENT_ID     = '0d8e920c-1478-11e7-a377-02dd59bd3041_1ewvaqmclfogo4kcsoo0c8k4kso884owg08sg8c40sk4go4ksg';
const CLIENT_SECRET = '12k73w1n540g8o4cokg0cw84cog840k84cwggscwg884004kgk';
const CLOUD_HOSTS = { europe: 'ha101-1.overkiz.com', oceania: 'ha201-1.overkiz.com', north_america: 'ha401-1.overkiz.com' };
const COVERS = ['RollerShutter', 'ExteriorScreen', 'ExteriorVenetianBlind', 'VenetianBlind',
  'Pergola', 'SwingingShutter', 'Gate', 'GarageDoor', 'Awning', 'Window', 'Blind'];

// ── CLI args ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const asJson  = args.includes('--json');
const watchArg = args.find(a => a === '--watch' || a.startsWith('--watch='));
const watchSec = watchArg ? (Number(watchArg.split('=')[1]) || 5) : 0;

// ── resolve connection target ────────────────────────────────────────────────
const cloud = cfg.mode === 'cloud' || cfg.cloud === true;
let host, port, base, agent, token = null, session = null, tokenExp = 0;
if (cloud) {
  host = CLOUD_HOSTS[cfg.region || 'europe'];
  if (!host) { console.error(`Unknown region: ${cfg.region}`); process.exit(1); }
  port = 443; base = BASE_CLOUD; agent = new https.Agent({ rejectUnauthorized: true });
} else {
  if (!cfg.host) { console.error('Local mode requires somfy.host'); process.exit(1); }
  host = cfg.host; port = cfg.port || 8443; base = BASE_LOCAL;
  agent = new https.Agent({ rejectUnauthorized: false }); // self-signed TaHoma cert
  if (cfg.token) token = cfg.token;
}

// ── HTTP ──────────────────────────────────────────────────────────────────
function request(hostname, prt, method, reqPath, body, headers, useAgent) {
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname, port: prt, path: reqPath, method, headers, agent: useAgent, timeout: 12000 }, res => {
      let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ sc: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error(`timeout talking to ${hostname}`)); });
    if (body) r.write(body);
    r.end();
  });
}

async function cloudLogin() {
  const params = new URLSearchParams({
    grant_type: 'password', client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    username: cfg.email, password: cfg.password,
  }).toString();
  const res = await request(SSO_HOST, 443, 'POST', SSO_PATH, params, {
    'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(params),
    Accept: 'application/json', 'User-Agent': 'LSH-Dashboard/1.0',
  }, undefined);
  let json = {}; try { json = JSON.parse(res.body); } catch {}
  if (res.sc >= 300 || !json.access_token) {
    const msg = json.error === 'invalid_grant' ? 'Invalid Somfy email or password' : (json.error_description || json.error || `SSO HTTP ${res.sc}`);
    throw new Error(msg);
  }
  token = json.access_token;
  tokenExp = Date.now() + ((json.expires_in || 3600) - 60) * 1000;
}

async function localLogin() {
  const body = `userId=${encodeURIComponent(cfg.email)}&userPassword=${encodeURIComponent(cfg.password)}`;
  const res = await request(host, port, 'POST', `${base}/login`, body, {
    'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body),
    Accept: 'application/json', 'User-Agent': 'LSH-Dashboard/1.0',
  }, agent);
  const cookie = [].concat(res.headers['set-cookie'] || []).find(c => c.startsWith('JSESSIONID='));
  if (!cookie) throw new Error('Local login failed — no JSESSIONID cookie');
  session = cookie.split(';')[0];
}

async function authenticate() {
  if (cloud) return cloudLogin();
  if (token) return;              // Developer-Mode Bearer token
  if (cfg.email && cfg.password) return localLogin();
  throw new Error('Local mode needs somfy.token or email + password');
}

async function fetchDevices() {
  if (cloud && Date.now() >= tokenExp) await cloudLogin();
  const headers = { Accept: 'application/json', 'User-Agent': 'LSH-Dashboard/1.0' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (session) headers.Cookie = session;
  const res = await request(host, port, 'GET', `${base}/setup/devices`, null, headers, agent);
  if (res.sc >= 300) throw new Error(`GET setup/devices → HTTP ${res.sc}`);
  const all = JSON.parse(res.body);
  return (Array.isArray(all) ? all : []).filter(d =>
    COVERS.includes(d.uiClass || d.definition?.uiClass || ''));
}

// ── formatting ──────────────────────────────────────────────────────────────
const proto = url => (url || '').split(':')[0];

function pick(dev) {
  const s = {};
  for (const st of (dev.states || [])) s[st.name] = st.value;
  const closure = s['core:ClosureState'] ?? s['core:DeploymentState'];
  const openPct = closure == null ? null : 100 - Number(closure);
  return {
    label: (dev.label || '').trim(),
    uiClass: dev.uiClass,
    proto: proto(dev.deviceURL),
    available: dev.available !== false && s['core:StatusState'] !== 'unavailable',
    closure: closure ?? null,
    openPct,
    slate: s['core:SlateOrientationState'] ?? null,
    moving: s['core:MovingState'] ?? null,
    rssi: s['core:RSSILevelState'] ?? null,
    open: s['core:OpenClosedState'] ?? null,
    url: dev.deviceURL,
  };
}

function printTable(rows) {
  const io  = rows.filter(r => r.proto !== 'rts');
  const rts = rows.filter(r => r.proto === 'rts');
  const stamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Warsaw', hour12: false });
  console.log(`\nSomfy covers — ${cloud ? `cloud/${cfg.region || 'europe'}` : `local ${host}`} — ${stamp}`);
  const pad = (v, n) => String(v ?? '—').padEnd(n);
  console.log('\n  ' + pad('Label', 22) + pad('Class', 22) + pad('Avail', 7) + pad('Clos', 6) + pad('Open%', 7) + pad('Slate', 7) + pad('Move', 6) + 'RSSI');
  for (const r of io) {
    console.log('  ' + pad(r.label, 22) + pad(r.uiClass, 22) + pad(r.available ? 'yes' : 'NO', 7) +
      pad(r.closure, 6) + pad(r.openPct == null ? '—' : r.openPct + '%', 7) + pad(r.slate, 7) +
      pad(r.moving === true ? 'yes' : r.moving === false ? 'no' : '—', 6) + (r.rssi ?? '—'));
  }
  if (rts.length) {
    console.log('\n  RTS (one-way, no position feedback):');
    for (const r of rts) console.log('  ' + pad(r.label, 22) + pad(r.uiClass, 22) + (r.available ? 'available' : 'unavailable'));
  }
  console.log('');
}

// ── run ─────────────────────────────────────────────────────────────────────
async function refresh() {
  const rows = (await fetchDevices()).map(pick).sort((a, b) => a.label.localeCompare(b.label));
  if (asJson) rows.forEach(r => console.log(JSON.stringify(r)));
  else printTable(rows);
}

(async () => {
  try {
    await authenticate();
    await refresh();
    if (watchSec) {
      setInterval(() => refresh().catch(e => console.error(`[refresh] ${e.message}`)), watchSec * 1000);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
