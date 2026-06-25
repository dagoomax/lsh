'use strict';

const https          = require('https');
const http           = require('http');
const platformStatus = require('./platform-status');

// Channel functions → kind
const SWITCH_FNS  = new Set(['LIGHTSWITCH','POWERSWITCH','STAIRCASETIMER']);
const DIMMER_FNS  = new Set(['DIMMER','RGBLIGHTING','DIMMERANDRGBLIGHTING']);
const SHUTTER_FNS = new Set(['CONTROLLINGTHEROLLERSHUTTER','CONTROLLINGTHEROOFWINDOW']);
const GATE_FNS    = new Set(['CONTROLLINGTHEGARAGEDOOR','CONTROLLINGTHEGATEWAY']);
const LOCK_FNS    = new Set(['CONTROLLINGTHEDOORLOCK']);
const BINARY_FNS  = new Set([
  'OPENCLOSESENSOR','NOLIQUIDCHSENSOR','HOTELCARDSENSOR',
  'ALARMARMAMENTSENSOR','MAILSENSOR','DOORBELL',
]);

class SuplaClient {
  constructor(config, store, sensorRegistry) {
    this._config         = config;
    this._store          = store;
    this._registry       = sensorRegistry;
    this._pollTimer      = null;
    this._stopping       = false;
    this._channelDevKey  = new Map(); // channelId → devKey
    this._channelFn      = new Map(); // channelId → functionName
  }

  async start() {
    try {
      await this._init();
      platformStatus.set('suppla', true);
      this._schedulePoll();
    } catch (err) {
      console.error(`[Suppla] Init failed: ${err.message}`);
      platformStatus.set('suppla', false);
      if (!this._stopping) this._pollTimer = setTimeout(() => this.start(), 30_000);
    }
  }

  stop() {
    this._stopping = true;
    clearTimeout(this._pollTimer);
    clearInterval(this._pollTimer);
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  async _init() {
    const channels = await this._api('GET',
      '/channels?include[]=state&include[]=iodevice&include[]=connected');

    // Group by ioDevice
    const byDevice = new Map();
    for (const ch of channels) {
      const devId   = ch.iodevice?.id || 0;
      const devName = ch.iodevice?.comment || ch.iodevice?.name || `Suppla Device ${devId}`;
      if (!byDevice.has(devId)) byDevice.set(devId, { name: devName, channels: [] });
      byDevice.get(devId).channels.push(ch);
    }

    for (const [devId, group] of byDevice) {
      const devKey  = `suppla/${devId}`;
      const sensors = [];
      const capMap  = new Map(); // capabilityId → { channelId, fn }

      for (const ch of group.channels) {
        const fn    = ch.functionName || '';
        const chId  = ch.id;
        const cap   = (ch.caption || '').trim() || fn.toLowerCase().replace(/_/g, ' ');

        const built = this._buildSensors(ch, cap);
        for (const s of built) {
          sensors.push(s);
          if (s.capabilityId) capMap.set(s.capabilityId, { channelId: chId, fn });
        }
        this._channelDevKey.set(chId, devKey);
        this._channelFn.set(chId, fn);
        this._applyState(devKey, ch);
      }

      if (!sensors.length) continue;

      this._registry.registerDevice({
        key:    devKey,
        label:  group.name,
        type:   'suppla',
        homekit: [],
        sensors,
        _writeCapability: (capId, command, args) => {
          const entry = capMap.get(capId);
          if (!entry) return;
          return this._executeCommand(entry.channelId, entry.fn, command, args);
        },
      });
    }

    const deviceCount = [...byDevice.values()].filter(g => g.channels.some(c => this._buildSensors(c, '').length)).length;
    console.log(`[Suppla] Registered ${deviceCount} device(s) from ${channels.length} channel(s)`);
  }

  _buildSensors(ch, cap) {
    const fn = ch.functionName || '';
    const id = ch.id;

    if (SWITCH_FNS.has(fn)) {
      return [{ path: `ch_${id}`, label: cap, format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
        capabilityId: `ch_${id}`, homekit: null }];
    }
    if (DIMMER_FNS.has(fn)) {
      return [{ path: `ch_${id}`, label: cap, unit: '%',
        controllable: true, type: 'range', min: 0, max: 100,
        writeCmd: 'set', capabilityId: `ch_${id}`, homekit: null }];
    }
    if (SHUTTER_FNS.has(fn)) {
      return [{ path: `ch_${id}`, label: cap, unit: '%',
        controllable: true, type: 'range', min: 0, max: 100,
        writeCmd: 'set', capabilityId: `ch_${id}`, homekit: null }];
    }
    if (GATE_FNS.has(fn) || LOCK_FNS.has(fn)) {
      return [{ path: `ch_${id}`, label: cap, format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
        capabilityId: `ch_${id}`, homekit: null }];
    }
    if (fn === 'THERMOMETER') {
      return [{ path: `ch_${id}`, label: cap, unit: '°C', homekit: null }];
    }
    if (fn === 'HUMIDITY') {
      return [{ path: `ch_${id}`, label: cap, unit: '%', homekit: null }];
    }
    if (fn === 'HUMIDITYANDTEMPERATURE') {
      return [
        { path: `ch_${id}_temp`, label: cap ? `${cap} Temp` : 'Temperature', unit: '°C', homekit: null },
        { path: `ch_${id}_hum`,  label: cap ? `${cap} Hum`  : 'Humidity',    unit: '%',  homekit: null },
      ];
    }
    if (BINARY_FNS.has(fn)) {
      return [{ path: `ch_${id}`, label: cap, format: 'on-off', homekit: null }];
    }
    if (fn === 'ELECTRICITYMETER') {
      return [
        { path: `ch_${id}_power`,  label: cap ? `${cap} Power`  : 'Power',  unit: 'W',   homekit: null },
        { path: `ch_${id}_energy`, label: cap ? `${cap} Energy` : 'Energy', unit: 'kWh', homekit: null },
      ];
    }
    return [];
  }

  _applyState(devKey, ch) {
    const fn    = ch.functionName || '';
    const id    = ch.id;
    const state = ch.state || {};

    if (SWITCH_FNS.has(fn)) {
      this._store.update(`${devKey}/ch_${id}`, state.on ? 1 : 0);
    } else if (GATE_FNS.has(fn)) {
      // closed=false means open/on; closed=true means shut/off
      this._store.update(`${devKey}/ch_${id}`, state.closed === false ? 1 : 0);
    } else if (LOCK_FNS.has(fn)) {
      this._store.update(`${devKey}/ch_${id}`, state.closed === false ? 1 : 0);
    } else if (DIMMER_FNS.has(fn)) {
      this._store.update(`${devKey}/ch_${id}`, state.brightness ?? 0);
    } else if (SHUTTER_FNS.has(fn)) {
      // shut: 0=fully open, 100=fully closed
      this._store.update(`${devKey}/ch_${id}`, state.shut ?? 0);
    } else if (fn === 'THERMOMETER') {
      if (state.temperature != null) this._store.update(`${devKey}/ch_${id}`, state.temperature);
    } else if (fn === 'HUMIDITY') {
      if (state.humidity != null) this._store.update(`${devKey}/ch_${id}`, state.humidity);
    } else if (fn === 'HUMIDITYANDTEMPERATURE') {
      if (state.temperature != null) this._store.update(`${devKey}/ch_${id}_temp`, state.temperature);
      if (state.humidity    != null) this._store.update(`${devKey}/ch_${id}_hum`,  state.humidity);
    } else if (BINARY_FNS.has(fn)) {
      this._store.update(`${devKey}/ch_${id}`, state.hi ? 1 : 0);
    } else if (fn === 'ELECTRICITYMETER') {
      const phases   = state.phases || [];
      const totalW   = phases.reduce((s, p) => s + (p.realPower ?? 0), 0);
      const totalKwh = phases.reduce((s, p) => s + (p.totalForwardActiveEnergy ?? 0), 0);
      this._store.update(`${devKey}/ch_${id}_power`,  Math.round(totalW   * 100) / 100);
      this._store.update(`${devKey}/ch_${id}_energy`, Math.round(totalKwh * 100) / 100);
    }
  }

  // ── Command execution ───────────────────────────────────────────────────

  async _executeCommand(channelId, fn, command, args) {
    let body;
    if (SWITCH_FNS.has(fn)) {
      body = { action: command === 'on' ? 'TURN_ON' : 'TURN_OFF' };
    } else if (GATE_FNS.has(fn)) {
      body = { action: command === 'on' ? 'OPEN' : 'CLOSE' };
    } else if (LOCK_FNS.has(fn)) {
      body = { action: 'OPEN' };
    } else if (DIMMER_FNS.has(fn)) {
      body = { action: 'SET_RGBW_PARAMETERS', brightness: Math.round(args?.[0] ?? 0) };
    } else if (SHUTTER_FNS.has(fn)) {
      const pos = args?.[0] ?? 0;
      if (pos === 0)        body = { action: 'REVEAL' };
      else if (pos >= 100)  body = { action: 'SHUT' };
      else                  body = { action: 'REVEAL_PARTIALLY', percentage: 100 - pos };
    } else {
      return;
    }
    try {
      await this._api('PATCH', `/channels/${channelId}`, body);
      setTimeout(() => this._pollOnce(), 700);
    } catch (err) {
      console.error(`[Suppla] Command failed ch ${channelId}: ${err.message}`);
    }
  }

  // ── Polling ─────────────────────────────────────────────────────────────

  _schedulePoll() {
    const ms = (this._config.suppla.pollInterval || 30) * 1000;
    this._pollTimer = setInterval(() => this._pollOnce(), ms);
  }

  async _pollOnce() {
    try {
      const channels = await this._api('GET',
        '/channels?include[]=state&include[]=connected');
      for (const ch of channels) {
        const devKey = this._channelDevKey.get(ch.id);
        if (devKey) this._applyState(devKey, ch);
      }
      platformStatus.set('suppla', true);
    } catch (err) {
      console.error(`[Suppla] Poll error: ${err.message}`);
      platformStatus.set('suppla', false);
    }
  }

  // ── HTTP helper ─────────────────────────────────────────────────────────

  _api(method, path, body) {
    const cfg    = this._config.suppla;
    const parsed = new URL(cfg.server || 'https://cloud.supla.org');
    const mod    = parsed.protocol === 'https:' ? https : http;
    const host   = parsed.hostname;
    const port   = parsed.port
      ? parseInt(parsed.port)
      : (parsed.protocol === 'https:' ? 443 : 80);
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;

    const headers = {
      Authorization: `Bearer ${cfg.token}`,
      Accept:        'application/json',
    };
    if (payload) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = payload.length;
    }

    return new Promise((resolve, reject) => {
      const req = mod.request({
        hostname: host,
        port,
        path:     `/api/v2.4.0${path}`,
        method,
        timeout:  15000,
        headers,
      }, res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 100)}`));
          }
          if (!text) return resolve(null);
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error('Non-JSON response')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

module.exports = SuplaClient;
