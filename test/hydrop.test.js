'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const HydropClient = require('../src/hydrop-client');
const { startSimulator } = require('../scripts/hydrop-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('hydrop: meter reading, flow, today, status', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new HydropClient({ hydrop: { apiKey: sim.apiKey, apiBase: `http://127.0.0.1:${sim.port}` } }, store, registry);
  const v = (k) => store.values[`hydrop/wasserzahler/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get('hydrop/wasserzahler').label, 'Wasserzähler');
    assert.equal(v('meter'), 123.4567); assert.equal(v('today'), 0); assert.equal(v('status'), 'green');
    assert.equal(typeof v('quota'), 'number');

    sim.advance(0.05, 300); // 50 L in 5 min
    await c._pollImpl();
    assert.equal(v('flow'), 10); assert.equal(v('today'), 50);
    await c._pollImpl(); // same reading again → flow kept, no division by zero
    assert.equal(v('flow'), 10);
  } finally { c.stop(); await sim.close() }
});

test('hydrop: wrong key and quota are reported', async () => {
  const sim = await startSimulator({ port: 0, limit: 1 });
  const mk = (key) => new HydropClient({ hydrop: { apiKey: key, apiBase: `http://127.0.0.1:${sim.port}` } }, fakeStore(), new SensorRegistry(fakeStore(), 'en'));
  try {
    await assert.rejects(mk('nope')._pollImpl(), /API key not accepted/);
    const c = mk(sim.apiKey);
    await c._pollImpl();
    await assert.rejects(c._pollImpl(), /quota used up/);
  } finally { await sim.close() }
});
