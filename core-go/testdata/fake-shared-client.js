'use strict';

// Test integration for the Go core's module host, standing in for an `expose`
// client (like grenton-vclu-client): it does NOT register the device it works
// with — it reads and commands `fake/1`, which another module owns. On the Go
// core that only works if the host mirrors the catalog + store into this
// worker and bridges sendCommand back to the real registry.
const platformStatus = require('../../src/platform-status');

class FakeSharedClient {
  constructor(config, store, registry) {
    this.store = store;
    this.registry = registry;
  }
  async start() {
    platformStatus.set('fakeShared', true);
  }
  // keys visible through the (mirrored) shared registry
  seenKeys() { return this.registry.getDevices().map((d) => d.key).sort(); }
  // a live reading of a device this client did not register
  readForeign(key, path) { return this.registry.getDeviceReadings(key)?.readings?.[path]?.value ?? null; }
  // command another module's device; resolves via the host's real registry
  async cmdForeign(key, path, value) { return this.registry.sendCommand(key, path, value); }
  stop() {}
}

module.exports = FakeSharedClient;
