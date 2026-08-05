'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dedupeVirtualDevices } = require('../src/api-routes');

test('api-routes: dedupes colliding device ids within a single save', () => {
  // Round 2 fix (02ae0a9) — POST /settings/virtual accepted a device list
  // without checking for id collisions within the same save; two devices
  // sharing a store key would silently overwrite each other's value.
  const devices = [
    { id: 'flag', name: 'Home/Away', type: 'switch' },
    { id: 'flag', name: 'Garage Light', type: 'switch' }, // colliding id
  ];

  const cleaned = dedupeVirtualDevices(devices);

  assert.equal(cleaned.length, 2);
  const ids = cleaned.map((d) => d.id);
  assert.equal(new Set(ids).size, 2, 'no two devices may share an id after a save');
});

test('api-routes: mints an id when none is supplied', () => {
  const cleaned = dedupeVirtualDevices([{ name: 'Unnamed', type: 'sensor' }]);
  assert.equal(cleaned.length, 1);
  assert.ok(cleaned[0].id, 'a device with no id must still get one');
});

test('api-routes: drops devices with no name and normalizes unknown types', () => {
  const cleaned = dedupeVirtualDevices([
    { id: 'a', name: '', type: 'switch' },
    { id: 'b', name: 'Weird', type: 'not-a-real-type' },
  ]);
  assert.equal(cleaned.length, 1, 'unnamed devices must be filtered out');
  assert.equal(cleaned[0].type, 'switch', 'an unrecognized type falls back to switch');
});
