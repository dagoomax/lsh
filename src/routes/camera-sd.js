'use strict';

// Camera SD-card recordings — Tuya cameras through tuya-ipc-terminal
// (config.tuyaIpc). Listing opens a replay session over the camera's MQTT
// signalling (`cameras recordings`); playback is the terminal's RTSP path
// /<camera>/replay/<start>-<end>, remuxed to fragmented MP4 for <video>.
// The camera streams replay at 1x and sends no audio track.
//
// config.json: cameras[i].tuyaPtz.deviceId + "tuyaIpc": { dir, rtspPort? }
const fs = require('fs');
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
        res.json({ success: true, data: JSON.parse(line) });
      });
  });

  router.get('/camera/sd/:idx/:st-:ed.mp4', (req, res) => {
    const st = Number(req.params.st), ed = Number(req.params.ed);
    if (!(st > 0 && ed > st)) return res.status(400).end();
    let url;
    try {
      const cam = sdCamera(req.params.idx);
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
