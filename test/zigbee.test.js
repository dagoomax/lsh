'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');
const DataStore = require('../src/data-store');
const SensorRegistry = require('../src/sensor-registry');
const { buildModel } = require('../src/zigbee-map');

// Exposes as zigbee-herdsman-converters builds them (exposes.presets…)
const LIGHT = { type: 'light', features: [
  { name: 'state', access: 7, type: 'binary', property: 'state', value_on: 'ON', value_off: 'OFF' },
  { name: 'brightness', access: 7, type: 'numeric', property: 'brightness', value_min: 0, value_max: 254 },
  { name: 'color_temp', access: 7, type: 'numeric', property: 'color_temp', unit: 'mired', value_min: 153, value_max: 454 },
  { type: 'composite', name: 'color_hs', property: 'color', access: 7, features: [{ name: 'hue', property: 'hue', access: 7, type: 'numeric' }, { name: 'saturation', property: 'saturation', access: 7, type: 'numeric' }] },
] };
const sw = (ep) => ({ type: 'switch', endpoint: ep, features: [{ name: 'state', access: 7, type: 'binary', endpoint: ep, property: `state_${ep}`, value_on: 'ON', value_off: 'OFF' }] });
const CONTACT = { name: 'contact', access: 1, type: 'binary', property: 'contact', value_on: false, value_off: true };
const BATTERY = { name: 'battery', access: 1, type: 'numeric', property: 'battery', unit: '%', category: 'diagnostic' };
const TEMP = { name: 'temperature', access: 1, type: 'numeric', property: 'temperature', unit: '°C' };
const COVER = { type: 'cover', features: [
  { name: 'state', access: 3, type: 'enum', property: 'state', values: ['OPEN', 'CLOSE', 'STOP'] },
  { name: 'position', access: 7, type: 'numeric', property: 'position', value_min: 0, value_max: 100 },
] };
const CLIMATE = { type: 'climate', features: [
  { name: 'occupied_heating_setpoint', access: 7, type: 'numeric', property: 'occupied_heating_setpoint', value_min: 5, value_max: 30, value_step: 0.5 },
  { name: 'local_temperature', access: 5, type: 'numeric', property: 'local_temperature' },
  { name: 'system_mode', access: 7, type: 'enum', property: 'system_mode', values: ['off', 'heat'] },
] };

test('Zigbee map: a colour bulb becomes the usual light sensors (HomeKit light-rw)', () => {
  const m = buildModel([LIGHT, { name: 'linkquality', access: 1, type: 'numeric', property: 'linkquality' }]);
  assert.equal(m.kind, 'light');
  assert.deepEqual(m.homekit, ['light-rw']);
  assert.deepEqual(m.sensors.map((s) => s.path), ['switch', 'level', 'colorTemperature', 'hue', 'saturation', 'color', 'linkquality']);
  assert.deepEqual(m.read({ state: 'ON', brightness: 127, color_temp: 250, color: { hue: 180, saturation: 50 }, linkquality: 80 }),
    [['switch', 1], ['level', 50], ['colorTemperature', 4000], ['hue', 50], ['saturation', 50], ['linkquality', 80]]);
  assert.deepEqual(m.write('switch', 'off'), { state: 'OFF' });
  assert.deepEqual(m.write('switchLevel', 'setLevel', [100]), { state: 'ON', brightness: 254 });
  assert.deepEqual(m.write('switchLevel', 'setLevel', [0]), { state: 'OFF' });
  assert.deepEqual(m.write('colorTemperature', 'setColorTemperature', [2700]), { state: 'ON', color_temp: 370 });
  assert.deepEqual(m.write('colorControl', 'setColor', [{ hue: 50, saturation: 80 }]), { state: 'ON', color: { hue: 180, saturation: 80 } });
  const ct = m.sensors.find((s) => s.path === 'colorTemperature');
  assert.equal(ct.min, 2203); assert.equal(ct.max, 6536);
});

test('Zigbee map: two-gang switch, contact sensor, cover, thermostat', () => {
  const two = buildModel([sw('l1'), sw('l2')]);
  assert.deepEqual(two.sensors.filter((s) => s.controllable).map((s) => s.path), ['switch', 'switch_l2']);
  assert.deepEqual(two.write('switch_l2', 'on'), { state_l2: 'ON' });
  assert.deepEqual(two.read({ state_l1: 'OFF', state_l2: 'ON' }), [['switch', 0], ['switch_l2', 1]]);

  const door = buildModel([CONTACT, BATTERY, TEMP]);
  assert.deepEqual(door.homekit, ['contact', 'battery-level', 'temperature']);
  const c = door.sensors.find((s) => s.path === 'contact');
  assert.equal(c.homekit, 'contact'); assert.equal(c.contactOpen, 1);
  // Zigbee2MQTT: contact true = closed → 0; false = open → 1
  assert.deepEqual(door.read({ contact: true, battery: 90, temperature: 21.5 }), [['contact', 0], ['battery', 90], ['temperature', 21.5]]);
  assert.deepEqual(door.read({ contact: false }), [['contact', 1]]);
  assert.throws(() => door.write('contact', 'on'), /not settable/);

  const blind = buildModel([COVER]);
  assert.deepEqual(blind.homekit, ['cover-rw']);
  assert.deepEqual(blind.write('windowShade', 'setLevel', [30]), { position: 30 });
  assert.deepEqual(blind.write('windowShade', 'open'), { state: 'OPEN' });
  assert.deepEqual(blind.write('windowShade', 'stop'), { state: 'STOP' });
  assert.deepEqual(blind.read({ position: 0 }), [['level', 0], ['windowShade', 0]]);

  const trv = buildModel([CLIMATE, BATTERY]);
  assert.equal(trv.kind, 'thermostat');
  assert.deepEqual(trv.write('thermostatHeatingSetpoint', 'setHeatingSetpoint', [45]), { occupied_heating_setpoint: 30 });
  assert.deepEqual(trv.write('thermostatMode', 'setThermostatMode', ['heat']), { system_mode: 'heat' });
  assert.throws(() => trv.write('thermostatMode', 'setThermostatMode', ['cool']), /off, heat/);
  assert.deepEqual(trv.read({ local_temperature: 19.5, occupied_heating_setpoint: 21 }), [['temperature', 19.5], ['heatingSetpoint', 21]]);
});

// ── The client against a stand-in coordinator ──

class FakeEndpoint {
  constructor(device, ID) { this.device = device; this.ID = ID; this.commands = []; }
  async command(cluster, cmd, payload) { this.commands.push([cluster, cmd, payload]); }
}
class FakeDevice {
  constructor(ieeeAddr, modelID, type = 'Router') {
    this.ieeeAddr = ieeeAddr; this.modelID = modelID; this.type = type; this.interviewCompleted = true; this.meta = {};
    this.endpoints = [new FakeEndpoint(this, 1)];
  }
  getEndpoint(id) { return this.endpoints.find((e) => e.ID === id); }
  save() { this.saved = true; }
  async removeFromNetwork() { this.removed = true; }
}
class FakeController extends EventEmitter {
  constructor(opts) { super(); FakeController.last = this; this.opts = opts; this.devices = FakeController.devices; this.permit = null; }
  async start() { return 'resumed'; }
  async stop() { this.stopped = true; }
  async getNetworkParameters() { return { panID: 0x1a62, channel: 15 }; }
  async getCoordinatorVersion() { return { type: 'EmberZNet', meta: { revision: '7.4.3' } }; }
  *getDevicesIterator(pred) { for (const d of this.devices) if (!pred || pred(d)) yield d; }
  getDevicesByType(t) { return this.devices.filter((d) => d.type === t); }
  getDeviceByIeeeAddr(a) { return this.devices.find((d) => d.ieeeAddr === a); }
  async permitJoin(t) { this.permit = t; }
}

// A plug the way a zigbee-herdsman-converters definition describes one
const PLUG = {
  vendor: 'SONOFF', model: 'S26R2ZB', description: 'Zigbee smart plug',
  exposes: [{ type: 'switch', features: [{ name: 'state', access: 7, type: 'binary', property: 'state', value_on: 'ON', value_off: 'OFF' }] },
    { name: 'power', access: 1, type: 'numeric', property: 'power', unit: 'W' }],
  fromZigbee: [
    { cluster: 'genOnOff', type: ['attributeReport', 'readResponse'], convert: (model, msg) => ('onOff' in msg.data ? { state: msg.data.onOff ? 'ON' : 'OFF' } : undefined) },
    { cluster: 'haElectricalMeasurement', type: 'attributeReport', convert: (model, msg) => ({ power: msg.data.activePower }) },
  ],
  toZigbee: [{ key: ['state'], convertSet: async (entity, key, value) => { await entity.command('genOnOff', value.toLowerCase(), {}); return { state: { state: value } }; } }],
  configure: async (device) => { device.configured = true; },
};

function stubHerdsman() {
  // zigbee-client requires the real packages at load — stand-ins when they aren't installed here
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'zigbee-herdsman') return { Controller: FakeController, setLogger() {} };
    if (req === 'zigbee-herdsman-converters') return { setLogger() {} };
    return orig.call(this, req, ...rest);
  };
  delete require.cache[require.resolve('../src/zigbee-client')];
  try { return require('../src/zigbee-client'); } finally { Module._load = orig; }
}

test('Zigbee client: devices from the database, reports into the store, commands through toZigbee, pairing, removal', async () => {
  const ZigbeeClient = stubHerdsman();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-zigbee-'));
  const plug = new FakeDevice('0x00124b0012345678', 'S26R2ZB');
  FakeController.devices = [new FakeDevice('0x0000000000000001', null, 'Coordinator'), plug];
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const zhc = { findByDevice: async (d) => (d.modelID === 'S26R2ZB' ? PLUG : undefined), onEvent: async () => {} };
  const client = new ZigbeeClient({ zigbee: { port: '/dev/ttyUSB0', channel: 20, names: { '0x00124b0012345678': 'Lampa' } } }, store, registry,
    { Controller: FakeController, zhc, dir });
  await client.start();

  // network generated once, kept
  const net = JSON.parse(fs.readFileSync(path.join(dir, 'network.json'), 'utf8'));
  assert.equal(net.network_key.length, 16);
  const c = FakeController.last;
  assert.deepEqual(c.opts.network.channelList, [20]);
  assert.deepEqual(c.opts.network.networkKey, net.network_key);
  assert.equal(c.opts.transport.adapter, 'ember');
  assert.equal(c.opts.transport.path, '/dev/ttyUSB0');

  assert.equal(store.get('zigbee/coordinator/firmware'), 'EmberZNet 7.4.3');
  assert.equal(store.get('zigbee/coordinator/panId'), '0x1a62');
  assert.equal(store.get('zigbee/coordinator/devices'), 1);
  const dev = registry.getDevices().find((d) => d.key === 'zigbee/00124b0012345678');
  assert.equal(dev.label, 'Lampa');
  assert.equal(dev.model, 'SONOFF S26R2ZB');
  assert.deepEqual(dev.homekit, ['switch-rw']);
  assert.equal(plug.configured, true);
  assert.equal(plug.meta.lshConfigured, 'SONOFF/S26R2ZB');

  // a report
  c.emit('message', { device: plug, endpoint: plug.endpoints[0], type: 'attributeReport', cluster: 'genOnOff', data: { onOff: 1 }, linkquality: 120 });
  c.emit('message', { device: plug, endpoint: plug.endpoints[0], type: 'attributeReport', cluster: 'haElectricalMeasurement', data: { activePower: 42 } });
  await new Promise((r) => setImmediate(r));
  assert.equal(store.get('zigbee/00124b0012345678/switch'), 1);
  assert.equal(store.get('zigbee/00124b0012345678/power'), 42);
  assert.equal(store.get('zigbee/00124b0012345678/linkquality'), 120);

  // a command, the way the dashboard / HomeKit sends it
  await registry.sendCommand('zigbee/00124b0012345678', 'switch', false);
  assert.deepEqual(plug.endpoints[0].commands, [['genOnOff', 'off', {}]]);
  assert.equal(store.get('zigbee/00124b0012345678/switch'), 0);

  // pairing and removal through the coordinator device
  await registry.sendCommand('zigbee/coordinator', 'permitJoin', true);
  assert.equal(c.permit, 240);
  assert.equal(store.get('zigbee/coordinator/permitJoin'), 1);
  await registry.sendCommand('zigbee/coordinator', 'remove', '0x00124b0012345678');
  assert.equal(plug.removed, true);
  assert.equal(store.get('zigbee/coordinator/devices'), 0);
  await assert.rejects(registry.sendCommand('zigbee/coordinator', 'remove', '0x00124b00ffffffff'), /No Zigbee device/);

  // a newly joined device: interview → definition → registered
  const plug2 = new FakeDevice('0x00124b0087654321', 'S26R2ZB');
  c.devices.push(plug2);
  c.emit('deviceInterview', { status: 'successful', device: plug2 });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(registry.getDevices().some((d) => d.key === 'zigbee/00124b0087654321' && d.label === 'Zigbee smart plug'));

  await client.stop();
  assert.equal(c.stopped, true);
  // same network on the next start
  await new ZigbeeClient({ zigbee: { port: '/dev/ttyUSB0' } }, new DataStore(), new SensorRegistry(new DataStore(), 'en'), { Controller: FakeController, zhc, dir }).start();
  assert.deepEqual(FakeController.last.opts.network.networkKey, net.network_key);
  await FakeController.last.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Zigbee client: Zigbee2MQTT network.json (hex strings) is taken as is', () => {
  const ZigbeeClient = stubHerdsman();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-zigbee-'));
  const file = path.join(dir, 'network.json');
  fs.writeFileSync(file, JSON.stringify({ pan_id: 6754, ext_pan_id: 'dddddddddddddddd', network_key: '01030507090b0d0f00020406080a0c0d' }));
  const n = ZigbeeClient.loadNetwork(file);
  assert.equal(n.panID, 6754);
  assert.deepEqual(n.extendedPanID, Array(8).fill(0xdd));
  assert.equal(n.networkKey[15], 0x0d);
  fs.rmSync(dir, { recursive: true, force: true });
});
