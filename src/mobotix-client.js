'use strict';

// MOBOTIX IP camera / IP video door-station support.
//
// MOBOTIX cameras expose a well-documented local HTTP interface:
//   • JPEG snapshot   GET /cgi-bin/image.jpg          (HTTP Basic auth)
//   • RTSP stream     rtsp://<ip>/mobotix.mobotix.h264
//   • HTTP control    GET /control/rcontrol?<query>   (the "rcontrol" API)
//
// Each configured camera becomes:
//   • a camera tile (snapshot proxied through LSH so credentials stay server
//     side; RTSP URL handed to go2rtc / an NVR / HomeKit like the other
//     camera integrations), and
//   • a registry device with an `online` sensor plus one controllable switch
//     per configured output — the rcontrol API is how you drive signal
//     outputs and, on a door station, the door relay.
//
// Output/door actions are configured as raw rcontrol query strings rather than
// hardcoded, because the exact action depends on each camera's signal-out
// profile (e.g. `action=putrs232outputs&params=+O0`). This keeps the
// integration honest about MOBOTIX's per-device configuration instead of
// guessing a universal "open door" command.

const http  = require('http');
const https = require('https');
const platformStatus = require('./platform-status');
const { readConfigCached } = require('./config-file-cache');

const POLL_DEFAULT_S = 30;
const DEFAULT_STREAM = 'mobotix.mobotix.h264';

// Read cameras straight from config.json so Settings-page edits apply live
// (same pattern as reolink-client.js).
function loadCameras() {
  const cfg = readConfigCached();
  return (cfg.mobotix?.cameras || []).filter((c) => c && c.host);
}
function loadPollInterval() {
  const cfg = readConfigCached();
  return Number(cfg.mobotix?.pollInterval) || POLL_DEFAULT_S;
}

// rtsp://user:pass@host:554/mobotix.mobotix.h264 (stream path configurable)
function buildRtspUrl(cam) {
  const port   = Number(cam.rtspPort) || 554;
  const stream = (cam.streamPath || DEFAULT_STREAM).replace(/^\/+/, '');
  const auth   = (cam.username || cam.password)
    ? `${encodeURIComponent(cam.username || '')}:${encodeURIComponent(cam.password || '')}@`
    : '';
  return `rtsp://${auth}${cam.host}:${port}/${stream}`;
}

function outputsOf(cam) {
  return (Array.isArray(cam.outputs) ? cam.outputs : []).filter((o) => o && o.name && (o.on || o.action));
}

class MobotixClient {
  constructor(store, sensorRegistry) {
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.pollTimer      = null;
    this._registered    = new Set(); // camera idx already registered as a device
    this._pulse         = {};        // `${idx}:${outIdx}` → timeout handle for momentary outputs
  }

  async start() {
    const cams = loadCameras();
    if (!cams.length) return;

    if (this.store && this.sensorRegistry) {
      cams.forEach((cam, idx) => this._registerDevice(cam, idx));
      platformStatus.set('mobotix', false);
      const seconds = loadPollInterval();
      await this._poll();
      this.pollTimer = setInterval(() => this._poll().catch(() => {}), seconds * 1000);
      console.log(`[MOBOTIX] ${cams.length} camera(s) — status polling every ${seconds}s`);
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
      key:   `mobotix/${idx}`,
      label: cam.name || `MOBOTIX ${cam.host}`,
      type:  'mobotix',
      icon:  cam.door ? 'door' : 'camera',
      sensors,
      _writeCapability: (capId, command) => this._writeCapability(idx, capId, command),
    });
  }

  // ── Polling: reachability → online + platform status ────────────────────────
  async _poll() {
    const cams = loadCameras();
    let anyOk = false;
    await Promise.all(cams.map(async (cam, idx) => {
      const ok = await MobotixClient.probe(cam);
      anyOk = anyOk || ok;
      if (this.store) this.store.update(`mobotix/${idx}/online`, ok ? 1 : 0);
    }));
    platformStatus.set('mobotix', anyOk);
  }

  // Lightweight reachability check: request the snapshot but tear the socket
  // down as soon as 2xx headers arrive, so the JPEG body is never downloaded
  // (the poll only needs an authenticated/online yes/no, not the image).
  static probe(cam) {
    return new Promise((resolve) => {
      const proto = cam.https ? https : http;
      const port  = Number(cam.port) || (cam.https ? 443 : 80);
      const req = proto.request({
        hostname: cam.host, port, path: '/cgi-bin/image.jpg', method: 'GET',
        rejectUnauthorized: false, timeout: 8000, headers: authHeader(cam),
      }, (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        res.destroy();
        resolve(ok);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  // ── Output / door control via the rcontrol HTTP API ─────────────────────────
  async _writeCapability(idx, capId, command) {
    const cam = loadCameras()[Number(idx)];
    if (!cam) throw new Error('Unknown MOBOTIX camera');
    const m = /^out:(\d+)$/.exec(capId);
    if (!m) throw new Error(`Unknown capability ${capId}`);
    const outIdx = Number(m[1]);
    const out = outputsOf(cam)[outIdx];
    if (!out) throw new Error(`Unknown output ${outIdx}`);

    // Momentary output (door relay): the "on" action pulses, then we snap the
    // reported state back to off after `pulseMs` so the switch reads correctly.
    const momentary = out.momentary || (!out.off);
    const query = command === 'on' ? (out.on || out.action) : (out.off || null);
    if (command === 'on' || query) {
      await this._rcontrol(cam, query || out.on || out.action);
    }

    const key = `${idx}:${outIdx}`;
    if (momentary && command === 'on') {
      this.store?.update(`mobotix/${idx}/out_${outIdx}`, 1);
      clearTimeout(this._pulse[key]);
      this._pulse[key] = setTimeout(() => this.store?.update(`mobotix/${idx}/out_${outIdx}`, 0), Number(out.pulseMs) || 1200);
    } else {
      this.store?.update(`mobotix/${idx}/out_${outIdx}`, command === 'on' ? 1 : 0);
    }
  }

  // GET /control/rcontrol?<query> with HTTP Basic auth.
  _rcontrol(cam, query) {
    const q = String(query || '').replace(/^\?+/, '');
    return new Promise((resolve, reject) => {
      const proto = cam.https ? https : http;
      const port  = Number(cam.port) || (cam.https ? 443 : 80);
      const req = proto.request({
        hostname: cam.host, port,
        path: `/control/rcontrol?${q}`,
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 8000,
        headers: authHeader(cam),
      }, (up) => {
        let data = '';
        up.on('data', (c) => data += c);
        up.on('end', () => {
          if (up.statusCode >= 200 && up.statusCode < 300) resolve(data);
          else reject(new Error(`rcontrol HTTP ${up.statusCode}`));
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
      req.end();
    });
  }

  // ── Camera list + snapshot proxy (consumed by /api/cameras) ─────────────────
  getCameras() {
    return loadCameras().map((cam, idx) => ({
      name:        cam.name || `MOBOTIX ${cam.host}`,
      url:         buildRtspUrl(cam),
      snapshotUrl: `/api/mobotix/snapshot/${idx}`,
      mjpegUrl:    '',
      webrtcUrl:   cam.webrtcUrl || '',
      _mobotix:    true,
    }));
  }

  proxySnapshot(idx, res) {
    const cam = loadCameras()[Number(idx)];
    if (!cam) return res.status(404).end();
    MobotixClient.fetchSnapshot(cam)
      .then(({ buffer, contentType }) => {
        res.setHeader('Content-Type', contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(buffer);
      })
      .catch(() => res.status(502).end());
  }

  // GET /cgi-bin/image.jpg — one JPEG frame, HTTP Basic auth.
  static fetchSnapshot(cam) {
    return new Promise((resolve, reject) => {
      const proto = cam.https ? https : http;
      const port  = Number(cam.port) || (cam.https ? 443 : 80);
      const size  = cam.snapshotSize ? `?size=${encodeURIComponent(cam.snapshotSize)}` : '';
      const req = proto.request({
        hostname: cam.host, port,
        path: `/cgi-bin/image.jpg${size}`,
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 8000,
        headers: authHeader(cam),
      }, (up) => {
        if (up.statusCode !== 200) { up.resume(); return reject(new Error(`HTTP ${up.statusCode}`)); }
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: up.headers['content-type'] }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
      req.end();
    });
  }
}

function authHeader(cam) {
  if (!cam.username && !cam.password) return {};
  const b64 = Buffer.from(`${cam.username || ''}:${cam.password || ''}`).toString('base64');
  return { Authorization: `Basic ${b64}` };
}

MobotixClient._test = { buildRtspUrl, outputsOf, authHeader };

module.exports = MobotixClient;
