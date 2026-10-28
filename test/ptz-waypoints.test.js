'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jpeg = require('jpeg-js');
const EventEmitter = require('events');
const PtzWaypoints = require('../src/ptz-waypoints');

// A scene wider than the camera's view: rectangles of different brightness
function scene(seed, w = 520, h = 240) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const g = new Uint8Array(w * h).fill(90);
  for (let i = 0; i < 70; i++) {
    const rw = 10 + rnd() * 60, rh = 10 + rnd() * 50, rx = rnd() * (w - rw), ry = rnd() * (h - rh), v = 20 + rnd() * 220;
    for (let yy = Math.floor(ry); yy < ry + rh; yy++) for (let xx = Math.floor(rx); xx < rx + rw; xx++) g[yy * w + xx] = v;
  }
  return { g, w, h };
}

// A pan/tilt camera over that scene, behaving like Wejście: a press moves
// `tap` px even when stopped at once, then `speed` px per ms; the view stops
// at the scene's edges (end stops). mirrored: pressing right turns the view left.
function fakeCamera(sc, { x = 180, y = 70, vw = 192, vh = 108, tap = 7, speed = 0.12, mirrored = false } = {}) {
  const cam = { x, y, presses: 0 };
  let started = null;
  cam.ptz = async (op) => {
    if (op !== 'stop') { started = { op, t: Date.now() }; cam.presses++; return }
    if (!started) return;
    const d = tap + (Date.now() - started.t) * speed;
    const s = mirrored ? -1 : 1;
    if (started.op === 'right') cam.x += d * s;
    if (started.op === 'left') cam.x -= d * s;
    if (started.op === 'down') cam.y += d;
    if (started.op === 'up') cam.y -= d;
    cam.x = Math.max(0, Math.min(sc.w - vw, cam.x));
    cam.y = Math.max(0, Math.min(sc.h - vh, cam.y));
    started = null;
  };
  cam.frame = async () => {
    const data = Buffer.alloc(vw * vh * 4);
    const ox = Math.round(cam.x), oy = Math.round(cam.y);
    for (let yy = 0; yy < vh; yy++) {
      for (let xx = 0; xx < vw; xx++) {
        const v = sc.g[(oy + yy) * sc.w + ox + xx], i = (yy * vw + xx) * 4;
        data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
      }
    }
    return jpeg.encode({ data, width: vw, height: vh }, 90).data;
  };
  return cam;
}

function setup(camOpts, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-'));
  const sc = scene(42);
  const cam = fakeCamera(sc, camOpts);
  const store = { v: {}, set(k, val) { this.v[k] = val } };
  const registry = Object.assign(new EventEmitter(), { devices: new Map(), registerDevice(d) { this.devices.set(d.key, d) } });
  const wp = new PtzWaypoints({
    cams: [{ name: 'Hall', slug: 'hall', idx: 0, ptz: cam.ptz, frame: cam.frame, opts: { settleMs: 0, ...opts } }],
    store, registry, file: path.join(dir, 'wp.json'), dir: path.join(dir, 'img'),
  });
  wp.start();
  return { wp, cam, sc, store, registry, dir };
}

test('waypoints: matching finds a known shift and rejects another scene', () => {
  const sc = scene(42), other = scene(7);
  const a = fakeCamera(sc, { x: 180, y: 70 }), b = fakeCamera(sc, { x: 220, y: 80 }), c = fakeCamera(other, { x: 180, y: 70 });
  return Promise.all([a.frame(), b.frame(), c.frame()]).then(([fa, fb, fc]) => {
    // b looks 40 px further right and 10 px further down: a's content sits at
    // −40·0.5, −10·0.5 in b's picture (192 px → 96 matching px)
    const m = PtzWaypoints.findShift(PtzWaypoints.view(fb), PtzWaypoints.view(fa));
    assert.ok(Math.abs(m.dx + 20) <= 1 && Math.abs(m.dy + 5) <= 1, JSON.stringify(m));
    assert.ok(PtzWaypoints.inView(m));
    assert.ok(!PtzWaypoints.inView(PtzWaypoints.findShift(PtzWaypoints.view(fc), PtzWaypoints.view(fa))), 'a different scene is not the waypoint');
  });
});

test('waypoints: save, go back from both axes off, learn the camera, trigger device', async () => {
  const { wp, cam, store, registry } = setup();
  const a = await wp.save('hall', 'Door');
  assert.equal(a.name, 'Door');
  assert.deepEqual(wp.list('hall').map((w) => w.name), ['Door']);
  assert.ok(wp.image('hall', a.id));
  const dev = registry.devices.get('ptz/hall');
  assert.ok(dev.sensors.find((s) => s.path === `goto_${a.id}` && s.label === 'Go to Door'));

  cam.x += 46; cam.y -= 22;
  const r = await wp.goto('hall', a.id);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(Math.abs(cam.x - 180) <= 10 && Math.abs(cam.y - 70) <= 10, `ended at ${cam.x},${cam.y}`);
  assert.equal(store.v['ptz/hall/waypoint'], 'Door');
  assert.equal(store.v['ptz/hall/moving'], 0);
  const cal = JSON.parse(fs.readFileSync(wp.file, 'utf8')).hall.calib;
  assert.equal(cal.x.sign, 1);
  assert.ok(cal.x.n >= 1, 'learned from its own moves');
});

test('waypoints: a mirrored mount is learned, not configured', async () => {
  const { wp, cam } = setup({ mirrored: true });
  const a = await wp.save('hall', 'A');
  cam.x -= 40;
  const r = await wp.goto('hall', a.id);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(Math.abs(cam.x - 180) <= 10, `ended at ${cam.x}`);
  assert.equal(JSON.parse(fs.readFileSync(wp.file, 'utf8')).hall.calib.x.sign, -1);
});

test('waypoints: out of the picture → searches, turning back at the end stop', async () => {
  const { wp, cam } = setup({ x: 60 }, { maxSteps: 30, searchMs: 250 });
  const a = await wp.save('hall', 'Left side');
  cam.x = 320; // the saved view is entirely out of the picture, to the left
  const r = await wp.goto('hall', a.id);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(Math.abs(cam.x - 60) <= 10, `ended at ${cam.x}`);
});

test('waypoints: one at a time, rename, remove', async () => {
  const { wp, registry } = setup();
  const a = await wp.save('hall', '');
  assert.equal(a.name, 'Waypoint 1');
  const run = wp.goto('hall', a.id);
  assert.throws(() => wp.goto('hall', a.id), /Already moving/);
  await run;
  wp.rename('hall', a.id, 'Stairs');
  assert.ok(registry.devices.get('ptz/hall').sensors.find((s) => s.label === 'Go to Stairs'));
  wp.remove('hall', a.id);
  assert.deepEqual(wp.list('hall'), []);
  assert.equal(wp.image('hall', a.id), null);
  assert.throws(() => wp.camera('nope'), /no waypoints/);
});

test('waypoints: go2rtc frame URL from its WebRTC URL', () => {
  assert.equal(PtzWaypoints.go2rtcFrameUrl('http://127.0.0.1:1984/api/webrtc?src=wejscie'), 'http://127.0.0.1:1984/api/frame.jpeg?src=wejscie');
  assert.equal(PtzWaypoints.go2rtcFrameUrl('http://cam.local/whep'), null);
});
