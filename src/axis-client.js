'use strict';

// Axis IP camera support (VAPIX HTTP API).
//
// Axis cameras expose the well-documented VAPIX interface:
//   • JPEG snapshot   GET /axis-cgi/jpg/image.cgi
//   • RTSP stream     rtsp://<ip>/axis-media/media.amp
//   • I/O outputs     GET /axis-cgi/io/port.cgi?action=<port>:<state>
//   • PTZ             GET /axis-cgi/com/ptz.cgi?continuouspantiltmove=...
//
// Axis defaults to HTTP **Digest** authentication (Basic can be enabled), so
// this client implements Digest (with a Basic fallback / override). Each
// configured camera becomes a camera tile (snapshot proxied through LSH so
// credentials stay server-side; RTSP handed to go2rtc / an NVR / HomeKit) plus
// a registry device with an `online` sensor and one controllable switch per
// configured relay output. PTZ models get a pad in the camera modal.

const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const platformStatus = require('./platform-status');
const { readConfigCached } = require('./config-file-cache');

const POLL_DEFAULT_S = 30;
const DEFAULT_STREAM = 'axis-media/media.amp';

function loadCameras() {
  const cfg = readConfigCached();
  return (cfg.axis?.cameras || []).filter((c) => c && c.host);
}
function loadPollInterval() {
  const cfg = readConfigCached();
  return Number(cfg.axis?.pollInterval) || POLL_DEFAULT_S;
}

// rtsp://user:pass@host:554/axis-media/media.amp (stream path configurable)
function buildRtspUrl(cam) {
  const port   = Number(cam.rtspPort) || 554;
  const stream = (cam.streamPath || DEFAULT_STREAM).replace(/^\/+/, '');
  const auth   = (cam.username || cam.password)
    ? `${encodeURIComponent(cam.username || '')}:${encodeURIComponent(cam.password || '')}@`
    : '';
  return `rtsp://${auth}${cam.host}:${port}/${stream}`;
}

function outputsOf(cam) {
  return (Array.isArray(cam.outputs) ? cam.outputs : []).filter((o) => o && o.name && o.port != null);
}

// ── HTTP Digest / Basic auth ────────────────────────────────────────────────
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function parseAuthHeader(h) {
  const out = {};
  const scheme = /^\s*(\w+)/.exec(h || '');
  out._scheme = scheme ? scheme[1].toLowerCase() : '';
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let m;
  while ((m = re.exec(h || ''))) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

function digestAuthHeader(cam, method, uri, chal) {
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';
  const qop = chal.qop ? (chal.qop.split(',').map(s => s.trim()).includes('auth') ? 'auth' : chal.qop.split(',')[0].trim()) : null;
  const ha1 = md5(`${cam.username || ''}:${chal.realm || ''}:${cam.password || ''}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${chal.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${chal.nonce}:${ha2}`);
  let h = `Digest username="${cam.username || ''}", realm="${chal.realm || ''}", nonce="${chal.nonce || ''}", uri="${uri}", response="${response}"`;
  if (chal.opaque) h += `, opaque="${chal.opaque}"`;
  if (chal.algorithm) h += `, algorithm=${chal.algorithm}`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

function basicAuthHeader(cam) {
  return 'Basic ' + Buffer.from(`${cam.username || ''}:${cam.password || ''}`).toString('base64');
}

// One HTTP request to a camera, transparently answering a 401 Digest (or Basic)
// challenge with a second authenticated attempt. Resolves { status, buffer, headers }.
function rawRequest(cam, uri, method, authorization) {
  return new Promise((resolve, reject) => {
    const proto = cam.https ? https : http;
    const port  = Number(cam.port) || (cam.https ? 443 : 80);
    const headers = {};
    if (authorization) headers.Authorization = authorization;
    const req = proto.request({
      hostname: cam.host, port, path: uri, method,
      rejectUnauthorized: false, timeout: 8000, headers,
    }, (up) => {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => resolve({ status: up.statusCode, buffer: Buffer.concat(chunks), headers: up.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
    req.end();
  });
}

async function vapix(cam, uri, method = 'GET') {
  // Pre-emptive Basic when explicitly configured; otherwise try unauthenticated
  // first and answer whatever challenge comes back.
  if ((cam.auth || '').toLowerCase() === 'basic') {
    const r = await rawRequest(cam, uri, method, basicAuthHeader(cam));
    if (r.status >= 200 && r.status < 300) return r;
    throw new Error(`HTTP ${r.status}`);
  }
  let r = await rawRequest(cam, uri, method, null);
  if (r.status !== 401) {
    if (r.status >= 200 && r.status < 300) return r;
    throw new Error(`HTTP ${r.status}`);
  }
  const chal = parseAuthHeader(r.headers['www-authenticate']);
  const authz = chal._scheme === 'basic' ? basicAuthHeader(cam) : digestAuthHeader(cam, method, uri, chal);
  r = await rawRequest(cam, uri, method, authz);
  if (r.status >= 200 && r.status < 300) return r;
  throw new Error(`HTTP ${r.status} (auth)`);
}

// Like rawRequest but tears the socket down as soon as headers arrive — the
// response body is never read. Used for the reachability probe.
function rawHead(cam, uri, method, authorization) {
  return new Promise((resolve, reject) => {
    const proto = cam.https ? https : http;
    const port  = Number(cam.port) || (cam.https ? 443 : 80);
    const headers = {};
    if (authorization) headers.Authorization = authorization;
    const req = proto.request({
      hostname: cam.host, port, path: uri, method,
      rejectUnauthorized: false, timeout: 8000, headers,
    }, (res) => {
      const out = { status: res.statusCode, headers: res.headers };
      res.destroy();
      resolve(out);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
    req.end();
  });
}

// Header-only equivalent of vapix() — completes the Digest/Basic handshake but
// downloads no body. Resolves true if the final response is 2xx.
async function vapixHead(cam, uri, method = 'GET') {
  if ((cam.auth || '').toLowerCase() === 'basic') {
    const r = await rawHead(cam, uri, method, basicAuthHeader(cam));
    return r.status >= 200 && r.status < 300;
  }
  let r = await rawHead(cam, uri, method, null);
  if (r.status !== 401) return r.status >= 200 && r.status < 300;
  const chal = parseAuthHeader(r.headers['www-authenticate']);
  const authz = chal._scheme === 'basic' ? basicAuthHeader(cam) : digestAuthHeader(cam, method, uri, chal);
  r = await rawHead(cam, uri, method, authz);
  return r.status >= 200 && r.status < 300;
}

class AxisClient {
  constructor(store, sensorRegistry) {
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.pollTimer      = null;
    this._registered    = new Set();
    this._pulse         = {};
  }

  async start() {
    const cams = loadCameras();
    if (!cams.length) return;
    if (this.store && this.sensorRegistry) {
      cams.forEach((cam, idx) => this._registerDevice(cam, idx));
      platformStatus.set('axis', false);
      const seconds = loadPollInterval();
      await this._poll();
      this.pollTimer = setInterval(() => this._poll().catch(() => {}), seconds * 1000);
      console.log(`[Axis] ${cams.length} camera(s) — status polling every ${seconds}s`);
    }
  }

  stop() {
    clearInterval(this.pollTimer);
    for (const t of Object.values(this._pulse)) clearTimeout(t);
    this._pulse = {};
  }

  _registerDevice(cam, idx) {
    if (this._registered.has(idx)) return;
    this._registered.add(idx);
    const outs = outputsOf(cam);
    const sensors = [{ path: 'online', name: 'Online', type: 'boolean' }];
    outs.forEach((o, i) => sensors.push({
      path: `out_${i}`, name: o.name, type: 'boolean',
      controllable: true, capabilityId: `out:${i}`, writeOn: 'on', writeOff: 'off',
    }));
    this.sensorRegistry.registerDevice({
      key:   `axis/${idx}`,
      label: cam.name || `Axis ${cam.host}`,
      type:  'axis',
      icon:  'camera',
      sensors,
      _writeCapability: (capId, command) => this._writeCapability(idx, capId, command),
    });
  }

  async _poll() {
    const cams = loadCameras();
    let anyOk = false;
    await Promise.all(cams.map(async (cam, idx) => {
      // Reachability only — completes auth but downloads no image body.
      let ok = false;
      try { ok = await vapixHead(cam, '/axis-cgi/jpg/image.cgi'); } catch { ok = false; }
      anyOk = anyOk || ok;
      if (this.store) this.store.update(`axis/${idx}/online`, ok ? 1 : 0);
    }));
    platformStatus.set('axis', anyOk);
  }

  // ── Output control via VAPIX I/O port.cgi ───────────────────────────────────
  // action=<port>:<state> — `/` active, `\` inactive, `/<ms>\` pulse active.
  async _writeCapability(idx, capId, command) {
    const cam = loadCameras()[Number(idx)];
    if (!cam) throw new Error('Unknown Axis camera');
    const m = /^out:(\d+)$/.exec(capId);
    if (!m) throw new Error(`Unknown capability ${capId}`);
    const outIdx = Number(m[1]);
    const out = outputsOf(cam)[outIdx];
    if (!out) throw new Error(`Unknown output ${outIdx}`);

    const port = Number(out.port);
    const active = out.activeLow ? '\\' : '/';       // physical "on" level
    const inactive = out.activeLow ? '/' : '\\';
    const momentary = !!out.momentary;

    let stateStr;
    if (command === 'on') stateStr = momentary ? `${active}${Number(out.pulseMs) || 500}${inactive}` : active;
    else stateStr = inactive;

    await vapix(cam, `/axis-cgi/io/port.cgi?action=${port}:${encodeURIComponent(stateStr)}`);

    const key = `${idx}:${outIdx}`;
    if (momentary && command === 'on') {
      this.store?.update(`axis/${idx}/out_${outIdx}`, 1);
      clearTimeout(this._pulse[key]);
      this._pulse[key] = setTimeout(() => this.store?.update(`axis/${idx}/out_${outIdx}`, 0), Number(out.pulseMs) || 500);
    } else {
      this.store?.update(`axis/${idx}/out_${outIdx}`, command === 'on' ? 1 : 0);
    }
  }

  // ── PTZ via VAPIX continuous move (press-and-hold; release sends stop) ───────
  async ptz(idx, op, speed) {
    const cam = loadCameras()[Number(idx)];
    if (!cam) throw new Error('Unknown camera');
    const s = Math.min(100, Math.max(1, Math.round((speed || 0.5) * 100)));
    const Q = {
      left:    `continuouspantiltmove=-${s},0`,
      right:   `continuouspantiltmove=${s},0`,
      up:      `continuouspantiltmove=0,${s}`,
      down:    `continuouspantiltmove=0,-${s}`,
      zoomin:  `continuouszoommove=${s * 10}`,
      zoomout: `continuouszoommove=-${s * 10}`,
      stop:    `continuouspantiltmove=0,0&continuouszoommove=0`,
    };
    if (!Q[op]) throw new Error(`Unknown PTZ op: ${op}`);
    const cameraSel = cam.channel != null ? `camera=${Number(cam.channel)}&` : '';
    await vapix(cam, `/axis-cgi/com/ptz.cgi?${cameraSel}${Q[op]}`);
  }

  // ── Camera list + snapshot proxy (consumed by /api/cameras) ─────────────────
  getCameras() {
    return loadCameras().map((cam, idx) => ({
      name:        cam.name || `Axis ${cam.host}`,
      url:         buildRtspUrl(cam),
      snapshotUrl: `/api/axis/snapshot/${idx}`,
      mjpegUrl:    '',
      webrtcUrl:   cam.webrtcUrl || '',
      ...(cam.ptz ? { ptzUrl: `/api/axis/ptz/${idx}` } : {}),
      _axis:       true,
    }));
  }

  proxySnapshot(idx, res) {
    const cam = loadCameras()[Number(idx)];
    if (!cam) return res.status(404).end();
    AxisClient.fetchSnapshot(cam)
      .then(({ buffer, contentType }) => {
        res.setHeader('Content-Type', contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(buffer);
      })
      .catch(() => res.status(502).end());
  }

  // GET /axis-cgi/jpg/image.cgi — one JPEG frame (Digest/Basic).
  static async fetchSnapshot(cam) {
    const params = [];
    if (cam.resolution) params.push(`resolution=${encodeURIComponent(cam.resolution)}`);
    if (cam.channel != null) params.push(`camera=${Number(cam.channel)}`);
    const q = params.length ? `?${params.join('&')}` : '';
    const r = await vapix(cam, `/axis-cgi/jpg/image.cgi${q}`);
    return { buffer: r.buffer, contentType: r.headers['content-type'] };
  }
}

AxisClient._test = { buildRtspUrl, outputsOf, parseAuthHeader, digestAuthHeader, vapixHead };

module.exports = AxisClient;
