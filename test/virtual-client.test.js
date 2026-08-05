'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const VirtualClient = require('../src/virtual-client');

// Minimal in-memory stand-in for DataStore's get/update surface.
function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (key) => (key in data ? data[key] : null),
    update: (key, value) => { data[key] = value; },
    _data: data,
  };
}

const fakeRegistry = { registerDevice() {} };

test('virtual-client: does not reseed an existing value on restart', async () => {
  // Round 1 fix (6d565bf) — seeding used to run unconditionally on every
  // start(), silently discarding whatever had been persisted (e.g. a
  // manually-set "Home/Away" flag) back to the type default.
  const store = fakeStore({ 'virtual/flag/value': 1 });
  const config = { virtual: { devices: [{ id: 'flag', name: 'Home/Away', type: 'switch' }] } };
  const client = new VirtualClient(config, store, fakeRegistry);

  await client.start();

  assert.equal(store.get('virtual/flag/value'), 1, 'persisted value must survive a restart');
});

test('virtual-client: seeds a default when nothing is persisted yet', async () => {
  const store = fakeStore();
  const config = { virtual: { devices: [{ id: 'flag', name: 'Home/Away', type: 'switch' }] } };
  const client = new VirtualClient(config, store, fakeRegistry);

  await client.start();

  assert.equal(store.get('virtual/flag/value'), 0, 'a fresh device should get a type default');
});

test('virtual-client: reseeds when the stored value type no longer matches the device type', async () => {
  // Round 2 fix (02ae0a9) — an id reused after being reconfigured to a
  // different type (e.g. a numeric sensor id reassigned to 'text') used to
  // keep inheriting its previous numeric value, since ids aren't guaranteed
  // unique outside the stock Settings UI flow.
  const store = fakeStore({ 'virtual/note/value': 42 }); // stale numeric leftover
  const config = { virtual: { devices: [{ id: 'note', name: 'Note', type: 'text' }] } };
  const client = new VirtualClient(config, store, fakeRegistry);

  await client.start();

  assert.equal(store.get('virtual/note/value'), '', 'type mismatch must trigger a reseed to the new type\'s default');
});

test('virtual-client: preserves a correctly-typed value across restarts', async () => {
  const store = fakeStore({ 'virtual/note/value': 'hello' });
  const config = { virtual: { devices: [{ id: 'note', name: 'Note', type: 'text' }] } };
  const client = new VirtualClient(config, store, fakeRegistry);

  await client.start();

  assert.equal(store.get('virtual/note/value'), 'hello', 'matching type must not be touched');
});
