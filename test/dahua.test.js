'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const DahuaClient = require('../src/dahua-client');
const { startSimulator } = require('../scripts/dahua-simulator');
const { execSync, execFileSync } = require('child_process');

const hasFfmpeg = (() => { try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true } catch { return false } })();

// Fake Express response for the proxy / MJPEG handlers
const fakeRes = () => {
  const r = { code: 200, headers: {}, body: null };
  r.status = (c) => { r.code = c; return r };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v };
  r.done = new Promise((resolve) => { r.end = (b) => { r.body = b; resolve(r) } });
  return r;
};

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)) }
  assert.fail('condition not met in time');
};

test('Dahua: channels, snapshots and the event stream behind Digest auth', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const dev = { name: 'dom', host: '127.0.0.1', port: sim.port, username: 'admin', password: 'admin123' };
  const c = new DahuaClient({ dahua: { devices: [dev], holdSeconds: 2 } }, store, registry);
  const v = (k) => store.values[k];
  try {
    await c.start();

    // Disconnected channel 4 is left out
    assert.deepEqual(c.nvrs[0].channels.map((x) => x.name), ['Brama', 'Ogród', 'Garaż']);
    assert.equal(registry.devices.get('dahua/0/1').label, 'Brama');
    assert.equal(registry.devices.get('dahua/0/1').model, 'Dahua DHI-NVR4108HS-4KS2/L');
    assert.equal(registry.devices.get('dahua/0/4'), undefined);
    assert.equal(v('dahua/0/2/online'), 1);

    const cams = c.getCameras();
    assert.equal(cams.length, 3);
    assert.equal(cams[1].url, `rtsp://admin:admin123@127.0.0.1:554/cam/realmonitor?channel=2&subtype=0`);
    assert.equal(cams[1].snapshotUrl, '/api/dahua/snapshot/0/2');
    const snap = await DahuaClient.fetchSnapshot(dev, 3);
    assert.equal(snap.contentType, 'image/jpeg');
    assert.equal(snap.buffer[4], 3);

    await until(() => sim.streams.size === 1);

    // Motion: Start / Stop
    sim.event('VideoMotion', 'Start', 0);
    await until(() => v('dahua/0/1/motion') === 1);
    sim.event('VideoMotion', 'Stop', 0);
    await until(() => v('dahua/0/1/motion') === 0);

    // IVS line crossing by a person: tripwire + person devices appear, pulse clears after holdSeconds
    sim.event('CrossLineDetection', 'Pulse', 1, 'Human');
    await until(() => v('dahua/0/2/tripwire/detected') === 1 && v('dahua/0/2/person/detected') === 1);
    assert.equal(registry.devices.get('dahua/0/2/person').label, 'Ogród — Person');
    assert.deepEqual(registry.devices.get('dahua/0/2/tripwire').homekit, ['motion']);
    await until(() => v('dahua/0/2/tripwire/detected') === 0, 3000);

    // Smart motion vehicle, video loss, and events for unused channels are ignored
    sim.event('SmartMotionVehicle', 'Start', 2);
    await until(() => v('dahua/0/3/vehicle/detected') === 1);
    sim.event('VideoLoss', 'Start', 2);
    await until(() => v('dahua/0/3/online') === 0);
    sim.event('VideoMotion', 'Start', 3);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(v('dahua/0/4/motion'), undefined);

    // Event stream reconnects after the NVR drops it
    for (const s of sim.streams) s.destroy();
    await until(() => sim.streams.size === 0);
    await until(() => sim.streams.size === 1, 8000);
    sim.event('VideoMotion', 'Start', 0);
    await until(() => v('dahua/0/1/motion') === 1);
  } finally {
    c.stop();
    await sim.close();
  }
});

test('Dahua: wrong password is reported', async () => {
  const sim = await startSimulator({ port: 0 });
  try {
    await assert.rejects(DahuaClient.probe({ host: '127.0.0.1', port: sim.port, username: 'admin', password: 'nope' }), /Login rejected/);
  } finally {
    await sim.close();
  }
});

test('Dahua: event parsing', () => {
  const { parseEvent, splitParts } = DahuaClient._test;
  assert.deepEqual(parseEvent('Code=VideoMotion;action=Start;index=0\r\n'), { code: 'VideoMotion', action: 'Start', index: 0, data: null });
  assert.equal(parseEvent('Heartbeat'), null);
  const ev = parseEvent('Code=CrossRegionDetection;action=Start;index=5;data={\n "Object" : { "ObjectType" : "Vehicle" }\n}\r\n');
  assert.equal(ev.data.Object.ObjectType, 'Vehicle');
  const body = 'Code=A;action=Start;index=0\r\n';
  const { parts, rest } = splitParts(Buffer.from(`--b\r\nContent-Length: ${body.length}\r\n\r\n${body}\r\n--b\r\nContent-Length: 30\r\n\r\nCode=B;act`), 'b');
  assert.deepEqual(parts, [body], 'complete part taken without waiting for the next boundary');
  assert.match(rest.toString(), /Code=B/);
});

test('Dahua: scaled snapshots and Loxone addresses', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const sim = await startSimulator({ port: 0 });
  sim.jpeg = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080', '-frames:v', '1', '-f', 'image2', 'pipe:1']);
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new DahuaClient({ dahua: { devices: [{ host: '127.0.0.1', port: sim.port, username: 'admin', password: 'admin123', events: false }] } }, store, registry);
  try {
    await c.start();
    const res = fakeRes();
    c.proxySnapshot(0, 1, res, { width: '320' });
    await res.done;
    assert.equal(res.headers['content-type'], 'image/jpeg');
    const probe = execFileSync('ffprobe', ['-loglevel', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', '-i', 'pipe:0'], { input: res.body }).toString().trim();
    assert.equal(probe, '320,180', 'scaled from 1920x1080 keeping the aspect ratio');

    const missing = fakeRes();
    c.serveMjpeg(0, 4, { query: {} }, missing);
    assert.equal(missing.code, 404, 'unused channel has no stream');

    const ch = c.status()[0].channels[0];
    assert.equal(ch.mjpeg, '/api/dahua/mjpeg/0/1');
    assert.equal(ch.snapshot, '/api/dahua/snapshot/0/1?width=640');
  } finally {
    c.stop();
    await sim.close();
  }
});
