'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const MelcloudClient = require('../src/melcloud-client');
const { startSimulator } = require('../scripts/melcloud-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('MELCloud: login, devices from floors, SetAta with EffectiveFlags', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new MelcloudClient({ melcloud: { email: sim.email, password: sim.password, apiBase: `http://127.0.0.1:${sim.port}` } }, store, registry);
  const v = (k) => store.values[`melcloud/4711/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get('melcloud/4711').label, 'Living room');
    assert.equal(v('power'), 1); assert.equal(v('modeName'), 'cool'); assert.equal(v('targetTemp'), 23);
    assert.equal(v('temperature'), 25.5); assert.equal(v('outdoorTemp'), 30);

    await registry.sendCommand('melcloud/4711', 'targetTemp', 21.5);
    const set = JSON.parse(sim.calls.filter((x) => x.path === '/Device/SetAta').at(-1).body);
    assert.equal(set.EffectiveFlags, 0x4); assert.equal(set.HasPendingCommand, true);
    assert.equal(sim.ata.SetTemperature, 21.5);
    await registry.sendCommand('melcloud/4711', 'mode', 4);
    await registry.sendCommand('melcloud/4711', 'fan', 5);
    await registry.sendCommand('melcloud/4711', 'swing', true);
    assert.equal(sim.ata.OperationMode, 1); assert.equal(sim.ata.SetFanSpeed, 5); assert.equal(sim.ata.VaneVertical, 7);
    await registry.sendCommand('melcloud/4711', 'power', false);
    assert.equal(sim.ata.Power, false); assert.equal(sim.ata.SetTemperature, 21.5);
  } finally { c.stop(); await sim.close() }
});

test('MELCloud: wrong password is reported', async () => {
  const sim = await startSimulator({ port: 0 });
  const c = new MelcloudClient({ melcloud: { email: sim.email, password: 'nope', apiBase: `http://127.0.0.1:${sim.port}` } }, fakeStore(), new SensorRegistry(fakeStore(), 'en'));
  try { await assert.rejects(c._pollImpl(), /check the e-mail and password/) } finally { c.stop(); await sim.close() }
});
