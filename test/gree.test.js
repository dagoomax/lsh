'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const GreeClient = require('../src/gree-client');
const { startSimulator } = require('../scripts/gree-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

for (const encryption of ['ecb', 'gcm']) {
  test(`Gree (${encryption.toUpperCase()}): scan, bind, status, commands`, async () => {
    const sim = await startSimulator({ port: 0, encryption });
    const store = fakeStore(), registry = new SensorRegistry(store, 'en');
    const c = new GreeClient({ gree: { devices: [{ host: `127.0.0.1:${sim.port}` }] } }, store, registry);
    const key = `gree/${sim.mac}`;
    const v = (k) => store.values[`${key}/${k}`];
    try {
      await c.start();
      assert.equal(c.units[0].enc, encryption, 'cipher detected');
      assert.equal(c.units[0].devKey, sim.devKey, 'bound');
      assert.equal(registry.devices.get(key).label, 'Bedroom AC');
      assert.equal(v('power'), 1); assert.equal(v('modeName'), 'cool'); assert.equal(v('targetTemp'), 24);
      assert.equal(v('temperature'), 26, 'TemSen 66 − 40');

      await registry.sendCommand(key, 'mode', 4);
      await registry.sendCommand(key, 'targetTemp', 21);
      await registry.sendCommand(key, 'fan', 5);
      await registry.sendCommand(key, 'swing', true);
      assert.equal(sim.state.Mod, 4); assert.equal(sim.state.SetTem, 21);
      assert.equal(sim.state.Tur, 1); assert.equal(sim.state.WdSpd, 5); assert.equal(sim.state.SwUpDn, 1);
      assert.equal(v('fan'), 5); assert.equal(v('thermostatMode'), 'heat');
      await registry.sendCommand(key, 'fan', 1);
      assert.equal(sim.state.Quiet, 1); assert.equal(sim.state.Tur, 0);
      await registry.sendCommand(key, 'power', false);
      assert.equal(sim.state.Pow, 0);
    } finally { c.stop(); await sim.close() }
  });
}
