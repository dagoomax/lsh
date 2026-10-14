'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const DaikinClient = require('../src/daikin-client');
const { startSimulator } = require('../scripts/daikin-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('Daikin: readings, set keeps the other fields, per-mode temperature', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new DaikinClient({ daikin: { devices: [{ host: `127.0.0.1:${sim.port}` }] } }, store, registry);
  const v = (k) => store.values[`daikin/a0b1c2d3e4f5/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get('daikin/a0b1c2d3e4f5').label, 'Living', 'url-encoded name decoded');
    assert.equal(v('power'), 1); assert.equal(v('modeName'), 'cool'); assert.equal(v('targetTemp'), 24);
    assert.equal(v('temperature'), 23.5); assert.equal(v('outdoorTemp'), 31); assert.equal(v('humidity'), undefined, '"-" = no sensor');
    assert.equal(v('fan'), 0); assert.equal(v('swing'), 0);

    await registry.sendCommand('daikin/a0b1c2d3e4f5', 'targetTemp', 22.5);
    let q = sim.calls.filter((x) => x.path === '/aircon/set_control_info').at(-1).query;
    assert.deepEqual(q, { pow: '1', mode: '3', stemp: '22.5', shum: '0', f_rate: 'A', f_dir: '0' });
    await registry.sendCommand('daikin/a0b1c2d3e4f5', 'mode', 4);
    q = sim.calls.filter((x) => x.path === '/aircon/set_control_info').at(-1).query;
    assert.equal(q.mode, '4'); assert.equal(q.stemp, '21.0', 'heat mode brings back its own last temperature');
    await registry.sendCommand('daikin/a0b1c2d3e4f5', 'fan', 4);
    await registry.sendCommand('daikin/a0b1c2d3e4f5', 'swing', true);
    assert.equal(sim.ctl.f_rate, '6'); assert.equal(sim.ctl.f_dir, '1');
    await registry.sendCommand('daikin/a0b1c2d3e4f5', 'power', false);
    assert.equal(sim.ctl.pow, '0'); assert.equal(v('thermostatMode'), 'off');
  } finally { c.stop(); await sim.close() }
});

test('Daikin BRP072C: registers with the adapter key first', async () => {
  const sim = await startSimulator({ port: 0, key: '0123456789012' });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  // the simulator serves plain HTTP — an explicit http:// host keeps the client off https
  const c = new DaikinClient({ daikin: { devices: [{ host: `http://127.0.0.1:${sim.port}`, key: '0123456789012' }] } }, store, registry);
  try {
    await c.start();
    assert.equal(sim.calls[0].path, '/common/register_terminal');
    assert.equal(store.values['daikin/a0b1c2d3e4f5/targetTemp'], 24);
  } finally { c.stop(); await sim.close() }
});
