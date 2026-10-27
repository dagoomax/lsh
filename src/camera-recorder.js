'use strict';

// Motion-triggered recording for manual `cameras` entries with an RTSP `url`.
// When object detection (src/object-detection.js) reports anything on the
// camera — the per-camera aggregate `objectdetect/<slug>/any/detected`, the
// same signal HomeKit Secure Video uses — ffmpeg copies the stream to an MP4
// clip; it keeps going while motion lasts, then `postSeconds` more, capped at
// `maxMinutes`. Each clip gets a JPEG thumbnail and a small JSON sidecar.
// Old clips go after `days`, and the oldest first once the camera's folder
// passes `maxMB`.
//
//   cameras[i].record = { days: 7, maxMB: 2000, postSeconds: 20, maxMinutes: 10 }
//   cameras[i].motionSource — name of the objectDetection camera (defaults to the name)
//   config.recordingsDir   — where clips go (default <LSH>/recordings)
//
// Clips are recordings/<camera slug>/<YYYY-MM-DD>/<HHMMSS>.mp4 (+ .jpg, .json).
// Video is copied as-is; audio becomes AAC, since MP4 can't carry the G.711
// most cheap cameras (Tuya included) send. Fragmented MP4, so a clip cut off by
// a crash still plays. No pre-roll: a clip starts when motion is reported, and
// a cloud-relayed stream (tuya-ipc-terminal) takes a few seconds to deliver
// its first frame on top of that.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const slugify = (name) => (name || 'camera').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'camera';
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLIP_RE = /^\d{6}\.(mp4|jpg|json)$/;

class CameraRecorder {
  constructor(config, store, sensorRegistry) {
    this.store = store;
    this.registry = sensorRegistry;
    this.ffmpeg = config.ffmpegRtsp?.ffmpegPath || 'ffmpeg';
    this.dir = config.recordingsDir || path.join(__dirname, '..', 'recordings');
    this.cams = new Map(); // slug → { cam, opts, motionKey, proc, clip, stopTimer, capTimer }
    for (const cam of config.cameras || []) {
      if (!cam?.record || !cam.url || !cam.name) continue;
      const r = cam.record === true ? {} : cam.record;
      const opts = {
        days: clamp(r.days, 1, 365, 7),
        maxMB: clamp(r.maxMB, 50, 1e6, 2000),
        postSeconds: clamp(r.postSeconds, 0, 600, 20),
        maxMinutes: clamp(r.maxMinutes, 1, 120, 10),
      };
      const slug = slugify(cam.name);
      this.cams.set(slug, { cam, slug, opts, motionKey: `objectdetect/${slugify(cam.motionSource || cam.name)}/any/detected`, proc: null });
    }
    this._onChange = this._onChange.bind(this);
  }

  start() {
    if (!this.cams.size) return;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const c of this.cams.values()) {
      this.registry?.registerDevice({
        key: `recorder/${c.slug}`, label: `${c.cam.name} recorder`, icon: '⏺️', type: 'recorder',
        sensors: [
          { path: 'recording', name: 'Recording', label: 'Recording', format: 'on-off' },
          { path: 'clips', name: 'Clips', label: 'Clips', format: 'number' },
          { path: 'last', name: 'Last clip', label: 'Last clip', format: 'string', raw: true },
        ],
      });
      this.store.set(`recorder/${c.slug}/recording`, 0);
      this._count(c);
    }
    this.store.on('change', this._onChange);
    this._prune();
    this._pruneTimer = setInterval(() => this._prune(), 3600_000);
    this._pruneTimer.unref?.();
    // ffmpeg outlives a parent that exits; SIGINT makes it close the clip properly
    process.once('exit', () => { for (const c of this.cams.values()) c.proc?.kill('SIGINT'); });
    console.log(`[Recorder] ${this.cams.size} camera(s): ${[...this.cams.values()].map((c) => `${c.cam.name} (${c.opts.days} d, ${c.opts.maxMB} MB)`).join(', ')} → ${this.dir}`);
  }

  stop() {
    this.store.off('change', this._onChange);
    clearInterval(this._pruneTimer);
    for (const c of this.cams.values()) this._stop(c);
  }

  _onChange({ key, value }) {
    for (const c of this.cams.values()) {
      if (key !== c.motionKey) continue;
      if (value === 1) this.trigger(c.slug, 'motion');
      else if (c.proc && c.clip.trigger === 'motion') this._stopIn(c, c.opts.postSeconds);
    }
  }

  // Start (or keep going) a recording. manualSeconds: a fixed-length clip from the API.
  trigger(slug, trigger = 'motion', manualSeconds = 0) {
    const c = this.cams.get(slug);
    if (!c) throw new Error('No such camera, or recording is off for it');
    if (c.proc) {
      clearTimeout(c.stopTimer); c.stopTimer = null;
      if (manualSeconds) this._stopIn(c, manualSeconds);
      return c.clip;
    }
    const now = new Date();
    const dayDir = path.join(this.dir, c.slug, dayOf(now));
    fs.mkdirSync(dayDir, { recursive: true });
    const base = path.join(dayDir, timeOf(now));
    const proc = spawn(this.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', ...(/^rtsps?:/i.test(c.cam.url) ? ['-rtsp_transport', 'tcp'] : ['-re']), '-i', c.cam.url,
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-y', `${base}.mp4`,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    c.proc = proc;
    c.clip = { start: now.toISOString(), trigger, base };
    this.store.set(`recorder/${c.slug}/recording`, 1);
    c.capTimer = setTimeout(() => this._stop(c), c.opts.maxMinutes * 60_000);
    if (manualSeconds) this._stopIn(c, manualSeconds);
    console.log(`[Recorder] ${c.cam.name}: recording (${trigger})`);
    proc.on('error', (e) => { err = e.message; });
    proc.on('close', () => this._finished(c, proc, err));
    return c.clip;
  }

  _stopIn(c, seconds) {
    clearTimeout(c.stopTimer);
    c.stopTimer = setTimeout(() => this._stop(c), seconds * 1000);
  }

  // 'q' lets ffmpeg write its last fragment; kill only if it doesn't go
  _stop(c) {
    if (!c.proc) return;
    clearTimeout(c.stopTimer); clearTimeout(c.capTimer);
    const proc = c.proc;
    try { proc.stdin.write('q'); proc.stdin.end(); } catch { /* already gone */ }
    setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, 5000);
  }

  _finished(c, proc, err) {
    if (c.proc !== proc) return;
    const clip = c.clip;
    c.proc = null; c.clip = null;
    clearTimeout(c.stopTimer); clearTimeout(c.capTimer);
    this.store.set(`recorder/${c.slug}/recording`, 0);
    const mp4 = `${clip.base}.mp4`;
    let size = 0;
    try { size = fs.statSync(mp4).size; } catch { /* nothing written */ }
    if (size < 2048) {
      fs.rmSync(mp4, { force: true });
      console.error(`[Recorder] ${c.cam.name}: no video recorded${err ? ` — ${err.trim().split('\n').pop()}` : ''}`);
      return;
    }
    const end = new Date();
    const meta = { camera: c.cam.name, start: clip.start, end: end.toISOString(), seconds: Math.round((end - new Date(clip.start)) / 1000), trigger: clip.trigger, size };
    fs.writeFileSync(`${clip.base}.json`, JSON.stringify(meta));
    // thumbnail from a second in (the first frames of a fresh stream are often grey)
    spawn(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', mp4, '-frames:v', '1', '-vf', 'scale=480:-2', '-y', `${clip.base}.jpg`], { stdio: 'ignore' })
      .on('close', () => {});
    this.store.set(`recorder/${c.slug}/last`, meta.end);
    console.log(`[Recorder] ${c.cam.name}: saved ${path.relative(this.dir, mp4)} (${meta.seconds} s, ${(size / 1e6).toFixed(1)} MB)`);
    this._prune(c);
  }

  // ── Listing / files ──────────────────────────────────────────────────────
  cameras() {
    return [...this.cams.values()].map((c) => ({ slug: c.slug, name: c.cam.name, recording: !!c.proc, ...c.opts }));
  }

  days(slug) {
    const d = path.join(this.dir, this._cam(slug).slug);
    try { return fs.readdirSync(d).filter((x) => DAY_RE.test(x)).sort().reverse(); } catch { return []; }
  }

  clips(slug, day) {
    const c = this._cam(slug);
    if (!DAY_RE.test(day)) throw new Error('day must be YYYY-MM-DD');
    const d = path.join(this.dir, c.slug, day);
    let names = [];
    try { names = fs.readdirSync(d).filter((x) => /^\d{6}\.mp4$/.test(x)); } catch { return []; }
    const active = c.clip ? path.basename(c.clip.base) : null;
    return names.sort().reverse().map((n) => {
      const id = n.slice(0, 6);
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(d, `${id}.json`), 'utf8')); } catch { /* still recording, or cut off */ }
      const url = `/api/recordings/${c.slug}/${day}/${id}`;
      return {
        id, day, start: meta.start || `${day}T${id.slice(0, 2)}:${id.slice(2, 4)}:${id.slice(4)}`, seconds: meta.seconds ?? null,
        trigger: meta.trigger || null, size: meta.size ?? safeSize(path.join(d, n)), recording: id === active,
        video: `${url}.mp4`, thumb: fs.existsSync(path.join(d, `${id}.jpg`)) ? `${url}.jpg` : null,
      };
    });
  }

  // absolute path of one clip file, or null (names are checked, never joined raw)
  file(slug, day, name) {
    const c = this.cams.get(slug);
    if (!c || !DAY_RE.test(day) || !CLIP_RE.test(name)) return null;
    const f = path.join(this.dir, c.slug, day, name);
    return fs.existsSync(f) ? f : null;
  }

  remove(slug, day, id) {
    const c = this._cam(slug);
    if (!DAY_RE.test(day) || !/^\d{6}$/.test(id)) throw new Error('Bad clip id');
    if (c.clip && path.basename(c.clip.base) === id) throw new Error('That clip is still recording');
    for (const ext of ['mp4', 'jpg', 'json']) fs.rmSync(path.join(this.dir, c.slug, day, `${id}.${ext}`), { force: true });
    this._count(c);
  }

  _cam(slug) {
    const c = this.cams.get(slug);
    if (!c) throw new Error('No such camera, or recording is off for it');
    return c;
  }

  _count(c) {
    let n = 0;
    for (const day of this.days(c.slug)) {
      try { n += fs.readdirSync(path.join(this.dir, c.slug, day)).filter((x) => x.endsWith('.mp4')).length; } catch { /* gone */ }
    }
    this.store.set(`recorder/${c.slug}/clips`, n);
  }

  // drop days past `days`, then oldest clips while over `maxMB`
  _prune(only) {
    for (const c of only ? [only] : this.cams.values()) {
      const root = path.join(this.dir, c.slug);
      const cutoff = dayOf(new Date(Date.now() - c.opts.days * 86400_000));
      const days = this.days(c.slug);
      for (const day of days) if (day < cutoff) fs.rmSync(path.join(root, day), { recursive: true, force: true });
      const active = c.clip ? `${c.clip.base}.mp4` : null;
      const files = [];
      for (const day of this.days(c.slug).reverse()) {
        for (const n of fs.readdirSync(path.join(root, day)).sort()) {
          if (n.endsWith('.mp4')) files.push(path.join(root, day, n));
        }
      }
      let total = files.reduce((s, f) => s + safeSize(f), 0);
      const limit = c.opts.maxMB * 1e6;
      for (const f of files) {
        if (total <= limit) break;
        if (f === active) continue;
        total -= safeSize(f);
        for (const ext of ['.mp4', '.jpg', '.json']) fs.rmSync(f.replace(/\.mp4$/, ext), { force: true });
      }
      for (const day of this.days(c.slug)) {
        try { if (!fs.readdirSync(path.join(root, day)).length) fs.rmdirSync(path.join(root, day)); } catch { /* in use */ }
      }
      this._count(c);
    }
  }
}

function safeSize(f) { try { return fs.statSync(f).size; } catch { return 0; } }
function clamp(v, lo, hi, dflt) { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? Math.min(hi, Math.max(lo, n)) : dflt; }

module.exports = CameraRecorder;
module.exports.slugify = slugify;
