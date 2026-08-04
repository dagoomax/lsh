'use strict';

const platformStatus = require('./platform-status');

/**
 * Virtual devices — switches, dimmers, sensors, text values, and buttons
 * that don't correspond to any real hardware. Useful for automation flags
 * ("Home/Away"), manual overrides, or as a landing spot for values pushed in
 * from an external script/webhook (weather API → a virtual temperature
 * sensor, etc.) via the normal GET/POST /api/device/<key>/set endpoints —
 * same mechanism every other integration in this file uses, just with no
 * real device on the other end of the write.
 *
 * config.virtual.devices[]: { id, name, type, unit? }
 *   type: 'switch' | 'dimmer' | 'sensor' | 'text' | 'button'
 *   unit: only meaningful for 'sensor' (e.g. '°C', '%', 'lux')
 *
 * No polling loop — this is entirely push-driven (the store only changes
 * when something writes to it), so "start" just registers the devices and
 * seeds an initial value so the dashboard doesn't show blank/undefined.
 */
class VirtualClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._pulseTimers = new Map(); // button id → pending reset-to-0 timeout
  }

  async start() {
    const devices = this._config.virtual?.devices || [];
    if (!devices.length) return;

    for (const d of devices) this._registerDevice(d);
    platformStatus.set('virtual', true);
    console.log(`[Virtual] Started — ${devices.length} virtual device(s)`);
  }

  stop() {
    for (const t of this._pulseTimers.values()) clearTimeout(t);
    this._pulseTimers.clear();
  }

  _registerDevice(d) {
    const key = `virtual/${d.id}`;
    const sensor = this._sensorDescriptor(d);
    if (!sensor) return;

    this._registry.registerDevice({
      key, label: d.name || d.id, type: 'virtual', icon: '🧩', homekit: [],
      sensors: [sensor],
      _writeCapability: (capId, command, args = []) => this._write(key, d.type, command, args),
    });

    // Seed an initial value so the tile doesn't show blank before the first
    // real write. Switch/button start off; dimmer/sensor start at 0; text
    // starts empty — all sensible "nothing has happened yet" defaults.
    if (d.type === 'switch' || d.type === 'button') this._store.update(`${key}/value`, 0);
    else if (d.type === 'dimmer' || d.type === 'sensor') this._store.update(`${key}/value`, 0);
    else if (d.type === 'text') this._store.update(`${key}/value`, '');
  }

  _sensorDescriptor(d) {
    switch (d.type) {
      case 'switch':
        return { path: 'value', name: 'Switch', type: 'boolean', format: 'on-off',
          controllable: true, capabilityId: 'value', writeOn: 'on', writeOff: 'off' };
      case 'dimmer':
        return { path: 'value', name: 'Level', type: 'range', unit: '%',
          controllable: true, capabilityId: 'value', writeCmd: 'set', min: 0, max: 100 };
      case 'sensor':
        return { path: 'value', name: 'Value', type: 'range', unit: d.unit || '',
          controllable: true, capabilityId: 'value', writeCmd: 'set', min: -1000, max: 1000 };
      case 'text':
        return { path: 'value', name: 'Text', type: 'text',
          controllable: true, capabilityId: 'value', writeCmd: 'set' };
      case 'button':
        return { path: 'value', name: 'Trigger', type: 'trigger',
          controllable: true, capabilityId: 'value', writeOn: 'on' };
      default:
        return null;
    }
  }

  _write(key, type, command, args) {
    if (type === 'switch') {
      this._store.update(`${key}/value`, command === 'on' ? 1 : 0);
      return;
    }
    if (type === 'dimmer' || type === 'sensor') {
      const n = Number(args[0]);
      if (!isNaN(n)) this._store.update(`${key}/value`, n);
      return;
    }
    if (type === 'text') {
      this._store.update(`${key}/value`, String(args[0] ?? ''));
      return;
    }
    if (type === 'button') {
      // Momentary pulse, same pattern as the SIP doorbell ring / UniFi ring.
      this._store.update(`${key}/value`, 1);
      clearTimeout(this._pulseTimers.get(key));
      this._pulseTimers.set(key, setTimeout(() => this._store.update(`${key}/value`, 0), 800));
    }
  }
}

module.exports = VirtualClient;
