'use strict';

// Live MJPEG out of an RTSP stream, for clients that can't play H.264/H.265 —
// the Loxone app's Intercom / Camera block takes only JPEG or MJPEG.
//
// One ffmpeg per source, shared by every viewer: it starts with the first
// viewer, keeps the latest frame, writes each new frame to all viewers as
// multipart/x-mixed-replace, and stops IDLE_MS after the last viewer leaves.
// A viewer that joins mid-stream gets the latest frame at once.
//
//   const relay = new MjpegRelay({ ffmpegPath });
//   relay.serve(key, rtspUrl, { fps: 10, width: 640 }, req, res);
//   const jpeg = await relay.frame(key, rtspUrl, opts);   // one frame, reusing a running stream

const { spawn } = require('child_process');

const BOUNDARY = 'lshframe';
const IDLE_MS = 10000;
const RESTART_MS = 3000;
const FIRST_FRAME_MS = 15000;
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

// Splits ffmpeg's concatenated JPEGs on the end-of-image marker (0xFFD9 can't
// occur inside JPEG entropy data — a 0xFF there is always byte-stuffed).
function takeFrames(buf) {
  const frames = [];
  let pos = 0;
  for (;;) {
    const start = buf.indexOf(SOI, pos);
    if (start < 0) { pos = buf.length; break }
    const end = buf.indexOf(EOI, start + 2);
    if (end < 0) { pos = start; break }
    frames.push(buf.subarray(start, end + 2));
    pos = end + 2;
  }
  return { frames, rest: buf.subarray(pos) };
}

class MjpegRelay {
  constructor({ ffmpegPath = 'ffmpeg', label = 'MJPEG', idleMs = IDLE_MS } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.idleMs = idleMs;
    this.label = label;
    this.streams = new Map(); // key → { url, opts, proc, viewers:Set, waiters:[], last, idle, restart }
  }

  _args(url, { fps = 10, width = 640, quality = 6 } = {}) {
    const vf = [`fps=${fps}`];
    if (width) vf.push(`scale=${Number(width)}:-2`);
    // url: an rtsp:// address, or ready ffmpeg input args (tests, other sources)
    const input = Array.isArray(url) ? url : [...(/^rtsps?:/.test(url) ? ['-rtsp_transport', 'tcp'] : []), '-i', url];
    return [
      '-loglevel', 'error', ...input,
      '-an', '-vf', vf.join(','), '-c:v', 'mjpeg', '-q:v', String(quality),
      '-f', 'image2pipe', 'pipe:1',
    ];
  }

  _get(key, url, opts) {
    let s = this.streams.get(key);
    if (!s) {
      s = { key, url, opts, proc: null, viewers: new Set(), waiters: [], last: null, idle: null, restart: null };
      this.streams.set(key, s);
    }
    clearTimeout(s.idle);
    s.idle = null;
    if (!s.proc && !s.restart) this._start(s);
    return s;
  }

  _start(s) {
    s.restart = null;
    const proc = spawn(this.ffmpegPath, this._args(s.url, s.opts), { stdio: ['ignore', 'pipe', 'pipe'] });
    s.proc = proc;
    let buf = Buffer.alloc(0);
    let err = '';
    proc.stdout.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      const { frames, rest } = takeFrames(buf);
      buf = rest.length > 8e6 ? Buffer.alloc(0) : rest;
      for (const f of frames) this._frame(s, f);
    });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-500) });
    proc.on('error', (e) => { err = e.message });
    proc.on('close', (code) => {
      if (s.proc !== proc) return;
      s.proc = null;
      if (!s.viewers.size && !s.waiters.length) return;
      console.error(`[${this.label}] ${s.key}: ffmpeg exited (${code})${err ? ' — ' + err.trim().split('\n').pop() : ''} — restarting`);
      s.restart = setTimeout(() => this._start(s), RESTART_MS);
    });
  }

  _frame(s, jpeg) {
    s.last = Buffer.from(jpeg);
    const part = Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${s.last.length}\r\n\r\n`),
      s.last, Buffer.from('\r\n'),
    ]);
    for (const res of s.viewers) {
      // a slow viewer skips frames instead of buffering without limit
      if (res.writableLength < 2e6) res.write(part);
    }
    for (const w of s.waiters.splice(0)) w(s.last);
    if (!s.viewers.size) this._release(s);
  }

  _release(s) {
    if (s.viewers.size || s.waiters.length || s.idle) return;
    s.idle = setTimeout(() => {
      s.idle = null;
      if (s.viewers.size || s.waiters.length) return;
      clearTimeout(s.restart);
      s.proc?.kill('SIGKILL');
      this.streams.delete(s.key);
    }, this.idleMs);
    s.idle.unref?.();
  }

  serve(key, url, opts, req, res) {
    const s = this._get(key, url, opts);
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-cache, no-store',
      Connection: 'close',
      Pragma: 'no-cache',
    });
    s.viewers.add(res);
    if (s.last) res.write(Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${s.last.length}\r\n\r\n`), s.last, Buffer.from('\r\n'),
    ]));
    const leave = () => { s.viewers.delete(res); this._release(s) };
    req.on('close', leave);
    res.on('error', leave);
  }

  // One JPEG: the running stream's next frame, or a short-lived stream's first
  frame(key, url, opts) {
    const s = this._get(key, url, opts);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        s.waiters = s.waiters.filter((w) => w !== done);
        this._release(s);
        reject(new Error('No frame from the stream'));
      }, FIRST_FRAME_MS);
      const done = (jpeg) => { clearTimeout(t); resolve(jpeg); setImmediate(() => this._release(s)) };
      s.waiters.push(done);
    });
  }

  viewers() {
    return [...this.streams.values()].map((s) => ({ key: s.key, viewers: s.viewers.size, running: !!s.proc }));
  }

  stop() {
    for (const s of this.streams.values()) {
      clearTimeout(s.idle); clearTimeout(s.restart);
      s.proc?.kill('SIGKILL');
      for (const res of s.viewers) res.end();
    }
    this.streams.clear();
  }
}

MjpegRelay._test = { takeFrames };
module.exports = MjpegRelay;
