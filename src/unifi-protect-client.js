'use strict';

const https          = require('https');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

let WebSocketLib = null;
try { WebSocketLib = require('ws'); } catch { /* handled in start() */ }

const POLL_MS = 30_000;

/**
 * UniFi Protect client.
 *
 * Two API modes:
 *  - apiKey set   → official Protect Integration API (`/proxy/protect/integration/v1`,
 *                   `X-API-Key` header). Rings, motion, and sensor open/close arrive in
 *                   real time over the `/subscribe/events` WebSocket; the 30 s sensor
 *                   poll only reconciles slow values (temperature/humidity/battery).
 *  - username/password → legacy private API (`/proxy/protect/api`, cookie login),
 *                   kept for consoles without an Integration API key. Rings are polled
 *                   every `ringPollInterval` seconds (the legacy camera object exposes
 *                   `lastRing`; the Integration API does not).
 */
class UnifiProtectClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this.cfg            = config.unifi;
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.useIntegration = Boolean(this.cfg.apiKey);
    this.token          = null;
    this.cookieJar      = '';
    this.devices        = [];
    this._cameras       = [];
    this.pollTimer      = null;
    this.ringTimer      = null;
    this.ws             = null;
    this._wsBackoff     = 5_000;
    this._wsReconnect   = null;
    this._stopped       = false;
    this._lastRing      = {}; // doorbell cameraId → last ring timestamp (legacy mode)
    this._motionState   = {}; // deviceId → last motion value
    this._ringResets    = {}; // doorbell cameraId → reset-to-0 timer
    this._seenEvents    = new Set(); // event ids already handled (integration mode)
  }

  async start() {
    if (this.useIntegration) {
      const info = await this._get('/meta/info').catch(err => {
        if (err.status === 401) throw new Error('Integration API rejected the key — create one under Protect → Settings → Control Plane → Integrations');
        return null; // tolerate consoles without /meta/info
      });
      if (info?.applicationVersion) console.log(`[UniFi Protect] Integration API — Protect ${info.applicationVersion}`);
    } else {
      await this._authenticate();
    }
    await this._discoverAll();
    platformStatus.set('unifi', true);
    this.pollTimer = setInterval(() => this._pollSensors().catch(() => {}), POLL_MS);
    if (this.useIntegration) this._connectEvents();
    console.log(`[UniFi Protect] Started (${this.useIntegration ? 'integration' : 'legacy'} API) — ${this._cameras.length} camera(s), ${this.devices.length} sensor(s)`);
  }

  stop() {
    this._stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.ringTimer);
    clearTimeout(this._wsReconnect);
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    for (const t of Object.values(this._ringResets)) clearTimeout(t);
    this._ringResets = {};
  }

  getCameras() {
    return this._cameras;
  }

  proxySnapshot(cameraId, res) {
    const req = https.request({
      hostname: this.cfg.host,
      path:     `${this._base()}/cameras/${cameraId}/snapshot`,
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

  // ── Auth (legacy mode only) ───────────────────────────────

  async _authenticate() {
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
    const cams = await this._get('/cameras');
    this._cameras = cams.map(cam => ({
      name:          cam.name || cam.id,
      url:           null,
      snapshotUrl:   `/api/unifi/snapshot/${cam.id}`,
      fetchSnapshot: () => this.fetchSnapshotBuffer(cam.id),
    }));

    // Integration API cameras carry no `featureFlags.isDoorbell`; `type` is the
    // model name ("G4 Doorbell Pro"), which both APIs expose.
    const doorbells = cams.filter(c => c.featureFlags?.isDoorbell || /doorbell/i.test(c.type || ''));
    for (const cam of doorbells) this._registerDoorbell(cam);
    if (doorbells.length > 0 && !this.useIntegration) {
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
    this._setMotion(cam.id, cam.isMotionDetected ? 1 : 0);
    console.log(`[UniFi Protect] Doorbell "${cam.name}" — store keys unifi/${cam.id}/doorbell, unifi/${cam.id}/motion`);
  }

  _ring(id, name) {
    const key = `unifi/${id}/doorbell`;
    this.store.update(key, 1);
    this.emit('doorbell-ring', { id, name });
    console.log(`[UniFi Protect] 🔔 Ring: ${name}`);
    // Pulse: back to 0 after 3 s so Loxone virtual inputs see an edge
    clearTimeout(this._ringResets[id]);
    this._ringResets[id] = setTimeout(() => this.store.update(key, 0), 3000);
  }

  _setMotion(id, val) {
    if (this._motionState[id] === val) return; // avoid re-emitting unchanged state
    this._motionState[id] = val;
    this.store.update(`unifi/${id}/motion`, val);
  }

  // ── Real-time events (integration mode) ───────────────────

  _connectEvents() {
    if (!WebSocketLib) {
      console.error('[UniFi Protect] "ws" module not available — rings will not be detected (run npm install)');
      return;
    }
    const ws = new WebSocketLib(`wss://${this.cfg.host}${this._base()}/subscribe/events`, {
      headers: { 'X-API-Key': this.cfg.apiKey },
      rejectUnauthorized: false,
    });
    this.ws = ws;

    ws.on('open', () => {
      this._wsBackoff = 5_000;
      platformStatus.set('unifi', true);
      console.log('[UniFi Protect] Event stream connected');
    });
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      try { this._handleEvent(msg); } catch (err) {
        console.error(`[UniFi Protect] Event handling: ${err.message}`);
      }
    });
    ws.on('error', err => console.error(`[UniFi Protect] Event stream: ${err.message}`));
    ws.on('close', () => {
      if (this._stopped) return;
      platformStatus.set('unifi', false);
      console.warn(`[UniFi Protect] Event stream closed — reconnecting in ${this._wsBackoff / 1000} s`);
      clearTimeout(this._wsReconnect);
      this._wsReconnect = setTimeout(() => this._connectEvents(), this._wsBackoff);
      this._wsBackoff = Math.min(this._wsBackoff * 2, 60_000);
    });
  }

  /** Messages are `{ type: 'add'|'update', item: { id, type, device, start, end, … } }`. */
  _handleEvent(msg) {
    const ev = msg?.item;
    if (!ev?.type || !ev.device) return;
    const known = this.devices.some(d => d.instance === ev.device);
    const k     = `unifi/${ev.device}`;

    switch (ev.type) {
      case 'ring':
        if (this._seenEvents.has(ev.id)) return;
        this._rememberEvent(ev.id);
        if (known) this._ring(ev.device, this._deviceLabel(ev.device));
        break;
      case 'motion':        // camera motion: `add` = started, `update` with `end` = finished
      case 'sensorMotion':
        if (!known) return;
        this._setMotion(ev.device, ev.end ? 0 : 1);
        break;
      case 'sensorOpened':
        if (known) this.store.update(`${k}/contact`, 1);
        break;
      case 'sensorClosed':
        if (known) this.store.update(`${k}/contact`, 0);
        break;
      case 'sensorAlarm':
        if (known) this.store.update(`${k}/alarm`, ev.end ? 0 : 1);
        break;
      default:
        break; // smart detections, alarm-hub, NFC… — not mapped to sensors yet
    }
  }

  _rememberEvent(id) {
    this._seenEvents.add(id);
    if (this._seenEvents.size > 500) {
      for (const old of this._seenEvents) {
        this._seenEvents.delete(old);
        if (this._seenEvents.size <= 250) break;
      }
    }
  }

  _deviceLabel(id) {
    return this.devices.find(d => d.instance === id)?.label || id;
  }

  // ── Ring polling (legacy mode) ────────────────────────────

  async _pollRings() {
    let cams;
    try {
      cams = await this._get('/cameras');
    } catch (err) {
      if (err.status === 401) await this._authenticate().catch(() => {});
      return;
    }

    for (const cam of cams) {
      if (!(cam.id in this._lastRing)) continue;
      if (cam.isMotionDetected !== undefined) this._setMotion(cam.id, cam.isMotionDetected ? 1 : 0);

      if (cam.lastRing && cam.lastRing > this._lastRing[cam.id]) {
        this._lastRing[cam.id] = cam.lastRing;
        this._ring(cam.id, cam.name);
      }
    }
  }

  fetchSnapshotBuffer(cameraId) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.cfg.host,
        path:     `${this._base()}/cameras/${cameraId}/snapshot`,
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
    const sensors = await this._get('/sensors');
    for (const s of sensors) {
      const sensorDefs = [];
      const hkTypes    = [];

      if ((s.mountType && s.mountType !== 'none') || s.isOpened !== undefined) {
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
      if (this._battery(s) != null) {
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
      sensors = await this._get('/sensors');
    } catch (err) {
      console.error(`[UniFi Protect] Poll failed: ${err.message}`);
      if (err.status === 401 && !this.useIntegration) await this._authenticate().catch(() => {});
      return;
    }

    for (const s of sensors) {
      const k = `unifi/${s.id}`;
      if (s.isOpened              !== undefined) this.store.update(`${k}/contact`,     s.isOpened ? 1 : 0);
      if (s.isMotionDetected      !== undefined) this._setMotion(s.id, s.isMotionDetected ? 1 : 0);
      if (s.stats?.temperature?.value != null)   this.store.update(`${k}/temperature`, s.stats.temperature.value);
      if (s.stats?.humidity?.value    != null)   this.store.update(`${k}/humidity`,    s.stats.humidity.value);
      if (s.stats?.light?.value       != null)   this.store.update(`${k}/lux`,         s.stats.light.value);
      if (this._battery(s)            != null)   this.store.update(`${k}/battery`,     this._battery(s));
      if (s.alarmSettings)                       this.store.update(`${k}/alarm`,       s.alarmTriggeredAt ? 1 : 0);
    }
  }

  _battery(s) {
    // Integration API deprecates batteryStatus in favor of wirelessConnectionState
    return s.batteryStatus?.percentage ?? s.wirelessConnectionState?.batteryStatus?.percentage ?? null;
  }

  // ── HTTP ─────────────────────────────────────────────────

  _base() {
    return this.useIntegration ? '/proxy/protect/integration/v1' : '/proxy/protect/api';
  }

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey)  h['X-API-Key']     = this.cfg.apiKey;
    if (this.token)       h['Authorization'] = `Bearer ${this.token}`;
    if (this.cookieJar)   h['Cookie']        = this.cookieJar;
    return h;
  }

  /** `path` is relative to the Protect API base (e.g. '/cameras'). */
  async _get(path) {
    const { status, data } = await this._request('GET', this._base() + path);
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
