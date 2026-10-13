'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const UgreenClient = require('../src/ugreen-client');
const { startSimulator } = require('../scripts/ugreen-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)) } };

test('UGREEN PowerRoam: RSA login, live telemetry, output switches, re-login', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const cfg = { ugreen: { email: 'a@b.c', password: 'secret', apiBase: `http://127.0.0.1:${sim.port}`, wsBase: `ws://127.0.0.1:${sim.port}` } };
  const c = new UgreenClient(cfg, store, registry);
  const v = (k) => store.values[`ugreen/G00XX0000000001/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get('ugreen/G00XX0000000001').label, 'PowerRoam 1200');
    await until(() => v('battery') === 76);
    assert.equal(v('output'), 320);
    assert.equal(v('acOutput'), 300);
    assert.equal(v('timeToEmpty'), 164, '9840 s → 164 min');
    assert.equal(v('batteryTemp'), 27);
    assert.equal(v('cellImbalance'), 2);
    assert.equal(v('ac'), 1);
    assert.equal(v('online'), 1);

    await registry.sendCommand('ugreen/G00XX0000000001', 'dc', '1');
    assert.equal(sim.state.switch_dc, 1);
    assert.equal(v('dc'), 1);

    sim.state.battery_percentage = 75; sim.push();
    await until(() => v('battery') === 75);

    // Expired token: the set fails once, the client logs in again and retries
    sim.expireTokens();
    await registry.sendCommand('ugreen/G00XX0000000001', 'light', '1');
    assert.equal(sim.state.lamp_sw, 1);

    // Socket dropped → reconnects
    sim.dropSockets();
    await until(() => v('online') === 0);
    await until(() => v('online') === 1, 8000);
  } finally { c.stop(); await sim.close() }
});

test('UGREEN: wrong password → clear error', async () => {
  const sim = await startSimulator({ port: 0 });
  const c = new UgreenClient({ ugreen: { email: 'a@b.c', password: 'nope', apiBase: `http://127.0.0.1:${sim.port}`, wsBase: `ws://127.0.0.1:${sim.port}` } }, fakeStore(), new SensorRegistry(fakeStore(), 'en'));
  try { await assert.rejects(c.start(), /login failed — check the app e-mail and password/) } finally { c.stop(); await sim.close() }
});
