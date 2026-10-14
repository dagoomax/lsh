'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const express = require('express');
const SensorRegistry = require('../src/sensor-registry');
const { startSimulator } = require('../scripts/daikin-simulator');

// config.json stays untouched: the route's config IO is swapped for memory
let CONFIG = {};
require('../src/routes/helpers').readConfigFile = () => JSON.parse(JSON.stringify(CONFIG));
require('../src/config-file-cache').writeConfigFile = (c) => { CONFIG = JSON.parse(JSON.stringify(c)) };
const route = require('../src/routes/integration-settings');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('integration settings: cleaning keeps masked secrets and rejects bad rows', () => {
  const { SPECS, cleanConfig } = route;
  const prev = { devices: [{ host: '10.0.0.5', id: '123', token: 'aa', key: 'bb' }] };
  const out = cleanConfig(SPECS.midea, { devices: [{ host: '10.0.0.5', id: '123', token: '••••••••', key: '••••••••', beep: 'false', junk: 1 }], pollInterval: '45' }, prev);
  assert.deepEqual(out, { pollInterval: 45, devices: [{ host: '10.0.0.5', id: '123', token: 'aa', key: 'bb', beep: false }] });
  assert.throws(() => cleanConfig(SPECS.midea, { devices: [{ host: '10.0.0.6' }] }), /id is required/);
  assert.throws(() => cleanConfig(SPECS.daikin, { devices: [{ host: 'not a host!' }] }), /not a host/);
  assert.deepEqual(cleanConfig(SPECS.sensibo, { apiKey: '••••••••' }, { apiKey: 'real' }), { apiKey: 'real' });
  assert.deepEqual(cleanConfig(SPECS.gree, { devices: [{ host: '10.0.0.7', encryption: 'nope' }] }).devices, [{ host: '10.0.0.7' }]);
});

test('integration settings: test, save + apply live, status, remove', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const clients = {};
  const app = express(); app.use(express.json());
  const router = express.Router();
  route(router, { clients, store, sensorRegistry: registry, requireAdmin: (req, res, next) => next() });
  app.use('/api', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) });
  const post = (p, body) => fetch(`http://127.0.0.1:${server.address().port}/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const get = (p) => fetch(`http://127.0.0.1:${server.address().port}/api${p}`).then((r) => r.json());
  CONFIG = { other: { keep: true } };
  const device = { host: `127.0.0.1:${sim.port}`, name: 'Office AC' };
  try {
    const t = await post('/integration/daikin/test', { config: { devices: [device] } });
    assert.equal(t.success, true, t.error);
    assert.deepEqual(t.data.devices, ['Office AC']);
    assert.equal(registry.devices.size, 0, 'a test registers nothing');
    assert.equal(CONFIG.daikin, undefined, 'a test saves nothing');

    const s = await post('/settings/integration/daikin', { config: { devices: [device], pollInterval: 60 } });
    assert.equal(s.success, true);
    assert.deepEqual(CONFIG, { other: { keep: true }, daikin: { pollInterval: 60, devices: [device] } });
    assert.ok(clients.daikin, 'client running');
    assert.equal(registry.devices.get('daikin/a0b1c2d3e4f5')?.label, 'Office AC');
    const st = await get('/integration/daikin/status');
    assert.equal(st.data.running, true);
    assert.equal(st.data.devices.length, 1);

    const bad = await post('/integration/daikin/test', { config: { devices: [{ host: '127.0.0.1:1' }] } });
    assert.equal(bad.success, false);

    const off = await post('/settings/integration/daikin', { config: { devices: [] } });
    assert.match(off.message, /not configured/);
    assert.equal(clients.daikin, undefined);
    assert.equal(registry.devices.size, 0, 'its devices are gone');
    assert.equal((await post('/settings/integration/nope', {})).success, false);
  } finally {
    clients.daikin?.stop();
    await new Promise((r) => server.close(r));
    await sim.close();
  }
});
