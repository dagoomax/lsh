'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const AnkerSolixClient = require('../src/anker-solix-client');
const { startSimulator } = require('../scripts/anker-solix-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

test('Anker SOLIX: product code from SN, decoding (INT32 sign split, gain, strings)', () => {
  assert.equal(AnkerSolixClient.productCode('APCDMY60123456789'), 'DMY6');
  assert.equal(AnkerSolixClient.productCode('XYZQNA0123456789'), 'QNA');
  const d = AnkerSolixClient.decode;
  assert.equal(d({ data_type: 'INT32', gain: 1, power_split_mode: 'negative_only' }, [0xffff, 0xfe0c]), 500);
  assert.equal(d({ data_type: 'INT32', gain: 1, power_split_mode: 'positive_only' }, [0xffff, 0xfe0c]), 0);
  assert.equal(d({ data_type: 'UINT32', gain: 10 }, [0, 12345]), 1234.5);
  assert.equal(d({ data_type: 'INT16', gain: 10 }, [0xff9c]), -10);
  assert.equal(d({ data_type: 'UINT16', gain: 1, value_mapping: { 1: 'charging' } }, [1]), 'charging');
});

test('Anker SOLIX Solarbank Max over Modbus: readings and controls', async () => {
  const sim = await startSimulator({ port: 0, kind: 'battery' });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new AnkerSolixClient({ ankerSolix: { devices: [{ host: `127.0.0.1:${sim.port}` }] } }, store, registry);
  const key = `anker/${sim.sn}`, v = (k) => store.values[`${key}/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get(key).label, 'Anker SOLIX Solarbank Max');
    assert.equal(v('batterySoc'), 57);
    assert.equal(v('pvPower'), 840);
    assert.equal(v('batteryChargingPower'), 500);
    assert.equal(v('batteryDischargingPower'), 0);
    assert.equal(v('gridExportPower'), 30);
    assert.equal(v('gridImportPower'), 0);
    assert.equal(v('pvTotalGeneration'), 1234.5);
    assert.equal(v('batteryStatus'), 'charging');
    assert.equal(v('chargingLimitSoc'), 100);

    await registry.sendCommand(key, 'operatingMode', 3);
    assert.deepEqual(sim.writes.at(-1), [10064, [3]]);
    await registry.sendCommand(key, 'batteryPowerSetpoint', -800);   // charge 800 W
    assert.deepEqual(sim.writes.at(-1), [10071, [0xffff, 0xfce0]]);
    await registry.sendCommand(key, 'batteryPowerSetpoint', 1200);   // discharge 1200 W
    assert.deepEqual(sim.writes.at(-1), [10071, [0, 1200]]);
    await registry.sendCommand(key, 'dischargeLimitSoc', 15);
    assert.deepEqual(sim.writes.at(-1), [60001, [15]]);
    await assert.rejects(registry.sendCommand(key, 'operatingMode', 2), /operating mode must be/);
    await assert.rejects(registry.sendCommand(key, 'chargingLimitSoc', 50), /80–100/);
  } finally { c.stop(); await sim.close() }
});

test('Anker SOLIX Smart Plug Gen 2: power readings and switch', async () => {
  const sim = await startSimulator({ port: 0, kind: 'plug' });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new AnkerSolixClient({ ankerSolix: { devices: [{ host: `127.0.0.1:${sim.port}`, name: 'Fridge plug' }] } }, store, registry);
  const key = `anker/${sim.sn}`, v = (k) => store.values[`${key}/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get(key).label, 'Fridge plug');
    assert.equal(v('realTimePower'), 123.4);
    assert.equal(v('voltage'), 230.1);
    assert.equal(v('temperature'), 21.5);
    assert.equal(v('switch'), 1);
    await registry.sendCommand(key, 'switch', '0');
    assert.deepEqual(sim.writes.at(-1), [30047, [0]]);
    assert.equal(v('switch'), 0);
  } finally { c.stop(); await sim.close() }
});
