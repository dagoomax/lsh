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
 * smart lock usually carries a couple). Three sources are added up:
 *   - registry devices flagged permanent;
 *   - BLE devices LSH itself reads (type 'lshble', configured in
 *     config.lshBle — always permanent by definition);
 *   - Zigbee and BLE devices that live in Home Assistant, counted per
 *     physical *device* through HA's template API (integration_entities +
 *     device_id), because LSH's registry holds one entry per HA *entity*
 *     and would count a single sensor several times. HA entries in the
 *     registry are therefore skipped. Needs config.homeassistant {url, token}.
 * Nothing on the LAN that has no integration is counted, and BLE devices that
 * merely advertise nearby (phones, trackers) are not.
 *
 * cfg = config.microcontrollerIndex, an optional object:
 *   { pollInterval?: seconds (default 60, min 5),
 *     name?: device label,
 *     defaultPerDevice?: MCUs for a type without an entry (default 1),
 *     perType?: { <device type | 'zigbee' | 'ble'>: MCUs per device } merged over the defaults }
 * Enabled by default; set config.microcontrollerIndex to false to disable.
 */
const DEFAULT_POLL_S = 60;
const MIN_POLL_S     = 5;

// MCUs per device, keyed by the registry device `type`. Rough guesses — tune
// them in config.microcontrollerIndex.perType.
// Home Assistant integrations whose devices are Zigbee / BLE radios.
const HA_ZIGBEE = ['zha', 'deconz', 'hue', 'ikea_tradfri'];
const HA_BLE = ['bluetooth', 'xiaomi_ble', 'govee_ble', 'bthome', 'switchbot', 'ruuvi_ble', 'inkbird',
  'qingping', 'sensorpush', 'oralb', 'thermopro', 'bluemaestro', 'moat', 'ibeacon', 'led_ble'];
const HA_TIMEOUT_MS = 8000;

const DEFAULT_PER_TYPE = {
  zigbee: 1,
  ble: 1,
  lshble: 1,
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
    this._ha       = { zigbee: {}, ble: {} }; // HA device counts per integration, from the last poll
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
        { path: 'zigbee',    name: 'Zigbee devices',    type: 'number', precision: 0 },
        { path: 'ble',       name: 'BLE devices',       type: 'number', precision: 0 },
        // JSON object { <device type>: { devices, mcus } } for the dashboard breakdown
        { path: 'breakdown', name: 'Breakdown',         type: 'string' },
      ],
    });

    // Flagging a device permanent fires devices-changed, so the index follows
    // the toggle immediately; the timer only picks up newly discovered devices.
    this._registry.on('devices-changed', this._onChange);
    this._registry.on('device-discovered', this._onChange);
    const interval = Math.max(Number(cfg.pollInterval) || DEFAULT_POLL_S, MIN_POLL_S) * 1000;
    this._timer = setInterval(() => this._poll(), interval);
    this._poll();
    console.log(`[McuIndex] Started — every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    this._registry.off('devices-changed', this._onChange);
    this._registry.off('device-discovered', this._onChange);
  }

  // Device count per integration from Home Assistant, for the given integration
  // domains. One template call; integrations with no devices are omitted.
  async _haCounts(domains) {
    const ha = this._config.homeassistant || {};
    const base = String(ha.url || '').replace(/\/$/, '');
    if (!base || !ha.token) return {};
    const template = `{% set ns = namespace(l=[]) %}{% for i in ${JSON.stringify(domains)} %}`
      + `{% set n = integration_entities(i) | map('device_id') | select('string') | unique | list | count %}`
      + `{% if n > 0 %}{% set ns.l = ns.l + [[i, n]] %}{% endif %}{% endfor %}{{ ns.l | tojson }}`;
    const res = await fetch(`${base}/api/template`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ha.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ template }),
      signal: AbortSignal.timeout(HA_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Object.fromEntries(JSON.parse(await res.text()));
  }

  async _poll() {
    try {
      const counts = await this._haCounts([...HA_ZIGBEE, ...HA_BLE]);
      this._ha = {
        zigbee: Object.fromEntries(HA_ZIGBEE.filter((i) => counts[i]).map((i) => [i, counts[i]])),
        ble:    Object.fromEntries(HA_BLE.filter((i) => counts[i]).map((i) => [i, counts[i]])),
      };
    } catch (err) {
      // Keep the last known HA counts; the registry part still updates.
      console.error(`[McuIndex] Home Assistant query failed: ${err.message}`);
    }
    this._update();
  }

  _update() {
    try {
      const byType = {};
      let devices = 0, total = 0, zigbee = 0, ble = 0;
      const add = (name, group, count, perDevice) => {
        if (!count) return;
        const t = (byType[name] ||= { devices: 0, mcus: 0 });
        t.devices += count;
        t.mcus += count * perDevice;
        devices += count;
        total += count * perDevice;
        if (group === 'zigbee') zigbee += count;
        if (group === 'ble') ble += count;
      };
      const counts = {};
      for (const d of this._registry.getDevices()) {
        if (d.key === this._key || d.type === 'homeassistant') continue;
        if (!d.permanent && d.type !== 'lshble') continue;
        counts[d.type || 'unknown'] = (counts[d.type || 'unknown'] || 0) + 1;
      }
      for (const [type, n] of Object.entries(counts)) {
        add(type, type === 'lshble' ? 'ble' : null, n, this._perType[type] ?? this._default);
      }
      for (const [integ, n] of Object.entries(this._ha.zigbee)) add(`zigbee · ${integ}`, 'zigbee', n, this._perType.zigbee ?? this._default);
      for (const [integ, n] of Object.entries(this._ha.ble))    add(`ble · ${integ}`,    'ble',    n, this._perType.ble ?? this._default);
      this._store.update(`${this._key}/total`, total);
      this._store.update(`${this._key}/devices`, devices);
      this._store.update(`${this._key}/zigbee`, zigbee);
      this._store.update(`${this._key}/ble`, ble);
      this._store.update(`${this._key}/breakdown`, JSON.stringify(byType));
      platformStatus.set('microcontrollerIndex', true);
    } catch (err) {
      console.error(`[McuIndex] Update failed: ${err.message}`);
      platformStatus.set('microcontrollerIndex', false);
    }
  }
}

module.exports = MicrocontrollerIndexClient;
