'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const ZendureClient = require('../src/zendure-client');
const { startSimulator } = require('../scripts/zendure-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('Zendure SolarFlow: readings, packs, limits written with smartMode', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new ZendureClient({ zendure: { devices: [{ host: `127.0.0.1:${sim.port}`, name: 'Balcony battery' }] } }, store, registry);
  const v = (k) => store.values[`zendure/${sim.sn}/${k}`];
  try {
    await c.start();
    const dev = registry.devices.get(`zendure/${sim.sn}`);
    assert.equal(dev.label, 'Balcony battery');
    assert.equal(v('soc'), 64);
    assert.equal(v('solar'), 712);
    assert.equal(v('home'), 400);
    assert.equal(v('charge'), 312);
    assert.equal(v('voltage'), 51.2);
    assert.equal(v('pack1Temp'), 25, '2981 (0.1 K) → 25.0 °C');

    await registry.sendCommand(`zendure/${sim.sn}`, 'outputLimit', 600);
    const w = JSON.parse(sim.calls.filter((x) => x.method === 'POST').at(-1).body);
    assert.deepEqual(w, { sn: sim.sn, properties: { outputLimit: 600, smartMode: 1 } });
    assert.equal(v('outputLimit'), 600);
    await registry.sendCommand(`zendure/${sim.sn}`, 'socSet', 90);
    assert.deepEqual(JSON.parse(sim.calls.filter((x) => x.method === 'POST').at(-1).body).properties, { socSet: 90 }, 'persistent settings without smartMode');
    await assert.rejects(registry.sendCommand(`zendure/${sim.sn}`, 'minSoc', 80), /0–50/);
  } finally { c.stop(); await sim.close() }
});
