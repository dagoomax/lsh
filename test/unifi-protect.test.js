'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const { execFileSync } = require('child_process');
const SensorRegistry = require('../src/sensor-registry');
const UnifiProtectClient = require('../src/unifi-protect-client');
const McpBots = require('../src/mcp-bots');

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }) } catch { hasOpenssl = false }
const { startSimulator } = require('../scripts/unifi-protect-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {},
  update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) },
  set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null },
  getTimestamp() { return Date.now() },
});
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)) } };

async function setup(extra = {}) {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new UnifiProtectClient({ unifi: { host: `127.0.0.1:${sim.port}`, apiKey: 'simkey', ...extra } }, store, registry);
  await c.start();
  await until(() => sim.connected() === 2);
  return { sim, store, registry, c, v: (k) => store.values[`unifi/${k}`], dev: (k) => registry.devices.get(`unifi/${k}`) };
}

test('UniFi Protect: RTSPS streams for live view (existing, created, SRTP flag stripped)', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const { sim, c } = await setup();
  try {
    const url = Object.fromEntries(c.getCameras().map((x) => [x.name, x.url]));
    assert.equal(url['Front door'], 'rtsps://127.0.0.1:7441/doorHIGH', 'existing stream reused, ?enableSrtp removed');
    assert.equal(url.Driveway, 'rtsps://127.0.0.1:7441/cam-driveHIGH', 'missing stream created');
    assert.ok(sim.calls.some((x) => x.method === 'POST' && x.path.endsWith('/cameras/cam-drive/rtsps-stream') && JSON.parse(x.body).qualities[0] === 'high'));
    assert.ok(!sim.calls.some((x) => x.method === 'POST' && x.path.endsWith('/cameras/cam-door/rtsps-stream')), 'no new stream when one exists');
  } finally { c.stop(); await sim.close() }

  const s2 = await setup({ createStreams: false });
  try {
    assert.equal(s2.c.getCameras().find((x) => x.name === 'Driveway').url, null);
    assert.ok(!s2.sim.calls.some((x) => x.method === 'POST'), 'createStreams: false never changes the console');
  } finally { s2.c.stop(); await s2.sim.close() }
});

test('UniFi Protect: smart detections, live device stream, ring', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const { sim, c, v, dev } = await setup();
  try {
    assert.deepEqual(dev('cam-drive').sensors.map((s) => s.path), ['motion', 'person', 'vehicle']);
    assert.deepEqual(dev('cam-door').sensors.map((s) => s.path), ['doorbell', 'motion', 'person', 'package']);
    assert.equal(dev('cam-plain'), undefined, 'a camera without smart detection gets no device');

    sim.event({ type: 'add', item: { id: 'e1', type: 'smartDetectZone', device: 'cam-drive', start: 1, smartDetectTypes: ['vehicle'] } });
    await until(() => v('cam-drive/vehicle') === 1);
    sim.event({ type: 'update', item: { id: 'e1', type: 'smartDetectZone', device: 'cam-drive', start: 1, end: 2, smartDetectTypes: ['vehicle'] } });
    await until(() => v('cam-drive/vehicle') === 0);

    sim.event({ type: 'add', item: { id: 'r1', type: 'ring', device: 'cam-door', start: 1 } });
    await until(() => v('cam-door/doorbell') === 1);

    // Device stream: changed fields only, no 30 s wait
    assert.equal(v('sen-hall/temperature'), 21.5);
    sim.device({ type: 'update', item: { id: 'sen-hall', modelKey: 'sensor', stats: { temperature: { value: 23.1 } }, isOpened: true } });
    await until(() => v('sen-hall/temperature') === 23.1 && v('sen-hall/contact') === 1);
    sim.device({ type: 'update', item: { id: ['light-yard'], modelKey: 'light', isPirMotionDetected: true } });
    await until(() => v('light-yard/motion') === 1);
  } finally { c.stop(); await sim.close() }
});

test('UniFi Protect: SuperLink sensors (leak, tamper, signal)', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const { sim, c, v, dev } = await setup();
  try {
    assert.deepEqual(dev('usl-bath').sensors.map((s) => s.path), ['leak', 'battery', 'tamper', 'signal'], 'leak mount: no climate readings');
    assert.ok(dev('usl-bath').homekit.includes('leak'));
    assert.equal(dev('usl-bath').model, 'USL Environmental');
    assert.deepEqual(dev('usl-door').sensors.map((s) => s.path), ['contact', 'battery', 'tamper', 'signal']);
    assert.equal(v('usl-bath/leak'), 0);
    assert.equal(v('usl-bath/signal'), -38);
    sim.event({ type: 'add', item: { id: 'w1', type: 'sensorWaterLeak', device: 'usl-bath', start: 1 } });
    await until(() => v('usl-bath/leak') === 1);
    sim.device({ type: 'update', item: { id: 'usl-bath', modelKey: 'sensor', leakDetectedAt: null } });
    await until(() => v('usl-bath/leak') === 0);
    sim.device({ type: 'update', item: { id: 'usl-door', modelKey: 'sensor', tamperingDetectedAt: 1758158543073, isOpened: true } });
    await until(() => v('usl-door/tamper') === 1 && v('usl-door/contact') === 1);
    sim.event({ type: 'add', item: { id: 't1', type: 'sensorTamper', device: 'usl-door', start: 1, end: 2 } });
    await until(() => v('usl-door/tamper') === 0);
  } finally { c.stop(); await sim.close() }
});

test('UniFi Protect: floodlights, sirens, relays, Alarm Manager webhook', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const { sim, registry, c, v, dev } = await setup({ sirenDuration: 20 });
  try {
    assert.deepEqual(dev('light-yard').homekit, ['light-rw', 'motion']);
    await registry.sendCommand('unifi/light-yard', 'switch', '1');
    assert.equal(sim.lists.lights[0].isLightForceEnabled, true);
    assert.equal(v('light-yard/switch'), 1);

    await registry.sendCommand('unifi/siren-1', 'siren', '1');
    assert.deepEqual(sim.lists.sirens[0].sirenStatus, { isActive: true, duration: 20 });
    await registry.sendCommand('unifi/siren-1', 'siren', '0');
    assert.equal(sim.lists.sirens[0].sirenStatus.isActive, false);

    assert.deepEqual(dev('relay-1').sensors.map((s) => s.name), ['Gate', 'Lamp']);
    await registry.sendCommand('unifi/relay-1', 'output2', '1');
    assert.equal(sim.lists.relays[0].outputs[1].state, 'on');
    assert.equal(v('relay-1/output2'), 1);

    await c.triggerAlarm('lsh-panic');
    assert.deepEqual(sim.alarms, ['lsh-panic']);
    await assert.rejects(c.triggerAlarm('../x'), /Invalid trigger id/);

    // Sirens and relays are "sensitive": an MCP bot can't drive them unless allowed
    const bots = new McpBots(require('path').join(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'b-')), 'b.json'));
    const { bot } = bots.create({ name: 'x', access: 'control' });
    const full = bots.get(bot.id);
    assert.match(bots.writeDenied(full, dev('siren-1'), 'siren'), /blocked/);
    assert.match(bots.writeDenied(full, dev('relay-1'), 'output1'), /blocked/);
    assert.equal(bots.writeDenied(full, dev('light-yard'), 'switch'), null);
  } finally { c.stop(); await sim.close() }
});

test('UniFi Protect: wrong API key → clear error', { skip: !hasOpenssl && 'needs openssl' }, async () => {
  const sim = await startSimulator({ port: 0 });
  const c = new UnifiProtectClient({ unifi: { host: `127.0.0.1:${sim.port}`, apiKey: 'nope' } }, fakeStore(), new SensorRegistry(fakeStore(), 'en'));
  try { await assert.rejects(c.start(), /rejected the key/) } finally { c.stop(); await sim.close() }
});
