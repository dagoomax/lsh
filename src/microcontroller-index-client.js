'use strict';

const platformStatus = require('./platform-status');

/**
 * Microcontroller index — an estimate of how many embedded microcontrollers
 * live on the network, derived from the devices LSH has in its registry that
 * the user has marked permanent (device edit panel → "Permanent", persisted
 * as the `permanent` override in persist/device-overrides.json).
 *
 * It's an estimate, not a scan: each permanent device counts as the number of
 * MCUs typical for its device `type` (a relay is one chip, a camera or a
 * smart lock usually carries a couple). Registry devices only — nothing on
 * the LAN that has no LSH integration is counted.
 *
 * cfg = config.microcontrollerIndex, an optional object:
 *   { pollInterval?: seconds (default 60, min 5),
 *     name?: device label,
 *     defaultPerDevice?: MCUs for a type without an entry (default 1),
 *     perType?: { <device type>: MCUs per device } merged over the defaults }
 * Enabled by default; set config.microcontrollerIndex to false to disable.
 */
const DEFAULT_POLL_S = 60;
const MIN_POLL_S     = 5;

// MCUs per device, keyed by the registry device `type`. Rough guesses — tune
// them in config.microcontrollerIndex.perType.
const DEFAULT_PER_TYPE = {
  shelly: 1,
  esphome: 1,
  wled: 1,
  tuya: 1,
  camera: 2,
  yale: 2,
  lock: 2,
  hue: 2,
  tradfri: 1,
  sonos: 3,
  router: 3,
};

class MicrocontrollerIndexClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._timer    = null;
    this._key      = 'system/microcontrollers';
    this._onChange = () => this._update();
  }

  async start() {
    if (this._config.microcontrollerIndex === false) return;
    const cfg = (this._config.microcontrollerIndex && typeof this._config.microcontrollerIndex === 'object')
      ? this._config.microcontrollerIndex : {};

    this._perType = { ...DEFAULT_PER_TYPE, ...(cfg.perType || {}) };
    this._default = Number.isFinite(Number(cfg.defaultPerDevice)) ? Number(cfg.defaultPerDevice) : 1;

    this._registry.registerDevice({
      key: this._key,
      label: cfg.name || 'Microcontroller index',
      type: 'mcu-index',
      icon: '🔬',
      sensors: [
        { path: 'total',     name: 'Microcontrollers',  type: 'number', precision: 0 },
        { path: 'devices',   name: 'Permanent devices', type: 'number', precision: 0 },
        // JSON object { <device type>: { devices, mcus } } for the dashboard breakdown
        { path: 'breakdown', name: 'Breakdown',         type: 'string' },
      ],
    });

    // Flagging a device permanent fires devices-changed, so the index follows
    // the toggle immediately; the timer only picks up newly discovered devices.
    this._registry.on('devices-changed', this._onChange);
    this._registry.on('device-discovered', this._onChange);
    const interval = Math.max(Number(cfg.pollInterval) || DEFAULT_POLL_S, MIN_POLL_S) * 1000;
    this._timer = setInterval(() => this._update(), interval);
    this._update();
    console.log(`[McuIndex] Started — every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    this._registry.off('devices-changed', this._onChange);
    this._registry.off('device-discovered', this._onChange);
  }

  _update() {
    try {
      const byType = {};
      let devices = 0, total = 0;
      for (const d of this._registry.getDevices()) {
        if (!d.permanent || d.key === this._key) continue;
        const mcus = this._perType[d.type] ?? this._default;
        const t = (byType[d.type || 'unknown'] ||= { devices: 0, mcus: 0 });
        t.devices += 1;
        t.mcus += mcus;
        devices += 1;
        total += mcus;
      }
      this._store.update(`${this._key}/total`, total);
      this._store.update(`${this._key}/devices`, devices);
      this._store.update(`${this._key}/breakdown`, JSON.stringify(byType));
      platformStatus.set('microcontrollerIndex', true);
    } catch (err) {
      console.error(`[McuIndex] Update failed: ${err.message}`);
      platformStatus.set('microcontrollerIndex', false);
    }
  }
}

module.exports = MicrocontrollerIndexClient;
