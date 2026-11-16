'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const GroupThermostatClient = require('../src/group-thermostat-client');

// DataStore stand-in: set() emits 'change' like the real one.
function fakeStore(initial = {}) {
  const data = { ...initial };
  const ee = new EventEmitter();
  ee.setMaxListeners(0);
  return Object.assign(ee, {
    get: (k) => (k in data ? data[k] : null),
    set(k, v) { data[k] = v; ee.emit('change', { key: k, value: v }); },
    _data: data,
  });
}

// SensorRegistry stand-in that records sendCommand calls and lets a member
// be made to reject (an offline zone).
function fakeRegistry(reject = new Set()) {
  const commands = [];
  const devices = new Map();
  return {
    registerDevice: (d) => devices.set(d.key, d),
    getDevice: (k) => devices.get(k),
    commands,
    async sendCommand(key, path, value) {
      commands.push({ key, path, value });
      if (reject.has(key)) throw new Error('offline');
      return value;
    },
  };
}

const config = (over = {}) => ({
  groupThermostats: { thermostats: [{ id: 'master', name: 'Master', members: ['tado/z1', 'tado/z2', 'tado/z3'], ...over }] },
});

test('registers one HomeKit thermostat for the group', async () => {
  const store = fakeStore();
  const reg = fakeRegistry();
  await new GroupThermostatClient(config(), store, reg).start();
  const d = reg.getDevice('groupthermostat/master');
  assert.ok(d, 'device registered');
  assert.deepEqual(d.homekit, ['thermostat']);
  assert.ok(d.sensors.find((s) => s.path === 'targetTemp' && s.controllable));
});

test('setting the target fans the setpoint out to every member', async () => {
  const store = fakeStore();
  const reg = fakeRegistry();
  const client = new GroupThermostatClient(config(), store, reg);
  await client.start();
  const d = reg.getDevice('groupthermostat/master');

  await d._writeCapability('targetTemp', 'set', [21]);

  const sent = reg.commands.filter((c) => c.path === 'targetTemp');
  assert.deepEqual(sent.map((c) => c.key).sort(), ['tado/z1', 'tado/z2', 'tado/z3']);
  assert.ok(sent.every((c) => c.value === 21));
  assert.equal(store.get('groupthermostat/master/targetTemp'), 21);
  assert.equal(store.get('groupthermostat/master/heatingSetpoint'), 21); // HomeKit reads this
});

test('clamps the setpoint to the configured range', async () => {
  const store = fakeStore();
  const reg = fakeRegistry();
  await new GroupThermostatClient(config({ min: 10, max: 24 }), store, reg).start();
  await reg.getDevice('groupthermostat/master')._writeCapability('targetTemp', 'set', [40]);
  assert.ok(reg.commands.every((c) => c.value === 24));
});

test('HomeKit setHeatingSetpoint and setThermostatMode drive the group', async () => {
  const store = fakeStore();
  const reg = fakeRegistry();
  const client = new GroupThermostatClient(config(), store, reg);
  await client.start();
  const d = reg.getDevice('groupthermostat/master');

  await d._writeCapability('thermostatHeatingSetpoint', 'setHeatingSetpoint', [19.5]);
  assert.ok(reg.commands.some((c) => c.path === 'targetTemp' && c.value === 19.5));

  await d._writeCapability('thermostatMode', 'setThermostatMode', ['off']);
  assert.ok(reg.commands.some((c) => c.path === 'power'));
  assert.equal(store.get('groupthermostat/master/thermostatMode'), 'off');
});

test('current temperature is the average of the members, heating if any is', async () => {
  const store = fakeStore({
    'tado/z1/temperature': 20, 'tado/z2/temperature': 22, 'tado/z3/temperature': 21,
    'tado/z1/heatingPower': 0, 'tado/z2/heatingPower': 40, 'tado/z3/heatingPower': 0,
  });
  const reg = fakeRegistry();
  await new GroupThermostatClient(config(), store, reg).start();
  assert.equal(store.get('groupthermostat/master/temperature'), 21); // (20+22+21)/3
  assert.equal(store.get('groupthermostat/master/heatingPower'), 40);
  assert.equal(store.get('groupthermostat/master/thermostatOperatingState'), 'heating');
});

test('a member change recomputes the average live', async () => {
  const store = fakeStore({ 'tado/z1/temperature': 20, 'tado/z2/temperature': 20, 'tado/z3/temperature': 20 });
  const reg = fakeRegistry();
  await new GroupThermostatClient(config(), store, reg).start();
  assert.equal(store.get('groupthermostat/master/temperature'), 20);
  store.set('tado/z1/temperature', 26); // one zone warms up
  assert.equal(store.get('groupthermostat/master/temperature'), 22); // (26+20+20)/3
});

test('seeds its setpoint from the members average target on start', async () => {
  const store = fakeStore({ 'tado/z1/targetTemp': 21, 'tado/z2/targetTemp': 21, 'tado/z3/targetTemp': 22 });
  const reg = fakeRegistry();
  await new GroupThermostatClient(config(), store, reg).start();
  assert.equal(store.get('groupthermostat/master/targetTemp'), 21.5); // (21+21+22)/3 → 21.33 → 21.5 step
});

test('succeeds when some zones are offline, throws only when all fail', async () => {
  const store = fakeStore();
  const okReg = fakeRegistry(new Set(['tado/z2'])); // one offline
  const client = new GroupThermostatClient(config(), store, okReg);
  await client.start();
  const d = okReg.getDevice('groupthermostat/master');
  await assert.doesNotReject(d._writeCapability('targetTemp', 'set', [21]));
  assert.equal(store.get('groupthermostat/master/targetTemp'), 21);

  const store2 = fakeStore();
  const allBad = fakeRegistry(new Set(['tado/z1', 'tado/z2', 'tado/z3']));
  const c2 = new GroupThermostatClient(config(), store2, allBad);
  await c2.start();
  await assert.rejects(allBad.getDevice('groupthermostat/master')._writeCapability('targetTemp', 'set', [21]));
});
