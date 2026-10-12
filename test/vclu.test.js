'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const VcluClient = require('../src/vclu-client');
const { buildOutputsXml } = require('../src/loxone-xml');
const { startSimulator } = require('../scripts/vclu-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {},
  update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) },
  set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null },
  getTimestamp() { return Date.now() },
});

async function setup(opts = {}, token = 'simbot') {
  const sim = await startSimulator({ port: 0, ...opts });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new VcluClient({ vclu: { host: `127.0.0.1:${sim.port}`, token } }, store, registry);
  await c.start();
  return { sim, store, registry, c, v: (k) => store.values[`vclu/${k}`], dev: (k) => registry.devices.get(`vclu/${k}`) };
}

test('vCLU: devices over MCP, areas as rooms, value ranges, read-only devices', async () => {
  const { sim, c, v, dev } = await setup();
  try {
    assert.equal(sim.calls[0].method, 'initialize');
    assert.equal(dev('CLU220000592.DIM1201').room, 'Salon');
    assert.deepEqual(dev('CLU220000592.DIM1201').homekit, ['light-rw']);
    assert.equal(v('CLU220000592.DIM1201/level'), 50, 'dimmer 0..1 → %');
    assert.equal(v('CLU220000592.DIM1201/switch'), 1);
    assert.equal(v('CLU220000592.DOU4992/switch'), 0);
    assert.ok(!dev('CLU220000592.DOU4992').sensors.some((s) => s.path === 'level'), 'on/off light has no brightness');
    assert.equal(v('CLU220000592.ROL0301/level'), 100);
    assert.equal(v('satel.zone.2/state'), 0);
    assert.equal(v('plugin_weather.temp/temperature'), 7.4, '":" in a path becomes "_" in the key');
    assert.equal(dev('CLU220000592.DOU6000')._writeCapability, undefined, 'readonly in vCLU → not controllable in LSH');
    assert.ok(dev('CLU220000592.DOU6000').sensors.every((s) => !s.controllable));
    assert.deepEqual(dev('vclu_frontlock').homekit, ['lock-rw']);
    assert.deepEqual(dev('scenes').sensors.map((s) => s.label), ['Film', 'Dobranoc']);
    assert.equal(c.devices.size, 8);
  } finally { c.stop(); await sim.close() }
});

test('vCLU: control through the registry (dashboard / Loxone / HomeKit / flows)', async () => {
  const { sim, registry, c, v } = await setup({ sse: true }); // answers as SSE
  const lastTool = () => sim.calls.filter((x) => x.method === 'tools/call' && x.params.name !== 'vclu_devices' && x.params.name !== 'vclu_scenes').at(-1).params;
  try {
    await registry.sendCommand('vclu/CLU220000592.DOU5048', 'switch', '0');
    assert.deepEqual(lastTool(), { name: 'vclu_device_set', arguments: { path: 'CLU220000592.DOU5048', value: 0 } });
    assert.equal(v('CLU220000592.DOU5048/switch'), 0, 'new_state applied right away');

    await registry.sendCommand('vclu/CLU220000592.DIM1201', 'level', 80);
    assert.deepEqual(lastTool().arguments, { path: 'CLU220000592.DIM1201', method: 'setBrightness', args: [80] });
    await c._poll();
    assert.equal(v('CLU220000592.DIM1201/level'), 80);

    await registry.sendCommand('vclu/CLU220000592.DOU4992', 'switch', '1');
    assert.deepEqual(lastTool().arguments, { path: 'CLU220000592.DOU4992', method: 'switchOn' });

    await registry.sendCommand('vclu/CLU220000592.ROL0301', 'level', 40);
    assert.deepEqual(lastTool().arguments, { path: 'CLU220000592.ROL0301', value: 40 });
    await registry.sendCommand('vclu/CLU220000592.ROL0301', 'windowShade', '1');
    assert.equal(lastTool().arguments.value, 100);
    await registry.sendCommand('vclu/CLU220000592.ROL0301', 'stop', '1');
    assert.deepEqual(lastTool().arguments, { path: 'CLU220000592.ROL0301', method: 'stop' });

    await registry.devices.get('vclu/vclu_frontlock')._writeCapability('lock', 'unlock'); // HomeKit
    assert.equal(v('vclu_frontlock/lock'), 0);

    await registry.sendCommand('vclu/scenes', 'scene2', '1');
    assert.deepEqual(sim.executed.at(-1), ['scene:dobranoc', 'scene', []]);

    await assert.rejects(registry.sendCommand('vclu/CLU220000592.DOU6000', 'switch', '1'), /not writable|not controllable/);
  } finally { c.stop(); await sim.close() }
});

test('vCLU: wrong token → clear error, platform stays down', async () => {
  const { sim, c } = await setup({}, 'nope');
  try {
    assert.equal(c.devices.size, 0);
    await assert.rejects(c.tool('vclu_devices'), /rejected the MCP token/);
  } finally { c.stop(); await sim.close() }
});

test('vCLU: Loxone outputs', async () => {
  const { sim, registry, c } = await setup();
  try {
    const out = buildOutputsXml(registry.getDevices().filter((d) => d.type === 'vclu'), { host: 'lsh:3000', token: 't' }).join('\n');
    assert.match(out, /vclu%2FCLU220000592.DIM1201\/set\?sensor=level&amp;value=&lt;v&gt;/);
    assert.match(out, /vclu%2Fscenes\/set\?sensor=scene1/);
    assert.doesNotMatch(out, /DOU6000/, 'read-only devices get no outputs');
  } finally { c.stop(); await sim.close() }
});
