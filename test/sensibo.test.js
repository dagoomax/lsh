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
  const c = new SensiboClient({ sensibo: { apiKey: sim.apiKey, apiBase: `http://127.0.0.1:${sim.port}`, minRequestGapMs: 0 } }, store, registry);
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

test('Sensibo: Climate React, Air Pro-style readings, Room Sensor, Pure, Elements', async () => {
  const sim = await startSimulator({ port: 0 });
  sim.pod.measurements.co2 = 640; sim.pod.measurements.tvoc = 90;
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new SensiboClient({ sensibo: { apiKey: sim.apiKey, apiBase: `http://127.0.0.1:${sim.port}`, minRequestGapMs: 0 } }, store, registry);
  const v = (k) => store.values[k];
  try {
    await c.start();
    const sky = registry.devices.get(`sensibo/${sim.pod.id}`);
    assert.deepEqual(sky.homekit, ['thermostat', 'co2-sensor']);
    assert.equal(v(`sensibo/${sim.pod.id}/climateReact`), 0);
    assert.equal(v(`sensibo/${sim.pod.id}/carbonDioxide`), 640);
    assert.equal(v(`sensibo/${sim.pod.id}/filterClean`), 1);
    await registry.sendCommand(`sensibo/${sim.pod.id}`, 'climateReact', true);
    assert.equal(sim.pod.smartMode.enabled, true);
    assert.equal(v(`sensibo/${sim.pod.id}/climateReact`), 1);

    const room = registry.devices.get('sensibo/ms01');
    assert.deepEqual(room.homekit, ['motion']);
    assert.equal(v('sensibo/ms01/motion'), 1);
    assert.equal(v('sensibo/ms01/temperature'), 22.1);

    const pure = registry.devices.get('sensibo/PuRe0001');
    assert.equal(pure.model, 'Sensibo Pure');
    assert.equal(v('sensibo/PuRe0001/pm25Index'), 2);
    assert.equal(v('sensibo/PuRe0001/airQuality'), 75);
    await registry.sendCommand('sensibo/PuRe0001', 'fan', 2);
    assert.deepEqual(sim.pure.acState, { on: true, mode: 'fan', fanLevel: 'high' });
    await registry.sendCommand('sensibo/PuRe0001', 'power', false);
    assert.equal(sim.pure.acState.on, false);
    assert.equal(v('sensibo/PuRe0001/power'), 0);

    const el = registry.devices.get('sensibo/ElEm0001');
    assert.deepEqual(el.homekit, ['air-quality', 'co2-sensor']);
    assert.equal(v('sensibo/ElEm0001/carbonDioxide'), 812);
    assert.equal(v('sensibo/ElEm0001/fineDustLevel'), 9);
    assert.equal(v('sensibo/ElEm0001/airQuality'), 25);
    assert.equal(registry.devices.has('sensibo/ElEm0001') && !registry.devices.get('sensibo/ElEm0001')._writeCapability, true, 'a monitor has nothing to set');
  } finally { c.stop(); await sim.close() }
});

test('Sensibo: requests are spaced out and a 429 is retried once', async () => {
  const origFetch = global.fetch;
  const times = [];
  let pending429 = true; // the first acStates POST gets rate-limited
  global.fetch = async (url) => {
    times.push(Date.now());
    if (pending429 && /acStates/.test(String(url))) {
      pending429 = false;
      return new Response(JSON.stringify({ status: 'failure' }), { status: 429 });
    }
    return new Response(JSON.stringify({ status: 'success', result: { ok: true } }), { status: 200 });
  };
  try {
    const c = new SensiboClient({ sensibo: { apiKey: 'k', apiBase: 'http://x', minRequestGapMs: 40, retry429Ms: 15 } }, fakeStore(), null);

    const t0 = Date.now();
    await c._call('GET', '/a');
    await c._call('GET', '/b');
    assert.ok(Date.now() - t0 >= 40, 'the second request waited at least minRequestGapMs');

    const r = await c._call('POST', '/pods/x/acStates', { acState: {} });
    assert.deepEqual(r, { ok: true }, 'the retried POST ultimately succeeds');
    assert.equal(pending429, false, 'the 429 was consumed and the call retried');
  } finally { global.fetch = origFetch; }
});
