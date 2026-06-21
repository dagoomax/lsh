'use strict';

/**
 * IKEA Tradfri gateway client.
 *
 * Uses the community node-tradfri-client package (CoAP/DTLS).
 * Install: npm install node-tradfri-client
 *
 * First-time setup: provide securityCode (from sticker on gateway) in config.
 * The client will print generated identity/psk credentials to the console —
 * copy those into config and remove securityCode for subsequent restarts.
 *
 * Config:
 *   "tradfri": {
 *     "host": "192.168.x.x",
 *     "securityCode": "XXXX-XXXX-XXXX",  ← one-time only
 *     "identity": "...",                  ← generated on first run
 *     "psk": "..."                        ← generated on first run
 *   }
 */

const platformStatus = require('./platform-status');

let TradfriClient, AccessoryTypes;
try {
  ({ TradfriClient, AccessoryTypes } = require('node-tradfri-client'));
} catch {
  TradfriClient   = null;
  AccessoryTypes  = null;
}

// node-tradfri-client AccessoryTypes enum
const TYPE_LIGHT  = 2;
const TYPE_PLUG   = 3;
const TYPE_BLIND  = 4;
const TYPE_SENSOR = 7;

class TradfriWrapper {
  constructor(config, store, sensorRegistry) {
    this._cfg      = config.tradfri;
    this._store    = store;
    this._registry = sensorRegistry;
    this._client   = null;
    this._known    = new Map(); // instanceId → { key, type }
  }

  async start() {
    if (!TradfriClient) {
      throw new Error('node-tradfri-client is not installed. Run: npm install node-tradfri-client');
    }

    const { host, securityCode, identity, psk } = this._cfg;
    if (!host) throw new Error('Tradfri: host is required');

    const client = new TradfriClient(host);

    let creds;
    if (identity && psk) {
      creds = { identity, psk };
    } else if (securityCode) {
      creds = await client.authenticate(securityCode);
      console.log('[Tradfri] Credentials generated — add to config and remove securityCode:');
      console.log(`[Tradfri]   "identity": "${creds.identity}", "psk": "${creds.psk}"`);
    } else {
      throw new Error('Tradfri: provide securityCode (first run) or identity+psk (subsequent runs)');
    }

    await client.connect(creds.identity, creds.psk);
    this._client = client;

    client.on('device updated', (acc) => this._onUpdate(acc));
    client.on('device removed', (id)  => this._known.delete(id));

    await client.observeDevices();
    platformStatus.set('tradfri', true);
    console.log('[Tradfri] Connected — observing devices');
  }

  stop() {
    if (this._client) try { this._client.destroy(); } catch {}
    platformStatus.set('tradfri', false);
  }

  // ── Device update handler ────────────────────────────────────────────────

  _onUpdate(acc) {
    const { instanceId, type, name } = acc;
    const key = `tradfri/${instanceId}`;

    if (!this._known.has(instanceId)) {
      const { sensors, homekit } = this._schema(type, acc);
      if (sensors.length === 0) return;

      const device = {
        key, label: name, type: 'tradfri',
        icon:  this._icon(type),
        color: 'blue',
        sensors, homekit,
        _writeCapability: (capId, command, args = []) =>
          this._write(acc, type, capId, command, args),
      };

      this._known.set(instanceId, { key, type });
      this._registry.registerDevice(device);
    }

    this._applyState(key, type, acc);
  }

  // ── Sensor schema ────────────────────────────────────────────────────────

  _schema(type, acc) {
    const sensors = [];
    const homekit = [];
    const add = (path, name, format, hk, extra = {}) => {
      if (hk && !homekit.includes(hk)) homekit.push(hk);
      sensors.push({ path, name, format, ...(hk ? { homekit: hk } : {}), ...extra });
    };

    const light  = acc.lightList?.[0];
    const plug   = acc.plugList?.[0];
    const blind  = acc.blindList?.[0];
    const sensor = acc.sensorList?.[0];

    if (type === TYPE_LIGHT && light) {
      add('switch', 'Power', 'on-off', 'light-rw',
        { controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch' });
      if (light.dimmer != null) add('level', 'Brightness', 'percent');
      if (light.colorTemperature != null) add('colorTemperature', 'Color Temp', 'number');
      if (light.color) {
        add('hue',        'Hue',        'number', null, { hidden: true });
        add('saturation', 'Saturation', 'number', null, { hidden: true });
      }
    } else if (type === TYPE_PLUG && plug) {
      add('switch', 'Power', 'on-off', 'switch-rw',
        { controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'switch' });
    } else if (type === TYPE_BLIND && blind) {
      add('windowShade', 'Blinds', 'on-off', 'cover-rw',
        { controllable: true, type: 'toggle', writeOn: 'open', writeOff: 'close', capabilityId: 'windowShade' });
      add('level', 'Position', 'percent');
    } else if (type === TYPE_SENSOR && sensor) {
      add('motion', 'Motion', 'on-off', 'motion');
    }

    if (acc.alive === true || acc.battery != null) {
      if (acc.battery != null) add('battery', 'Battery', 'percent', 'battery-level');
    }

    return { sensors, homekit };
  }

  _icon(type) {
    return { [TYPE_LIGHT]: '💡', [TYPE_PLUG]: '🔌', [TYPE_BLIND]: '🪟', [TYPE_SENSOR]: '👁' }[type] || '📟';
  }

  // ── State application ────────────────────────────────────────────────────

  _applyState(key, type, acc) {
    const light = acc.lightList?.[0];
    const plug  = acc.plugList?.[0];
    const blind = acc.blindList?.[0];

    if (type === TYPE_LIGHT && light) {
      this._store.update(`${key}/switch`, light.onOff ? 1 : 0);
      if (light.dimmer != null) this._store.update(`${key}/level`, light.dimmer);
      if (light.colorTemperature != null) {
        // Tradfri colorTemperature: 0 (warm) – 100 (cool) — convert to Kelvin
        const k = Math.round(2202 + light.colorTemperature * 40); // ~2200K–6200K
        this._store.update(`${key}/colorTemperature`, k);
      }
      if (light.color) {
        // node-tradfri-client exposes hue/saturation via .color.hue/.saturation
        // Values are already 0-100 range
        const h = light.color.hue ?? 0;
        const s = light.color.saturation ?? 0;
        this._store.update(`${key}/hue`, h);
        this._store.update(`${key}/saturation`, s);
      }
    } else if (type === TYPE_PLUG && plug) {
      this._store.update(`${key}/switch`, plug.onOff ? 1 : 0);
    } else if (type === TYPE_BLIND && blind) {
      const pos = blind.position ?? 0;
      this._store.update(`${key}/level`, pos);
      this._store.update(`${key}/windowShade`, pos >= 50 ? 1 : 0);
    }

    if (acc.battery != null) this._store.update(`${key}/battery`, acc.battery);
  }

  // ── Write (HomeKit → Tradfri API) ────────────────────────────────────────

  async _write(acc, type, capId, command, args) {
    try {
      if (type === TYPE_LIGHT) {
        const patch = {};
        if (capId === 'switch') {
          patch.onOff = command === 'on';
        } else if (capId === 'switchLevel') {
          patch.dimmer = args[0];
        } else if (capId === 'colorControl') {
          const { hue, saturation } = args[0] || {};
          if (hue        != null) patch.hue        = hue;
          if (saturation != null) patch.saturation = saturation;
        } else if (capId === 'colorTemperature') {
          // Convert Kelvin back to Tradfri 0-100 scale
          patch.colorTemperature = Math.round(Math.max(0, Math.min(100, (args[0] - 2202) / 40)));
        }
        if (Object.keys(patch).length) await this._client.operateLight(acc, patch, true);
      } else if (type === TYPE_PLUG) {
        if (capId === 'switch') {
          await this._client.operatePlug(acc, { onOff: command === 'on' }, true);
        }
      } else if (type === TYPE_BLIND) {
        if (capId === 'windowShade') {
          const pos = command === 'open' ? 100 : command === 'close' ? 0 : args[0];
          await this._client.operateBlind(acc, { position: pos }, true);
        }
      }
    } catch (err) {
      console.error(`[Tradfri] Write failed for ${acc.name}: ${err.message}`);
    }
  }
}

module.exports = TradfriWrapper;
