'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

// An isolated, unpaired bridge on loopback — never the real HomeKit pairing
process.env.LSH_HAP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-hap-'));
let startHomekitBridge;
try { startHomekitBridge = require('../src/homekit-bridge') } catch { /* hap-nodejs not installed */ }

test('HomeKit exclusions: devices, whole types, scenes, relays — removed and added back live', { skip: !startHomekitBridge && 'needs hap-nodejs' }, async () => {
  const store = Object.assign(new EventEmitter(), { get: () => 21, getTimestamp: () => Date.now() });
  const registry = new EventEmitter();
  const devs = [
    { key: 'shelly/a', type: 'shelly', label: 'Garage temp', homekit: ['temperature'], sensors: [{ path: 'temp', homekit: 'temperature' }] },
    { key: 'shelly/b', type: 'shelly', label: 'Attic temp', homekit: ['temperature'], sensors: [{ path: 'temp', homekit: 'temperature' }] },
    { key: 'loxone/c', type: 'loxone', label: 'Hall temp', homekit: ['temperature'], sensors: [{ path: 'temp', homekit: 'temperature' }] },
  ];
  registry.getDevices = () => devs;
  const config = {
    homekit: { name: 'LSH test', pin: '031-45-154', port: 47990 + Math.floor(Math.random() * 9), username: 'CC:22:3D:E3:CE:A1', bind: '127.0.0.1', exclude: { devices: ['shelly/b'] } },
    relays: [{ index: 0, name: 'Relay 1' }],
    cameras: [],
  };
  const relayController = { getState: () => 0, setState: async () => {} };
  const automation = { scenes: [{ id: 's1', name: 'Movie' }], runScene: async () => {} };
  const pool = startHomekitBridge(config, store, relayController, registry, { automation });
  const keys = () => [...pool.byKey.keys()].sort();
  try {
    assert.deepEqual(keys(), ['device:loxone/c', 'device:shelly/a', 'relay:0', 'scene:s1'], 'excluded at start');

    // A device discovered later that's excluded stays out
    devs.push({ key: 'shelly/d', type: 'shelly', label: 'Late', homekit: ['temperature'], sensors: [{ path: 'temp', homekit: 'temperature' }] });
    config.homekit.exclude.devices.push('shelly/d');
    pool.applyExclude(config.homekit.exclude);
    assert.ok(!pool.has('device:shelly/d'));

    let r = pool.applyExclude({ types: ['shelly'], scenes: ['s1'], relays: ['0'] });
    assert.deepEqual(keys(), ['device:loxone/c']);
    assert.equal(r.removed, 3);
    assert.equal(pool.bridges[0]._count, 1);
    // a removed accessory takes its store listeners with it — only the hall
    // sensor still listens
    assert.equal(store.listenerCount('change'), 1);

    r = pool.applyExclude({});
    assert.deepEqual(keys(), ['device:loxone/c', 'device:shelly/a', 'device:shelly/b', 'device:shelly/d', 'relay:0', 'scene:s1']);
    assert.equal(r.added, 5);
    assert.equal(pool.bridges[0].bridgedAccessories.length, 6);
    assert.equal(store.listenerCount('change'), 5, 'four temperature sensors + the relay');

    // excluding and re-including again doesn't pile listeners up
    pool.applyExclude({ types: ['shelly'], scenes: ['s1'], relays: ['0'] });
    assert.equal(store.listenerCount('change'), 1);
    pool.applyExclude({});
    assert.equal(store.listenerCount('change'), 5);
  } finally {
    for (const b of pool.bridges) await b.unpublish().catch?.(() => {});
  }
});

after(() => setTimeout(() => process.exit(0), 300));
