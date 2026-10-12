'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const SinumClient = require('../src/sinum-client');
const { buildOutputsXml, buildInputsXml } = require('../src/loxone-xml');
const { startSimulator } = require('../scripts/sinum-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {},
  update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) },
  set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null },
  getTimestamp() { return Date.now() },
});

async function setup(auth) {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new SinumClient({ sinum: { host: `127.0.0.1:${sim.port}`, ...auth } }, store, registry);
  await c.start();
  return { sim, store, registry, c, v: (k) => store.values[`sinum/${k}`] };
}

test('Sinum: devices from every bus, rooms, readings ×10, unsupported buses dropped', async () => {
  const { sim, registry, c, v } = await setup({ token: 'simtoken' });
  try {
    const dev = (k) => registry.devices.get(`sinum/${k}`);
    assert.equal(dev('virtual-10').label, 'Salon termostat');
    assert.equal(dev('virtual-10').room, 'Salon');
    assert.deepEqual(dev('virtual-10').homekit, ['thermostat', 'humidity']);
    assert.equal(v('virtual-10/temperature'), 21.5);
    assert.equal(v('virtual-10/heatingSetpoint'), 22);
    assert.equal(v('virtual-10/humidity'), 45);
    assert.equal(v('virtual-10/thermostatOperatingState'), 'heating');
    assert.equal(v('wtp-20/temperature'), 19.8);
    assert.equal(v('wtp-21/state'), 0);
    assert.equal(v('wtp-22/state'), 1, 'open window');
    assert.deepEqual(dev('wtp-22').homekit, ['contact']);
    assert.equal(v('virtual-13/level'), 100);
    assert.equal(v('virtual-14/state'), 'closed');
    // Unknown type → its numeric fields, read-only
    assert.equal(dev('sbus-30').room, 'Kuchnia');
    assert.equal(v('sbus-30/active_power'), 1530);
    assert.equal(dev('sbus-30')._writeCapability, undefined);
    assert.deepEqual([...registry.devices.get('sinum/scenes').sensors.map((s) => s.label)], ['Dzień dobry', 'Wyjście z domu']);
    assert.ok(!c.buses.has('slink') && !c.buses.has('lora') && c.buses.has('wtp'), 'buses the hub doesn’t have are skipped after a 404');
    assert.ok(sim.calls.every((x) => x.path === '/api/v1/login' || x.auth === 'Bearer simtoken'));
  } finally { c.stop(); await sim.close() }
});

test('Sinum: control through the registry (dashboard / Loxone / HomeKit paths)', async () => {
  const { sim, registry, c, v } = await setup({ token: 'simtoken' });
  const last = () => JSON.parse(sim.calls.filter((x) => x.method !== 'GET').at(-1).body || '{}');
  try {
    await registry.sendCommand('sinum/virtual-10', 'heatingSetpoint', '23.5');
    assert.deepEqual(last(), { target_temperature: 235 });
    assert.equal(v('virtual-10/heatingSetpoint'), 23.5, 'PATCH response applied right away');
    await registry.devices.get('sinum/virtual-10')._writeCapability('thermostatMode', 'setThermostatMode', ['cool']); // HomeKit
    assert.deepEqual(last(), { mode: 'cooling' });

    await registry.sendCommand('sinum/virtual-12', 'switch', '1');
    assert.deepEqual(last(), { state: true });
    assert.equal(v('virtual-12/switch'), 1);

    await registry.sendCommand('sinum/virtual-11', 'level', 40);
    assert.deepEqual(last(), { state: true, brightness: 40 });
    assert.equal(v('virtual-11/switch'), 1);
    await registry.sendCommand('sinum/virtual-11', 'level', 0);
    assert.deepEqual(last(), { state: false });

    await registry.sendCommand('sinum/virtual-13', 'level', 30);
    assert.deepEqual(last(), { command: 'open', opening_percentage: 30 });
    assert.equal(v('virtual-13/level'), 30);
    await registry.sendCommand('sinum/virtual-13', 'windowShade', '0');
    assert.deepEqual(last(), { command: 'open', opening_percentage: 0 });
    await registry.sendCommand('sinum/virtual-13', 'stop', '1');
    assert.deepEqual(last(), { command: 'stop' });

    await registry.sendCommand('sinum/virtual-14', 'open', '1'); // hub answers 304
    assert.deepEqual(last(), { command: 'full_open' });
    await c._poll();
    assert.equal(v('virtual-14/state'), 'opening');
    await registry.sendCommand('sinum/virtual-15', 'unlock', '1');
    assert.equal(v('virtual-15/state'), 'unlocked');

    await registry.sendCommand('sinum/wtp-23', 'heatingSetpoint', 19);
    assert.deepEqual(last(), { target_temperature: 190 });

    await registry.sendCommand('sinum/scenes', 'scene2', '1');
    assert.deepEqual(sim.activated, [2]);

    // Bus busy → retried once
    sim.busyNext = true;
    await registry.sendCommand('sinum/virtual-12', 'switch', '0');
    assert.equal(v('virtual-12/switch'), 0);
  } finally { c.stop(); await sim.close() }
});

test('Sinum: login + password, re-login when the session expires', async () => {
  const { sim, registry, c, v } = await setup({ username: 'admin', password: 'admin' });
  try {
    assert.equal(v('virtual-10/temperature'), 21.5);
    sim.expireSessions();
    await registry.sendCommand('sinum/virtual-12', 'switch', '1');
    assert.equal(v('virtual-12/switch'), 1);
    assert.equal(sim.calls.filter((x) => x.path === '/api/v1/login').length, 2);
  } finally { c.stop(); await sim.close() }

  const sim2 = await startSimulator({ port: 0 });
  const bad = new SinumClient({ sinum: { host: `127.0.0.1:${sim2.port}`, username: 'admin', password: 'nope' } }, fakeStore(), new SensorRegistry(fakeStore(), 'en'));
  try {
    await bad.start(); // never rejects — logs and retries
    assert.equal(bad.devices.size, 0);
    await assert.rejects(bad.call('GET', '/api/v1/rooms'), /rejected the login/);
  } finally { bad.stop(); await sim2.close() }
});

test('Sinum: Loxone templates', async () => {
  const { sim, registry, c } = await setup({ token: 'simtoken' });
  try {
    const devices = registry.getDevices().filter((d) => d.type === 'sinum');
    const out = buildOutputsXml(devices, { host: 'lsh:3000', token: 't' }).join('\n');
    assert.match(out, /sinum%2Fvirtual-10\/set\?sensor=heatingSetpoint&amp;value=&lt;v&gt;/);
    assert.match(out, /sinum%2Fvirtual-13\/set\?sensor=level/);
    assert.match(out, /sinum%2Fscenes\/set\?sensor=scene1&amp;value=1/);
    const inp = buildInputsXml(devices, { host: 'lsh:3000', token: 't' }).join('\n');
    assert.match(inp, /Salon termostat Temperature/);
    assert.doesNotMatch(inp, /thermostatMode/, 'text readings stay out of numeric inputs');
  } finally { c.stop(); await sim.close() }
});
