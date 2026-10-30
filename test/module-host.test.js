'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const DataStore = require('../src/data-store');
const SensorRegistry = require('../src/sensor-registry');
const ModuleHost = require('../src/module-host');
const platformStatus = require('../src/platform-status');

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};

test('integration runs in its own process: devices, values, commands, restart after a crash', async () => {
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const host = new ModuleHost({ language: 'en' }, store, registry);
  const file = path.join(__dirname, 'fixtures', 'fake-module-client');
  const m = host.add({ file, label: 'Fake' });
  try {
    await until(() => registry.devices.get('fake/1'));
    await until(() => store.get('fake/1/switch') === 0);
    assert.equal(platformStatus.getAll().fake, true);
    const firstPid = m.child.pid;
    assert.notEqual(firstPid, process.pid);

    // a dashboard / HomeKit command reaches the device in the module process
    const res = await registry.sendCommand('fake/1', 'switch', true);
    assert.equal(res.pid, firstPid);
    assert.equal(store.get('fake/1/switch'), 1);

    // values set in the server reach a module that listens for changes
    await until(() => m.subscribed);
    store.set('fake/in/x', 42);
    await until(() => store.get('fake/out/x') === 42);

    // a crash takes down only the module; the watchdog brings it back
    await registry.devices.get('fake/1')._writeCapability('sw', 'crash').catch(() => {});
    await until(() => m.restarts === 1 && m.state === 'running' && m.child && m.child.pid !== firstPid, 10000);
    assert.equal(platformStatus.getAll().fake, true);
    const again = await registry.sendCommand('fake/1', 'switch', false);
    assert.equal(again.pid, m.child.pid);
    assert.equal(host.list()[0].devices, 1);
  } finally {
    await host.stopAll();
  }
});
