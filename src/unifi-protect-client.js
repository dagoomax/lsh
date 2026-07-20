'use strict';

const https          = require('https');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

const POLL_MS = 30_000;

class UnifiProtectClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this.cfg            = config.unifi;
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.token          = null;
    this.cookieJar      = '';
    this.devices        = [];
    this._cameras       = [];
    this.pollTimer      = null;
    this.ringTimer      = null;
    this._lastRing      = {}; // doorbell cameraId → last ring timestamp
    this._motionState   = {}; // doorbell cameraId → last motion value
    this._ringResets    = {}; // doorbell cameraId → reset-to-0 timer
  }

  async start() {
    await this._authenticate();
    await this._discoverAll();
    platformStatus.set('unifi', true);
    this.pollTimer = setInterval(() => this._pollSensors().catch(() => {}), POLL_MS);
    console.log(`[UniFi Protect] Started — ${this._cameras.length} camera(s), ${this.devices.length} sensor(s)`);
  }

  stop() {
    clearInterval(this.pollTimer);
    clearInterval(this.ringTimer);
    for (const t of Object.values(this._ringResets)) clearTimeout(t);
    this._ringResets = {};
  }

  getCameras() {
    return this._cameras;
  }

  proxySnapshot(cameraId, res) {
    const req = https.request({
      hostname: this.cfg.host,
      path:     `${this._protectBase()}/cameras/${cameraId}/snapshot`,
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
    const cams = await this._get(`${this._protectBase()}/cameras`);
    this._cameras = cams.map(cam => ({
      name:          cam.name || cam.id,
      url:           null,
      snapshotUrl:   `/api/unifi/snapshot/${cam.id}`,
      fetchSnapshot: () => this.fetchSnapshotBuffer(cam.id),
    }));

    // Ubiquiti's newer System-API-key-authenticated integration endpoint
    // doesn't include featureFlags.isDoorbell/type/lastRing/isMotionDetected
    // on camera list objects at all (confirmed empirically), so this filter
    // — and the ring/motion polling below — only ever finds doorbells when
    // authenticated via username/password against the legacy internal API.
    const doorbells = cams.filter(c => c.featureFlags?.isDoorbell || /doorbell/i.test(c.type || ''));
    for (const cam of doorbells) this._registerDoorbell(cam);
    if (doorbells.length > 0) {
      const seconds  = this.cfg.ringPollInterval || 3;
      this.ringTimer = setInterval(() => this._pollRings().catch(() => {}), seconds * 1000);
    }

    this.emit('cameras-discovered', this._cameras);
  }

  // ── Doorbell (door station) ───────────────────────────────

  _registerDoorbell(cam) {
    this._lastRing[cam.id] = cam.lastRing || 0;

    const device = {
      key:      `unifi/${cam.id}`,
      type:     'unifi',
      instance: cam.id,
      label:    cam.name || cam.id,
      icon:     '🔔',
      color:    'blue',
      sensors: [
        { path: 'doorbell', name: 'Doorbell', format: 'on-off', homekit: 'contact' },
        { path: 'motion',   name: 'Motion',   format: 'on-off', homekit: 'motion'  },
      ],
      homekit: ['contact', 'motion'],
    };
    this.devices.push(device);
    this.sensorRegistry.registerDevice(device);

    this.store.update(`unifi/${cam.id}/doorbell`, 0);
    this._setMotion(cam);
    console.log(`[UniFi Protect] Doorbell "${cam.name}" — store keys unifi/${cam.id}/doorbell, unifi/${cam.id}/motion`);
  }

  async _pollRings() {
    let cams;
    try {
      cams = await this._get(`${this._protectBase()}/cameras`);
    } catch (err) {
      if (err.status === 401) await this._authenticate().catch(() => {});
      return;
    }

    for (const cam of cams) {
      if (!(cam.id in this._lastRing)) continue;
      this._setMotion(cam);

      if (cam.lastRing && cam.lastRing > this._lastRing[cam.id]) {
        this._lastRing[cam.id] = cam.lastRing;
        const key = `unifi/${cam.id}/doorbell`;
        this.store.update(key, 1);
        this.emit('doorbell-ring', { id: cam.id, name: cam.name });
        console.log(`[UniFi Protect] 🔔 Ring: ${cam.name}`);
        // Pulse: back to 0 after 3 s so Loxone virtual inputs see an edge
        clearTimeout(this._ringResets[cam.id]);
        this._ringResets[cam.id] = setTimeout(() => this.store.update(key, 0), 3000);
      }
    }
  }

  _setMotion(cam) {
    if (cam.isMotionDetected === undefined) return;
    const val = cam.isMotionDetected ? 1 : 0;
    if (this._motionState[cam.id] === val) return; // avoid re-emitting unchanged state
    this._motionState[cam.id] = val;
    this.store.update(`unifi/${cam.id}/motion`, val);
  }

  fetchSnapshotBuffer(cameraId) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.cfg.host,
        path:     `${this._protectBase()}/cameras/${cameraId}/snapshot`,
        method:   'GET',
        headers:  this._headers(),
        rejectUnauthorized: false,
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async _discoverSensors() {
    const sensors = await this._get(`${this._protectBase()}/sensors`);
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
      sensors = await this._get(`${this._protectBase()}/sensors`);
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

  // Ubiquiti's System API key (X-API-Key, generated from Network →
  // Integrations) only authorizes against Protect's newer versioned
  // "integration" endpoints — it 401s against the legacy internal proxy API
  // even though that same key works fine for Network. Cookie-session auth
  // (username/password login) is the reverse: it's what the legacy internal
  // API expects and isn't known to work against the integration endpoints.
  _protectBase() {
    return this.cfg.apiKey ? '/proxy/protect/integration/v1' : '/proxy/protect/api';
  }

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
