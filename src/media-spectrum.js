'use strict';

// Live spectrum of a radio stream for the dashboard's music hub visualizer, when
// the station plays on a speaker (Chromecast / AirPlay) and the browser can't
// hear it. LSH opens the same stream, ffmpeg decodes it to mono PCM, and an FFT
// turns every 1024 samples (~46 ms at 22.05 kHz) into BANDS log-spaced levels
// (0–255). One decoder per stream URL, shared by every watcher, stopped a few
// seconds after the last one leaves; at most MAX_STREAMS at a time.
const { spawn } = require('child_process');

const RATE = 22050;
const N = 1024;
const BANDS = 48;
const MAX_STREAMS = 3;
const LINGER_MS = 4000;

// iterative radix-2 FFT, in place
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
// band edges: 40 Hz … 11 kHz, logarithmic (as ears hear it)
const EDGES = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round((40 * Math.pow(11000 / 40, i / BANDS)) / (RATE / N))));

// 1024 samples (−1…1) → BANDS levels 0–255
function bands(samples) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = samples[i] * HANN[i];
  fft(re, im);
  const out = new Uint8Array(BANDS);
  for (let b = 0; b < BANDS; b++) {
    const lo = EDGES[b], hi = Math.max(lo + 1, EDGES[b + 1]);
    let peak = 0;
    for (let k = lo; k < hi && k < N / 2; k++) peak = Math.max(peak, Math.hypot(re[k], im[k]));
    const db = 20 * Math.log10(peak / (N / 4) + 1e-9); // ≈ dBFS
    out[b] = Math.max(0, Math.min(255, Math.round(((db + 48) / 40) * 255))); // −48 … −8 dBFS → 0 … 255 (radio is loud and compressed)
  }
  return out;
}

class SpectrumHub {
  constructor() { this.streams = new Map() } // url → { proc, watchers: Set, timer }

  // watch(url, onFrame(Uint8Array)) → stop()
  watch(url, onFrame) {
    let s = this.streams.get(url);
    if (!s) {
      if (this.streams.size >= MAX_STREAMS) throw new Error('Too many streams analysed at once');
      s = this._start(url);
      this.streams.set(url, s);
    }
    clearTimeout(s.timer);
    s.watchers.add(onFrame);
    return () => {
      s.watchers.delete(onFrame);
      if (!s.watchers.size) s.timer = setTimeout(() => this._stop(url), LINGER_MS);
    };
  }

  _start(url) {
    const s = { watchers: new Set(), timer: null, proc: null };
    const proc = spawn('ffmpeg', [
      '-loglevel', 'error', '-re', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-i', url, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    s.proc = proc;
    let buf = Buffer.alloc(0);
    const samples = new Float64Array(N);
    proc.stdout.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= N * 2) {
        for (let i = 0; i < N; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
        buf = buf.subarray(N * 2);
        const frame = bands(samples);
        for (const w of s.watchers) { try { w(frame) } catch { /* a watcher went away */ } }
      }
    });
    proc.on('error', () => this._stop(url));
    proc.on('close', () => { if (this.streams.get(url) === s) this.streams.delete(url) });
    return s;
  }

  _stop(url) {
    const s = this.streams.get(url);
    if (!s) return;
    this.streams.delete(url);
    clearTimeout(s.timer);
    try { s.proc?.kill('SIGKILL') } catch { /* gone */ }
  }

  stopAll() { for (const url of [...this.streams.keys()]) this._stop(url) }
}

module.exports = SpectrumHub;
module.exports.bands = bands;
module.exports.BANDS = BANDS;
module.exports.N = N;
module.exports.RATE = RATE;
