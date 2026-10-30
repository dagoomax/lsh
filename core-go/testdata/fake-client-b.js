'use strict';

// Second test integration, to share a group process with fake-client.js.
class FakeClientB {
  constructor(config, store, registry) { this.store = store; this.registry = registry; }
  async start() {
    this.registry.registerDevice({
      key: 'fakeb/1', label: 'Fake B', type: 'fakeb',
      sensors: [{ path: 'on', name: 'On', type: 'toggle', controllable: true, capabilityId: 'switch', writeOn: 'on', writeOff: 'off' }],
      _writeCapability: async (cap, cmd) => { this.store.set('fakeb/1/on', cmd === 'on'); },
    });
  }
  whoami() { return 'b'; }
  stop() {}
}

module.exports = FakeClientB;
