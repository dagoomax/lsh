#!/usr/bin/env node
'use strict';

// Copy a Tuya camera's SD-card recordings to disk before the card loops over
// them (the Wejście doorbell keeps ~5 days). Oldest first, one segment at a
// time: the camera serves a single replay session and plays back at 1x, so
// N hours of footage take about N hours. Re-run safe — saved segments are
// skipped. While it runs, SD playback in the dashboard will be refused.
//
//   node scripts/tuya-sd-archive.js [--hours 96] [--camera 0] [--out ~/sd-archive]
//
// Uses cameras[i].tuyaPtz.deviceId + config.tuyaIpc (see src/routes/camera-sd.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const hours = Number(arg('hours', 96));
const camIdx = Number(arg('camera', 0));

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const cam = (cfg.cameras || [])[camIdx];
const ipc = cfg.tuyaIpc;
if (!cam?.tuyaPtz?.deviceId || !ipc?.dir) {
  console.error(`cameras[${camIdx}] has no tuyaPtz.deviceId, or tuyaIpc.dir is missing`);
  process.exit(1);
}
const deviceId = cam.tuyaPtz.deviceId;
const reg = JSON.parse(fs.readFileSync(path.join(ipc.dir, '.tuya-data', 'cameras.json'), 'utf8'));
const rtspPath = reg.cameras.find((c) => c.deviceId === deviceId).rtspPath;
const outDir = arg('out', path.join(os.homedir(), 'sd-archive', rtspPath.replace(/^\//, '')));

const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d) => `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

function listDay(date) {
  return new Promise((resolve) => {
    execFile(path.join(ipc.dir, 'tuya-ipc-terminal'), ['cameras', 'recordings', deviceId, date, '--json'],
      { cwd: ipc.dir, timeout: 90000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        const line = String(stdout).split('\n').find((l) => l.startsWith('['));
        resolve(line ? JSON.parse(line) : null);
      });
  });
}

function duration(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      (err, out) => resolve(err ? 0 : Number(out) || 0));
  });
}

function record(seg, file) {
  const len = seg.ed - seg.st;
  const url = `rtsp://127.0.0.1:${ipc.rtspPort || 8667}${encodeURI(rtspPath)}/replay/${seg.st}-${seg.ed}`;
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp',
      '-analyzeduration', '20000000', '-probesize', '20000000', '-i', url,
      '-map', '0:v', '-c:v', 'copy', '-t', String(len), '-f', 'mp4', '-y', file,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errText = '';
    ff.stderr.on('data', (d) => { errText += d; });
    const kill = setTimeout(() => ff.kill('SIGTERM'), (len + 90) * 1000);
    ff.on('close', () => { clearTimeout(kill); resolve(errText.trim().split('\n').pop()); });
  });
}

(async () => {
  const until = Math.floor(Date.now() / 1000);
  const from = until - hours * 3600;
  log(`Archiving ${rtspPath} ${new Date(from * 1000).toLocaleString()} → ${new Date(until * 1000).toLocaleString()} into ${outDir}`);

  let saved = 0, skipped = 0, failed = 0;
  for (let t = new Date(from * 1000); t.getTime() / 1000 < until; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    const date = day(t);
    // Re-listed per day: the camera deletes its oldest footage while we copy
    const segs = await listDay(date);
    if (!segs) { log(`${date}: camera did not answer the list, skipping day`); continue; }
    const todo = segs.filter((s) => s.ed > from && s.st < until);
    log(`${date}: ${todo.length} segment(s) in range`);
    fs.mkdirSync(path.join(outDir, date), { recursive: true });

    for (const seg of todo) {
      const file = path.join(outDir, date, `${clock(new Date(seg.st * 1000))}.mp4`);
      if (fs.existsSync(file)) { skipped++; continue; }
      const part = `${file}.part.mp4`;
      let ok = false;
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        const err = await record(seg, part);
        const got = await duration(part);
        ok = got >= (seg.ed - seg.st) * 0.5;
        if (!ok) {
          log(`${date} ${clock(new Date(seg.st * 1000))}: attempt ${attempt} got ${got.toFixed(0)}s${err ? ` (${err})` : ''}`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      if (ok) {
        fs.renameSync(part, file);
        saved++;
        if (saved % 12 === 0) log(`${date}: saved ${saved} so far, now at ${clock(new Date(seg.ed * 1000))}`);
      } else {
        fs.rmSync(part, { force: true });
        failed++;
      }
    }
  }
  log(`Done — saved ${saved}, already had ${skipped}, failed ${failed}`);
})();
