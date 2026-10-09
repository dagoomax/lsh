'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const HomeAssistantClient = require('../src/homeassistant-client');
const { startSimulator } = require('../scripts/homeassistant-simulator');

function fakeStore() {
  const s = new EventEmitter();
  s.values = {};
  s.update = s.set = (k, v) => { s.values[k] = v; s.emit('change', { key: k, value: v }) };
  s.get = (k) => s.values[k];
  return s;
}

function fakeRegistry(extra = []) {
  const devices = new Map(extra.map((d) => [d.key, d]));
  return {
    devices,
    registerDevice: (d) => devices.set(d.key, d),
    getDevices: () => [...devices.values()],
    async sendCommand(key, path, value) {
      const d = devices.get(key), s = d.sensors.find((x) => x.path === path);
      if (s.type === 'range') return d._writeCapability(s.capabilityId, s.writeCmd, [value]);
      const on = value === true || value === 1 || value === 'on' || value === '1';
      return d._writeCapability(s.capabilityId, on ? s.writeOn : s.writeOff);
    },
  };
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)) }
  throw new Error('timed out');
};

test('Home Assistant import: entities mirrored, live updates, control via call_service, own exports skipped', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = fakeRegistry();
  const c = new HomeAssistantClient({ homeassistant: { url: `http://127.0.0.1:${sim.port}`, token: 'sim-token' } }, store, registry);
  try {
    await c.start();
    await until(() => c.status.import.connected);
    assert.equal(c.status.import.version, '2026.10.0');
    assert.ok(registry.devices.has('ha/light.kitchen'));
    assert.ok(!registry.devices.has('ha/switch.lsh_shelly_1_relay0'), 'LSH export must not be imported back');
    assert.equal(store.values['ha/light.kitchen/state'], 1);
    assert.equal(store.values['ha/light.kitchen/brightness'], 50);
    assert.equal(store.values['ha/cover.living_room/position'], 70);
    assert.equal(store.values['ha/climate.office/current_temperature'], 20.5);
    assert.equal(store.values['ha/lock.front_door/locked'], 1);
    assert.equal(store.values['ha/sensor.outdoor_temperature/state'], 12.4);
    assert.equal(registry.devices.get('ha/binary_sensor.hall_motion').sensors[0].homekit, 'motion');

    // Cameras: listed for /api/cameras, snapshot + MJPEG proxied with the token server-side
    const cams = c.getCameras();
    assert.equal(cams.length, 1);
    assert.equal(cams[0].name, 'Front door camera');
    assert.equal(cams[0].snapshotUrl, '/api/homeassistant/camera/camera.front_door/snapshot');
    assert.ok(!JSON.stringify(cams).includes('sim-token'));
    const proxied = (kind, entity = 'camera.front_door') => new Promise((resolve) => {
      const chunks = [], req = new EventEmitter(), res = new EventEmitter();
      Object.assign(res, { headers: {}, statusCode: 200, headersSent: false,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; this.headersSent = true },
        status(n) { this.statusCode = n; return this },
        write(b) { chunks.push(b); if (kind === 'mjpeg' && Buffer.concat(chunks).toString('latin1').split('--frame').length > 2) { req.emit('close'); resolve({ res, body: Buffer.concat(chunks) }) } return true },
        end(b) { if (b) chunks.push(b); resolve({ res, body: Buffer.concat(chunks) }) },
        on() { return this }, once() { return this }, emit() { return true }, removeListener() { return this } });
      c.proxyCamera(entity, kind, req, res);
    });
    const snap = await proxied('snapshot');
    assert.equal(snap.res.headers['content-type'], 'image/jpeg');
    assert.equal(snap.body[0], 0xff); assert.equal(snap.body[1], 0xd8);
    const mj = await proxied('mjpeg');
    assert.match(mj.res.headers['content-type'], /multipart\/x-mixed-replace/);
    assert.equal((await proxied('snapshot', 'camera.nope')).res.statusCode, 404);

    // HA-side change arrives as an event
    sim.setState('binary_sensor.hall_motion', 'on');
    await until(() => store.values['ha/binary_sensor.hall_motion/state'] === 1);

    // LSH commands → services → state back
    await registry.sendCommand('ha/switch.garden_pump', 'state', true);
    await until(() => store.values['ha/switch.garden_pump/state'] === 1);
    await registry.sendCommand('ha/light.kitchen', 'brightness', 20);
    await until(() => store.values['ha/light.kitchen/brightness'] === 20);
    await registry.sendCommand('ha/cover.living_room', 'position', 0);
    await registry.sendCommand('ha/climate.office', 'target_temperature', 22.5);
    await registry.sendCommand('ha/lock.front_door', 'locked', false);
    await until(() => store.values['ha/lock.front_door/locked'] === 0);
    assert.deepEqual(sim.calls.map((x) => `${x.domain}.${x.service}`),
      ['switch.turn_on', 'light.turn_on', 'cover.set_cover_position', 'climate.set_temperature', 'lock.unlock']);
    assert.equal(store.values['ha/climate.office/target_temperature'], 22.5);
  } finally { c.stop(); await sim.close() }
});

test('Home Assistant import: rejected token stops retrying', async () => {
  const sim = await startSimulator({ port: 0 });
  const c = new HomeAssistantClient({ homeassistant: { url: `http://127.0.0.1:${sim.port}`, token: 'wrong' } }, fakeStore(), fakeRegistry());
  try {
    await c.start();
    await until(() => c.status.import.error);
    assert.match(c.status.import.error, /rejected/);
    assert.equal(c.stopped, true);
  } finally { c.stop(); await sim.close() }
});

test('Home Assistant export: MQTT Discovery configs, states and commands', async () => {
  const relay = { on: 0 };
  const shelly = {
    key: 'shelly/1', type: 'shelly', label: 'Garage Shelly',
    sensors: [
      { path: 'relay0', label: 'Garage door', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'relay0' },
      { path: 'power', label: 'Power', unit: 'W' },
      { path: 'temp', label: 'Temperature', unit: '°C', sensorType: 'temperature' },
    ],
    _writeCapability: (cap, cmd) => { relay.on = cmd === 'on' ? 1 : 0 },
  };
  const imported = { key: 'ha/switch.x', type: 'homeassistant', sensors: [{ path: 'state', controllable: true, type: 'toggle' }] };
  const store = fakeStore(), registry = fakeRegistry([shelly, imported]);
  store.values['shelly/1/power'] = 42;

  const published = [], subscribed = [];
  const fake = new EventEmitter();
  fake.publish = (topic, payload, o) => published.push({ topic, payload, retain: o?.retain });
  fake.subscribe = (t) => subscribed.push(...t);
  fake.end = () => {};
  let connectOpts;
  const c = new HomeAssistantClient({ homeassistant: { export: { enabled: true, mqttUrl: 'mqtt://broker:1883' } } }, store, registry,
    { mqttConnect: (url, o) => { connectOpts = o; return fake } });
  await c.start();
  fake.emit('connect');

  assert.deepEqual(connectOpts.will, { topic: 'lsh/lsh/status', payload: 'offline', retain: true, qos: 1 });
  assert.deepEqual(subscribed, ['lsh/+/set', 'homeassistant/status']);
  const configs = published.filter((p) => p.topic.endsWith('/config'));
  assert.deepEqual(configs.map((p) => p.topic).sort(), [
    'homeassistant/sensor/lsh/lsh_shelly_1_power/config',
    'homeassistant/sensor/lsh/lsh_shelly_1_temp/config',
    'homeassistant/switch/lsh/lsh_shelly_1_relay0/config',
  ], 'imported HA devices are never exported back');
  const sw = JSON.parse(configs.find((p) => p.topic.includes('/switch/')).payload);
  assert.equal(sw.unique_id, 'lsh_shelly_1_relay0');
  assert.equal(sw.command_topic, 'lsh/lsh_shelly_1_relay0/set');
  assert.equal(sw.device.name, 'Garage Shelly');
  assert.equal(JSON.parse(configs.find((p) => p.topic.includes('_temp/')).payload).device_class, 'temperature');
  assert.ok(published.some((p) => p.topic === 'lsh/lsh_shelly_1_power/state' && p.payload === '42' && p.retain));

  // Live state and command from HA
  store.update('shelly/1/relay0', 1);
  assert.ok(published.some((p) => p.topic === 'lsh/lsh_shelly_1_relay0/state' && p.payload === '1'));
  fake.emit('message', 'lsh/lsh_shelly_1_relay0/set', Buffer.from('1'));
  await until(() => relay.on === 1);

  // HA restarted → everything republished
  const before = published.length;
  fake.emit('message', 'homeassistant/status', Buffer.from('online'));
  assert.ok(published.length > before);

  assert.equal(c.unpublishAll(), 3);
  assert.equal(published.filter((p) => p.topic.endsWith('/config') && p.payload === '').length, 3);
  c.stop();
  assert.ok(published.some((p) => p.topic === 'lsh/lsh/status' && p.payload === 'offline'));
});
