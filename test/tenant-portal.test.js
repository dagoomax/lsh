'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const express = require('express');
const DataStore = require('../src/data-store');
const SensorRegistry = require('../src/sensor-registry');
const TenantPortal = require('../src/tenant-portal');

const H = 3600_000;
const iso = (ms) => new Date(ms).toISOString();

function setup() {
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const writes = [];
  registry.registerDevice({
    key: 'test/light', label: 'Lamp', sensors: [
      { path: 'switch', type: 'toggle', controllable: true, capabilityId: 'sw', writeOn: 'on', writeOff: 'off' },
      { path: 'power', type: 'number', unit: 'W' },
    ],
    _writeCapability: async (cap, cmd) => { writes.push(cmd); store.set('test/light/switch', cmd === 'on' ? 1 : 0); },
  });
  registry.registerDevice({
    key: 'test/other', label: 'Not for guests', sensors: [{ path: 'switch', type: 'toggle', controllable: true, writeOn: 'on', writeOff: 'off' }],
    _writeCapability: async (cap, cmd) => writes.push(`other:${cmd}`),
  });
  const now = Date.now();
  // one stay now, one next week (no phone digits → derived PIN)
  store.set('airbnb/flat/reservations', [
    { start: iso(now - 20 * H), end: iso(now + 30 * H), code: 'HMAAA', phone4: '4321', name: null, nights: 2 },
    { start: iso(now + 7 * 24 * H), end: iso(now + 9 * 24 * H), code: 'HMBBB', phone4: null, name: null, nights: 2 },
  ]);
  const config = {
    tenant: {
      enabled: true,
      properties: [{ name: 'Flat', listing: 'airbnb/flat', devices: ['test/light'], wifi: { ssid: 'FlatNet', password: 'secret123' }, rules: 'No parties', pin: { mode: 'phone4', digits: 6 } }],
    },
  };
  const secretFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-')), 'secret.json');
  const portal = new TenantPortal(store, registry, { secretFile, readConfig: () => config });
  return { store, registry, portal, writes, config };
}

test('stays get a link, a window and a PIN; keypad check follows the window', () => {
  const { portal, store } = setup();
  const [prop] = portal.properties();
  const [cur, next] = portal.stays(prop);
  assert.equal(cur.status, 'active');
  assert.equal(next.status, 'upcoming');
  assert.equal(cur.pin, '4321'); // Airbnb phone last 4
  assert.match(next.pin, /^\d{6}$/); // derived, configured length
  assert.notEqual(cur.token, next.token);
  assert.equal(portal.find(cur.token).stay.code, 'HMAAA');
  assert.equal(portal.find('x'.repeat(22)), null);

  assert.equal(portal.checkPin('4321').valid, true);
  assert.equal(portal.checkPin(next.pin).valid, false); // not yet
  assert.equal(portal.checkPin('4321', 'other').valid, false);

  portal.publish();
  assert.equal(store.get('tenant/flat/active'), true);
  assert.equal(store.get('tenant/flat/doorPin'), '4321');

  // reset → every link changes
  portal.resetSecret();
  assert.equal(portal.find(cur.token), null);
});

test('guest page: only the active stay gets Wi-Fi, PIN and the allowed devices', async () => {
  const { portal, writes } = setup();
  const [prop] = portal.properties();
  const [cur, next] = portal.stays(prop);
  const app = express();
  app.use('/guest', portal.router());
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/guest`;
  try {
    let r = await fetch(`${base}/${cur.token}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/${'a'.repeat(22)}`)).status, 404);

    let s = (await (await fetch(`${base}/${cur.token}/state`)).json()).data;
    assert.equal(s.status, 'active');
    assert.equal(s.pin, '4321');
    assert.equal(s.wifi.ssid, 'FlatNet');
    assert.deepEqual(s.devices.map((d) => d.key), ['test/light']);

    const post = (token, body) => fetch(`${base}/${token}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    r = await post(cur.token, { device: 'test/light', sensor: 'switch', value: true });
    assert.equal(r.status, 200);
    assert.deepEqual(writes, ['on']);
    assert.equal((await post(cur.token, { device: 'test/other', sensor: 'switch', value: true })).status, 403);
    assert.equal((await post(cur.token, { device: 'test/light', sensor: 'power', value: 5 })).status, 403);
    assert.deepEqual(writes, ['on']);

    s = (await (await fetch(`${base}/${next.token}/state`)).json()).data;
    assert.equal(s.status, 'upcoming');
    assert.equal(s.pin, null);
    assert.equal(s.wifi, null);
    assert.deepEqual(s.devices, []);
    assert.equal((await post(next.token, { device: 'test/light', sensor: 'switch', value: false })).status, 403);
  } finally {
    srv.close();
  }
});

test('turning the portal off kills every link', async () => {
  const { portal, config } = setup();
  const [cur] = portal.stays(portal.properties()[0]);
  config.tenant.enabled = false;
  assert.equal(portal.find(cur.token), null);
  assert.equal(portal.checkPin('4321').valid, false);
});

test('with a Nuki lock the PIN follows its keypad rules and codes are published for it', () => {
  const { portal, store, config } = setup();
  config.tenant.properties[0].lock = 'nuki/123';
  const [prop] = portal.properties();
  const stays = portal.stays(prop);
  for (const s of stays) assert.match(s.pin, /^[1-9]{6}$/); // phone4 (4 digits) can't be a Nuki code
  assert.ok(stays.every((s) => !s.pin.startsWith('12')));
  portal.publish();
  const codes = store.get('tenant/flat/codes');
  assert.equal(codes.lock, 'nuki/123');
  assert.equal(codes.codes.length, 2);
  assert.match(codes.codes[0].name, /^LSH-[a-z0-9]{6} /);
  assert.equal(codes.codes[0].pin, stays[0].pin);
  // portal off → no codes wanted any more
  config.tenant.enabled = false;
  portal.publish();
  assert.deepEqual(store.get('tenant/flat/codes').codes, []);
});
