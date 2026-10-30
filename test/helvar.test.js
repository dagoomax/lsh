'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const SensorRegistry = require('../src/sensor-registry');
const HelvarClient = require('../src/helvar-client');
const { startSimulator } = require('../scripts/helvar-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {},
  update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) },
  set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null },
  getTimestamp() { return Date.now() },
});
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)) } };

test('HelvarNet: message parsing, formatting, device types', () => {
  const { parseMessage, formatCommand, decodeType } = HelvarClient;
  assert.deepEqual(parseMessage('>V:1,C:11,G:1234,B:5,S:6,F:3200'), { type: '>', version: 1, command: 11, params: { G: '1234', B: '5', S: '6', F: '3200' }, address: null, value: null });
  assert.deepEqual(parseMessage('?V:1,C:152,@1.1.2.15=25'), { type: '?', version: 1, command: 152, params: {}, address: '1.1.2.15', value: '25' });
  assert.equal(parseMessage('?V:2,C:100@2.2.1.1=00100802@1,00110702@10').value, '00100802@1,00110702@10', 'no comma before @');
  assert.equal(parseMessage('?V:2,C:166=@1.1.1:Morning@1.1.2:Afternoon').value, '@1.1.1:Morning@1.1.2:Afternoon');
  assert.equal(parseMessage('!V:1,C:104,@1.1.1.9=11').type, '!');
  assert.equal(formatCommand(14, { L: 60, F: 9000 }, '1.2.3.4'), '>V:2,C:14,L:60,F:9000,@1.2.3.4#');

  assert.deepEqual(decodeType('1537'), { protocol: 'DALI', kind: 'load', model: 'LED driver' });
  assert.deepEqual(decodeType('00100802'), { protocol: 'Digidim', kind: 'control', model: '100 Rotary' }, 'hex form from the help file');
  assert.equal(decodeType(String(0x00312502)).kind, 'sensor');
  assert.equal(decodeType(String(0x00444302)).kind, 'input');
  assert.equal(decodeType(String(0x00458002)).kind, 'load');
});

test('Helvar: discovery, levels, scenes, push messages, sensors', async () => {
  const sim = await startSimulator({ port: 0 });
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new HelvarClient({ helvar: { host: '127.0.0.1', port: sim.port, cluster: 1, router: 1, fade: 0.5 } }, store, registry);
  const v = (k) => store.values[`helvar/${k}`];
  try {
    await c.start();
    assert.equal(registry.devices.get('helvar/1_1_1_1').label, 'Desk');
    assert.match(registry.devices.get('helvar/1_1_1_1').model, /LED driver \(DALI @1\.1\.1\.1\)/);
    assert.equal(registry.devices.get('helvar/1_1_1_4'), undefined, 'button panel not registered');
    assert.equal(registry.devices.get('helvar/group-1').label, 'Office');
    assert.deepEqual(v('group-1/scenes'), { '1.1': 'Bright', '1.2': 'Relax' });
    assert.equal(v('group-1/lastScene'), 'off');
    assert.equal(v('1_1_1_2/fault'), 1, 'lamp failure flag');
    assert.equal(v('1_1_1_1/fault'), 0);
    assert.equal(v('1_1_1_3/lux'), 42, 'light level found on subdevice 2');
    assert.equal(c.status().workgroup, 'Office');

    await registry.sendCommand('helvar/1_1_1_1', 'level', 60);
    await until(() => sim.devices['1.1.1.1'].level === 60);
    assert.ok(sim.received.includes('>V:2,C:14,L:60,F:50,@1.1.1.1'), 'fade 0.5 s = F:50');
    assert.equal(v('1_1_1_1/switch'), 1);

    await registry.sendCommand('helvar/group-1', 'switch', '0');
    await until(() => sim.devices['1.1.1.2'].level === 0 && sim.devices['1.1.1.1'].level === 0);
    assert.equal(v('1_1_1_1/level'), 0, 'members follow the group');

    await registry.sendCommand('helvar/group-1', 'scene', 'relax');
    await until(() => sim.devices['1.1.1.1'].level === 30);
    assert.equal(v('group-1/lastScene'), 'Relax');
    await until(() => v('1_1_1_1/level') === 30 && v('group-1/level') === 30, 3000);
    await assert.rejects(registry.sendCommand('helvar/group-1', 'scene', 'disco'), /No scene "disco".*Bright, Relax/);
    await assert.rejects(registry.sendCommand('helvar/group-1', 'scene', '9.1'), /block 1–8/);

    // a wall panel recalls "Bright" — pushed to LSH, levels read back
    sim.pushScene(1, 1, 1);
    await until(() => v('group-1/lastScene') === 'Bright' && v('1_1_1_2/level') === 100, 3000);

    sim.motion(true);
    await c._pollSensors();
    assert.equal(v('1_1_1_3/motion'), 1);

    await c._pollLoads();
    assert.equal(v('group-1/power'), 20);
    assert.equal(v('group-1/lastScene'), 'Bright', 'LSIG 1 → block 1 scene 1');
  } finally { c.stop(); await sim.close() }
});
