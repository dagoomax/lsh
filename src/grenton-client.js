'use strict';

const http           = require('http');
const platformStatus = require('./platform-status');

// Grenton smart home (CLU controllers) via the GATE HTTP module.
// LSH talks to a single HttpListener on the GATE running the companion Lua
// script (docs/grenton-gate-lsh.lua): POST {cmd:'status'|'set'|'exec'} JSON.
// Grenton objects are addressed by their Object Manager names (e.g. DOU8272);
// devices are declared in config.grenton.devices — there is no discovery API.
//
// config.grenton = {
//   host: '192.168.1.x', port: 80, path: '/lsh', token: '', pollInterval: 5,
//   devices: [
//     { name: 'Lampa salon', object: 'DOU8272', type: 'light' },
//     { name: 'Ściemniacz',  object: 'DIM1234', type: 'dimmer', scale: 1 },
//     { name: 'Roleta',      object: 'ROL4321', type: 'blind',
//       commands: { up: 'ROL4321:execute(0,0)', down: 'ROL4321:execute(1,0)', stop: 'ROL4321:execute(3,0)' } },
//     { name: 'Temp. salon', object: 'PANELSENSTEMP1', type: 'temperature' },
//   ],
// }

const TYPE_ICONS = { light: '💡', dimmer: '💡', switch: '🔌', blind: '🪟', temperature: '🌡️', sensor: '📟' };

class GrentonClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._devices  = [];   // [{ cfg, deviceKey }]
    this._timer    = null;
  }

  async start() {
    const cfg = this._config.grenton || {};
    if (!cfg.host || !Array.isArray(cfg.devices) || !cfg.devices.length) {
      console.log('[Grenton] No host/devices configured');
      return;
    }

    for (const d of cfg.devices) {
      if (!d.object) continue;
      this._register(d);
    }

    try {
      await this._poll();
      platformStatus.set('grenton', true);
    } catch (err) {
      platformStatus.set('grenton', false);
      console.error(`[Grenton] First poll failed: ${err.message}`);
    }
    const ms = Math.max(2, cfg.pollInterval || 5) * 1000;
    this._timer = setInterval(() => this._poll().then(
      () => platformStatus.set('grenton', true),
      (err) => { platformStatus.set('grenton', false); console.error(`[Grenton] Poll failed: ${err.message}`); }
    ), ms);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  // ── Registration ─────────────────────────────────────────────────────────

  _register(d) {
    const type      = d.type || 'switch';
    const deviceKey = `grenton/${d.object}`;
    const sensors   = [];

    if (type === 'light' || type === 'switch' || type === 'dimmer') {
      sensors.push({
        path: 'switch', label: type === 'switch' ? 'Switch' : 'Light', format: 'on-off',
        sensorType: type === 'switch' ? 'switch' : 'dimmer',
        controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off',
        capabilityId: 'switch', homekit: 'switch-rw',
      });
    }
    if (type === 'dimmer') {
      sensors.push({
        path: 'level', label: 'Brightness', format: 'percent', sensorType: 'dimmer',
        controllable: true, type: 'range',
        writeCmd: 'setLevel', capabilityId: 'level',
        min: 0, max: 100, rangeFormat: 'percent',
      });
    }
    if (type === 'blind') {
      sensors.push({
        path: 'level', label: 'Position', format: 'percent', sensorType: 'sensor',
        controllable: true, type: 'range',
        writeCmd: 'setLevel', capabilityId: 'level',
        min: 0, max: 100, rangeFormat: 'percent',
      });
      for (const dir of ['up', 'down', 'stop']) {
        if (!d.commands?.[dir]) continue;
        sensors.push({
          path: dir, label: dir[0].toUpperCase() + dir.slice(1), format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: dir, writeOff: dir,
          capabilityId: 'command', homekit: null,
        });
      }
    }
    if (type === 'temperature') {
      sensors.push({ path: 'value', label: 'Temperature', sensorType: 'temperature',
        unit: d.unit || '°C', homekit: 'temperature' });
    }
    if (type === 'sensor') {
      sensors.push({ path: 'value', label: d.label || 'Value', sensorType: 'sensor', unit: d.unit || '' });
    }

    this._registry.registerDevice({
      key:   deviceKey,
      label: d.name || d.object,
      type:  'grenton',
      icon:  d.icon || TYPE_ICONS[type] || '🏠',
      sensors,
      homekit: sensors.map((s) => s.homekit).filter(Boolean),
      _writeCapability: (capId, command, args) => this._write(d, capId, command, args),
    });
    this._devices.push({ cfg: d, deviceKey, type });
    console.log(`[Grenton] Registered ${d.name || d.object} (${type})`);
  }

  // ── State polling ────────────────────────────────────────────────────────

  async _poll() {
    if (!this._devices.length) return;
    const objects = this._devices.map(({ cfg }) =>
      `${cfg.object}:${cfg.getIndex ?? 0}`);
    const res = await this._req({ cmd: 'status', objects });
    for (const { cfg, deviceKey, type } of this._devices) {
      const raw = res?.[`${cfg.object}:${cfg.getIndex ?? 0}`];
      if (raw === undefined || raw === null) continue;
      const scale = cfg.scale ?? (type === 'dimmer' ? 1 : 100);
      if (type === 'light' || type === 'switch') {
        this._store.set(`${deviceKey}/switch`, raw === 1 || raw === true || raw > 0);
      } else if (type === 'dimmer') {
        const pct = Math.round((Number(raw) / scale) * 100);
        this._store.set(`${deviceKey}/level`, pct);
        this._store.set(`${deviceKey}/switch`, pct > 0);
      } else if (type === 'blind') {
        this._store.set(`${deviceKey}/level`, Math.round((Number(raw) / scale) * 100));
      } else {
        this._store.set(`${deviceKey}/value`, Number(raw));
      }
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  async _write(d, capId, command, args) {
    const type  = d.type || 'switch';
    const idx   = d.setIndex ?? 0;
    const scale = d.scale ?? (type === 'dimmer' ? 1 : 100);

    if (capId === 'switch') {
      await this._req({ cmd: 'set', object: d.object, index: idx, value: command === 'on' ? 1 : 0 });
    } else if (capId === 'level') {
      const v = (Math.round(args?.[0] ?? 0) / 100) * scale;
      await this._req({ cmd: 'set', object: d.object, index: idx, value: v });
    } else if (capId === 'command') {
      const code = d.commands?.[command];
      if (code) await this._req({ cmd: 'exec', code });
    }
    // re-read quickly so the UI reflects the change before the next poll tick
    setTimeout(() => this._poll().catch(() => {}), 800);
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  _req(payload) {
    const cfg  = this._config.grenton;
    const body = JSON.stringify({ ...payload, ...(cfg.token ? { token: cfg.token } : {}) });
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: cfg.host,
        port:     cfg.port || 80,
        path:     cfg.path || '/lsh',
        method:   'POST',
        timeout:  6000,
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`GATE HTTP ${res.statusCode}: ${data.slice(0, 120)}`));
          try { resolve(data ? JSON.parse(data) : null); }
          catch { reject(new Error('Non-JSON response from GATE — is the LSH listener script installed?')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = GrentonClient;
