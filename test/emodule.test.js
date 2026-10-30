'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const EmoduleClient = require('../src/emodule-client');
const { startSimulator } = require('../scripts/emodule-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('eModule: zones and tiles, setpoint and zone on/off', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new EmoduleClient({ emodule: { username: sim.username, password: sim.password, apiBase: `http://127.0.0.1:${sim.port}/api/v1` } }, store, registry);
  const z = (k) => store.values[`emodule/abc123-101/${k}`];
  const m = (k) => store.values[`emodule/abc123/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get('emodule/abc123-101').label, 'Salon');
    assert.equal(registry.devices.get('emodule/abc123-102').label, 'Sypialnia');
    assert.ok(!registry.devices.has('emodule/abc123-103'), 'unregistered zone skipped');
    assert.equal(z('temperature'), 21.4); assert.equal(z('targetTemp'), 22); assert.equal(z('humidity'), 45);
    assert.equal(z('power'), 1); assert.equal(z('heating'), 1); assert.equal(z('openWindow'), 0);
    assert.equal(z('thermostatMode'), 'heat'); assert.equal(z('thermostatOperatingState'), 'heating');
    assert.equal(store.values['emodule/abc123-102/thermostatMode'], 'off');
    assert.equal(store.values['emodule/abc123-102/humidity'], undefined);

    assert.equal(m('tile1'), -3.5); assert.equal(m('tile2'), 1); assert.equal(m('tile3'), 40);
    assert.equal(m('tile3Current'), 45.2); assert.equal(m('tile3Return'), 38.1); assert.equal(m('tile4W1'), 1.5);
    assert.equal(m('tile5'), undefined); assert.equal(m('zones'), 2);
    const labels = Object.fromEntries(registry.devices.get('emodule/abc123').sensors.map((s) => [s.path, s.label]));
    assert.equal(labels.tile2, 'Pompa CO'); assert.equal(labels.tile4W1, 'Ciśnienie');

    await registry.sendCommand('emodule/abc123-101', 'targetTemp', 23.5);
    const set = JSON.parse(sim.calls.filter((x) => x.path.endsWith('/zones')).at(-1).body);
    assert.deepEqual(set, { mode: { id: 5001, parentId: 101, mode: 'constantTemp', constTempTime: 60, setTemperature: 235, scheduleIndex: 0 } });
    assert.equal(z('targetTemp'), 23.5);

    await registry.sendCommand('emodule/abc123-101', 'power', false);
    assert.equal(sim.zones[0].zone.zoneState, 'zoneOff'); assert.equal(z('power'), 0); assert.equal(z('thermostatMode'), 'off');
  } finally { c.stop(); await sim.close() }
});

test('eModule: wrong password is reported', async () => {
  const sim = await startSimulator({ port: 0 });
  const c = new EmoduleClient({ emodule: { username: sim.username, password: 'nope', apiBase: `http://127.0.0.1:${sim.port}/api/v1` } }, fakeStore(), new SensorRegistry(fakeStore(), 'en'));
  try { await assert.rejects(c._pollImpl(), /check the username and password/) } finally { c.stop(); await sim.close() }
});
