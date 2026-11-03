'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Avoid loading the real platform-status singleton's side effects — the client
// only calls platformStatus.set(), which is harmless, so require it as-is.
const GrentonVcluClient = require('../src/grenton-vclu-client');

// A fake in-process SensorRegistry + DataStore good enough to exercise the
// bridge: discovery, the Tuya-reading → Grenton-object mapping, and commands
// flowing back to the Tuya device via sendCommand.
function harness(tuyaDevices) {
  const values = new Map();                      // "key/path" → value
  const registered = new Map();                  // grenton device key → descriptor
  const commands = [];                           // { key, path, value }

  const devicesByKey = new Map(tuyaDevices.map((d) => [d.key, d]));

  const registry = {
    getDevices: () => [...devicesByKey.values()],
    registerDevice: (dev) => { registered.set(dev.key, dev); devicesByKey.set(dev.key, dev); },
    getDeviceReadings: (key) => {
      const d = devicesByKey.get(key);
      if (!d) return null;
      const readings = {};
      for (const s of d.sensors || []) {
        const v = values.get(`${key}/${s.path}`);
        if (v !== undefined) readings[s.path] = { ...s, value: v };
      }
      return { ...d, readings };
    },
    sendCommand: async (key, path, value) => { commands.push({ key, path, value }); return true; },
  };

  const store = {
    set: (k, v) => values.set(k, v),
    get: (k) => (values.has(k) ? values.get(k) : null),
    getTimestamp: () => Date.now(),
  };

  return { registry, store, values, registered, commands };
}

function tuyaAC(id, { modes = ['cold', 'hot', 'wet', 'wind', 'auto'], modeRw = true } = {}) {
  return {
    key: `tuya/${id}`, label: `Klima ${id}`, type: 'tuya',
    sensors: [
      { path: 'switch', controllable: true, type: 'toggle' },
      { path: 'heatingSetpoint', controllable: true, type: 'range', min: 16, max: 31, step: 1 },
      { path: 'thermostatMode', controllable: modeRw, range: modes },
      { path: 'temperature' },
    ],
  };
}

test('registers four Grenton objects per AC and skips a TRV with no switch', async () => {
  const trv = {
    key: 'tuya/trv1', label: 'Grzejnik', type: 'tuya',
    sensors: [{ path: 'heatingSetpoint', controllable: true, type: 'range' }], // no switch
  };
  const h = harness([tuyaAC('klima1'), trv]);
  const c = new GrentonVcluClient({ grentonVclu: { enabled: true } }, h.store, h.registry);
  await c.start();
  c.stop();

  assert.ok(h.registered.has('grenton/AC_klima1_PWR'));
  assert.ok(h.registered.has('grenton/AC_klima1_SET'));
  assert.ok(h.registered.has('grenton/AC_klima1_MODE'));
  assert.ok(h.registered.has('grenton/AC_klima1_TMP'));
  assert.ok(!h.registered.has('grenton/AC_trv1_PWR'), 'TRV without a switch must not become an AC');

  // SET range inherits the Tuya setpoint bounds
  const set = h.registered.get('grenton/AC_klima1_SET').sensors[0];
  assert.strictEqual(set.min, 16);
  assert.strictEqual(set.max, 31);
  // MODE range spans the device's mode list
  assert.strictEqual(h.registered.get('grenton/AC_klima1_MODE').sensors[0].max, 4);
});

test('Tuya reading maps to the Grenton object value (status up)', async () => {
  const h = harness([tuyaAC('k')]);
  h.values.set('tuya/k/switch', true);
  h.values.set('tuya/k/heatingSetpoint', 24);
  h.values.set('tuya/k/thermostatMode', 'wet'); // index 2
  h.values.set('tuya/k/temperature', 21.5);

  const c = new GrentonVcluClient({ grentonVclu: { enabled: true } }, h.store, h.registry);
  await c.start();
  c.stop();

  assert.strictEqual(h.values.get('grenton/AC_k_PWR/switch'), true);
  assert.strictEqual(h.values.get('grenton/AC_k_SET/level'), 24);
  assert.strictEqual(h.values.get('grenton/AC_k_MODE/level'), 2);
  assert.strictEqual(h.values.get('grenton/AC_k_TMP/value'), 21.5);
});

test('writing a Grenton object commands the Tuya device (command down)', async () => {
  const h = harness([tuyaAC('k')]);
  const c = new GrentonVcluClient({ grentonVclu: { enabled: true } }, h.store, h.registry);
  await c.start();
  c.stop();

  const PWR  = h.registered.get('grenton/AC_k_PWR');
  const SET  = h.registered.get('grenton/AC_k_SET');
  const MODE = h.registered.get('grenton/AC_k_MODE');

  await PWR._writeCapability('switch', 'on');
  await SET._writeCapability('level', 'setLevel', [22]);
  await MODE._writeCapability('level', 'setLevel', [1]); // → 'hot'

  assert.deepStrictEqual(h.commands[0], { key: 'tuya/k', path: 'switch', value: true });
  assert.deepStrictEqual(h.commands[1], { key: 'tuya/k', path: 'heatingSetpoint', value: 22 });
  assert.deepStrictEqual(h.commands[2], { key: 'tuya/k', path: 'thermostatMode', value: 'hot' });

  // Mode index is clamped to the device's range
  await MODE._writeCapability('level', 'setLevel', [99]);
  assert.strictEqual(h.commands[3].value, 'auto'); // last mode
});

test('a newly-added AC is bridged on the next sync without a restart', async () => {
  const h = harness([tuyaAC('first')]);
  const c = new GrentonVcluClient({ grentonVclu: { enabled: true } }, h.store, h.registry);
  await c.start();

  assert.ok(!h.registered.has('grenton/AC_second_PWR'));
  // Tuya discovers another AC later…
  const second = tuyaAC('second');
  h.registry.registerDevice(second); // adds it to devicesByKey
  // …the next sync tick picks it up (call the private hook the timer would)
  c._sync();
  c.stop();

  assert.ok(h.registered.has('grenton/AC_second_PWR'));
  assert.ok(h.registered.has('grenton/AC_second_MODE'));
});
