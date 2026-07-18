'use strict';

// KENIK (Eltrox) camera / DVR support.
//
// One config section covers a DVR/XVR (several channels on the same host) and
// standalone IP cameras (per-channel host override). KENIK shipped three RTSP
// URL generations over the years, selectable via urlStyle per device or as the
// section default:
//   kenik  — rtsp://user:pass@host:554/mode=real&idc=<ch>&ids=<1|2>   (DVR/XVR)
//   xm     — rtsp://host:554/user=<u>&password=<p>&channel=<ch>&stream=<0|1>.sdp?real_stream
//   simple — rtsp://user:pass@host:8554/ch<NN>                        (new cameras, doorphones)
// urlTemplate overrides the whole URL for anything else ({host} {port} {user}
// {pass} {ch} {ch2} placeholders).
//
// KENIK devices have no uniform HTTP snapshot API, so snapshots are grabbed
// from the RTSP stream with ffmpeg (one frame, cached 10 s) and proxied
// through LSH so the browser never sees the credentials.

const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');

const CONFIG_PATH  = path.join(__dirname, '..', 'config.json');
const SNAP_TTL_MS  = 10000;
const SNAP_TIMEOUT = 12000;

// Read fresh from config.json so channels added via Settings apply live.
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function loadChannels() {
  const cfg = loadConfig().kenik || {};
  return (cfg.channels || [])
    .filter((c) => c && (c.host || cfg.host))
    .map((c) => ({
      urlStyle: cfg.urlStyle || 'kenik',
      username: cfg.username || 'admin',
      password: cfg.password || '',
      host:     cfg.host,
      rtspPort: cfg.rtspPort,
      ...c,
    }));
}

function buildRtspUrl(cam) {
  const ch   = Number(cam.channel) || 1;
  const sub  = cam.stream === 'sub';
  const user = cam.username || '';
  const pass = cam.password || '';
  const auth = (user || pass) ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';

  if (cam.urlTemplate) {
    return cam.urlTemplate
      .replace(/\{host\}/g, cam.host)
      .replace(/\{port\}/g, String(cam.rtspPort || 554))
      .replace(/\{user\}/g, user)
      .replace(/\{pass\}/g, pass)
      .replace(/\{ch\}/g, String(ch))
      .replace(/\{ch2\}/g, String(ch).padStart(2, '0'));
  }
  if (cam.urlStyle === 'xm') {
    const port = Number(cam.rtspPort) || 554;
    return `rtsp://${cam.host}:${port}/user=${user}&password=${pass}&channel=${ch}&stream=${sub ? 1 : 0}.sdp?real_stream`;
  }
  if (cam.urlStyle === 'simple') {
    const port = Number(cam.rtspPort) || 8554;
    return `rtsp://${auth}${cam.host}:${port}/ch${String(ch).padStart(2, '0')}`;
  }
  // kenik (TVT-based DVR/XVR): ids 1 = main stream, 2 = sub stream
  const port = Number(cam.rtspPort) || 554;
  return `rtsp://${auth}${cam.host}:${port}/mode=real&idc=${ch}&ids=${sub ? 2 : 1}`;
}

class KenikClient {
  constructor() {
    this._snapCache = new Map();   // idx → { at, buffer }
  }

  // Shape consumed by GET /api/cameras — read fresh so Settings edits apply live.
  getCameras() {
    return loadChannels().map((cam, idx) => ({
      name:        cam.name || `KENIK ${cam.host} ch${cam.channel || 1}`,
      url:         buildRtspUrl(cam),
      snapshotUrl: `/api/kenik/snapshot/${idx}`,
      mjpegUrl:    '',
      webrtcUrl:   cam.webrtcUrl || '',
      ...(cam.onvif ? { ptzUrl: `/api/kenik/ptz/${idx}` } : {}),
      _kenik:      true,
    }));
  }

  // PTZ over ONVIF (channel needs an `onvif: { port, username, password }`
  // section — credentials default to the KENIK ones, host to the channel host).
  async ptz(idx, op, speed) {
    const cam = loadChannels()[Number(idx)];
    if (!cam?.onvif) throw new Error('Camera has no ONVIF config');
    return require('./onvif-ptz').ptz({
      host:     cam.onvif.host || cam.host,
      port:     cam.onvif.port || 80,
      username: cam.onvif.username ?? cam.username,
      password: cam.onvif.password ?? cam.password,
      ...cam.onvif,
    }, op, speed);
  }

  // Pipe a fresh JPEG frame for camera <idx> to the Express response.
  proxySnapshot(idx, res) {
    const cam = loadChannels()[Number(idx)];
    if (!cam) return res.status(404).end();

    const cached = this._snapCache.get(Number(idx));
    if (cached && Date.now() - cached.at < SNAP_TTL_MS) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      return res.end(cached.buffer);
    }

    this._grabFrame(buildRtspUrl(cam))
      .then((buffer) => {
        this._snapCache.set(Number(idx), { at: Date.now(), buffer });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(buffer);
      })
      .catch((err) => {
        console.error(`[KENIK] Snapshot failed (${cam.name || cam.host}): ${err.message}`);
        res.status(502).end();
      });
  }

  // One JPEG frame off the RTSP stream via ffmpeg.
  _grabFrame(rtspUrl) {
    const ffmpeg = loadConfig().ffmpegRtsp?.ffmpegPath || 'ffmpeg';
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        '-rtsp_transport', 'tcp', '-i', rtspUrl,
        '-frames:v', '1', '-q:v', '4', '-f', 'image2', 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'ignore'] });

      const chunks = [];
      const timer  = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, SNAP_TIMEOUT);
      proc.stdout.on('data', (c) => chunks.push(c));
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        const buffer = Buffer.concat(chunks);
        if (code === 0 && buffer.length) resolve(buffer);
        else reject(new Error(`ffmpeg exited ${code}, ${buffer.length} bytes`));
      });
    });
  }
}

module.exports = KenikClient;
module.exports.buildRtspUrl = buildRtspUrl;
