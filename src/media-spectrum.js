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

// FFT tables for size N, computed once: the bit-reversal permutation and the
// twiddle factors e^(−2πik/N), k < N/2 (a stage of size `len` uses every
// (N/len)-th one)
const REV = new Uint16Array(N);
for (let i = 0; i < N; i++) {
  let r = 0;
  for (let b = 1, x = i; b < N; b <<= 1, x >>= 1) r = (r << 1) | (x & 1);
  REV[i] = r;
}
const COS = Float64Array.from({ length: N / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / N));
const SIN = Float64Array.from({ length: N / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / N));

// iterative radix-2 FFT of N points, in place
function fft(re, im) {
  for (let i = 1; i < N; i++) {
    const j = REV[i];
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1, step = N / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = i + k, b = a + half, wr = COS[w], wi = SIN[w];
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
// band edges: 40 Hz … 11 kHz, logarithmic (as ears hear it)
const EDGES = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round((40 * Math.pow(11000 / 40, i / BANDS)) / (RATE / N))));

// work buffers, reused: this runs ~21 times a second per stream
const RE = new Float64Array(N), IM = new Float64Array(N);

// 1024 samples (−1…1) → BANDS levels 0–255
function bands(samples) {
  for (let i = 0; i < N; i++) { RE[i] = samples[i] * HANN[i]; IM[i] = 0 }
  fft(RE, IM);
  const out = new Uint8Array(BANDS);
  for (let b = 0; b < BANDS; b++) {
    const lo = EDGES[b], hi = Math.max(lo + 1, EDGES[b + 1]);
    let peak = 0; // squared magnitude: one square root per band, not one per bin
    for (let k = lo; k < hi && k < N / 2; k++) { const m = RE[k] * RE[k] + IM[k] * IM[k]; if (m > peak) peak = m }
    const db = 20 * Math.log10(Math.sqrt(peak) / (N / 4) + 1e-9); // ≈ dBFS
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
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      s.watchers.delete(onFrame);
      if (s.watchers.size) return;
      clearTimeout(s.timer);
      s.timer = setTimeout(() => this._stop(url, s), LINGER_MS);
    };
  }

  _start(url) {
    const s = { watchers: new Set(), timer: null, proc: null };
    const proc = spawn('ffmpeg', [
      '-loglevel', 'error', '-re', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-i', url, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    s.proc = proc;
    // s16le PCM straight into the frame; a chunk can end halfway through a
    // sample, its low byte waits in `low` for the next one
    const samples = new Float64Array(N);
    let fill = 0, low = -1;
    const push = (v) => {
      samples[fill++] = v / 32768;
      if (fill < N) return;
      fill = 0;
      const frame = bands(samples);
      for (const w of s.watchers) { try { w(frame) } catch { /* a watcher went away */ } }
    };
    proc.stdout.on('data', (chunk) => {
      let i = 0;
      if (low >= 0) { push(((chunk[0] << 8) | low) << 16 >> 16); low = -1; i = 1 }
      for (; i + 1 < chunk.length; i += 2) push(((chunk[i + 1] << 8) | chunk[i]) << 16 >> 16);
      if (i < chunk.length) low = chunk[i];
    });
    proc.on('error', () => this._stop(url));
    proc.on('close', () => { if (this.streams.get(url) === s) this.streams.delete(url) });
    return s;
  }

  // `only`: just that decoder — a linger timer mustn't take down a newer one
  // of the same station
  _stop(url, only = null) {
    const s = this.streams.get(url);
    if (!s || (only && s !== only)) return;
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
