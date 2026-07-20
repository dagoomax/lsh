'use strict';

// Reolink PoE camera / NVR support.
//
// Each configured camera is a { name, host, username, password, channel } entry
// (an NVR exposes several channels on the same host; a standalone PoE camera is
// channel 0). Snapshots use Reolink's HTTP API (cmd=Snap) and are proxied
// through LSH so the browser never sees the credentials. The RTSP URL is built
// from the well-known Reolink path for use with go2rtc / VLC / an NVR.
//
// AI object detection (person/vehicle/pet/face) is polled via cmd=GetAiState
// and registered as one sub-device per detected category per camera — not one
// device with several sensors — because HomeKit bridging picks only the FIRST
// sensor of a given homekit type per device (see homekit-bridge.js), so three
// same-typed 'motion' sensors on one device would silently drop two of them
// from HomeKit. Separate sub-devices also let "person detected" and "vehicle
// detected" drive different HomeKit automations, which is the actual point.

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const platformStatus = require('./platform-status');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const AI_POLL_DEFAULT_S = 5;

// Reolink's internal AI category names → LSH-friendly ones. Anything not
// listed here (newer models add categories like "package") passes through
// lowercased as-is, so new AI types show up without a code change.
const AI_CATEGORY_MAP = { people: 'person', dog_cat: 'pet' };
const AI_CATEGORY_ICON = { person: '🚶', vehicle: '🚗', pet: '🐾', face: '🙂' };

// Read the current Reolink cameras straight from config.json so changes saved
// via the Settings page apply immediately — no server restart needed.
function loadCameras() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return (cfg.reolink?.cameras || []).filter((c) => c && c.host);
  } catch {
    return [];
  }
}

function loadAiPollInterval() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Number(cfg.reolink?.aiPollInterval) || AI_POLL_DEFAULT_S;
  } catch {
    return AI_POLL_DEFAULT_S;
  }
}

// rtsp://user:pass@host:554/h264Preview_<NN>_<main|sub>  (NN = channel + 1, padded)
function buildRtspUrl(cam) {
  const nn     = String((Number(cam.channel) || 0) + 1).padStart(2, '0');
  const stream = cam.stream === 'sub' ? 'sub' : 'main';
  const port   = Number(cam.rtspPort) || 554;
  const auth   = (cam.username || cam.password)
    ? `${encodeURIComponent(cam.username || '')}:${encodeURIComponent(cam.password || '')}@`
    : '';
  return `rtsp://${auth}${cam.host}:${port}/h264Preview_${nn}_${stream}`;
}

class ReolinkClient {
  // store/sensorRegistry are optional — the camera-list/PTZ/snapshot methods
  // below don't need them; only AI-detection polling (start()) does.
  constructor(store, sensorRegistry) {
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.pollTimer      = null;
    this._registered    = new Set(); // `${idx}/${category}` already registered
  }

  async start() {
    if (!this.store || !this.sensorRegistry) return;
    const cams = loadCameras();
    if (!cams.length) return;

    const seconds = loadAiPollInterval();
    await this._pollAiState();
    platformStatus.set('reolink', true);
    this.pollTimer = setInterval(() => this._pollAiState().catch(() => {}), seconds * 1000);
    console.log(`[Reolink] AI detection polling started (${seconds}s)`);
  }

  stop() {
    clearInterval(this.pollTimer);
  }

  // Poll every camera's AI detection state and register/update sub-devices.
  // Cameras without AI support (older models) just never register anything —
  // no separate config toggle needed for that case, only for opting a
  // capable camera out (per-camera "aiDetect": false).
  async _pollAiState() {
    const cams = loadCameras();
    let anyOk = false;
    await Promise.all(cams.map(async (cam, idx) => {
      if (cam.aiDetect === false) return;
      let state;
      try { state = await this._getAiState(cam); }
      catch (err) { console.error(`[Reolink] AI state failed for "${cam.name || cam.host}": ${err.message}`); return; }
      anyOk = true;

      const camName = cam.name || `Reolink ${cam.host}`;
      for (const [category, detected] of Object.entries(state)) {
        const regKey = `${idx}/${category}`;
        const deviceKey = `reolink/${idx}/${category}`;
        if (!this._registered.has(regKey)) {
          this._registered.add(regKey);
          this.sensorRegistry.registerDevice({
            key: deviceKey, type: 'reolink', instance: `${idx}/${category}`,
            label: `${camName} — ${category[0].toUpperCase()}${category.slice(1)}`,
            icon: AI_CATEGORY_ICON[category] || '🎯', color: 'blue',
            sensors: [{ path: 'detected', name: 'Detected', format: 'on-off', homekit: 'motion' }],
            homekit: ['motion'],
          });
        }
        this.store.update(`${deviceKey}/detected`, detected ? 1 : 0);
      }
    }));
    if (cams.some((c) => c.aiDetect !== false)) platformStatus.set('reolink', anyOk);
  }

  // cmd=GetAiState — same POST cmd/param-array shape as ptz() below. Returns
  // { <category>: boolean } for every category the camera reports, handling
  // both response shapes Reolink has shipped (see AI_CATEGORY_MAP comment):
  // firmware >= 3.0.0.0-494 nests { alarm_state, support } per category;
  // older firmware returns a plain 0/1 integer per category directly.
  _getAiState(cam) {
    const channel = Number(cam.channel) || 0;
    const body = JSON.stringify([{ cmd: 'GetAiState', action: 0, param: { channel } }]);
    return new Promise((resolve, reject) => {
      const proto = cam.https ? https : http;
      const port  = Number(cam.port) || (cam.https ? 443 : 80);
      const query = new URLSearchParams({ cmd: 'GetAiState', user: cam.username || '', password: cam.password || '' });
      const req = proto.request({
        hostname: cam.host, port,
        path: `/cgi-bin/api.cgi?${query}`,
        method: 'POST',
        rejectUnauthorized: false,
        timeout: 8000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (up) => {
        let data = '';
        up.on('data', (c) => data += c);
        up.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j?.[0]?.code !== 0) return reject(new Error(j?.[0]?.error?.detail || `HTTP ${up.statusCode}`));
            const value = j[0].value || {};
            const out = {};
            for (const [key, v] of Object.entries(value)) {
              if (key === 'channel') continue;
              const category = AI_CATEGORY_MAP[key] || key.toLowerCase();
              if (typeof v === 'object') {
                if (v.support !== 1) continue; // camera doesn't have this AI type — no device for it
                out[category] = v.alarm_state === 1;
              } else {
                out[category] = v === 1; // legacy firmware: no support flag, a present key means supported
              }
            }
            resolve(out);
          } catch { reject(new Error(`HTTP ${up.statusCode}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
      req.end(body);
    });
  }

  // Shape consumed by GET /api/cameras — read fresh so Settings edits apply live.
  getCameras() {
    return loadCameras().map((cam, idx) => ({
      name:        cam.name || `Reolink ${cam.host}${cam.channel ? '/' + cam.channel : ''}`,
      url:         buildRtspUrl(cam),
      snapshotUrl: `/api/reolink/snapshot/${idx}`,
      mjpegUrl:    '',
      webrtcUrl:   cam.webrtcUrl || '',
      ...(cam.ptz ? { ptzUrl: `/api/reolink/ptz/${idx}` } : {}),
      _reolink:    true,
    }));
  }

  // PTZ via Reolink's HTTP API (cmd=PtzCtrl). Continuous — the frontend sends
  // an op on press and 'stop' on release. op: left|right|up|down|zoomin|zoomout|stop
  async ptz(idx, op, speed) {
    const cam = loadCameras()[Number(idx)];
    if (!cam) throw new Error('Unknown camera');
    const OPS = { left: 'Left', right: 'Right', up: 'Up', down: 'Down',
                  zoomin: 'ZoomInc', zoomout: 'ZoomDec', stop: 'Stop' };
    if (!OPS[op]) throw new Error(`Unknown PTZ op: ${op}`);

    const body = JSON.stringify([{
      cmd: 'PtzCtrl', action: 0,
      param: {
        channel: Number(cam.channel) || 0,
        op:      OPS[op],
        ...(op !== 'stop' ? { speed: Math.min(64, Math.max(1, Math.round((speed || 0.5) * 64))) } : {}),
      },
    }]);

    return new Promise((resolve, reject) => {
      const proto = cam.https ? https : http;
      const port  = Number(cam.port) || (cam.https ? 443 : 80);
      const query = new URLSearchParams({ cmd: 'PtzCtrl', user: cam.username || '', password: cam.password || '' });
      const req = proto.request({
        hostname: cam.host, port,
        path: `/cgi-bin/api.cgi?${query}`,
        method: 'POST',
        rejectUnauthorized: false,
        timeout: 8000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (up) => {
        let data = '';
        up.on('data', (c) => data += c);
        up.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j?.[0]?.code === 0) return resolve();
            reject(new Error(j?.[0]?.error?.detail || `HTTP ${up.statusCode}`));
          } catch { reject(new Error(`HTTP ${up.statusCode}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
      req.end(body);
    });
  }

  // Pipe a fresh snapshot for camera <idx> to the Express response.
  proxySnapshot(idx, res) {
    const cam = loadCameras()[Number(idx)];
    if (!cam) return res.status(404).end();
    ReolinkClient.fetchSnapshot(cam)
      .then(({ buffer, contentType }) => {
        res.setHeader('Content-Type', contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(buffer);
      })
      .catch(() => res.status(502).end());
  }

  // Fetch one JPEG snapshot buffer from a Reolink camera (cmd=Snap).
  static fetchSnapshot(cam) {
    return new Promise((resolve, reject) => {
      const proto = cam.https ? https : http;
      const port  = Number(cam.port) || (cam.https ? 443 : 80);
      const query = new URLSearchParams({
        cmd:      'Snap',
        channel:  String(Number(cam.channel) || 0),
        rs:       Math.random().toString(36).slice(2, 10),
        user:     cam.username || '',
        password: cam.password || '',
      }).toString();

      const req = proto.request({
        hostname: cam.host, port,
        path: `/cgi-bin/api.cgi?${query}`,
        method: 'GET',
        rejectUnauthorized: false,   // Reolink devices ship self-signed certs
        timeout: 8000,
      }, (up) => {
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const ct = up.headers['content-type'] || '';
          if (up.statusCode === 200 && /image/i.test(ct)) {
            resolve({ buffer, contentType: ct });
          } else {
            // On auth/other errors Reolink returns a JSON body
            let msg = `HTTP ${up.statusCode}`;
            try { msg = JSON.parse(buffer.toString())?.[0]?.error?.detail || msg; } catch {}
            reject(new Error(msg));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
      req.end();
    });
  }
}

module.exports = ReolinkClient;
module.exports.buildRtspUrl = buildRtspUrl;
