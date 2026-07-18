'use strict';

// Reolink PoE camera / NVR support.
//
// Each configured camera is a { name, host, username, password, channel } entry
// (an NVR exposes several channels on the same host; a standalone PoE camera is
// channel 0). Snapshots use Reolink's HTTP API (cmd=Snap) and are proxied
// through LSH so the browser never sees the credentials. The RTSP URL is built
// from the well-known Reolink path for use with go2rtc / VLC / an NVR.

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

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
