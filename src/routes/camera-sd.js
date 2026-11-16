'use strict';

// Camera SD-card recordings — Tuya cameras through tuya-ipc-terminal
// (config.tuyaIpc). Listing opens a replay session over the camera's MQTT
// signalling (`cameras recordings`); playback is the terminal's RTSP path
// /<camera>/replay/<start>-<end>, remuxed to fragmented MP4 for <video>.
// The camera streams replay at 1x and sends no audio track.
//
// Segments already copied by scripts/tuya-sd-archive.js are served from disk
// instead (instant and seekable — the camera only serves one replay at a
// time). Thumbnails come from the archived file when there is one, otherwise
// from the first frame of a short replay session (~8 s each). The camera
// takes one replay at a time and needs a pause between sessions (straight
// after one ends, the next fails about half the time), so those grabs run
// one by one, newest request first, and step aside for playback.
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

function replayUrl(cam, st, ed) {
  return `rtsp://127.0.0.1:${cam.ipc.rtspPort || 8667}${encodeURI(rtspPath(cam.ipc, cam.deviceId))}/replay/${st}-${ed}`;
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

const thumbPath = (dir, st) => path.join(dir, '.thumbs', `${st}.jpg`);

const thumbJobs = new Map();  // st → Promise, so one grid load doesn't spawn duplicate ffmpegs

function makeThumb(src, out, { seek = 3, rtsp = false, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.tmp.jpg`;
    const ff = execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error',
      ...(rtsp ? ['-rtsp_transport', 'tcp'] : ['-ss', String(seek)]), '-i', src,
      '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', '-y', tmp],
    { timeout }, (err) => {
      if (err || !fs.existsSync(tmp)) { fs.rmSync(tmp, { force: true }); return reject(err || new Error('no frame')); }
      fs.renameSync(tmp, out);
      resolve();
    });
    if (rtsp) replay.grab = ff;
  });
}

// ── The camera's single replay slot ──────────────────────────────────────
const GAP_MS = 8000;          // pause the camera needs between replay sessions
const STALE_MS = 60000;       // drop queued thumbnails nobody has asked for lately
const replay = {
  playing: 0,                 // live <video> playbacks
  grab: null,                 // ffmpeg of the thumbnail being grabbed
  lastEnd: 0,                 // when the camera's last replay session ended
  queue: new Map(),           // st → { cam, st, ed, out, asked }
  running: false,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const untilRested = () => sleep(Math.max(0, replay.lastEnd + GAP_MS - Date.now()));

function queueReplayThumb(cam, st, ed, out) {
  const job = replay.queue.get(st);
  if (job) job.asked = Date.now();
  else replay.queue.set(st, { cam, st, ed, out, asked: Date.now() });
  if (!replay.running) runQueue();
}

async function runQueue() {
  replay.running = true;
  try {
    for (;;) {
      for (const [st, j] of replay.queue) if (Date.now() - j.asked > STALE_MS) replay.queue.delete(st);
      if (!replay.queue.size) break;
      if (replay.playing) { await sleep(2000); continue; }
      await untilRested();
      if (replay.playing) continue;
      // newest request first — the hour the dashboard is showing right now
      const job = [...replay.queue.values()].sort((a, b) => b.asked - a.asked || a.st - b.st)[0];
      replay.queue.delete(job.st);
      if (fs.existsSync(job.out)) continue;
      try {
        await makeThumb(replayUrl(job.cam, job.st, job.ed), job.out, { rtsp: true, timeout: 30000 });
      } catch { /* the dashboard asks again */ }
      replay.grab = null;
      replay.lastEnd = Date.now();
    }
  } finally {
    replay.running = false;
  }
}

module.exports = function register(router) {
  // ?date=YYYY-MM-DD → [{ st, ed, archived, thumb }] (unix seconds)
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
        replay.lastEnd = Date.now();
        const line = String(stdout).split('\n').find((l) => l.startsWith('['));
        if (!line) return res.status(502).json({ success: false, error: err ? err.message : 'No answer from camera' });
        const segs = JSON.parse(line).map((s) => {
          const { dir, file } = archivedFile(cam, s.st);
          return { ...s, archived: !!file, thumb: fs.existsSync(thumbPath(dir, s.st)) };
        });
        res.json({ success: true, data: segs });
      });
  });

  // 202 while a thumbnail grabbed from the camera is still queued — ask again
  router.get('/camera/sd/:idx/:st-:ed.jpg', async (req, res) => {
    const st = Number(req.params.st), ed = Number(req.params.ed);
    if (!(st > 0 && ed > st)) return res.status(400).end();
    try {
      const cam = sdCamera(req.params.idx);
      const { dir, file } = archivedFile(cam, st);
      const thumb = thumbPath(dir, st);
      if (!fs.existsSync(thumb)) {
        if (!file) {
          queueReplayThumb(cam, st, ed, thumb);
          res.setHeader('Cache-Control', 'no-store');
          return res.status(202).end();
        }
        if (!thumbJobs.has(st)) thumbJobs.set(st, makeThumb(file, thumb).finally(() => thumbJobs.delete(st)));
        await thumbJobs.get(st);
      }
      res.setHeader('Cache-Control', 'private, max-age=604800');
      res.sendFile(thumb);
    } catch {
      res.status(404).end();
    }
  });

  router.get('/camera/sd/:idx/:st-:ed.mp4', async (req, res) => {
    const st = Number(req.params.st), ed = Number(req.params.ed);
    if (!(st > 0 && ed > st)) return res.status(400).end();
    let url;
    try {
      const cam = sdCamera(req.params.idx);
      const { file } = archivedFile(cam, st);
      if (file) return res.sendFile(file);  // seekable, with Range support
      url = replayUrl(cam, st, ed);
    } catch (err) {
      return res.status(404).json({ success: false, error: err.message });
    }

    // playback goes first: stop a thumbnail grab and give the camera its pause
    replay.playing++;
    let closed = false;
    req.on('close', () => { closed = true; });
    if (replay.grab) { replay.grab.kill('SIGTERM'); replay.lastEnd = Date.now(); }
    await untilRested();
    if (closed) { replay.playing--; replay.lastEnd = Date.now(); return; }

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
    ff.on('close', () => { replay.playing--; replay.lastEnd = Date.now(); res.end(); });
    req.on('close', () => ff.kill('SIGTERM'));
  });
};

module.exports._replay = replay;
