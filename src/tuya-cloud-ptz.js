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
// Without tuyaCloud keys, falls back to the Smart Life web viewer's own
// endpoints (/api/jarvis/ptz/start|end) using the tuya-ipc-terminal login
// from config.tuyaIpc — verified on the Wejście doorbell 2026-10-30. That
// path has no optical zoom (the web viewer only zooms digitally).

const crypto = require('crypto');
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

// ── Smart Life web viewer (app session) ───────────────────────────────
const fs   = require('fs');
const path = require('path');

const PORTAL_DIR = { up: 'UP', right: 'RIGHT', down: 'DOWN', left: 'LEFT' };

// tuya-ipc-terminal stores its login as .tuya-data/user_<region>_<email>.json
function portalSession(ipc) {
  if (!ipc?.dir) throw new Error('tuyaCloud keys or tuyaIpc.dir not configured');
  const dataDir = path.join(ipc.dir, '.tuya-data');
  const key = `${ipc.region}_${String(ipc.email || '').replace('@', '_at_').replace(/\./g, '_')}`;
  let file = path.join(dataDir, `user_${key}.json`);
  if (!fs.existsSync(file)) {
    const any = fs.readdirSync(dataDir).find((f) => f.startsWith('user_') && f.endsWith('.json'));
    if (!any) throw new Error('No tuya-ipc-terminal login found');
    file = path.join(dataDir, any);
  }
  const sd = JSON.parse(fs.readFileSync(file, 'utf8')).sessionData;
  return { host: sd.serverHost, cookie: sd.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
}

async function portalPost(ipc, apiPath, body) {
  const { host, cookie } = portalSession(ipc);
  const r = await fetch(`https://${host}${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8', Accept: '*/*',
      Origin: `https://${host}`, Referer: `https://${host}/playback`,
      'X-Requested-With': 'XMLHttpRequest', 'Cloud-Type': 'public', Cookie: cookie,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => null);
  if (!j?.success) throw new Error(`Tuya: ${j?.errorMsg || j?.errorCode || r.status}`);
  return j.result;
}

function portalPtz(ipc, id, op) {
  if (op === 'stop') return portalPost(ipc, '/api/jarvis/ptz/end', { devId: id });
  if (PORTAL_DIR[op]) return portalPost(ipc, '/api/jarvis/ptz/start', { devId: id, direction: PORTAL_DIR[op] });
  throw new Error(op.startsWith('zoom') ? 'Zoom not supported for this camera' : `Unsupported op: ${op}`);
}

/** Continuous move on press, `stop` on release — same contract as onvif-ptz. */
async function ptz(cfg, tuyaPtz, op, ipc) {
  const id = tuyaPtz?.deviceId;
  if (!id) throw new Error('Camera has no tuyaPtz.deviceId');
  if (!cfg?.accessId || !cfg?.accessSecret) return portalPtz(ipc, id, op);
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

module.exports = { ptz, info };
