'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const AquiloClient = require('../src/aquilo-client');
const { startSimulator } = require('../scripts/aquilo-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('Aquilo: tanks from a gateway, optional readings, stale + overflow flags', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const host = `127.0.0.1:${sim.port}`;
  const c = new AquiloClient({ aquilo: { gateways: [{ host }], names: { '3D4E5F': 'Rainwater' } } }, store, registry);
  const v = (id, k) => store.values[`aquilo/${id}/${k}`];
  try {
    await c.start();
    const septic = registry.devices.get('aquilo/0A1B2C');
    const rain = registry.devices.get('aquilo/3D4E5F');
    assert.equal(septic.label, 'SZAMBO', 'name from the gateway');
    assert.equal(rain.label, 'Rainwater', 'name from settings');
    assert.equal(v('0A1B2C', 'fill'), 34);
    assert.equal(v('0A1B2C', 'level'), 125.6);
    assert.equal(v('0A1B2C', 'battery'), 76);
    assert.equal(v('0A1B2C', 'daysLeft'), 48);
    assert.equal(v('0A1B2C', 'toFull'), 121);
    assert.equal(v('0A1B2C', 'stale'), false);
    assert.equal(v('0A1B2C', 'overflow'), false);
    assert.equal(v('0A1B2C', 'online'), true);
    assert.ok(septic.sensors.some((s) => s.path === 'battery'));
    assert.ok(!rain.sensors.some((s) => s.path === 'battery'), 'old firmware: no battery reading → no battery sensor');
    assert.equal(v('3D4E5F', 'stale'), true, 'last reading 3 days ago > 24 h');
    assert.deepEqual(septic.homekit, ['tank', 'leak']);

    // Battery appears later (firmware update), overflow crosses the threshold
    sim.tanks[1].bat = 40;
    sim.tanks[0].pct = 93;
    await c.pollAll();
    assert.ok(rain.sensors.some((s) => s.path === 'battery'), 'battery added to the existing device');
    assert.equal(v('3D4E5F', 'battery'), 40);
    assert.equal(v('0A1B2C', 'overflow'), true);

    // A new tank shows up on the gateway
    sim.tanks.push({ id: '777777', name: 'STUDNIA', lvl: 300, pct: 50, lstRead: new Date().toISOString() });
    await c.pollAll();
    assert.equal(registry.devices.get('aquilo/777777').label, 'STUDNIA');

    // Gateway down → offline, readings kept
    sim.fail = true;
    await c.pollAll();
    assert.equal(v('0A1B2C', 'online'), false);
    assert.equal(v('0A1B2C', 'fill'), 93);
    assert.equal(c.status().gateways[0].ok, false);
    sim.fail = false;

    // Live settings: exclude one tank, rename another, lower the overflow threshold
    await c.reconfigure({ gateways: [{ host }], exclude: ['777777'], names: { '0A1B2C': 'Septic tank' }, overflowPct: 30 });
    assert.equal(registry.devices.get('aquilo/777777'), undefined, 'excluded tank removed');
    assert.equal(septic.label, 'Septic tank');
    assert.equal(v('3D4E5F', 'overflow'), true, '61 % ≥ 30 %');
    assert.equal(c.status().tanks.length, 2);
  } finally { c.stop(); await sim.close() }
});

test('Aquilo: fetchState rejects things that are not an Aquilo gateway', async () => {
  const sim = await startSimulator({ port: 0 });
  try {
    const s = await AquiloClient.fetchState(`http://127.0.0.1:${sim.port}/`);
    assert.equal(s.tanks.length, 2);
    assert.equal(s.tanks[1].battery, null);
    sim.tanks = undefined;
    await assert.rejects(AquiloClient.fetchState(`127.0.0.1:${sim.port}`), /no "sensors" list/);
  } finally { await sim.close() }
  await assert.rejects(AquiloClient.fetchState('127.0.0.1:1'), /ECONNREFUSED/);
});
