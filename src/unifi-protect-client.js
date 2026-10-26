'use strict';

const https          = require('https');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

let WebSocketLib = null;
try { WebSocketLib = require('ws'); } catch { /* handled in start() */ }

const POLL_MS = 30_000;
const WS_HEARTBEAT_MS = 180_000; // the console's proxy drops a WebSocket idle for 10 min
const SMART_TYPES = ['person', 'vehicle', 'animal', 'package'];
const SMART_RESET_MS = 60_000;   // clear a detection even if its "end" never arrives
const SIREN_DURATIONS = [5, 10, 20, 30];

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
 *
 * Integration API extras (Protect 6.x public API, `/proxy/protect/integration/v1`):
 *  - RTSPS live streams per camera (`/cameras/{id}/rtsps-stream`) — the camera
 *    `url` HomeKit / the RTSP proxy use; created on the console when missing
 *    unless `unifi.createStreams === false` (quality `unifi.streamQuality`, default high)
 *  - `/subscribe/devices` WebSocket — sensor / light / siren / relay state live
 *  - SuperLink sensors (USL-*, via the SuperLink Gateway) are ordinary Protect
 *    sensors here: contact / motion / leak / climate / tamper / signal
 *  - smart detections (`smartDetectZone` / `smartDetectLine` events) → per-camera
 *    `person`, `vehicle`, `animal`, `package` sensors
 *  - floodlights (`/lights`, on/off), sirens (`/sirens`, play / stop) and relay
 *    outputs (`/relays`, on / off) as controllable devices; sirens and relays
 *    are marked `sensitive` (MCP bots can't drive them unless allowed)
 *  - `triggerAlarm(id)` — Alarm Manager webhook trigger (`/alarm-manager/webhook/{id}`)
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
    this.devWs          = null;
    this._devWsBackoff  = 5_000;
    this._devWsReconnect = null;
    this._smartResets   = {}; // `${cameraId}/${type}` → reset timer
    this._extraDevices  = {}; // id → { kind: 'light'|'siren'|'relay', raw }
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
    if (this.useIntegration) { this._connectEvents(); this._connectDevices(); }
    console.log(`[UniFi Protect] Started (${this.useIntegration ? 'integration' : 'legacy'} API) — ${this._cameras.length} camera(s), ${this.devices.length} sensor(s)`);
  }

  stop() {
    this._stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.ringTimer);
    clearTimeout(this._wsReconnect);
    clearTimeout(this._devWsReconnect);
    for (const w of [this.ws, this.devWs]) if (w) { clearInterval(w._lshPing); try { w.close(); } catch {} }
    this.ws = null; this.devWs = null;
    for (const t of [...Object.values(this._ringResets), ...Object.values(this._smartResets)]) clearTimeout(t);
    this._ringResets = {}; this._smartResets = {};
  }

  getCameras() {
    return this._cameras;
  }

  proxySnapshot(cameraId, res) {
    const req = https.request({
      hostname: this._hostPort().split(':')[0],
      port:     this._hostPort().split(':')[1] || 443,
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
    if (this.useIntegration) {
      for (const [kind, fn] of [['lights', () => this._discoverLights()], ['sirens', () => this._discoverSirens()], ['relays', () => this._discoverRelays()]]) {
        // 404 = an older Protect without that endpoint — skip quietly
        await fn().catch(err => { if (!/HTTP 404/.test(err.message)) console.error(`[UniFi Protect] ${kind} discovery: ${err.message}`); });
      }
    }
  }

  async _discoverCameras() {
    const cams = await this._get('/cameras');
    const urls = {};
    if (this.useIntegration) {
      for (const cam of cams) urls[cam.id] = await this._streamUrl(cam.id).catch(err => {
        console.warn(`[UniFi Protect] No RTSPS stream for "${cam.name || cam.id}": ${err.message}`);
        return null;
      });
    }
    this._cameras = cams.map(cam => ({
      name:          cam.name || cam.id,
      url:           urls[cam.id] || null,
      snapshotUrl:   `/api/unifi/snapshot/${cam.id}`,
      fetchSnapshot: () => this.fetchSnapshotBuffer(cam.id),
    }));

    // Integration API cameras carry no `featureFlags.isDoorbell`; `type` is the
    // model name ("G4 Doorbell Pro"), which both APIs expose.
    const isDoorbell = c => c.featureFlags?.isDoorbell || /doorbell/i.test(c.type || '');
    const doorbells = cams.filter(isDoorbell);
    for (const cam of doorbells) this._registerDoorbell(cam);
    // Other cameras with smart detection get a device for its sensors
    if (this.useIntegration) for (const cam of cams.filter(c => !isDoorbell(c) && this._smartTypes(c).length)) this._registerCamera(cam);
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
        ...this._smartSensors(cam),
      ],
      homekit: ['contact', 'motion'],
    };
    this.devices.push(device);
    this.sensorRegistry.registerDevice(device);

    this.store.update(`unifi/${cam.id}/doorbell`, 0);
    this._setMotion(cam.id, cam.isMotionDetected ? 1 : 0);
    console.log(`[UniFi Protect] Doorbell "${cam.name}" — store keys unifi/${cam.id}/doorbell, unifi/${cam.id}/motion`);
  }

  // A non-doorbell camera with smart detection: motion + one sensor per type
  _registerCamera(cam) {
    const device = {
      key: `unifi/${cam.id}`, type: 'unifi', instance: cam.id, label: cam.name || cam.id, icon: '📷', color: 'blue',
      sensors: [{ path: 'motion', name: 'Motion', format: 'on-off', homekit: 'motion' }, ...this._smartSensors(cam)],
      homekit: ['motion'],
    };
    this.devices.push(device);
    this.sensorRegistry.registerDevice(device);
    this._setMotion(cam.id, cam.isMotionDetected ? 1 : 0);
    for (const t of this._smartTypes(cam)) this.store.update(`unifi/${cam.id}/${t}`, 0);
  }

  _smartTypes(cam) {
    const types = cam.featureFlags?.smartDetectTypes || [];
    return SMART_TYPES.filter(t => types.includes(t));
  }

  _smartSensors(cam) {
    const label = { person: 'Person', vehicle: 'Vehicle', animal: 'Animal', package: 'Package' };
    return this._smartTypes(cam).map(t => ({ path: t, name: label[t], format: 'on-off', type: 'boolean' }));
  }

  _setSmart(cameraId, type, val) {
    const k = `${cameraId}/${type}`;
    clearTimeout(this._smartResets[k]);
    this.store.update(`unifi/${k}`, val);
    if (val) this._smartResets[k] = setTimeout(() => this.store.update(`unifi/${k}`, 0), SMART_RESET_MS);
  }

  // RTSPS URL of the camera's stream (created on the console when missing).
  // Protect appends `?enableSrtp`; ffmpeg / go2rtc want plain RTSPS.
  async _streamUrl(cameraId) {
    const quality = this.cfg.streamQuality || 'high';
    let streams = await this._get(`/cameras/${cameraId}/rtsps-stream`).catch(err => { if (err.status === 404) return {}; throw err; });
    if (!streams?.[quality] && this.cfg.createStreams !== false) {
      streams = await this._send('POST', `/cameras/${cameraId}/rtsps-stream`, { qualities: [quality] });
    }
    const url = streams?.[quality];
    return typeof url === 'string' ? url.replace(/\?enableSrtp$/, '') : null;
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
    const ws = new WebSocketLib(`wss://${this._hostPort()}${this._base()}/subscribe/events`, {
      headers: { 'X-API-Key': this.cfg.apiKey },
      rejectUnauthorized: false,
    });
    this.ws = ws;

    ws.on('open', () => {
      this._wsBackoff = 5_000;
      platformStatus.set('unifi', true);
      console.log('[UniFi Protect] Event stream connected');
      ws._lshPing = setInterval(() => { try { ws.ping(); } catch {} }, WS_HEARTBEAT_MS);
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
      clearInterval(ws._lshPing);
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
      case 'sensorWaterLeak':
        if (known) this.store.update(`${k}/leak`, ev.end ? 0 : 1);
        break;
      case 'sensorTamper':
        if (known) this.store.update(`${k}/tamper`, ev.end ? 0 : 1);
        break;
      case 'smartDetectZone':
      case 'smartDetectLine':
        if (!known) return;
        for (const t of ev.smartDetectTypes || []) if (SMART_TYPES.includes(t)) this._setSmart(ev.device, t, ev.end ? 0 : 1);
        break;
      default:
        break; // audio detections, alarm-hub, NFC… — not mapped to sensors yet
    }
  }

  // ── Device state stream (integration mode) ───────────────

  _connectDevices() {
    if (!WebSocketLib) return;
    const ws = new WebSocketLib(`wss://${this._hostPort()}${this._base()}/subscribe/devices`, {
      headers: { 'X-API-Key': this.cfg.apiKey },
      rejectUnauthorized: false,
    });
    this.devWs = ws;
    ws.on('open', () => {
      this._devWsBackoff = 5_000;
      ws._lshPing = setInterval(() => { try { ws.ping(); } catch {} }, WS_HEARTBEAT_MS);
      // Catch up on what changed while disconnected
      this._pollSensors().catch(() => {});
    });
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      try { this._handleDevice(msg); } catch (err) { console.error(`[UniFi Protect] Device update: ${err.message}`); }
    });
    ws.on('error', err => console.error(`[UniFi Protect] Device stream: ${err.message}`));
    ws.on('close', () => {
      clearInterval(ws._lshPing);
      if (this._stopped) return;
      clearTimeout(this._devWsReconnect);
      this._devWsReconnect = setTimeout(() => this._connectDevices(), this._devWsBackoff);
      this._devWsBackoff = Math.min(this._devWsBackoff * 2, 60_000);
    });
  }

  /** `{ type: 'add'|'update'|'remove', item: { id, modelKey, …changed fields } }` — `id` may be a list (bulk). */
  _handleDevice(msg) {
    const item = msg?.item;
    if (!item?.modelKey || msg.type === 'remove') return;
    for (const id of Array.isArray(item.id) ? item.id : [item.id]) {
      const it = { ...item, id };
      if (it.modelKey === 'sensor') this._applySensor(it);
      else if (it.modelKey === 'camera' && it.isMotionDetected !== undefined && this.devices.some(d => d.instance === id)) this._setMotion(id, it.isMotionDetected ? 1 : 0);
      else if (this._extraDevices[id]) {
        const e = this._extraDevices[id];
        e.raw = { ...e.raw, ...it };
        this._applyExtra(id);
      }
    }
  }

  // ── Lights, sirens, relays (integration mode) ────────────

  async _discoverLights() {
    for (const l of await this._get('/lights')) {
      this._extraDevices[l.id] = { kind: 'light', raw: l };
      this.sensorRegistry.registerDevice({
        key: `unifi/${l.id}`, type: 'unifi', instance: l.id, label: l.name || 'Floodlight', icon: '💡', color: 'blue',
        sensors: [
          { path: 'switch', name: 'Light', format: 'on-off', type: 'toggle', controllable: true, writeOn: 'on', writeOff: 'off', capabilityId: 'switch' },
          { path: 'motion', name: 'Motion', format: 'on-off', homekit: 'motion' },
        ],
        homekit: ['light-rw', 'motion'],
        _writeCapability: (cap, cmd) => this._send('PATCH', `/lights/${l.id}`, { isLightForceEnabled: cmd === 'on' })
          .then(r => { if (r && typeof r === 'object') { this._extraDevices[l.id].raw = { ...this._extraDevices[l.id].raw, ...r }; this._applyExtra(l.id); } }),
      });
      this._applyExtra(l.id);
    }
  }

  async _discoverSirens() {
    const duration = SIREN_DURATIONS.includes(Number(this.cfg.sirenDuration)) ? Number(this.cfg.sirenDuration) : 10;
    for (const s of await this._get('/sirens')) {
      this._extraDevices[s.id] = { kind: 'siren', raw: s };
      this.sensorRegistry.registerDevice({
        key: `unifi/${s.id}`, type: 'unifi', instance: s.id, label: s.name || 'Siren', icon: '🚨', color: 'red', sensitive: true,
        sensors: [{ path: 'siren', name: 'Siren', format: 'on-off', type: 'toggle', controllable: true, writeOn: 'play', writeOff: 'stop', capabilityId: 'siren' }],
        homekit: [],
        _writeCapability: async (cap, cmd) => {
          if (cmd === 'play') await this._send('POST', `/sirens/${s.id}/play`, { duration });
          else await this._send('POST', `/sirens/${s.id}/stop`);
          this.store.update(`unifi/${s.id}/siren`, cmd === 'play' ? 1 : 0);
        },
      });
      this._applyExtra(s.id);
    }
  }

  async _discoverRelays() {
    for (const r of await this._get('/relays')) {
      this._extraDevices[r.id] = { kind: 'relay', raw: r };
      this.sensorRegistry.registerDevice({
        key: `unifi/${r.id}`, type: 'unifi', instance: r.id, label: r.name || 'Relay', icon: '🔌', color: 'blue', sensitive: true,
        sensors: (r.outputs || []).map(o => ({ path: `output${o.id}`, name: o.name || `Output ${o.id}`, format: 'on-off', type: 'toggle', controllable: true, writeOn: 'on', writeOff: 'off', capabilityId: String(o.id) })),
        homekit: [],
        _writeCapability: async (outputId, cmd) => {
          await this._send('POST', `/relays/${r.id}/outputs/${encodeURIComponent(outputId)}/activate`, { state: cmd === 'on' ? 'on' : 'off' });
          this.store.update(`unifi/${r.id}/output${outputId}`, cmd === 'on' ? 1 : 0);
        },
      });
      this._applyExtra(r.id);
    }
  }

  _applyExtra(id) {
    const { kind, raw } = this._extraDevices[id];
    const k = `unifi/${id}`;
    if (kind === 'light') {
      if (raw.isLightOn !== undefined) this.store.update(`${k}/switch`, raw.isLightOn ? 1 : 0);
      if (raw.isPirMotionDetected !== undefined) this.store.update(`${k}/motion`, raw.isPirMotionDetected ? 1 : 0);
    } else if (kind === 'siren') {
      if (raw.sirenStatus) this.store.update(`${k}/siren`, raw.sirenStatus.isActive ? 1 : 0);
    } else if (kind === 'relay') {
      for (const o of raw.outputs || []) if (o.state) this.store.update(`${k}/output${o.id}`, o.state === 'on' ? 1 : 0);
    }
  }

  /** Fire an Alarm Manager webhook trigger (Protect → Alarm Manager → trigger "Webhook"). */
  async triggerAlarm(triggerId) {
    if (!this.useIntegration) throw new Error('Alarm Manager webhooks need the Integration API (set an API key)');
    if (!/^[A-Za-z0-9._~-]{1,128}$/.test(String(triggerId || ''))) throw new Error('Invalid trigger id');
    await this._send('POST', `/alarm-manager/webhook/${encodeURIComponent(triggerId)}`);
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
        hostname: this._hostPort().split(':')[0],
        port:     this._hostPort().split(':')[1] || 443,
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

  // UP Sense (Bluetooth) and SuperLink sensors (USL-Entry, USL-Motion,
  // USL-Environmental, glass break, all-in-one… — "type": "USL-…", same
  // modelKey "sensor", behind a SuperLink Gateway) share one shape. Which
  // readings a sensor has depends on its model and mountType: "leak" turns an
  // Environmental into a water sensor (temperature/humidity/light then stop
  // reporting), door/window/garage make it a contact.
  async _discoverSensors() {
    const sensors = await this._get('/sensors');
    for (const s of sensors) {
      const sensorDefs = [];
      const hkTypes    = [];
      const add = (def, hk) => { sensorDefs.push(def); if (hk) hkTypes.push(hk); };
      const superlink = _isSuperLink(s);
      const leakMount = s.mountType === 'leak';

      if (CONTACT_MOUNTS.includes(s.mountType) || typeof s.isOpened === 'boolean') {
        add({ path: 'contact',     name: 'Contact',     format: 'on-off',      homekit: 'contact' }, 'contact');
      }
      if (s.isMotionDetected !== undefined && !leakMount) {
        add({ path: 'motion',      name: 'Motion',      format: 'on-off',      homekit: 'motion' }, 'motion');
      }
      if (leakMount || s.leakDetectedAt != null || s.externalLeakDetectedAt != null) {
        add({ path: 'leak',        name: 'Leak',        format: 'on-off',      homekit: 'leak' }, 'leak');
      }
      if (s.stats?.temperature != null && !leakMount) {
        add({ path: 'temperature', name: 'Temperature', format: 'temperature', homekit: 'temperature' }, 'temperature');
      }
      if (s.stats?.humidity != null && !leakMount) {
        add({ path: 'humidity',    name: 'Humidity',    format: 'percent',     homekit: 'humidity' }, 'humidity');
      }
      if (s.stats?.light != null && !leakMount) {
        add({ path: 'lux',         name: 'Light',       format: 'number' });
      }
      if (this._battery(s) != null) {
        add({ path: 'battery',     name: 'Battery',     format: 'percent',     homekit: 'battery-level' }, 'battery-level');
      }
      if (s.alarmSettings) {
        add({ path: 'alarm',       name: 'Alarm',       format: 'alarm',       homekit: 'smoke' }, 'smoke');
      }
      if (superlink || s.tamperingDetectedAt !== undefined) {
        add({ path: 'tamper',      name: 'Tamper',      format: 'on-off' });
      }
      if (superlink && _signal(s) != null) {
        add({ path: 'signal',      name: 'Signal',      format: 'number', unit: 'dBm' });
      }

      if (sensorDefs.length === 0) continue;

      const device = {
        key:      `unifi/${s.id}`,
        type:     'unifi',
        instance: s.id,
        label:    s.name || s.id,
        model:    s.marketName || s.type || undefined,
        icon:     _sensorIcon(s),
        color:    'blue',
        sensors:  sensorDefs,
        homekit:  hkTypes,
      };
      if (superlink) device.superlink = true;
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

    for (const s of sensors) this._applySensor(s);
  }

  // Full sensor (poll) or the changed fields of one (device stream)
  _applySensor(s) {
    if (!this.devices.some(d => d.instance === s.id)) return;
    const k = `unifi/${s.id}`;
    if (s.isOpened              !== undefined) this.store.update(`${k}/contact`,     s.isOpened ? 1 : 0);
    if (s.isMotionDetected      !== undefined) this._setMotion(s.id, s.isMotionDetected ? 1 : 0);
    if (s.stats?.temperature?.value != null)   this.store.update(`${k}/temperature`, s.stats.temperature.value);
    if (s.stats?.humidity?.value    != null)   this.store.update(`${k}/humidity`,    s.stats.humidity.value);
    if (s.stats?.light?.value       != null)   this.store.update(`${k}/lux`,         s.stats.light.value);
    if (this._battery(s)            != null)   this.store.update(`${k}/battery`,     this._battery(s));
    if (s.alarmSettings)                       this.store.update(`${k}/alarm`,       s.alarmTriggeredAt ? 1 : 0);
    const has = (p) => this.devices.some(d => d.instance === s.id && d.sensors.some(x => x.path === p));
    // Leak / tamper are timestamps of the last detection — cleared (null) once dry / closed again
    if ((s.leakDetectedAt !== undefined || s.externalLeakDetectedAt !== undefined) && has('leak')) {
      this.store.update(`${k}/leak`, s.leakDetectedAt || s.externalLeakDetectedAt ? 1 : 0);
    }
    if (s.tamperingDetectedAt !== undefined && has('tamper')) this.store.update(`${k}/tamper`, s.tamperingDetectedAt ? 1 : 0);
    if (_signal(s) != null && has('signal')) this.store.update(`${k}/signal`, _signal(s));
  }

  _battery(s) {
    // Integration API deprecates batteryStatus in favor of wirelessConnectionState
    return s.batteryStatus?.percentage ?? s.wirelessConnectionState?.batteryStatus?.percentage ?? null;
  }

  // ── HTTP ─────────────────────────────────────────────────

  // `host` may carry a port ("192.168.1.1:7443"); default 443
  _hostPort() { return String(this.cfg.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, '') }

  /** JSON write (POST / PATCH) relative to the API base; resolves the parsed reply. */
  async _send(method, path, body) {
    const { status, data } = await this._request(method, this._base() + path, body === undefined ? undefined : JSON.stringify(body));
    if (status === 401) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
    if (status < 200 || status >= 300) { const e = new Error(`HTTP ${status} for ${path}${data?.error ? ` — ${data.error}` : ''}`); e.status = status; throw e; }
    return data;
  }

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
    if (status !== 200) { const e = new Error(`HTTP ${status} for ${path}`); e.status = status; throw e; }
    if (!Array.isArray(data) && typeof data !== 'object') throw new Error(`Unexpected response for ${path}`);
    return data;
  }

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const [hostname, port] = this._hostPort().split(':');
      const req = https.request({
        hostname,
        port:     port || 443,
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

const CONTACT_MOUNTS = ['door', 'window', 'garage'];

const _isSuperLink = (s) => /^USL[-_]/i.test(s.type || '') || /SuperLink|^USL /i.test(s.marketName || '');

// SuperLink sensors report their radio link in the same field as the UP Sense's Bluetooth one
function _signal(s) {
  const v = s.bluetoothConnectionState?.signalStrength;
  return typeof v === 'number' ? v : null;
}

function _sensorIcon(s) {
  if (s.mountType === 'leak')              return '💧';
  if (s.mountType === 'door')              return '🚪';
  if (s.mountType === 'window')            return '🪟';
  if (s.stats?.temperature != null)        return '🌡';
  if (s.isMotionDetected   !== undefined)  return '👁';
  return '📡';
}

module.exports = UnifiProtectClient;
