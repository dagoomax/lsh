'use strict';

/**
 * Ring cameras and video doorbells (ring.com cloud).
 *
 * Ring has no public API and nothing on the LAN: every camera is reached
 * through the same private cloud API the Ring app uses. The endpoints,
 * headers and token handling below follow the open-source `ring-client-api`
 * (github.com/dgreif/ring, rest-client.ts / ring-camera.ts / api.ts) — they
 * are not guessed, but Ring can change them without notice.
 *
 *   POST https://oauth.ring.com/oauth/token
 *        { client_id: 'ring_official_android', scope: 'client',
 *          grant_type: 'password', username, password }      first sign-in
 *        { …, grant_type: 'refresh_token', refresh_token }   afterwards
 *        headers 2fa-support: true, 2fa-code, hardware_id, User-Agent
 *        → 412 when a verification code is needed (sent by SMS / e-mail, or
 *          from an authenticator app); send the same request again with it
 *          in the `2fa-code` header.
 *        Every answer carries a NEW refresh token — the old one stops
 *        working, so it is written to persist/ring-auth.json each time.
 *   POST https://api.ring.com/clients_api/session            once per start / 12 h
 *   GET  https://api.ring.com/clients_api/ring_devices
 *        → { doorbots, authorized_doorbots, stickup_cams, … }
 *   GET  https://app-snaps.ring.com/snapshots/next/<id>?extras=force   JPEG
 *   PUT  https://api.ring.com/clients_api/doorbots/<id>/floodlight_light_on|off
 *   PUT  https://api.ring.com/clients_api/doorbots/<id>/siren_on|off
 *   GET  https://api.ring.com/clients_api/locations/<loc>/devices/<id>/events?limit=1
 *
 * What this module does: lists the account's cameras and doorbells as LSH
 * devices (online, battery, motion-detection state, light and siren
 * switches where the hardware has them, last event), and serves a snapshot
 * per camera for the Cameras view (/api/ring/snapshot/<id>).
 *
 * What it does not do:
 *   - Live video. Ring streams over its own WebRTC signalling; go2rtc
 *     (≥ 1.9.13) speaks it — add a `ring:` stream there and point
 *     config.ring.streams[<camera id>] at its WebRTC URL.
 *   - Instant motion / ring alerts. Ring delivers those as push
 *     notifications; here "last event" is read on every poll, so a motion
 *     or a press shows up after up to one poll interval.
 *   - Alarm base stations, chimes, smart lighting — cameras only.
 *
 * Sign in once with `node scripts/ring-auth.js` (or POST
 * /api/settings/ring/login); the password is never stored, only the
 * refresh token.
 *
 * Written against the documented wire protocol and exercised with a fake
 * Ring cloud in test/ring.test.js — NOT yet run against a real Ring account.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PollingClient = require('./polling-client');

const DEFAULT_AUTH_FILE = path.join(__dirname, '..', 'persist', 'ring-auth.json');
const USER_AGENT = 'android:com.ringapp';
const ENDPOINTS = {
  oauth: 'https://oauth.ring.com/oauth/token',
  api: 'https://api.ring.com/clients_api/',
  snapshots: 'https://app-snaps.ring.com/snapshots/next/',
};
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 20000;

class RingAuthError extends Error {}

// `ring-client-api` hands out its refresh token wrapped as base64 JSON
// { rt, hid } — accept that form too, so a token made with its ring-auth-cli
// can be pasted into config.ring.refreshToken.
function parseRefreshToken(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const j = JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
    if (j && typeof j.rt === 'string' && j.rt) return { rt: j.rt, hid: j.hid || null };
  } catch { /* a plain token */ }
  return { rt: s, hid: null };
}

// Sign-in and token upkeep. One instance per auth file; the Settings/CLI
// login and the poller share the file, so a fresh sign-in is picked up by
// the running client on its next token refresh.
class RingAuth {
  constructor({ authFile = DEFAULT_AUTH_FILE, endpoints = {}, seedToken = '' } = {}) {
    this.file = authFile;
    this.endpoints = { ...ENDPOINTS, ...endpoints };
    this.seed = parseRefreshToken(seedToken);
    this.access = null; // { token, expires }
    this._refreshing = null;
  }

  _read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { return {}; }
  }

  _load() {
    const j = this._read();
    return j.rt ? j : null;
  }

  _save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  // The stored sign-in, or the config seed the first time round
  state() {
    const saved = this._load();
    if (saved) return saved;
    if (this.seed) return { rt: this.seed.rt, hid: this.seed.hid || crypto.randomUUID() };
    return null;
  }

  signedIn() { return !!this.state(); }

  async _token(grant, hid, code = '') {
    const res = await fetch(this.endpoints.oauth, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT,
        '2fa-support': 'true', '2fa-code': code || '', hardware_id: hid,
      },
      body: JSON.stringify({ client_id: 'ring_official_android', scope: 'client', ...grant }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  _accept(body, hid) {
    if (!body.access_token || !body.refresh_token) throw new RingAuthError('Ring answered without tokens');
    this._save({ rt: body.refresh_token, hid, updated: new Date().toISOString() });
    this.access = { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60000 };
    return this.access.token;
  }

  // E-mail + password sign-in. → { ok: true } or { needs2fa: true, prompt }.
  // Call again with the code Ring sent; the password is used, never kept.
  async login(email, password, code = '') {
    if (!email || !password) throw new RingAuthError('E-mail and password are required');
    // one hardware id for the whole sign-in: the verification code is tied to
    // the device that asked for it, so it is saved before the code arrives
    const saved = this._read();
    const hid = saved.hid || this.seed?.hid || crypto.randomUUID();
    if (!saved.hid) this._save({ ...saved, hid });
    const { status, body } = await this._token({ grant_type: 'password', username: email, password }, hid, code);
    if (status === 412) {
      const how = body.tsv_state === 'totp' ? 'from your authenticator app'
        : body.phone ? `sent to ${body.phone}${body.tsv_state ? ` by ${body.tsv_state}` : ''}` : 'sent by Ring';
      return { needs2fa: true, prompt: `Enter the verification code ${how}` };
    }
    if (status === 400 && /^Verification Code/i.test(String(body.error || ''))) throw new RingAuthError('Wrong verification code');
    if (status >= 400) throw new RingAuthError(body.error_description || body.error || `Ring sign-in failed (HTTP ${status})`);
    this._accept(body, hid);
    return { ok: true };
  }

  // A valid access token, refreshed (and the rotated refresh token saved) when needed
  async token(force = false) {
    if (!force && this.access && Date.now() < this.access.expires) return this.access.token;
    if (!this._refreshing) {
      this._refreshing = (async () => {
        const st = this.state();
        if (!st) throw new RingAuthError('Not signed in to Ring — run node scripts/ring-auth.js');
        const { status, body } = await this._token({ grant_type: 'refresh_token', refresh_token: st.rt }, st.hid);
        if (status === 400 || status === 401) {
          throw new RingAuthError(`Ring rejected the saved sign-in (${body.error_description || body.error || status}) — sign in again`);
        }
        if (status >= 400) throw new Error(`Ring token refresh failed (HTTP ${status})`);
        return this._accept(body, st.hid);
      })().finally(() => { this._refreshing = null; });
    }
    return this._refreshing;
  }

  hardwareId() { return this.state()?.hid || ''; }
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

class RingClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'ring', logTag: 'Ring' });
    const cfg = config.ring || {};
    this.cfg = cfg;
    this.store = store;
    this.registry = sensorRegistry;
    this.pollMs = Math.max(20, Number(cfg.pollInterval) || 60) * 1000;
    // a battery camera wakes up for every snapshot — don't ask more often than this
    this.batterySnapshotMs = Math.max(30, Number(cfg.batterySnapshotSeconds) || 600) * 1000;
    this.wiredSnapshotMs = Math.max(2, Number(cfg.snapshotSeconds) || 10) * 1000;
    this.streams = cfg.streams && typeof cfg.streams === 'object' ? cfg.streams : {};
    this.auth = new RingAuth({ authFile: cfg.authFile, endpoints: cfg.endpoints, seedToken: cfg.refreshToken });
    this.cameras = new Map();   // id → { data, battery, key }
    this.snapshots = new Map(); // id → { buffer, at, pending }
    this.sessionAt = 0;
  }

  async start() {
    if (!this.auth.signedIn()) {
      console.warn('[Ring] Not signed in — run `node scripts/ring-auth.js` (the poller retries on its own)');
    }
    await this.startPolling(this.pollMs);
  }

  stop() { this.stopPolling(); }

  async _request(url, { method = 'GET', body, accept = 'application/json', retry = true } = {}) {
    const token = await this.auth.token();
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`, hardware_id: this.auth.hardwareId(), 'User-Agent': USER_AGENT, Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 && retry) {
      await this.auth.token(true);
      return this._request(url, { method, body, accept, retry: false });
    }
    if (!res.ok) throw new Error(`${method} ${new URL(url).pathname} → HTTP ${res.status}`);
    return res;
  }

  _api(pathname) { return this.auth.endpoints.api + pathname; }

  async _session() {
    if (Date.now() - this.sessionAt < SESSION_TTL_MS) return;
    await this._request(this._api('session'), {
      method: 'POST',
      body: { device: { hardware_id: this.auth.hardwareId(), metadata: { api_version: 11, device_model: 'lsh' }, os: 'android' } },
    });
    this.sessionAt = Date.now();
  }

  async _pollImpl() {
    await this._session();
    const res = await this._request(this._api('ring_devices'));
    const data = await res.json();
    if (!data || typeof data !== 'object') throw new Error('ring_devices answered without a device list');
    const list = [
      ...(data.doorbots || []).map((d) => ({ d, doorbell: true })),
      ...(data.authorized_doorbots || []).map((d) => ({ d, doorbell: true })),
      ...(data.stickup_cams || []).map((d) => ({ d, doorbell: String(d.kind || '').startsWith('doorbell') })),
    ];
    for (const { d, doorbell } of list) {
      if (d?.id == null) continue;
      this._sync(String(d.id), d, doorbell);
    }
    // last event per camera — never fails the poll: the device list is what matters
    await Promise.all([...this.cameras.entries()].map(([id, cam]) => this._lastEvent(id, cam).catch(() => {})));
  }

  _sync(id, d, doorbell) {
    const key = `ring/${id}`;
    const levels = [num(d.battery_life), num(d.battery_life_2)].filter((v) => v != null);
    const battery = levels.length ? Math.min(...levels) : null;
    const hasLight = d.led_status !== undefined;
    const hasSiren = d.siren_status !== undefined;
    const onBattery = battery != null && d.settings?.power_mode !== 'wired';

    if (!this.cameras.has(id)) {
      const sensors = [
        { path: 'online', name: 'Online', format: 'on-off', sensorType: 'connectivity' },
        ...(battery != null ? [{ path: 'battery', name: 'Battery', format: 'percent', unit: '%', homekit: 'battery-level' }] : []),
        { path: 'motionDetection', name: 'Motion detection', format: 'on-off' },
        { path: 'motion', name: 'Motion', format: 'on-off', sensorType: 'motion' },
        ...(doorbell ? [{ path: 'ding', name: 'Doorbell pressed', format: 'on-off' }] : []),
        { path: 'lastEvent', name: 'Last event', format: 'string' },
        { path: 'lastEventTime', name: 'Last event time', format: 'string' },
        ...(hasLight ? [{ path: 'light', name: 'Light', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'light' }] : []),
        ...(hasSiren ? [{ path: 'siren', name: 'Siren', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'siren' }] : []),
        { path: 'image', name: 'Snapshot URL', format: 'string', hidden: true, isCamera: true },
      ];
      this.registry.registerDevice({
        key, type: 'ring', instance: id, label: d.description || `Ring ${doorbell ? 'doorbell' : 'camera'} ${id}`,
        model: `Ring · ${d.kind || 'camera'}`, icon: doorbell ? '🔔' : '📷', color: 'gray', sensors,
        homekit: battery != null ? ['battery-level'] : [],
        _writeCapability: (cap, cmd) => this._write(id, cap, cmd),
      });
      this.store.set(`${key}/image`, `/api/ring/snapshot/${id}`);
      console.log(`[Ring] ${doorbell ? 'Doorbell' : 'Camera'} "${d.description || id}" (${d.kind || 'unknown'})`);
    }
    this.cameras.set(id, { key, data: d, doorbell, onBattery, last: this.cameras.get(id)?.last || null });

    this.store.set(`${key}/online`, d.alerts?.connection === 'offline' ? 0 : 1);
    if (battery != null) this.store.set(`${key}/battery`, Math.round(battery));
    this.store.set(`${key}/motionDetection`, d.settings?.motion_detection_enabled === false ? 0 : 1);
    if (hasLight) this.store.set(`${key}/light`, this._active(d.led_status) ? 1 : 0);
    if (hasSiren) this.store.set(`${key}/siren`, this._active(d.siren_status) ? 1 : 0);
  }

  // led_status is 'on' / 'off' or { seconds_remaining }; siren_status { seconds_remaining }
  _active(status) {
    if (status && typeof status === 'object') return Number(status.seconds_remaining) > 0;
    return status === 'on' || status === true;
  }

  async _lastEvent(id, cam) {
    const loc = cam.data.location_id;
    if (!loc) return;
    const res = await this._request(this._api(`locations/${loc}/devices/${id}/events?limit=1`));
    const body = await res.json();
    const ev = (Array.isArray(body) ? body : body?.events || [])[0];
    const at = ev && Date.parse(ev.created_at);
    // "motion" / "ding" stay on while their latest event is fresher than a poll and a half
    const fresh = at && Date.now() - at < Math.max(90000, this.pollMs * 1.5);
    const kind = String(ev?.kind || ev?.event_type || '');
    this.store.set(`${cam.key}/motion`, fresh && kind === 'motion' ? 1 : 0);
    if (cam.doorbell) this.store.set(`${cam.key}/ding`, fresh && kind === 'ding' ? 1 : 0);
    if (!at) return;
    if (cam.last !== ev.created_at) {
      cam.last = ev.created_at;
      this.store.set(`${cam.key}/lastEvent`, kind || 'event');
      this.store.set(`${cam.key}/lastEventTime`, new Date(at).toISOString());
    }
  }

  async _write(id, cap, cmd) {
    const cam = this.cameras.get(id);
    if (!cam) throw new Error('Unknown Ring camera');
    const on = cmd === 'on';
    const action = cap === 'light' ? `floodlight_light_${on ? 'on' : 'off'}` : cap === 'siren' ? `siren_${on ? 'on' : 'off'}` : null;
    if (!action) throw new Error(`Ring: unsupported command ${cap}`);
    await this._request(this._api(`doorbots/${id}/${action}`), { method: 'PUT' });
    this.store.set(`${cam.key}/${cap}`, on ? 1 : 0);
  }

  // A JPEG for the camera. Cached per camera: a wired one refreshes after a
  // few seconds, a battery one after minutes (each snapshot wakes it up).
  // If Ring can't produce a new picture, the previous one is served.
  async getSnapshot(id) {
    const cam = this.cameras.get(String(id));
    if (!cam) throw new Error('Unknown Ring camera');
    const slot = this.snapshots.get(cam.key) || {};
    this.snapshots.set(cam.key, slot);
    const life = cam.onBattery ? this.batterySnapshotMs : this.wiredSnapshotMs;
    if (slot.buffer && Date.now() - slot.at < life) return slot.buffer;
    if (!slot.pending) {
      slot.pending = (async () => {
        const res = await this._request(`${this.auth.endpoints.snapshots}${id}?extras=force`, { accept: 'image/jpeg' });
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 100) throw new Error('Ring returned an empty snapshot');
        slot.buffer = buffer; slot.at = Date.now();
        return buffer;
      })().catch((err) => {
        if (slot.buffer) return slot.buffer;
        throw err;
      }).finally(() => { slot.pending = null; });
    }
    return slot.pending;
  }

  /** Same shape as the other camera clients' getCameras() — merged into /api/cameras */
  getCameras() {
    return [...this.cameras.entries()].map(([id, cam]) => ({
      name: this.registry.devices.get(cam.key)?.label || cam.data.description || `Ring ${id}`,
      url: '',
      snapshotUrl: `/api/ring/snapshot/${id}`,
      mjpegUrl: '',
      webrtcUrl: typeof this.streams[id] === 'string' ? this.streams[id] : '',
      _ring: true,
    }));
  }

  status() {
    return {
      signedIn: this.auth.signedIn(),
      cameras: [...this.cameras.entries()].map(([id, cam]) => ({
        id, name: cam.data.description || '', kind: cam.data.kind || '', doorbell: cam.doorbell, battery: cam.onBattery,
        online: cam.data.alerts?.connection !== 'offline',
      })),
    };
  }
}

module.exports = RingClient;
module.exports.RingAuth = RingAuth;
module.exports.RingAuthError = RingAuthError;
module.exports.parseRefreshToken = parseRefreshToken;
