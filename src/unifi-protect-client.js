'use strict';

const https = require('https');

const POLL_MS = 30_000;

class UnifiProtectClient {
  constructor(config, store, sensorRegistry) {
    this.cfg            = config.unifi;
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.token          = null;
    this.cookieJar      = '';
    this.devices        = [];
    this._cameras       = [];
    this.pollTimer      = null;
  }

  async start() {
    await this._authenticate();
    await this._discoverAll();
    this.pollTimer = setInterval(() => this._pollSensors().catch(() => {}), POLL_MS);
    console.log(`[UniFi Protect] Started — ${this._cameras.length} camera(s), ${this.devices.length} sensor(s)`);
  }

  stop() {
    clearInterval(this.pollTimer);
  }

  getCameras() {
    return this._cameras;
  }

  proxySnapshot(cameraId, res) {
    const req = https.request({
      hostname: this.cfg.host,
      path:     `/proxy/protect/api/cameras/${cameraId}/snapshot`,
      method:   'GET',
      headers:  this._headers(),
      rejectUnauthorized: false,
    }, upstream => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      upstream.pipe(res);
    });
    req.on('error', () => res.status(502).end());
    req.end();
  }

  // ── Auth ──────────────────────────────────────────────────

  async _authenticate() {
    if (this.cfg.apiKey) return; // Bearer API key — no login needed

    const { status, headers } = await this._request('POST', '/api/auth/login',
      JSON.stringify({ username: this.cfg.username, password: this.cfg.password })
    );
    if (status !== 200) throw new Error(`UniFi auth failed: HTTP ${status}`);

    const cookies = headers['set-cookie'];
    if (cookies) this.cookieJar = cookies.map(c => c.split(';')[0]).join('; ');
    if (headers['x-updated-authorization']) this.token = headers['x-updated-authorization'];
    console.log('[UniFi Protect] Authenticated');
  }

  // ── Discovery ─────────────────────────────────────────────

  async _discoverAll() {
    await this._discoverCameras().catch(err =>
      console.error(`[UniFi Protect] Camera discovery: ${err.message}`)
    );
    await this._discoverSensors().catch(err =>
      console.error(`[UniFi Protect] Sensor discovery: ${err.message}`)
    );
  }

  async _discoverCameras() {
    const cams = await this._get('/proxy/protect/api/cameras');
    this._cameras = cams.map(cam => ({
      name:        cam.name || cam.id,
      url:         null,
      snapshotUrl: `/api/unifi/snapshot/${cam.id}`,
    }));
  }

  async _discoverSensors() {
    const sensors = await this._get('/proxy/protect/api/sensors');
    for (const s of sensors) {
      const sensorDefs = [];
      const hkTypes    = [];

      if (s.mountType || s.isOpened !== undefined) {
        sensorDefs.push({ path: 'contact',     name: 'Contact',     format: 'on-off',      homekit: 'contact' });
        hkTypes.push('contact');
      }
      if (s.isMotionDetected !== undefined) {
        sensorDefs.push({ path: 'motion',      name: 'Motion',      format: 'on-off',      homekit: 'motion' });
        hkTypes.push('motion');
      }
      if (s.stats?.temperature != null) {
        sensorDefs.push({ path: 'temperature', name: 'Temperature', format: 'temperature', homekit: 'temperature' });
        hkTypes.push('temperature');
      }
      if (s.stats?.humidity != null) {
        sensorDefs.push({ path: 'humidity',    name: 'Humidity',    format: 'percent',     homekit: 'humidity' });
        hkTypes.push('humidity');
      }
      if (s.stats?.light != null) {
        sensorDefs.push({ path: 'lux',         name: 'Light',       format: 'number' });
      }
      if (s.batteryStatus != null) {
        sensorDefs.push({ path: 'battery',     name: 'Battery',     format: 'percent',     homekit: 'battery-level' });
        hkTypes.push('battery-level');
      }
      if (s.alarmSettings) {
        sensorDefs.push({ path: 'alarm',       name: 'Alarm',       format: 'alarm',       homekit: 'smoke' });
        hkTypes.push('smoke');
      }

      if (sensorDefs.length === 0) continue;

      const device = {
        key:      `unifi/${s.id}`,
        type:     'unifi',
        instance: s.id,
        label:    s.name || s.id,
        icon:     _sensorIcon(s),
        color:    'blue',
        sensors:  sensorDefs,
        homekit:  hkTypes,
      };
      this.devices.push(device);
      this.sensorRegistry.registerDevice(device);
    }

    await this._pollSensors();
  }

  // ── Polling ───────────────────────────────────────────────

  async _pollSensors() {
    let sensors;
    try {
      sensors = await this._get('/proxy/protect/api/sensors');
    } catch (err) {
      console.error(`[UniFi Protect] Poll failed: ${err.message}`);
      if (err.status === 401) await this._authenticate().catch(() => {});
      return;
    }

    for (const s of sensors) {
      const k = `unifi/${s.id}`;
      if (s.isOpened              !== undefined) this.store.update(`${k}/contact`,     s.isOpened ? 1 : 0);
      if (s.isMotionDetected      !== undefined) this.store.update(`${k}/motion`,      s.isMotionDetected ? 1 : 0);
      if (s.stats?.temperature?.value != null)   this.store.update(`${k}/temperature`, s.stats.temperature.value);
      if (s.stats?.humidity?.value    != null)   this.store.update(`${k}/humidity`,    s.stats.humidity.value);
      if (s.stats?.light?.value       != null)   this.store.update(`${k}/lux`,         s.stats.light.value);
      if (s.batteryStatus?.percentage != null)   this.store.update(`${k}/battery`,     s.batteryStatus.percentage);
      if (s.alarmSettings)                       this.store.update(`${k}/alarm`,       s.alarmTriggeredAt ? 1 : 0);
    }
  }

  // ── HTTP ─────────────────────────────────────────────────

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey)  h['X-API-Key']     = this.cfg.apiKey;
    if (this.token)       h['Authorization'] = `Bearer ${this.token}`;
    if (this.cookieJar)   h['Cookie']        = this.cookieJar;
    return h;
  }

  async _get(path) {
    const { status, data } = await this._request('GET', path);
    if (status === 401) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
    if (status !== 200) throw new Error(`HTTP ${status} for ${path}`);
    if (!Array.isArray(data) && typeof data !== 'object') throw new Error(`Unexpected response for ${path}`);
    return data;
  }

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.cfg.host,
        path,
        method,
        headers:  this._headers(),
        rejectUnauthorized: false,
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, headers: res.headers, data: raw }); }
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

function _sensorIcon(s) {
  if (s.mountType === 'door')              return '🚪';
  if (s.mountType === 'window')            return '🪟';
  if (s.stats?.temperature != null)        return '🌡';
  if (s.isMotionDetected   !== undefined)  return '👁';
  return '📡';
}

module.exports = UnifiProtectClient;
