'use strict';

// Tuya Cloud PTZ — pan/tilt/zoom for Tuya/Smart Life cameras that have no
// ONVIF. Uses the Tuya IoT Platform OpenAPI (HMAC-SHA256 signed) to send the
// camera's `ptz_control` / `ptz_stop` / `zoom_control` / `zoom_stop` commands.
//
// config.json:
//   "tuyaCloud": { "accessId": "...", "accessSecret": "...", "region": "eu" }
//   cameras[i].tuyaPtz = { "deviceId": "bf03..." }
//
// UNVERIFIED against real hardware: written from the Tuya OpenAPI docs while
// the camera's Tuya session was down. `GET /api/camera/ptz-info/:idx` returns
// the device's real command specification so codes/values can be checked.
//
// Without an IoT project: `tuyaPtz: { deviceId, via: "smartlife" }` drives the
// camera through the Smart Life web player's own PTZ endpoints
// (/api/jarvis/ptz/start|end on protect-<region>.ismartlife.me), signed in with
// the session tuya-ipc-terminal keeps in .tuya-data/ — the same login that
// relays the video. `session` overrides where that is: a user_*.json file or
// its folder (default ~/tuya-ipc-terminal/.tuya-data). Pan/tilt only — the
// web player has no zoom. Verified on a real camera (2026-10-27).

const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const https  = require('https');

const HOSTS = {
  eu: 'openapi.tuyaeu.com', us: 'openapi.tuyaus.com',
  cn: 'openapi.tuyacn.com', in: 'openapi.tuyain.com',
};

// ptz_control enum: 0 up, 2 right, 4 down, 6 left. zoom_control: 0 in, 1 out.
const DIR = { up: '0', right: '2', down: '4', left: '6' };
const ZOOM = { zoomin: '0', zoomout: '1' };

let tokenCache = { token: null, exp: 0 };

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex').toUpperCase();

function request(cfg, method, path, body, withToken = true) {
  const host = HOSTS[cfg.region || 'eu'] || cfg.host;
  if (!host) throw new Error('tuyaCloud.region must be eu/us/cn/in');
  const payload = body ? JSON.stringify(body) : '';
  const t = String(Date.now());
  const stringToSign = [method, sha256(payload), '', path].join('\n');
  const token = withToken ? tokenCache.token : '';
  const sign = hmac(cfg.accessSecret, cfg.accessId + (token || '') + t + stringToSign);
  const headers = {
    client_id: cfg.accessId, sign, t, sign_method: 'HMAC-SHA256',
    ...(token ? { access_token: token } : {}),
    ...(payload ? { 'Content-Type': 'application/json' } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method, headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Tuya: bad response (${res.statusCode})`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tuya request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function ensureToken(cfg) {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return;
  tokenCache = { token: null, exp: 0 };
  const r = await request(cfg, 'GET', '/v1.0/token?grant_type=1', null, false);
  if (!r.success) throw new Error(`Tuya token: ${r.msg || r.code}`);
  tokenCache = { token: r.result.access_token, exp: Date.now() + r.result.expire_time * 1000 };
}

async function call(cfg, method, path, body) {
  if (!cfg?.accessId || !cfg?.accessSecret) throw new Error('tuyaCloud.accessId / accessSecret not configured');
  await ensureToken(cfg);
  let r = await request(cfg, method, path, body);
  if (r.code === 1010) { tokenCache = { token: null, exp: 0 }; await ensureToken(cfg); r = await request(cfg, method, path, body); }
  if (!r.success) throw new Error(`Tuya: ${r.msg || r.code}`);
  return r.result;
}

const sendCommands = (cfg, deviceId, commands) =>
  call(cfg, 'POST', `/v1.0/devices/${deviceId}/commands`, { commands });

// ── Smart Life web session (tuya-ipc-terminal's login) ──────────────────────
function smartLifeSession(tuyaPtz) {
  let file = tuyaPtz.session || path.join(os.homedir(), 'tuya-ipc-terminal', '.tuya-data');
  if (file.startsWith('~/')) file = path.join(os.homedir(), file.slice(2));
  if (fs.statSync(file).isDirectory()) {
    const users = fs.readdirSync(file).filter((f) => /^user_.*\.json$/.test(f));
    if (!users.length) throw new Error(`No Smart Life login in ${file} — run tuya-ipc-terminal auth add`);
    file = path.join(file, users[0]);
  }
  // re-read every call: tuya-ipc-terminal rewrites it when the login is renewed
  const s = JSON.parse(fs.readFileSync(file, 'utf8')).sessionData || {};
  if (!s.serverHost || !s.cookies?.length) throw new Error('Smart Life session file has no login');
  return { host: s.serverHost, cookie: s.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
}

async function smartLife(tuyaPtz, urlPath, body) {
  const { host, cookie } = smartLifeSession(tuyaPtz);
  const res = await fetch(`https://${host}${urlPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8', Origin: `https://${host}`, Referer: `https://${host}/playback`,
      'X-Requested-With': 'XMLHttpRequest', 'Cloud-Type': 'public', Cookie: cookie,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.success) throw new Error(`Smart Life PTZ: ${j.errorMsg || j.errorCode || `HTTP ${res.status}`}`);
  return j.result;
}

function smartLifePtz(tuyaPtz, op) {
  const devId = tuyaPtz.deviceId;
  if (op === 'stop') return smartLife(tuyaPtz, '/api/jarvis/ptz/end', { devId });
  if (!DIR[op]) throw new Error('Smart Life PTZ has no zoom');
  // UP / RIGHT / DOWN / LEFT, as the web player sends them — lower case moved
  // the pan but left the tilt unreliable (checked on Wejście, 2026-10-28)
  return smartLife(tuyaPtz, '/api/jarvis/ptz/start', { devId, direction: op.toUpperCase() });
}

/** Continuous move on press, `stop` on release — same contract as onvif-ptz. */
async function ptz(cfg, tuyaPtz, op) {
  const id = tuyaPtz?.deviceId;
  if (!id) throw new Error('Camera has no tuyaPtz.deviceId');
  if (tuyaPtz.via === 'smartlife') return smartLifePtz(tuyaPtz, op);
  if (op === 'stop') {
    // Stop both axes; a camera without zoom just ignores the second command.
    await sendCommands(cfg, id, [{ code: 'ptz_stop', value: true }]);
    return sendCommands(cfg, id, [{ code: 'zoom_stop', value: true }]).catch(() => {});
  }
  if (DIR[op])  return sendCommands(cfg, id, [{ code: 'ptz_control', value: DIR[op] }]);
  if (ZOOM[op]) return sendCommands(cfg, id, [{ code: 'zoom_control', value: ZOOM[op] }]);
  throw new Error(`Unsupported op: ${op}`);
}

/** Real command spec of the device — to verify codes/values on first use. */
const info = (cfg, tuyaPtz) => call(cfg, 'GET', `/v1.0/devices/${tuyaPtz.deviceId}/specifications`);

module.exports = { ptz, info, hasZoom: (tuyaPtz) => tuyaPtz?.via !== 'smartlife' };
