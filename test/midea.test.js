'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const MideaClient = require('../src/midea-client');
const { startSimulator } = require('../scripts/midea-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

for (const v2 of [false, true]) {
  test(`Midea ${v2 ? 'V2' : 'V3 (8370 handshake)'}: state, set command`, async () => {
    const sim = await startSimulator({ port: 0, v2 });
    const store = fakeStore(), registry = new SensorRegistry(store, 'en');
    const dev = { host: `127.0.0.1:${sim.port}`, id: sim.id, ...(v2 ? {} : { token: sim.token, key: sim.key }) };
    const c = new MideaClient({ midea: { devices: [dev] } }, store, registry);
    const key = `midea/${sim.id}`;
    const v = (k) => store.values[`${key}/${k}`];
    try {
      await c.start();
      assert.equal(v('online'), 1);
      assert.equal(v('power'), 1); assert.equal(v('modeName'), 'cool'); assert.equal(v('targetTemp'), 24);
      assert.equal(v('temperature'), 23.5); assert.equal(v('outdoorTemp'), 31); assert.equal(v('fan'), 0);

      await registry.sendCommand(key, 'targetTemp', 21.5);
      assert.equal(sim.state.targetTemp, 21.5); assert.equal(v('targetTemp'), 21.5);
      await registry.sendCommand(key, 'mode', 4);
      await registry.sendCommand(key, 'fan', 3);
      await registry.sendCommand(key, 'swing', true);
      assert.equal(sim.state.mode, 4); assert.equal(sim.state.fan, 60); assert.equal(sim.state.swing, 0x0c);
      assert.equal(sim.state.targetTemp, 21.5, 'other fields kept');
      await registry.sendCommand(key, 'targetTemp', 16);
      assert.equal(sim.state.targetTemp, 16, 'below 17 °C uses the alternate field');
      await registry.sendCommand(key, 'power', false);
      assert.equal(sim.state.power, false); assert.equal(v('thermostatMode'), 'off');
    } finally { c.stop(); await sim.close() }
  });
}

test('Midea V3: wrong token fails clearly', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new MideaClient({ midea: { devices: [{ host: `127.0.0.1:${sim.port}`, id: sim.id, token: 'ab'.repeat(64), key: sim.key }] } }, store, registry);
  try {
    await c.start(); // the first poll fails without rejecting start()
    await assert.rejects(c._pollImpl(), /handshake refused|connection closed/);
    assert.equal(registry.devices.get(`midea/${sim.id}`), undefined, 'nothing registered without a state');
  } finally { c.stop(); await sim.close() }
});
