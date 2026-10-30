'use strict';

// Test integration for the Go core's module host: registers one writable
// device, publishes a value, echoes store changes it hears and answers
// _writeCapability.
const platformStatus = require('../../src/platform-status');

class FakeClient {
  constructor(config, store, registry, automation) {
    this.store = store;
    this.registry = registry;
    this.automation = automation;
  }
  async start() {
    const device = {
      key: 'fake/1', label: 'Fake lamp', icon: '💡', type: 'fake',
      sensors: [
        { path: 'on', name: 'On', type: 'toggle', controllable: true, capabilityId: 'switch', writeOn: 'on', writeOff: 'off' },
        { path: 'level', name: 'Level', type: 'range', controllable: true, capabilityId: 'level', writeCmd: 'setLevel' },
      ],
      _writeCapability: async (cap, cmd, args) => {
        if (cap === 'switch') this.store.set('fake/1/on', cmd === 'on');
        if (cap === 'level') this.store.set('fake/1/level', args[0]);
        return { cap, cmd, args };
      },
    };
    this.registry.registerDevice(device);
    this.store.set('fake/1/level', 42);
    this.store.on('change', ({ key, value }) => {
      if (key === 'test/ping') this.store.set('fake/1/echo', value);
    });
    platformStatus.set('fake', true);
  }
  // automation stand-in + camera events, as object detection uses them
  reportCamera() {
    require('../../src/camera-log').push('Wejście', 'motion', 'person');
    require('../../src/detection-boxes').set('Wejście', [{ class: 'person', score: 0.9, bbox: [1, 2, 3, 4] }], 640, 480);
    this.automation.notify('warning', 'Person at the door', 'fake');
    const had = this.automation.flows.length;
    this.automation.saveFlow({ id: 'fake-auto', name: 'Auto flow from fake', enabled: false, nodes: [] });
    return { had, now: this.automation.flows.length };
  }
  // public methods reached through the module channel's 'call'
  async getToken() { return 'tok-123'; }
  handleWebhookEvent(payload) {
    if (!payload?.deviceId) throw new Error('bad payload');
    this.store.set(`fake/1/${payload.attribute}`, payload.value);
  }
  _secret() { return 'never'; }
  stop() {}
}

module.exports = FakeClient;
