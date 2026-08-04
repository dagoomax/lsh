'use strict';

const http           = require('http');
const https          = require('https');
const platformStatus = require('./platform-status');

/**
 * MiCasaVerde / Vera client — the local LuaUPnP JSON API (Vera Lite/Plus/
 * Edge/Secure, and forks like openLuup). No cloud relay, no login for the
 * common LAN setup. Polls http://<host>:3480/data_request?id=sdata for a
 * full device snapshot; commands go through
 * data_request?id=lu_action&serviceId=...&action=...
 *
 * Switch/dimmer/lock coverage (status, level, SwitchPower1, Dimming1,
 * DoorLock1) is long-stable, well-documented Vera API surface. Thermostat
 * setpoint field naming is less certain from documentation alone and hasn't
 * been verified against real hardware — check the sdata dump for your unit
 * (GET .../data_request?id=sdata&output_format=json) if that one sensor
 * doesn't show a value, and adjust SETPOINT_FIELD below if it differs.
 */

const CATEGORY = {
  DIMMABLE_LIGHT: 2, SWITCH: 3, SECURITY_SENSOR: 4, THERMOSTAT: 5, CAMERA: 6,
  DOOR_LOCK: 7, WINDOW_COVERING: 8, HUMIDITY_SENSOR: 16, TEMPERATURE_SENSOR: 17,
  LIGHT_SENSOR: 18, POWER_METER: 21,
};
const SETPOINT_FIELD = 'setpoint'; // see thermostat note above

class VeraClient {
  constructor(config, store, sensorRegistry) {
    this._config    = config;
    this._store     = store;
    this._registry  = sensorRegistry;
    this._timer     = null;
    this._registered = new Set();
  }

  async start() {
    const cfg = this._config.vera;
    if (!cfg?.host) return;

    console.log(`[Vera] Starting — ${cfg.host}:${cfg.port || 3480}`);
    platformStatus.set('vera', false);

    await this._poll(true);
    const interval = (cfg.pollInterval || 10) * 1000;
    this._timer = setInterval(() => this._poll().catch((err) => {
      console.error(`[Vera] Poll error: ${err.message}`);
      platformStatus.set('vera', false);
    }), interval);
    console.log(`[Vera] Started — polling every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  // ── Discovery & polling ─────────────────────────────────────────────────

  async _poll(initial = false) {
    const res = await this._req('GET', '/data_request?id=sdata&output_format=json');
    const devices = (res?.devices || []).filter((d) => d.category && d.category !== CATEGORY.CAMERA);

    for (const d of devices) {
      const key = `vera/${d.id}`;
      if (!this._registered.has(key)) this._registerDevice(key, d);
      this._updateValues(key, d);
    }

    platformStatus.set('vera', true);
    if (initial) console.log(`[Vera] Discovered ${devices.length} device(s)`);
  }

  _registerDevice(key, d) {
    this._registered.add(key);
    const sensors = this._sensorDescriptors(d);
    if (!sensors.length) return;

    const homekit = sensors.some((s) => s.homekit === 'temperature') ? ['temperature'] : [];

    this._registry.registerDevice({
      key, label: d.name || key, type: 'vera', homekit, sensors,
      _writeCapability: (capId, command, args = []) => this._command(d.id, capId, command, args),
    });
  }

  _sensorDescriptors(d) {
    const sensors = [];
    switch (d.category) {
      case CATEGORY.SWITCH:
        sensors.push({ path: 'switch', name: 'Switch', type: 'boolean', format: 'on-off',
          controllable: true, capabilityId: 'switch', writeOn: 'on', writeOff: 'off' });
        break;
      case CATEGORY.DIMMABLE_LIGHT:
        sensors.push({ path: 'level', name: 'Level', type: 'range', unit: '%',
          controllable: true, capabilityId: 'level', writeCmd: 'exact', min: 0, max: 100 });
        break;
      case CATEGORY.DOOR_LOCK:
        sensors.push({ path: 'lock', name: 'Lock', type: 'boolean', format: 'on-off',
          controllable: true, capabilityId: 'lock', writeOn: 'on', writeOff: 'off' });
        break;
      case CATEGORY.WINDOW_COVERING:
        sensors.push({ path: 'level', name: 'Position', type: 'range', unit: '%',
          controllable: true, capabilityId: 'level', writeCmd: 'exact', min: 0, max: 100 });
        break;
      case CATEGORY.THERMOSTAT:
        sensors.push({ path: 'setpoint', name: 'Setpoint', type: 'range', unit: '°C',
          controllable: true, capabilityId: 'setpoint', writeCmd: 'exact', min: 5, max: 35 });
        if (d.temperature != null) {
          sensors.push({ path: 'temperature', name: 'Temperature', type: 'number', unit: '°C', homekit: 'temperature' });
        }
        break;
      case CATEGORY.SECURITY_SENSOR:
        sensors.push({ path: 'tripped', name: 'Tripped', type: 'boolean', format: 'on-off' });
        break;
      case CATEGORY.HUMIDITY_SENSOR:
        sensors.push({ path: 'humidity', name: 'Humidity', type: 'number', unit: '%' });
        break;
      case CATEGORY.TEMPERATURE_SENSOR:
        sensors.push({ path: 'temperature', name: 'Temperature', type: 'number', unit: '°C', homekit: 'temperature' });
        break;
      case CATEGORY.LIGHT_SENSOR:
        sensors.push({ path: 'light', name: 'Light', type: 'number', unit: 'lux' });
        break;
      case CATEGORY.POWER_METER:
        sensors.push({ path: 'watts', name: 'Power', type: 'number', unit: 'W' });
        break;
      default:
        if (d.status !== undefined) {
          sensors.push({ path: 'status', name: 'Status', type: 'boolean', format: 'on-off' });
        }
    }
    if (d.batterylevel != null) sensors.push({ path: 'battery', name: 'Battery', type: 'number', unit: '%' });
    return sensors;
  }

  _updateValues(key, d) {
    const fields = {
      switch:      d.status,
      status:      d.status,
      level:       d.level,
      tripped:     d.tripped,
      lock:        d.locked ?? d.status,
      temperature: d.temperature,
      humidity:    d.humidity,
      light:       d.light,
      watts:       d.watts,
      battery:     d.batterylevel,
      setpoint:    d.category === CATEGORY.THERMOSTAT ? d[SETPOINT_FIELD] : undefined,
    };
    for (const [path, raw] of Object.entries(fields)) {
      if (raw === undefined || raw === null) continue;
      const n = Number(raw);
      if (!isNaN(n)) this._store.update(`${key}/${path}`, n);
    }
  }

  // ── Commands ────────────────────────────────────────────────────────────

  async _command(deviceId, capId, command, args) {
    let serviceId, action;
    const params = {};
    switch (capId) {
      case 'switch':
        serviceId = 'urn:upnp-org:serviceId:SwitchPower1';
        action    = 'SetTarget';
        params.newTargetValue = command === 'on' ? 1 : 0;
        break;
      case 'level':
        serviceId = 'urn:upnp-org:serviceId:Dimming1';
        action    = 'SetLoadLevelTarget';
        params.newLoadlevelTarget = Math.round(Number(args[0] ?? 0));
        break;
      case 'lock':
        serviceId = 'urn:micasaverde-com:serviceId:DoorLock1';
        action    = 'SetTarget';
        params.newTargetValue = command === 'on' ? 1 : 0;
        break;
      case 'setpoint':
        serviceId = 'urn:upnp-org:serviceId:TemperatureSetpoint1';
        action    = 'SetCurrentSetpoint';
        params.NewCurrentSetpoint = Number(args[0] ?? 20);
        break;
      default:
        throw new Error(`Vera: '${capId}' not writable`);
    }
    const qs = new URLSearchParams({
      id: 'lu_action', output_format: 'json', DeviceNum: String(deviceId), serviceId, action, ...params,
    }).toString();
    await this._req('GET', `/data_request?${qs}`);
    setTimeout(() => this._poll().catch(() => {}), 1500);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────

  _req(method, path) {
    const cfg   = this._config.vera;
    const proto = cfg.https ? https : http;

    return new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json' };
      if (cfg.username) {
        headers.Authorization = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password || ''}`).toString('base64');
      }
      const req = proto.request({
        hostname: cfg.host, port: cfg.port || 3480, path, method, headers, timeout: 12_000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`${method} ${path} → ${res.statusCode}: ${text.slice(0, 100)}`));
          }
          if (!text) return resolve(null);
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error(`Bad JSON from ${path}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${path}`)); });
      req.end();
    });
  }
}

module.exports = VeraClient;
