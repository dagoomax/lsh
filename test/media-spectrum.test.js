'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const cp = require('child_process');

// stand-in ffmpeg (patched before the module grabs spawn): the hub reads
// s16le PCM off its stdout
let fake = null;
cp.spawn = () => {
  fake = new EventEmitter();
  fake.stdout = new EventEmitter();
  fake.kill = (sig) => { fake.killed = sig; fake.emit('close') };
  return fake;
};
const SpectrumHub = require('../src/media-spectrum');
const mediaRoutes = require('../src/routes/media');
const { bands, N, RATE, BANDS } = SpectrumHub;

// straight DFT with the same window and bands — what the FFT must agree with
const HANN = Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
const EDGES = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round((40 * Math.pow(11000 / 40, i / BANDS)) / (RATE / N))));
function referenceBands(samples) {
  const out = [];
  for (let b = 0; b < BANDS; b++) {
    const lo = EDGES[b], hi = Math.max(lo + 1, EDGES[b + 1]);
    let peak = 0;
    for (let k = lo; k < hi && k < N / 2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const a = (-2 * Math.PI * k * n) / N, x = samples[n] * HANN[n];
        re += x * Math.cos(a); im += x * Math.sin(a);
      }
      peak = Math.max(peak, Math.hypot(re, im));
    }
    const db = 20 * Math.log10(peak / (N / 4) + 1e-9);
    out.push(Math.max(0, Math.min(255, Math.round(((db + 48) / 40) * 255))));
  }
  return out;
}

function tone(freqs, length = N, amp = 0.5) {
  return Float64Array.from({ length }, (_, i) => freqs.reduce((s, f) => s + (amp / freqs.length) * Math.sin((2 * Math.PI * f * i) / RATE), 0));
}

test('spectrum: the FFT agrees with a plain DFT', () => {
  let seed = 7;
  const noise = Float64Array.from({ length: N }, () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 31 - 1) * 0.3);
  for (const samples of [tone([1000]), tone([60, 440, 5000]), tone([9000], N, 0.05), noise, new Float64Array(N)]) {
    const got = [...bands(samples)], want = referenceBands(samples);
    for (let b = 0; b < BANDS; b++) assert.ok(Math.abs(got[b] - want[b]) <= 1, `band ${b}: ${got[b]} vs ${want[b]}`);
  }
});

test('spectrum: PCM split anywhere — even mid-sample — gives the same frames', () => {
  const hub = new SpectrumHub();
  const frames = [];
  hub.watch('http://radio.example/stream', (f) => frames.push([...f]));
  const pcm = tone([440, 3000], Math.floor(N * 3.5));
  const bytes = Buffer.alloc(pcm.length * 2);
  pcm.forEach((v, i) => bytes.writeInt16LE(Math.round(v * 32767), i * 2));
  let seed = 3;
  for (let at = 0; at < bytes.length;) {
    const len = 1 + ((seed = (seed * 1103515245 + 12345) >>> 0) % 997); // odd and even sizes
    fake.stdout.emit('data', bytes.subarray(at, at + len));
    at += len;
  }
  assert.equal(frames.length, 3);
  for (let f = 0; f < 3; f++) {
    const samples = Float64Array.from({ length: N }, (_, i) => bytes.readInt16LE((f * N + i) * 2) / 32768);
    assert.deepEqual(frames[f], [...bands(samples)], `frame ${f}`);
  }
  hub.stopAll();
});

test('spectrum stream: only while a speaker plays the station, ended once it stops', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const STATION = 'https://radio.example/live.mp3';
  let playing = null;
  const routes = {};
  mediaRoutes({ get: (p, ...h) => { routes[p] = h.at(-1) }, post: () => {} }, {
    clients: { airplayClient: { getSpeakers: () => [{ id: 'salon', name: 'Salon', playing }] } },
    store: { get: () => null },
    requireAdmin: (req, res, next) => next(),
  });
  const open = () => {
    const req = new EventEmitter();
    req.query = { url: STATION };
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200, out: '', destroyed: false, writableEnded: false,
      status(c) { this.statusCode = c; return this },
      writeHead(c) { this.statusCode = c; return this },
      write(s) { this.out += s; return true },
      end() { this.writableEnded = true; this.emit('close'); return this },
      json() { return this.end() },
    });
    routes['/media/spectrum'](req, res);
    return { req, res };
  };

  // nothing on a speaker: 204, which also stops an EventSource reconnecting — no decoder
  fake = null;
  let { res } = open();
  assert.equal(res.statusCode, 204);
  assert.equal(fake, null);

  playing = { url: STATION, title: 'Live' };
  ({ res } = open());
  assert.equal(res.statusCode, 200);
  assert.ok(fake, 'decoding');
  fake.stdout.emit('data', Buffer.alloc(N * 2));
  assert.match(res.out, /data: [A-Za-z0-9+/=]+\n\n/);

  // a short gap is ridden out, the station gone for two checks ends it
  playing = null;
  t.mock.timers.tick(15000);
  playing = { url: STATION, title: 'Live' };
  t.mock.timers.tick(15000);
  assert.equal(res.writableEnded, false);
  playing = null;
  t.mock.timers.tick(30000);
  assert.equal(res.writableEnded, true);
  t.mock.timers.tick(4000);
  assert.equal(fake.killed, 'SIGKILL', 'decoder stopped after the linger');

  // a client that goes away stops it too
  playing = { url: STATION, title: 'Live' };
  const c = open();
  c.req.emit('close');
  t.mock.timers.tick(4000);
  assert.equal(fake.killed, 'SIGKILL');
});
