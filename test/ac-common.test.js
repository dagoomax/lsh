'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const { registerAc, publishAc, acPatch } = require('../src/ac-common');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('AC model: patches from capabilities, HomeKit thermostat mirror', async () => {
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const patches = [];
  registerAc(registry, { key: 'x/1', label: 'AC', type: 'x', features: { minTemp: 16, maxTemp: 30, step: 0.5 }, set: async (p) => patches.push(p) });
  const dev = registry.devices.get('x/1');
  assert.deepEqual(dev.homekit, ['thermostat']);

  await registry.sendCommand('x/1', 'power', 'on');
  await registry.sendCommand('x/1', 'mode', 4);
  await registry.sendCommand('x/1', 'targetTemp', 22.3);
  await registry.sendCommand('x/1', 'fan', 2);
  await registry.sendCommand('x/1', 'swing', false);
  assert.deepEqual(patches, [{ power: true }, { mode: 'heat' }, { targetTemp: 22.5 }, { fan: 2 }, { swing: false }]);
  await assert.rejects(registry.sendCommand('x/1', 'targetTemp', 35), /16–30/);
  await assert.rejects(registry.sendCommand('x/1', 'mode', 9), /mode is/);

  // what homekit-bridge's Thermostat writes
  await dev._writeCapability('thermostatMode', 'setThermostatMode', ['off']);
  await dev._writeCapability('thermostatMode', 'setThermostatMode', ['cool']);
  await dev._writeCapability('thermostatCoolingSetpoint', 'setCoolingSetpoint', [21]);
  assert.deepEqual(patches.slice(-3), [{ power: false }, { power: true, mode: 'cool' }, { targetTemp: 21 }]);

  publishAc(store, 'x/1', { online: true, power: true, mode: 'dry', targetTemp: 25, temperature: 27, fan: 0, swing: true });
  const v = (k) => store.values[`x/1/${k}`];
  assert.equal(v('mode'), 2); assert.equal(v('modeName'), 'dry');
  assert.equal(v('thermostatMode'), 'cool', 'dry shows as cool in HomeKit');
  assert.equal(v('thermostatOperatingState'), 'cooling');
  assert.equal(v('coolingSetpoint'), 25); assert.equal(v('heatingSetpoint'), 25);
  publishAc(store, 'x/1', { power: false });
  assert.equal(v('thermostatMode'), 'off');
  assert.equal(v('modeName'), 'dry', 'mode kept while off');
  assert.deepEqual(acPatch('fan', 'set', ['turbo'], { minTemp: 16, maxTemp: 30, step: 1 }), { fan: 5 });
});
