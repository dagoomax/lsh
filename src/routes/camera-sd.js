'use strict';

// Camera SD-card recordings — Tuya cameras through tuya-ipc-terminal
// (config.tuyaIpc). Listing opens a replay session over the camera's MQTT
// signalling (`cameras recordings`); playback is the terminal's RTSP path
// /<camera>/replay/<start>-<end>, remuxed to fragmented MP4 for <video>.
// The camera streams replay at 1x and sends no audio track.
//
// Segments already copied by scripts/tuya-sd-archive.js are served from disk
// instead (instant and seekable — the camera only serves one replay at a
// time), and only those get thumbnails: grabbing a frame from the camera
// would take a full replay session per segment.
//
// config.json: cameras[i].tuyaPtz.deviceId + "tuyaIpc": { dir, rtspPort?, archiveDir? }
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { readConfigFile } = require('./helpers');

function sdCamera(idx) {
  const cfg = readConfigFile();
  const cam = (cfg.cameras || [])[Number(idx)];
  const ipc = cfg.tuyaIpc;
  if (!cam?.tuyaPtz?.deviceId || !ipc?.dir) throw new Error('Camera has no SD-card access');
  return { deviceId: cam.tuyaPtz.deviceId, ipc };
}

// tuya-ipc-terminal's own RTSP path for the camera, e.g. "/Wejście"
function rtspPath(ipc, deviceId) {
  const reg = JSON.parse(fs.readFileSync(path.join(ipc.dir, '.tuya-data', 'cameras.json'), 'utf8'));
  const cam = (reg.cameras || []).find((c) => c.deviceId === deviceId);
  if (!cam?.rtspPath) throw new Error('Camera not found in tuya-ipc-terminal');
  return cam.rtspPath;
}

// Where tuya-sd-archive.js saves a segment: <archive>/<YYYY-MM-DD>/<HH-MM-SS>.mp4 (local time)
function archivedFile(cam, st) {
  const dir = cam.ipc.archiveDir || path.join(os.homedir(), 'sd-archive', rtspPath(cam.ipc, cam.deviceId).replace(/^\//, ''));
  const d = new Date(st * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const file = path.join(dir, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.mp4`);
  return { dir, file: fs.existsSync(file) ? file : null };
}

const thumbJobs = new Map();  // st → Promise, so one grid load doesn't spawn duplicate ffmpegs

function makeThumb(src, out) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '3', '-i', src,
      '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', '-y', out],
    { timeout: 20000 }, (err) => (err ? reject(err) : resolve()));
  });
}

module.exports = function register(router) {
  // ?date=YYYY-MM-DD → [{ st, ed }] (unix seconds)
  router.get('/camera/sd/:idx', (req, res) => {
    let cam;
    try { cam = sdCamera(req.params.idx); } catch (err) {
      return res.status(404).json({ success: false, error: err.message });
    }
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    execFile(path.join(cam.ipc.dir, 'tuya-ipc-terminal'),
      ['cameras', 'recordings', cam.deviceId, date, '--json'],
      { cwd: cam.ipc.dir, timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const line = String(stdout).split('\n').find((l) => l.startsWith('['));
        if (!line) return res.status(502).json({ success: false, error: err ? err.message : 'No answer from camera' });
        const segs = JSON.parse(line).map((s) => ({ ...s, archived: !!archivedFile(cam, s.st).file }));
        res.json({ success: true, data: segs });
      });
  });

  router.get('/camera/sd/:idx/:st-:ed.jpg', async (req, res) => {
    const st = Number(req.params.st);
    try {
      const cam = sdCamera(req.params.idx);
      const { dir, file } = archivedFile(cam, st);
      if (!file) return res.status(404).end();
      const thumb = path.join(dir, '.thumbs', `${st}.jpg`);
      if (!fs.existsSync(thumb)) {
        if (!thumbJobs.has(st)) thumbJobs.set(st, makeThumb(file, thumb).finally(() => thumbJobs.delete(st)));
        await thumbJobs.get(st);
      }
      res.setHeader('Cache-Control', 'private, max-age=604800');
      res.sendFile(thumb);
    } catch {
      res.status(404).end();
    }
  });

  router.get('/camera/sd/:idx/:st-:ed.mp4', (req, res) => {
    const st = Number(req.params.st), ed = Number(req.params.ed);
    if (!(st > 0 && ed > st)) return res.status(400).end();
    let url;
    try {
      const cam = sdCamera(req.params.idx);
      const { file } = archivedFile(cam, st);
      if (file) return res.sendFile(file);  // seekable, with Range support
      const p = encodeURI(rtspPath(cam.ipc, cam.deviceId));
      url = `rtsp://127.0.0.1:${cam.ipc.rtspPort || 8667}${p}/replay/${st}-${ed}`;
    } catch (err) {
      return res.status(404).json({ success: false, error: err.message });
    }

    const ff = spawn('ffmpeg', [
      // fragmented MP4 needs the dimensions up front: probe until the first SPS
      '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp',
      '-analyzeduration', '20000000', '-probesize', '20000000', '-i', url,
      '-map', '0:v', '-c:v', 'copy', '-t', String(ed - st),
      '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1',
    ]);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    ff.stdout.pipe(res);
    ff.stderr.on('data', (d) => console.warn(`[CameraSD] ffmpeg: ${String(d).trim()}`));
    ff.on('close', () => res.end());
    req.on('close', () => ff.kill('SIGTERM'));
  });
};
