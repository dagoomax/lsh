'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');

const AtiosClient = require('../src/atios-client');
const { decodeEvent, addressByte } = AtiosClient;
const { startSimulator } = require('../scripts/atios-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)) } };

test('Atios: DALI addressing and event decoding', () => {
  assert.equal(addressByte({ short: 5 }, false), 10);
  assert.equal(addressByte({ group: 2 }, true), 133);
  assert.equal(addressByte({}, true), 255);
  assert.deepEqual(decodeEvent([20, 0x04, 0x01], 24), { shortAddress: 10, instanceType: 1, info: 1 });
  assert.deepEqual(decodeEvent([20, 0x80 | (1 << 2), 0x00], 24), { shortAddress: 10, instanceNumber: 1, info: 0 });
  assert.equal(decodeEvent([21, 0, 0], 24), null); // 24-bit command
  assert.equal(decodeEvent([3, 160], 16), null);
});

test('Atios: lamps, groups, broadcast, scenes and bus events', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new AtiosClient({ atios: { host: `127.0.0.1:${sim.port}` } }, store, registry);
  const v = (k) => store.values[`atios/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get('atios/l1').label, 'Kitchen');
    assert.equal(registry.devices.get('atios/g0').label, 'Ground floor');
    assert.ok(registry.devices.has('atios/all'));
    assert.equal(v('l1/switch'), 1); assert.equal(v('l1/level'), 100);
    assert.equal(v('l2/switch'), 0); assert.equal(v('l2/level'), 0);
    assert.equal(v('all/ipInterface'), 1);

    await registry.sendCommand('atios/l2', 'level', 50);
    assert.equal(sim.lamps[2].level, 128);
    await registry.sendCommand('atios/l1', 'switch', 'off');
    assert.equal(sim.lamps[1].level, 0); assert.equal(v('l1/switch'), 0);
    await registry.sendCommand('atios/l1', 'switch', 'on');
    assert.equal(sim.lamps[1].level, 254);
    await registry.sendCommand('atios/g0', 'switch', 'off');
    assert.equal(sim.lamps[1].level, 0); assert.equal(sim.lamps[2].level, 0);
    await registry.sendCommand('atios/all', 'scene', 3);
    assert.equal(JSON.parse(sim.calls.filter((x) => x.path === '/api/dali/iface').at(-1).body).data[1], 0x13);

    await until(() => sim.clients() > 0);
    sim.emit(24, [20, 0x04, 0x01]);               // input 10, device scheme, button pressed
    await until(() => v('in10/button0Pressed') === 1);
    sim.emit(24, [20, 0x80 | (1 << 2), 0x02]);    // input 10, instance 1, short press
    await until(() => v('in10/button1') === 'short press');
    sim.emit(24, [22, 0x0c, 0x02]);               // input 11, occupancy (type 3), occupied
    await until(() => v('in11/occupancy0') === 1);
    sim.lamps[1].level = 254;
    sim.emit(16, [3, 0x05]);                      // another controller → re-read the lamps
    await until(() => v('l1/level') === 100);
  } finally { c.stop(); await sim.close() }
});
