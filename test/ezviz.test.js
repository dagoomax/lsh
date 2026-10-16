'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.LSH_EZVIZ_SESSION = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-ezviz-')), 'session.json');
const EzvizClient = require('../src/ezviz-client');
const SensorRegistry = require('../src/sensor-registry');
const DataStore = require('../src/data-store');
const { startSimulator } = require('../scripts/ezviz-simulator');

const setup = async (opts = {}) => {
  const sim = await startSimulator({ port: 0, ...opts });
  const store = new DataStore();
  const registry = new SensorRegistry(store);
  const c = new EzvizClient({ ezviz: { username: 'user@example.com', password: 'secret', apiBase: `http://127.0.0.1:${sim.port}`, codes: { C6N111: 'ABCDEF' } } }, store, registry);
  return { sim, store, registry, c };
};

test('EZVIZ: sign in, every device type, motion from the latest alarm, switches / defence / siren / PTZ, session expiry', async () => {
  const { sim, store, registry, c } = await setup();
  try {
    await c._pollImpl();
    const keys = registry.getDevices().map((d) => d.key).sort();
    assert.deepEqual(keys, ['ezviz/BC1222', 'ezviz/C6N111', 'ezviz/DB1333', 'ezviz/T30444']);
    const g = (s, p) => store.get(`ezviz/${s}/${p}`);
    const dev = (s) => registry.getDevices().find((d) => d.key === `ezviz/${s}`);

    // camera: PTZ, privacy / sleep / lights, motion from an alarm 20 s ago
    const cam = dev('C6N111');
    assert.equal(cam.kind, 'camera');
    for (const p of ['motion', 'motionDetection', 'siren', 'privacy', 'sleep', 'statusLight', 'alarmLight', 'up', 'left']) assert.ok(cam.sensors.some((s) => s.path === p), p);
    assert.ok(cam.homekit.includes('motion'));
    assert.equal(g('C6N111', 'motion'), 1);
    assert.equal(g('C6N111', 'motionDetection'), 1);
    assert.equal(g('C6N111', 'lastEventPicture'), 'https://example.invalid/alarm.jpg');
    assert.equal(g('C6N111', 'localIp'), '192.168.1.60');
    assert.equal(c.rtspUrl('C6N111'), 'rtsp://admin:ABCDEF@192.168.1.60:554/h264/ch1/main/av_stream');
    assert.equal(c.rtspUrl('BC1222'), null, 'no address / code → no local stream');

    // battery camera, doorbell offline, smart plug as a HomeKit switch
    assert.equal(g('BC1222', 'battery'), 78);
    assert.ok(!dev('BC1222').sensors.some((s) => s.path === 'up'), 'no PTZ');
    assert.equal(dev('DB1333').kind, 'doorbell');
    assert.equal(g('DB1333', 'online'), 0);
    assert.equal(dev('T30444').kind, 'smart plug');
    assert.equal(g('T30444', 'switch'), 1);
    assert.ok(dev('T30444').homekit.includes('switch-rw'));
    assert.ok(!dev('T30444').sensors.some((s) => s.path === 'motion'), 'a plug has no camera sensors');

    const set = (s, p, v) => registry.sendCommand(`ezviz/${s}`, p, v);
    await set('C6N111', 'privacy', 1);
    assert.equal(sim.state.switches.C6N111[7], true);
    await set('T30444', 'switch', 0);
    assert.equal(sim.state.switches.T30444[14], false);
    await set('C6N111', 'motionDetection', 0);
    assert.equal(sim.state.defence.C6N111, 0);
    await set('C6N111', 'siren', 1);
    assert.equal(sim.state.siren.C6N111, 2, '2 = sound');
    await set('C6N111', 'left', 1);
    assert.deepEqual(sim.calls.filter((x) => x.path.endsWith('/ptzControl')).map((x) => [x.form.command, x.form.action]), [['LEFT', 'START'], ['LEFT', 'STOP']]);

    // the session expires → refreshed, the call goes through
    sim.expireSessions();
    await c._pollImpl();
    assert.ok(sim.calls.some((x) => x.path === '/v3/apigateway/login'));
    assert.equal(c.status().devices.length, 4);
  } finally { c.stop(); await sim.close() }
});

test('EZVIZ: e-mail verification code, wrong password', async () => {
  const { sim, c } = await setup({ mfa: true });
  try {
    await assert.rejects(c.login(), /sent a verification code/);
    assert.equal(c.mfaPending, true);
    assert.ok(sim.calls.some((x) => x.path === '/v3/sms/nologin/checkcode'));
    await c.login('123456');
    assert.equal(c.mfaPending, false);
    c.cfg.password = 'nope';
    await assert.rejects(c.login(), /Wrong EZVIZ password/);
  } finally { await sim.close() }
});

test('EZVIZ alarm times', () => {
  const t = EzvizClient.parseAlarmTime('Today 10:00:00');
  assert.equal(new Date(t).getHours(), 10);
  assert.equal(EzvizClient.apiHost('eu'), 'apiieu.ezvizlife.com');
});
