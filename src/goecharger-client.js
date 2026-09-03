'use strict';

// go-eCharger — local-only integration, no cloud account needed. Talks to the
// charger's own HTTP API (v2, documented at https://github.com/goecharger/go-eCharger-API-v2)
// over the LAN. Field mapping below follows that spec; go-e's own community
// has reshuffled the `nrg` array indices across firmware revisions in the
// past, so this reads defensively (falls back to null rather than throwing).

const http           = require('http');
const platformStatus = require('./platform-status');

// go-e "car" status enum (API v2): 1=idle/unplugged, 2=charging,
// 3=WaitCar (plugged, paused), 4=complete, 5=error.
const CAR_STATUS = { 1: 'available', 2: 'charging', 3: 'connected', 4: 'complete', 5: 'error' };

class GoEChargerClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._meta     = {}; // host → { deviceKey, ampMin, ampMax }
    this._timer    = null;
  }

  async start() {
    const devices = this._config.goecharger?.devices || [];
    if (!devices.length) return;

    for (const cfg of devices) {
      await this._initDevice(cfg).catch(err =>
        console.error(`[go-eCharger] Init failed for ${cfg.host}: ${err.message}`)
      );
    }

    if (Object.keys(this._meta).length) platformStatus.set('goecharger', true);
    this._timer = setInterval(() => this._pollAll(), 10000);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  async _initDevice(cfg) {
    const { host, name, ampMin = 6, ampMax = 32 } = cfg;
    const status = await this._get(host, '/api/status');

    const deviceKey = `goecharger/${host.replace(/\./g, '_')}`;
    this._meta[host] = { deviceKey, ampMin, ampMax };

    const device = {
      key:      deviceKey,
      label:    name || status.name || `go-eCharger ${host}`,
      type:     'goecharger',
      category: 'ev-charger',
      sensors: [
        { path: 'power',  label: 'Power',  sensorType: 'power',  unit: 'W' },
        { path: 'energy', label: 'Energy', sensorType: 'energy', unit: 'kWh' },
        { path: 'status', label: 'Status', sensorType: 'sensor' },
        {
          path: 'charging', label: 'Charging', sensorType: 'switch', format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: 'on', writeOff: 'off',
          capabilityId: 'charging', homekit: 'switch-rw',
        },
        {
          path: 'currentLimit', label: 'Charge current', sensorType: 'dimmer', unit: 'A',
          controllable: true, type: 'range',
          writeCmd: 'setCurrent', capabilityId: 'currentLimit',
          min: ampMin, max: ampMax, rangeFormat: 'raw',
        },
      ],
      homekit: ['switch-rw'],
      _writeCapability: async (capId, command, args = []) =>
        this._send(host, capId, command, args),
    };

    this._registry.registerDevice(device);
    this._applyStatus(host, status);
    console.log(`[go-eCharger] Registered ${device.label} (${host})`);
  }

  _applyStatus(host, status) {
    const { deviceKey } = this._meta[host];

    // nrg[11] is total active power in units of 0.1 kW per the v2 API spec.
    const nrg = Array.isArray(status.nrg) ? status.nrg : null;
    const powerW = nrg && nrg[11] != null ? nrg[11] * 100 : null;
    if (powerW != null) this._store.set(`${deviceKey}/power`, powerW);

    // "wh" = energy transferred since the car was plugged in, in Wh.
    if (status.wh != null) this._store.set(`${deviceKey}/energy`, status.wh / 1000);

    const carState = CAR_STATUS[status.car] || 'unknown';
    this._store.set(`${deviceKey}/status`, carState);
    this._store.set(`${deviceKey}/charging`, carState === 'charging');

    if (status.amp != null) this._store.set(`${deviceKey}/currentLimit`, Number(status.amp));
  }

  async _pollAll() {
    for (const [host, meta] of Object.entries(this._meta)) {
      try {
        const status = await this._get(host, '/api/status');
        this._applyStatus(host, status);
      } catch (err) {
        console.error(`[go-eCharger] Poll failed for ${host}: ${err.message}`);
      }
    }
  }

  // capId is always 'charging' or 'currentLimit' here (single charger per host).
  async _send(host, capId, command, args) {
    if (capId === 'charging') {
      // frc: 0=neutral (car/schedule decides), 1=force off, 2=force on.
      const frc = command === 'on' ? 2 : 1;
      await this._get(host, `/api/set?frc=${frc}`);
    } else if (capId === 'currentLimit') {
      const amp = Math.round(Number(args[0]));
      await this._get(host, `/api/set?amp=${amp}`);
    }
  }

  _get(host, path) {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: host, port: 80, path, timeout: 5000 }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error(`Non-JSON response from ${host}${path}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${host}`)); });
    });
  }
}

module.exports = GoEChargerClient;
