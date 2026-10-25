'use strict';

// Stand-in integration for test/module-host.test.js — runs inside
// src/module-worker.js like a real client.
const platformStatus = require('../../src/platform-status');

module.exports = class FakeClient {
  constructor(config, store, sensorRegistry) {
    this.store = store;
    this.registry = sensorRegistry;
  }
  async start() {
    const device = {
      key: 'fake/1', label: 'Fake', icon: 'switch',
      sensors: [{ path: 'switch', type: 'toggle', controllable: true, capabilityId: 'sw', writeOn: 'on', writeOff: 'off' }],
      _writeCapability: async (cap, cmd) => {
        if (cmd === 'crash') setImmediate(() => { throw new Error('boom'); });
        this.store.set('fake/1/switch', cmd === 'on' ? 1 : 0);
        return { pid: process.pid };
      },
    };
    this.registry.registerDevice(device);
    this.store.set('fake/1/switch', 0);
    platformStatus.set('fake', true);
    // echo values the server sets on fake/in/* back to fake/out/*
    this.store.on('change', ({ key, value }) => {
      if (key.startsWith('fake/in/')) this.store.set(`fake/out/${key.slice(8)}`, value);
    });
  }
  stop() {}
};
