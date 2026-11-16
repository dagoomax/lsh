'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const HeatingCurveClient = require('../src/heating-curve-client');

function fakeStore(initial = {}) {
  const data = { ...initial };
  const ee = new EventEmitter(); ee.setMaxListeners(0);
  return Object.assign(ee, {
    get: (k) => (k in data ? data[k] : null),
    update(k, v) { data[k] = v; ee.emit('change', { key: k, value: v }); },
    _data: data,
  });
}
function fakeRegistry() {
  const devices = new Map(); const commands = [];
  return {
    registerDevice: (d) => devices.set(d.key, d),
    getDevice: (k) => devices.get(k),
    getDevices: () => [...devices.values()],
    commands,
    async sendCommand(key, path, value) { commands.push({ key, path, value }); return value; },
  };
}
const cfg = (over = {}) => ({ heatingCurves: { curves: [{ id: 'x', name: 'Curve', outdoorKey: 'out', targetDevice: 'boiler/1', targetPath: 'flow', room: 21, ...over }] } });
const quiet = (c) => { clearTimeout(c._saveTimer); c._saveTimer = null; }; // don't let the debounced config save fire in tests

test('the switch is a controllable toggle, default on, and exports as a thermostat', async () => {
  const store = fakeStore({ out: 0 }); const reg = fakeRegistry();
  await new HeatingCurveClient(cfg(), store, reg).start();
  const d = reg.getDevice('heatingcurve/x');
  assert.deepEqual(d.homekit, ['thermostat', 'temperature']);
  const sw = d.sensors.find((s) => s.path === 'enabled');
  assert.ok(sw && sw.controllable && sw.type === 'toggle');
  assert.equal(store.get('heatingcurve/x/enabled'), 1);
});

test('turning the switch off stops pushing to the boiler; on resumes', async () => {
  const store = fakeStore({ out: -5 }); const reg = fakeRegistry();
  const client = new HeatingCurveClient(cfg(), store, reg);
  await client.start();
  assert.ok(reg.commands.length >= 1, 'pushes a flow setpoint while enabled');
  const before = reg.commands.length;
  const d = reg.getDevice('heatingcurve/x');

  await d._writeCapability('enabled', 'off'); quiet(client);
  assert.equal(store.get('heatingcurve/x/enabled'), 0);
  assert.equal(store.get('heatingcurve/x/thermostatMode'), 'off');
  store.update('out', -12); // a big outdoor swing must not reach the boiler while off
  assert.equal(reg.commands.length, before, 'no boiler writes while disabled');

  await d._writeCapability('enabled', 'on'); quiet(client);
  assert.ok(reg.commands.length > before, 're-enabling pushes the current flow again');
});

test('HomeKit mode off/heat drives the switch; setpoint sets the room target', async () => {
  const store = fakeStore({ out: 2 }); const reg = fakeRegistry();
  const client = new HeatingCurveClient(cfg(), store, reg);
  await client.start();
  const d = reg.getDevice('heatingcurve/x');

  await d._writeCapability('thermostatMode', 'setThermostatMode', ['off']); quiet(client);
  assert.equal(store.get('heatingcurve/x/enabled'), 0);

  await d._writeCapability('thermostatMode', 'setThermostatMode', ['heat']); quiet(client);
  assert.equal(store.get('heatingcurve/x/enabled'), 1);

  await d._writeCapability('thermostatHeatingSetpoint', 'setHeatingSetpoint', [22]); quiet(client);
  assert.equal(store.get('heatingcurve/x/room'), 22);
  assert.equal(store.get('heatingcurve/x/heatingSetpoint'), 22); // HomeKit reads this back
});
