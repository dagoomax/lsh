'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const TuyaClient = require('../src/tuya-client');
const EwelinkClient = require('../src/ewelink-client');
const tuyaSim = require('../scripts/tuya-simulator');
const ewelinkSim = require('../scripts/ewelink-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});

// ── Tuya ──

test('Tuya: request signature matches the documented algorithm', () => {
  // stringToSign = METHOD \n sha256(body) \n \n url ; str = client_id + token + t + nonce + stringToSign
  const s = TuyaClient.TuyaCloud.sign({ id: 'id', secret: 'secret', token: '', t: '1588925778000', nonce: '5138cc3a9033d69856923fd07b491173',
    method: 'GET', path: '/v1.0/token?grant_type=1' });
  const crypto = require('crypto');
  const sts = ['GET', crypto.createHash('sha256').update('').digest('hex'), '', '/v1.0/token?grant_type=1'].join('\n');
  assert.equal(s, crypto.createHmac('sha256', 'secret').update('id' + '1588925778000' + '5138cc3a9033d69856923fd07b491173' + sts).digest('hex').toUpperCase());
  assert.match(s, /^[0-9A-F]{64}$/);
});

test('Tuya: local DP layouts are recognised without a cloud model', () => {
  const { guessProps, buildModel, parseColour, encodeColour } = TuyaClient._test;
  const bulb = buildModel(guessProps({ 20: true, 21: 'colour', 22: 800, 23: 500, 24: '007800c801f4' }), '');
  assert.equal(bulb.kind, 'light');
  assert.deepEqual(bulb.sensors.map((s) => s.path), ['switch', 'level', 'colorTemperature', 'hue', 'saturation', 'color']);
  const plug = buildModel(guessProps({ 1: true, 9: 0, 17: 12, 18: 300, 19: 700, 20: 2300 }), '');
  assert.equal(plug.kind, 'switch');
  assert.deepEqual(plug.sensors.map((s) => s.path), ['switch', 'power', 'voltage', 'current', 'energy']);
  const curtain = buildModel(guessProps({ 1: 'stop', 2: 30, 3: 30 }), '');
  assert.equal(curtain.kind, 'cover');
  // colour: LAN v2 hex ↔ {h,s,v}
  assert.deepEqual(parseColour('007800c801f4'), { h: 120, s: 200, v: 500 });
  assert.equal(encodeColour({ h: 120, s: 200, v: 500 }, 'colour_data_v2', true), '007800c801f4');
  assert.equal(encodeColour({ h: 120, s: 200, v: 500 }, 'colour_data_v2', false), '{"h":120,"s":200,"v":500}');
});

test('Tuya cloud: devices, readings and control through the simulator', async () => {
  const sim = await tuyaSim.startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const client = new TuyaClient({ tuya: { mode: 'cloud', accessId: 'sim-id', accessSecret: 'sim-secret', baseUrl: sim.url } }, store, registry);
  try {
    await client.start();
    const keys = registry.getDevices().map((d) => d.key).sort();
    assert.deepEqual(keys, ['tuya/bf0sim0bulb', 'tuya/bf0sim0curt', 'tuya/bf0sim0plug', 'tuya/bf0sim0th00']);
    const v = store.values;
    assert.equal(v['tuya/bf0sim0bulb/switch'], 1);
    assert.equal(v['tuya/bf0sim0bulb/level'], 50);
    assert.equal(v['tuya/bf0sim0bulb/colorTemperature'], 3840);
    assert.equal(v['tuya/bf0sim0plug/power'], 117.6);
    assert.equal(v['tuya/bf0sim0plug/voltage'], 230.1);
    assert.equal(v['tuya/bf0sim0plug/energy'], 1.234);
    assert.equal(v['tuya/bf0sim0plug/switch_2'], 0);
    assert.equal(v['tuya/bf0sim0curt/level'], 40);
    assert.equal(v['tuya/bf0sim0th00/temperature'], 21.5);
    assert.equal(v['tuya/bf0sim0th00/humidity'], 58);
    assert.equal(v['tuya/bf0sim0th00/battery'], 87);
    const bulb = registry.getDevices().find((d) => d.key === 'tuya/bf0sim0bulb');
    assert.ok(bulb.homekit.includes('light-rw'));

    await registry.sendCommand('tuya/bf0sim0bulb', 'level', 40);
    assert.equal(sim.state.bf0sim0bulb.bright_value_v2, 400);
    await registry.sendCommand('tuya/bf0sim0bulb', 'colorTemperature', 6500);
    assert.equal(sim.state.bf0sim0bulb.temp_value_v2, 1000);
    assert.equal(sim.state.bf0sim0bulb.work_mode, 'white');
    await registry.sendCommand('tuya/bf0sim0bulb', 'color', { hue: 50, saturation: 100 });
    assert.equal(sim.state.bf0sim0bulb.work_mode, 'colour');
    assert.deepEqual(JSON.parse(sim.state.bf0sim0bulb.colour_data_v2), { h: 180, s: 1000, v: 400 });
    // dimming in colour mode changes the colour's brightness, not the white one
    await registry.sendCommand('tuya/bf0sim0bulb', 'level', 20);
    assert.equal(JSON.parse(sim.state.bf0sim0bulb.colour_data_v2).v, 200);
    assert.equal(sim.state.bf0sim0bulb.bright_value_v2, 400);
    await registry.sendCommand('tuya/bf0sim0bulb', 'switch', 'off');
    assert.equal(sim.state.bf0sim0bulb.switch_led, false);

    await registry.sendCommand('tuya/bf0sim0plug', 'switch_2', 'on');
    assert.equal(sim.state.bf0sim0plug.switch_2, true);
    assert.equal(v['tuya/bf0sim0plug/switch_2'], 1);

    await registry.sendCommand('tuya/bf0sim0curt', 'level', 75);
    assert.equal(sim.state.bf0sim0curt.percent_control, 75);
    await registry.sendCommand('tuya/bf0sim0curt', 'windowShade', 'off');
    assert.equal(sim.state.bf0sim0curt.control, 'close');

    // a rejected token is renewed once and the request retried
    client._cloud._token = 'stale';
    await client._pollCloud();
    assert.equal(v['tuya/bf0sim0curt/level'], 0);
  } finally {
    client.stop();
    await sim.close();
  }
});

test('Tuya probe lists the project devices with their local keys', async () => {
  const sim = await tuyaSim.startSimulator({ port: 0 });
  try {
    const list = await TuyaClient.probe({ accessId: 'sim-id', accessSecret: 'sim-secret', baseUrl: sim.url });
    assert.equal(list.length, 4);
    assert.ok(list.every((d) => d.hasKey));
    await assert.rejects(TuyaClient.probe({ accessId: 'sim-id', accessSecret: 'wrong', baseUrl: sim.url }), /sign invalid/);
  } finally { await sim.close(); }
});

// ── Sonoff / eWeLink ──

test('eWeLink: LAN payloads round-trip through AES-128-CBC with MD5(devicekey)', () => {
  const { encryptLan, decryptLan, parseTxt, lanEndpoint } = EwelinkClient._test;
  const e = encryptLan('my-device-key', { switches: [{ switch: 'on', outlet: 1 }] });
  assert.deepEqual(decryptLan('my-device-key', e.iv, e.data), { switches: [{ switch: 'on', outlet: 1 }] });
  assert.deepEqual(parseTxt({ encrypt: 'true', iv: e.iv, data1: e.data.slice(0, 10), data2: e.data.slice(10) }, 'my-device-key'),
    { switches: [{ switch: 'on', outlet: 1 }] });
  assert.deepEqual(parseTxt({ data1: '{"switch":"on"}' }), { switch: 'on' }); // DIY mode: plain JSON
  assert.equal(lanEndpoint({ switch: 'on' }), 'switch');
  assert.equal(lanEndpoint({ switches: [] }), 'switches');
  assert.equal(lanEndpoint({ switch: 'on', brightness: 40, mode: 0 }), 'dimmable');
  assert.equal(lanEndpoint({ switch: 'on', ltype: 'white', white: { br: 40 } }), null);
});

test('eWeLink: cloud devices, LAN discovery and local control through the simulator', async () => {
  const sim = await ewelinkSim.startSimulator({ port: 0, lanPort: 0, mdns: false });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const client = new EwelinkClient({ sonoff: { mode: 'cloud', appId: 'sim-app', appSecret: 'sim-secret',
    email: 'sim@example.com', password: 'sim-pass', baseUrl: sim.url } }, store, registry);
  client._mode = 'auto'; // auto, but no real multicast socket in the test — mDNS answers are fed in below
  try {
    await client.start();
    const keys = registry.getDevices().map((d) => d.key).sort();
    assert.deepEqual(keys, ['sonoff/1000sim0mn', 'sonoff/1000sim0pw', 'sonoff/1000sim0r3', 'sonoff/1000sim0th']);
    const v = store.values;
    assert.equal(v['sonoff/1000sim0r3/switch'], 1);
    assert.equal(v['sonoff/1000sim0r3/switch_2'], 0);
    assert.equal(v['sonoff/1000sim0r3/switch_3'], undefined); // DUALR3 has two channels, not four
    assert.equal(v['sonoff/1000sim0pw/power'], 19.5);
    assert.equal(v['sonoff/1000sim0pw/voltage'], 231.2);
    assert.equal(v['sonoff/1000sim0th/temperature'], 18.4);
    assert.equal(v['sonoff/1000sim0th/humidity'], 61);

    // the DUALR3 announces itself on the LAN → switched locally, not via the cloud
    client._onMdns(sim.mdnsResponse('1000sim0r3'));
    const cloudCalls = sim.calls.length;
    await registry.sendCommand('sonoff/1000sim0r3', 'switch_2', 'on');
    assert.equal(sim.lanCalls.length, 1);
    assert.equal(sim.lanCalls[0].path, '/zeroconf/switches');
    assert.deepEqual(sim.lanCalls[0].params, { switches: [{ switch: 'on', outlet: 1 }] });
    assert.equal(sim.devices[1].params.switches[1].switch, 'on');
    assert.equal(sim.calls.length, cloudCalls);
    assert.equal(v['sonoff/1000sim0r3/switch_2'], 1);
    assert.equal(v['sonoff/1000sim0r3/switch'], 1); // the other channel kept its state

    // a fresh LAN announcement (state changed at the device) updates the store
    sim.devices[1].params.switches[0].switch = 'off'; sim.seq++;
    client._onMdns(sim.mdnsResponse('1000sim0r3'));
    assert.equal(v['sonoff/1000sim0r3/switch'], 0);

    // the MINI is not on the LAN → cloud
    await registry.sendCommand('sonoff/1000sim0mn', 'switch', 'on');
    assert.equal(sim.devices[0].params.switch, 'on');
    assert.equal(sim.lanCalls.length, 1);
    assert.equal(v['sonoff/1000sim0mn/switch'], 1);
  } finally {
    client.stop();
    await sim.close();
  }
});

test('eWeLink probe signs in and lists devices; a wrong secret is rejected', async () => {
  const sim = await ewelinkSim.startSimulator({ port: 0, lanPort: 0, mdns: false });
  try {
    const cfg = { appId: 'sim-app', appSecret: 'sim-secret', email: 'sim@example.com', password: 'sim-pass', baseUrl: sim.url };
    assert.equal((await EwelinkClient.probe(cfg)).length, 4);
    await assert.rejects(EwelinkClient.probe({ ...cfg, appSecret: 'nope' }), /sign invalid/);
  } finally { await sim.close(); }
});
