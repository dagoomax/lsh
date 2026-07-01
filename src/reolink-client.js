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
  constructor(config) {
    this.cams = (config.reolink?.cameras || []).filter((c) => c && c.host);
  }

  // Shape consumed by GET /api/cameras
  getCameras() {
    return this.cams.map((cam, idx) => ({
      name:        cam.name || `Reolink ${cam.host}${cam.channel ? '/' + cam.channel : ''}`,
      url:         buildRtspUrl(cam),
      snapshotUrl: `/api/reolink/snapshot/${idx}`,
      mjpegUrl:    '',
      webrtcUrl:   cam.webrtcUrl || '',
      _reolink:    true,
    }));
  }

  // Pipe a fresh snapshot for camera <idx> to the Express response.
  proxySnapshot(idx, res) {
    const cam = this.cams[Number(idx)];
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
