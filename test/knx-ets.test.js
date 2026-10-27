'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knx-ets-'));
process.env.LSH_KNX_ETS_MAP = path.join(tmp, 'knx-ets.json');
const ets = require('../src/knx-ets');
const KNXClient = require('../src/knx-client');

const lamp = { key: 'shelly/lamp', label: 'Lampa', type: 'shelly', room: 'Salon', sensors: [
  { path: 'on', label: 'Włącz', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'on' },
  { path: 'level', label: 'Jasność', controllable: true, type: 'range', min: 0, max: 100, writeCmd: 'setLevel', capabilityId: 'level' },
  { path: 'power', label: 'Moc', unit: 'W' },
  { path: 'name', label: 'Nazwa', type: 'text' },
] };
const climate = { key: 'netatmo/salon', label: 'Klimat', type: 'netatmo', sensors: [
  { path: 'temp', label: 'Temperatura', unit: '°C' },
  { path: 'hum', label: 'Wilgotność', unit: '%' },
  { path: 'door', label: 'Drzwi', type: 'boolean' },
] };
const blind = { key: 'somfy/okno', label: 'Roleta', type: 'somfy', sensors: [
  { path: 'up', label: 'Góra', controllable: true, type: 'toggle', writeOn: 'up', writeOff: 'up', capabilityId: 'up' },
] };
const knxOwn = { key: 'knx/10.0.0.5', label: 'KNX', type: 'knx', sensors: [{ path: '1/1/1', label: 'x' }] };
const values = { 'shelly/lamp/power': 12.5, 'netatmo/salon/temp': 21.5, 'netatmo/salon/hum': 40, 'netatmo/salon/door': false };

test('classify picks the bus form and DPT', () => {
  assert.deepStrictEqual(ets.classify(lamp.sensors[0]), { kind: 'switch', dpt: 'DPT1.001', status: true });
  assert.deepStrictEqual(ets.classify(lamp.sensors[1]), { kind: 'dim', dpt: 'DPT5.001' });
  assert.deepStrictEqual(ets.classify(lamp.sensors[2], 12.5), { kind: 'value', dpt: 'DPT14.056' });
  assert.strictEqual(ets.classify(lamp.sensors[3], 'x'), null);
  assert.deepStrictEqual(ets.classify(climate.sensors[1], 40), { kind: 'value', dpt: 'DPT9.007' });
  assert.deepStrictEqual(ets.classify(climate.sensors[2], false), { kind: 'state', dpt: 'DPT1.001' });
  assert.deepStrictEqual(ets.classify(blind.sensors[0]), { kind: 'switch', dpt: 'DPT1.017', status: false });
  assert.deepStrictEqual(ets.classify({ path: 'x', controllable: true, type: 'range', min: 10, max: 30 }), { kind: 'dim', dpt: 'DPT5.010' });
  assert.strictEqual(ets.etsDpt('DPT9.001'), 'DPST-9-1');
  assert.strictEqual(ets.etsDpt('DPT14'), 'DPT-14');
});

test('allocate keeps addresses stable as devices come and go', () => {
  const map = ets.loadMap();
  const getValue = (k) => values[k] ?? null;
  const a = ets.allocate([lamp, knxOwn], map, { mainGroup: 20, getValue });
  assert.ok(a.changed);
  const on = a.entries.find((e) => e.key === 'shelly/lamp/on');
  assert.strictEqual(on.cmd, '20/0/0');
  assert.strictEqual(on.status, '20/4/0');
  assert.strictEqual(a.entries.find((e) => e.key === 'shelly/lamp/level').cmd, '21/0/0');
  assert.strictEqual(a.entries.find((e) => e.key === 'shelly/lamp/power').status, '22/0/0');
  assert.ok(!a.entries.some((e) => e.deviceKey === 'knx/10.0.0.5'), 'KNX devices are not re-exported');

  // a device registered earlier in a later run doesn't move the lamp
  const b = ets.allocate([blind, climate, lamp], map, { mainGroup: 20, getValue, scenes: [{ id: 's1', name: 'Kino' }] });
  assert.strictEqual(b.entries.find((e) => e.key === 'shelly/lamp/on').cmd, '20/0/0');
  const up = b.entries.find((e) => e.key === 'somfy/okno/up');
  assert.strictEqual(up.cmd, '20/0/1');
  assert.strictEqual(up.status, undefined, 'momentary buttons have no status');
  assert.strictEqual(b.entries.find((e) => e.key === 'netatmo/salon/door').status, '23/0/0');
  assert.strictEqual(b.entries.find((e) => e.kind === 'scene').cmd, '24/0/0');

  // readOnly never hands out new addresses
  const extra = { key: 'x/new', label: 'Nowy', type: 'x', sensors: [{ path: 't', unit: '°C' }] };
  const c = ets.allocate([extra, lamp], map, { mainGroup: 20, getValue: () => 20, readOnly: true });
  assert.ok(!c.entries.some((e) => e.deviceKey === 'x/new'));
  assert.ok(!c.changed);

  ets.saveMap(map);
  assert.deepStrictEqual(ets.loadMap().slots, map.slots);
});

test('buildEtsXml writes the ETS group-address import format', () => {
  const map = ets.loadMap();
  const { entries } = ets.allocate([lamp, climate, blind], map, { mainGroup: 20, getValue: (k) => values[k] ?? null, scenes: [{ id: 's1', name: 'Kino & TV' }] });
  const xml = ets.buildEtsXml(entries, { mainGroup: 20 });
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8" standalone="yes"\?>\n<GroupAddress-Export xmlns="http:\/\/knx\.org\/xml\/ga-export\/01">/);
  // main 20 = 20<<11 = 40960 … 43007
  assert.match(xml, /<GroupRange Name="LSH Switching" RangeStart="40960" RangeEnd="43007">/);
  assert.match(xml, /<GroupRange Name="Commands" RangeStart="40960" RangeEnd="41215">/);
  assert.match(xml, /<GroupRange Name="Status" RangeStart="41984" RangeEnd="42239">/);
  assert.match(xml, /<GroupAddress Name="Lampa Włącz" Address="20\/0\/0" DPTs="DPST-1-1" Description="LSH shelly\/lamp\/on · Salon" \/>/);
  assert.match(xml, /<GroupAddress Name="Lampa Włącz status" Address="20\/4\/0" DPTs="DPST-1-1"/);
  assert.match(xml, /Address="21\/0\/0" DPTs="DPST-5-1"/);
  assert.match(xml, /Name="Klimat Temperatura" Address="22\/0\/\d+" DPTs="DPST-9-1"/);
  assert.match(xml, /Name="Kino &amp; TV" Address="24\/0\/0" DPTs="DPST-1-17"/);
  assert.ok(!/Nazwa/.test(xml), 'text sensors are left out');
  // every GroupRange closes
  assert.strictEqual((xml.match(/<GroupRange /g) || []).length, (xml.match(/<\/GroupRange>/g) || []).length);
});

test('bridge: bus writes drive LSH, LSH changes and reads go to the bus', async () => {
  const store = new EventEmitter();
  const data = { ...values, 'shelly/lamp/on': true, 'shelly/lamp/level': 40 };
  store.get = (k) => data[k] ?? null;
  const commands = [];
  const reg = new EventEmitter();
  reg.getDevices = () => [lamp, climate, blind];
  reg.sendCommand = async (key, p, v) => { commands.push([key, p, v]); };
  reg.registerDevice = () => {};
  const scenesRun = [];
  const automation = { scenes: [{ id: 's1', name: 'Kino & TV' }], runScene: async (id) => { scenesRun.push(id); }, onScenesChanged() {} };

  const client = new KNXClient({ knx: { host: '10.0.0.5', lshBridge: true, ets: { mainGroup: 20 } } }, store, reg);
  const sent = [];
  client._conn = { write: (a, v, d) => sent.push(['write', a, v, d]), respond: (a, v, d) => sent.push(['respond', a, v, d]) };
  client._automation = automation;
  client._startBridge();

  const ev = (evt, dest, raw) => client._onBridgeEvent(evt, dest, raw);
  assert.ok(ev('GroupValue_Write', '20/0/0', Buffer.from([0])));
  assert.ok(ev('GroupValue_Write', '21/0/0', Buffer.from([0x80])));   // 128 → 50 %
  assert.ok(ev('GroupValue_Write', '20/0/1', Buffer.from([0])));      // trigger fires either way
  assert.ok(ev('GroupValue_Write', '24/0/0', Buffer.from([1])));
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(commands, [['shelly/lamp', 'on', false], ['shelly/lamp', 'level', 50], ['somfy/okno', 'up', true]]);
  assert.deepStrictEqual(scenesRun, ['s1']);
  assert.ok(!ev('GroupValue_Write', '1/1/1', Buffer.from([1])), 'other addresses go to the normal KNX handling');

  assert.ok(ev('GroupValue_Read', '20/4/0'));
  assert.deepStrictEqual(sent.pop(), ['respond', '20/4/0', true, 'DPT1.001']);

  store.emit('change', { key: 'netatmo/salon/temp', value: 22.1, changed: true });
  const temp = [...client._bridge.byKey.values()].find((e) => e.key === 'netatmo/salon/temp');
  assert.deepStrictEqual(sent.pop(), ['write', temp.status, 22.1, 'DPT9.001']);
  store.emit('change', { key: 'netatmo/salon/temp', value: 22.1, changed: false });
  assert.strictEqual(sent.length, 0, 'repeats are not re-sent');
  client.stop();
});
