'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const DataStore = require('../src/data-store');
const SensorRegistry = require('../src/sensor-registry');
const NukiClient = require('../src/nuki-client');
const TedeeClient = require('../src/tedee-client');
const { pinRule } = require('../src/tenant-portal');
const { diffCodes } = require('../src/lock-codes');
const { createSimulator } = require('../scripts/nuki-simulator');

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('timed out');
};
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const H = 3600_000;

test('PIN rules follow the lock', () => {
  const nuki = pinRule({ lock: 'nuki/1' });
  assert.equal(nuki.ok('345678'), true);
  assert.equal(nuki.ok('123456'), false); // starts with 12
  assert.equal(nuki.ok('305678'), false); // no zeros on a Nuki keypad
  assert.equal(pinRule({ lock: 'tedee/9' }).ok('1234'), false);
  assert.equal(pinRule({ lock: 'tedee/9' }).ok('12345'), true);
  assert.equal(pinRule({}).ok('1234'), true);
});

test('code diff touches only LSH codes', () => {
  const { remove, add } = diffCodes(
    [{ id: 1, name: 'LSH-aaaaaa HMX' }, { id: 2, name: 'Sprzątaczka' }, { id: 3, name: 'LSH-bbbbbb old' }],
    [{ id: 'aaaaaa', name: 'LSH-aaaaaa HMX' }, { id: 'cccccc', name: 'LSH-cccccc new' }],
  );
  assert.deepEqual(remove.map((r) => r.id), [3]);
  assert.deepEqual(add.map((a) => a.id), ['cccccc']);
});

test('Nuki: Bridge state and commands (hashed token), Web keypad codes from the guest portal', async () => {
  const sim = createSimulator();
  const port = await listen(sim.server);
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const config = { nuki: { bridges: [{ host: '127.0.0.1', port, token: 'simtoken' }], webToken: 'webtoken', webBase: `http://127.0.0.1:${port}/web`, pollSeconds: 5 } };
  const client = new NukiClient(config, store, registry);
  const lockKey = `nuki/${0x1A2B3C4D}`;
  try {
    await client.start();
    assert.equal(registry.devices.get(lockKey).label, 'Drzwi wejściowe');
    assert.equal(store.get(`${lockKey}/lock`), 1);
    assert.equal(store.get(`${lockKey}/status`), 'Locked');
    assert.equal(store.get(`${lockKey}/battery`), 81);
    assert.equal(store.get(`${lockKey}/door`), 'Closed');
    assert.equal(store.get(`nuki/${0x0BADCAFE}/status`), 'Online');

    await registry.sendCommand(lockKey, 'lock', false);
    assert.deepEqual(sim.log, [`bridge:${0x1A2B3C4D}:1`]);
    await registry.sendCommand(`nuki/${0x0BADCAFE}`, 'ringToOpen', true);
    assert.equal(sim.log[1], `bridge:${0x0BADCAFE}:1`);

    // the guest portal wants two codes on this lock; the owner's own code stays
    sim.auths.push({ id: 'own', name: 'Sprzątaczka', type: 13, code: 987654 });
    const now = Date.now();
    store.set('tenant/flat/codes', { lock: lockKey, codes: [
      { id: 'aaaaaa', name: 'LSH-aaaaaa HMAAA', pin: '345678', from: new Date(now).toISOString(), to: new Date(now + 48 * H).toISOString() },
      { id: 'bbbbbb', name: 'LSH-bbbbbb HMBBB', pin: '456789', from: new Date(now + 96 * H).toISOString(), to: new Date(now + 140 * H).toISOString() },
    ] });
    await until(() => sim.auths.length === 3);
    const a = sim.auths.find((x) => x.name === 'LSH-aaaaaa HMAAA');
    assert.equal(a.type, 13);
    assert.equal(a.code, 345678);
    assert.equal(a.remoteAllowed, false);
    await until(() => /^OK · 2/.test(store.get('tenant/flat/lockCodes') || ''));

    // stay gone → its code goes; the owner's code is untouched
    store.set('tenant/flat/codes', { lock: lockKey, codes: [] });
    await until(() => sim.auths.length === 1);
    assert.equal(sim.auths[0].id, 'own');
  } finally {
    client.stop();
    sim.server.close();
  }
});

test('Nuki: cloud only (no Bridge) polls and controls through Nuki Web', async () => {
  const sim = createSimulator();
  const port = await listen(sim.server);
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const client = new NukiClient({ nuki: { webToken: 'webtoken', webBase: `http://127.0.0.1:${port}/web` } }, store, registry);
  try {
    await client.start();
    const key = `nuki/${0x1A2B3C4D}`;
    assert.equal(store.get(`${key}/status`), 'Locked');
    await registry.sendCommand(key, 'open', true);
    assert.deepEqual(sim.log, [`web:${0x1A2B3C4D}:3`]);
  } finally {
    client.stop();
    sim.server.close();
  }
});

test('Tedee: guest portal PINs become time-limited Bridge PINs', async () => {
  const pins = [{ id: 7, alias: 'Rodzina' }, { id: 8, alias: 'LSH-zzzzzz old' }];
  const created = [];
  let nextId = 20;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.headers.api_token !== 'tk') { res.writeHead(401); return res.end(); }
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj ? JSON.stringify(obj) : ''); };
      if (req.url === '/v1.0/lock' && req.method === 'GET') return send(200, [{ id: 55, name: 'Front', state: 6, batteryLevel: 90, doorState: 3, jammed: false }]);
      if (req.url === '/v1.0/lock/55/pin' && req.method === 'GET') return send(200, { listVersion: 1, pins });
      if (req.url === '/v1.0/lock/55/pin' && req.method === 'POST') {
        const p = JSON.parse(body);
        if (!/^[0-9]{5,8}$/.test(p.pin)) return send(400, { 'error-description': 'bad pin' });
        created.push(p);
        pins.push({ id: nextId, alias: p.alias });
        return send(200, { id: nextId++ });
      }
      const m = /^\/v1\.0\/lock\/55\/pin\/(\d+)$/.exec(req.url);
      if (m && req.method === 'DELETE') { pins.splice(pins.findIndex((p) => p.id === Number(m[1])), 1); return send(204); }
      send(404);
    });
  });
  const port = await listen(srv);
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const client = new TedeeClient({ tedee: { devices: [{ host: `127.0.0.1:${port}`, apiToken: 'tk' }] } }, store, registry);
  try {
    await client.start();
    await until(() => registry.devices.get('tedee/55'));
    const from = new Date(Date.now() + H), to = new Date(Date.now() + 50 * H);
    store.set('tenant/flat/codes', { lock: 'tedee/55', codes: [{ id: 'aaaaaa', name: 'LSH-aaaaaa HMAAA', pin: '48213', from: from.toISOString(), to: to.toISOString() }] });
    await until(() => created.length === 1 && !pins.some((p) => p.id === 8));
    assert.deepEqual(created[0], { pin: '48213', alias: 'LSH-aaaaaa HMAAA', startDate: Math.floor(from / 1000), endDate: Math.floor(to / 1000), weekdays: 127 });
    assert.ok(pins.some((p) => p.alias === 'Rodzina'));
    await until(() => /^OK · 1/.test(store.get('tenant/flat/lockCodes') || ''));
  } finally {
    client.stop();
    srv.close();
  }
});
