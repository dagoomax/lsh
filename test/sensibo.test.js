'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const SensiboClient = require('../src/sensibo-client');
const { startSimulator } = require('../scripts/sensibo-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('Sensibo: pods, acStates within the remote capabilities', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new SensiboClient({ sensibo: { apiKey: sim.apiKey, apiBase: `http://127.0.0.1:${sim.port}` } }, store, registry);
  const key = `sensibo/${sim.pod.id}`;
  const v = (k) => store.values[`${key}/${k}`];
  try {
    await c.start();
    const dev = registry.devices.get(key);
    assert.equal(dev.label, 'Office');
    assert.equal(dev.sensors.find((s) => s.path === 'targetTemp').min, 16, 'range from the remote');
    assert.equal(v('power'), 0); assert.equal(v('temperature'), 26.4); assert.equal(v('humidity'), 48);

    await dev._writeCapability('thermostatMode', 'setThermostatMode', ['heat']);
    assert.equal(sim.pod.acState.on, true); assert.equal(sim.pod.acState.mode, 'heat');
    await registry.sendCommand(key, 'fan', 5);
    assert.equal(sim.pod.acState.fanLevel, 'high', 'no "strong" on this remote → nearest');
    await registry.sendCommand(key, 'swing', true);
    assert.equal(sim.pod.acState.swing, 'rangeFull');
    await registry.sendCommand(key, 'mode', 2);
    assert.equal(sim.pod.acState.mode, 'dry', 'dry has no fan levels — fanLevel left out');
    await assert.rejects(registry.sendCommand(key, 'mode', 0), /no auto mode/);
  } finally { c.stop(); await sim.close() }
});
