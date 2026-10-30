'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const DataStore = require('../src/data-store');
const SensorRegistry = require('../src/sensor-registry');
const TTLockClient = require('../src/ttlock-client');
const { pinRule } = require('../src/tenant-portal');
const { createSimulator } = require('../scripts/ttlock-simulator');

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('timed out');
};
const H = 3600_000;

test('TTLock: login (MD5), state, lock/unlock via gateway, passcodes from the guest portal', async () => {
  const sim = createSimulator();
  await new Promise((r) => sim.server.listen(0, '127.0.0.1', r));
  const tokenFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-')), 'token.json');
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const config = { ttlock: { clientId: 'cid', clientSecret: 'csec', username: 'host@example.com', password: 'secret', apiBase: `http://127.0.0.1:${sim.server.address().port}`, tokenFile } };
  const client = new TTLockClient(config, store, registry);
  try {
    await client.start();
    assert.equal(registry.devices.get('ttlock/3311').label, 'Apartament 4B');
    assert.equal(store.get('ttlock/3311/lock'), 1);
    assert.equal(store.get('ttlock/3311/door'), 'Closed');
    assert.equal(store.get('ttlock/3311/battery'), 76);
    assert.equal(store.get('ttlock/3312/status'), 'No gateway');
    assert.ok(JSON.parse(fs.readFileSync(tokenFile, 'utf8'))); // token kept for restarts

    await registry.sendCommand('ttlock/3311', 'lock', false);
    assert.deepEqual(sim.log, ['unlock:3311']);
    await assert.rejects(registry.sendCommand('ttlock/3312', 'lock', false), /no TTLock gateway/);

    // expired token → refreshed and retried
    sim.expireToken();
    await registry.sendCommand('ttlock/3311', 'lock', true);
    assert.deepEqual(sim.log, ['unlock:3311', 'lock:3311']);

    // guest-portal codes: the owner's passcode stays
    sim.passcodes[3311].push({ keyboardPwdId: 1, keyboardPwdName: 'Właściciel', keyboardPwd: '777777' });
    const from = new Date(Date.now() + H), to = new Date(Date.now() + 50 * H);
    store.set('tenant/flat/codes', { lock: 'ttlock/3311', codes: [{ id: 'aaaaaa', name: 'LSH-aaaaaa HMAAA', pin: '4321', from: from.toISOString(), to: to.toISOString() }] });
    await until(() => sim.passcodes[3311].length === 2);
    const pc = sim.passcodes[3311][1];
    assert.equal(pc.keyboardPwd, '4321');
    assert.equal(pc.keyboardPwdType, 3);
    assert.equal(pc.addType, 2);
    assert.equal(pc.startDate, from.getTime());
    assert.equal(pc.endDate, to.getTime());
    await until(() => /^OK · 1/.test(store.get('tenant/flat/lockCodes') || ''));

    store.set('tenant/flat/codes', { lock: 'ttlock/3311', codes: [] });
    await until(() => sim.passcodes[3311].length === 1);
    assert.equal(sim.passcodes[3311][0].keyboardPwdName, 'Właściciel');

    // a lock without a gateway reports why codes can't be set
    store.set('tenant/shed/codes', { lock: 'ttlock/3312', codes: [{ id: 'bbbbbb', name: 'LSH-bbbbbb x', pin: '5555', from: from.toISOString(), to: to.toISOString() }] });
    await until(() => /gateway/.test(store.get('tenant/shed/lockCodes') || ''));
  } finally {
    client.stop();
    sim.server.close();
  }
});

test('TTLock PIN rule: 4-9 digits, so Airbnb phone digits work', () => {
  assert.equal(pinRule({ lock: 'ttlock/1' }).ok('4321'), true);
  assert.equal(pinRule({ lock: 'ttlock/1' }).ok('1234567890'), false);
});
