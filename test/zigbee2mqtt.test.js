'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const MqttBroker = require('../src/mqtt-broker');
const SensorRegistry = require('../src/sensor-registry');
const platformStatus = require('../src/platform-status');
const Zigbee2MqttClient = require('../src/zigbee2mqtt-client');
const { startSimulator } = require('../scripts/zigbee2mqtt-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }); }, set(k, v) { this.update(k, v); },
  get(k) { return this.values[k] ?? null; }, getTimestamp() { return Date.now(); },
});

async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`timed out waiting for ${fn}`);
}

async function setup({ v1 = false } = {}) {
  const broker = new MqttBroker({ mqttBroker: { enabled: true, port: 0, host: '127.0.0.1' } });
  assert.equal(await broker.start(), true);
  const sim = startSimulator({ url: `mqtt://127.0.0.1:${broker.port}`, base: 'z2m', v1 });
  await new Promise((r) => sim.client.once('connect', r));
  const store = fakeStore();
  const registry = new SensorRegistry(store, 'en');
  // blank host → the built-in broker
  const config = { mqttBroker: { enabled: true, port: broker.port }, zigbee2mqtt: { baseTopic: 'z2m', names: { '0x00158d0000000003': 'Drzwi wejściowe' } } };
  const client = new Zigbee2MqttClient(config, store, registry);
  await client.start();
  return { broker, sim, store, registry, client,
    async close() { client.stop(); await sim.stop(); broker.stop(); } };
}

test('Zigbee2MQTT: devices from bridge/devices, state, availability, commands', async () => {
  const t = await setup();
  try {
    const { registry, store, sim } = t;
    await until(() => registry.devices.size === 4);
    assert.equal(platformStatus.getAll().zigbee2mqtt, true);
    const lamp = registry.devices.get('zigbee2mqtt/0017880100000001');
    assert.equal(lamp.label, 'living/lamp');
    assert.equal(lamp.model, 'Philips 9290012573A');
    assert.deepEqual(lamp.homekit, ['light-rw']);
    assert.equal(registry.devices.get('zigbee2mqtt/00158d0000000003').label, 'Drzwi wejściowe'); // names override
    assert.equal(store.get('zigbee2mqtt/bridge/version'), '2.6.0');
    assert.equal(store.get('zigbee2mqtt/bridge/channel'), 15);
    assert.equal(store.get('zigbee2mqtt/bridge/panId'), '0x1a62');
    assert.equal(store.get('zigbee2mqtt/bridge/devices'), 3);

    // state isn't retained: the client asks with /get, the simulator answers
    await until(() => store.get('zigbee2mqtt/0017880100000001/level') === 79);
    assert.equal(store.get('zigbee2mqtt/0017880100000001/switch'), 0);
    assert.equal(store.get('zigbee2mqtt/0017880100000001/online'), 1);
    assert.equal(store.get('zigbee2mqtt/0017880100000001/colorTemperature'), 2703);

    await registry.sendCommand('zigbee2mqtt/0017880100000001', 'level', 50);
    await until(() => store.get('zigbee2mqtt/0017880100000001/level') === 50);
    assert.equal(store.get('zigbee2mqtt/0017880100000001/switch'), 1);
    assert.deepEqual(sim.received.find(([tp]) => tp === 'living/lamp/set')[1], { state: 'ON', brightness: 127 });

    await registry.sendCommand('zigbee2mqtt/a4c1380000000002', 'switch_l2', 0);
    await until(() => store.get('zigbee2mqtt/a4c1380000000002/switch_l2') === 0);
    assert.deepEqual(sim.received.find(([tp]) => tp === 'Hall switch/set')[1], { state_l2: 'OFF' });

    sim.report('Front door', { contact: false });
    await until(() => store.get('zigbee2mqtt/00158d0000000003/contact') === 1); // 1 = open
    assert.equal(store.get('zigbee2mqtt/00158d0000000003/battery'), 97);

    // availability
    sim.client.publish('z2m/Front door/availability', JSON.stringify({ state: 'offline' }));
    await until(() => store.get('zigbee2mqtt/00158d0000000003/online') === 0);
  } finally { await t.close(); }
});

test('Zigbee2MQTT: rename keeps the device, pairing and removal go through bridge requests', async () => {
  const t = await setup();
  try {
    const { registry, store, sim } = t;
    await until(() => registry.devices.size === 4);

    sim.rename('Hall switch', 'Korytarz');
    await until(() => registry.devices.get('zigbee2mqtt/a4c1380000000002').label === 'Korytarz');
    await registry.sendCommand('zigbee2mqtt/a4c1380000000002', 'switch', 1);
    await until(() => sim.received.some(([tp, b]) => tp === 'Korytarz/set' && b.state_l1 === 'ON'));

    await registry.sendCommand('zigbee2mqtt/bridge', 'permitJoin', 1);
    await until(() => store.get('zigbee2mqtt/bridge/permitJoinLeft') > 250);
    assert.deepEqual(sim.received.find(([tp]) => tp === 'bridge/request/permit_join')[1], { time: 254 });
    assert.equal(store.get('zigbee2mqtt/bridge/permitJoin'), 1);

    await registry.sendCommand('zigbee2mqtt/bridge', 'remove', '0x00158d0000000003');
    await until(() => !registry.devices.has('zigbee2mqtt/00158d0000000003'));
    assert.deepEqual(sim.received.find(([tp]) => tp === 'bridge/request/device/remove')[1], { id: 'Front door', force: false });
    assert.equal(store.get('zigbee2mqtt/bridge/devices'), 2);
  } finally { await t.close(); }
});

test('Zigbee2MQTT 1.x: string availability, permit_join with value', async () => {
  const t = await setup({ v1: true });
  try {
    const { registry, store, sim } = t;
    await until(() => store.get('zigbee2mqtt/0017880100000001/online') === 1);
    assert.equal(store.get('zigbee2mqtt/bridge/state'), 'online');
    await registry.sendCommand('zigbee2mqtt/bridge', 'permitJoin', 1);
    await until(() => store.get('zigbee2mqtt/bridge/permitJoinLeft') === 254);
    assert.deepEqual(sim.received.find(([tp]) => tp === 'bridge/request/permit_join')[1], { value: true, time: 254 });
  } finally { await t.close(); }
});

test('Zigbee2MQTT: start rejects when nothing answers on the base topic', async () => {
  const broker = new MqttBroker({ mqttBroker: { enabled: true, port: 0, host: '127.0.0.1' } });
  await broker.start();
  const store = fakeStore();
  const client = new Zigbee2MqttClient({ zigbee2mqtt: { host: '127.0.0.1', port: broker.port, baseTopic: 'nobody' } }, store, new SensorRegistry(store, 'en'));
  const orig = global.setTimeout;
  try {
    global.setTimeout = (fn, ms, ...a) => orig(fn, ms === 10_000 ? 200 : ms, ...a); // shorten the start timeout
    await assert.rejects(client.start(), /no nobody\/bridge\/devices/);
  } finally { global.setTimeout = orig; client.stop(); broker.stop(); }
});
