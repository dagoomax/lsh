'use strict';

const https          = require('https');
const PollingClient  = require('./polling-client');

let WebSocketLib = null;
try { WebSocketLib = require('ws'); } catch { /* polling only */ }

// UniFi Access's local "Developer API" — a fixed port on the same console,
// separate from the UniFi Protect proxy this repo already talks to. Auth is
// a single Bearer token (Access → Settings → General → Advanced → API Token,
// "Security → Advanced" on older versions), no session/cookie handshake.
//
//   GET  /api/v1/developer/doors                      door position + lock relay
//   PUT  /api/v1/developer/doors/:id/unlock           remote unlock (one pulse)
//   GET/PUT /api/v1/developer/doors/:id/lock_rule     keep_lock / keep_unlock /
//        custom (minutes) / reset / lock_early / lock_now   (Access 1.24.6+)
//   GET/PUT /api/v1/developer/doors/settings/emergency    lockdown / evacuation
//   GET  /api/v1/developer/devices                    hubs, readers, intercoms
//   WSS  /api/v1/developer/devices/notifications      doorbell rings, door
//        position / lock changes, access logs (Access 1.20.11+)
//
// Devices: one per door (`unifiAccess/<door id>`) and `unifiAccess/system`
// (lockdown / evacuation for every door). The WebSocket makes rings and door
// changes instant; the 30 s poll reconciles everything (and is all there is
// on an Access version without notifications). `host` may carry a port
// ("127.0.0.1:12445") — the simulator, or a console behind a port forward.
const ACCESS_PORT = 12445;
const POLL_MS     = 30_000;
const RULES       = ['keep_lock', 'keep_unlock', 'custom', 'reset', 'lock_early', 'lock_now'];
const SYSTEM      = 'unifiAccess/system';
const ACTOR       = { actor_id: 'lsh', actor_name: 'LSH' };

class UnifiAccessClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'unifiAccess', logTag: 'UniFi Access' });
    this.cfg            = config.unifiAccess || {};
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.devices        = [];
    this._doors         = new Map(); // id → door
    this._readers       = new Map(); // device id → { name, type, doorId }
    this._ringResets    = {};
    this._rules         = !this.cfg.noLockRules; // Access < 1.24.6 answers 404 — then off
    this._ws            = null;
    this._wsBackoff     = 5_000;
    this._stopped       = false;
  }

  async start() {
    if (!this.cfg.host || !this.cfg.apiKey) throw new Error('unifiAccess.host and unifiAccess.apiKey are required');
    await this._discover();
    await this.startPolling(POLL_MS);
    this._connectEvents();
    console.log(`[UniFi Access] Started — ${this._doors.size} door(s), ${this._readers.size} reader(s)`);
  }

  stop() {
    this._stopped = true;
    this.stopPolling?.();
    clearTimeout(this._wsReconnect);
    for (const t of Object.values(this._ringResets)) clearTimeout(t);
    try { this._ws?.terminate(); } catch { /* closed */ }
  }

  // ── Discovery ─────────────────────────────────────────────

  async _discover() {
    const doors = await this._get('/api/v1/developer/doors');
    for (const door of doors) this._registerDoor(door);
    await this._loadReaders().catch((err) => console.warn(`[UniFi Access] Device list: ${err.message}`));
    this._registerSystem();
  }

  _registerDoor(door) {
    this._doors.set(door.id, door);
    const key = `unifiAccess/${door.id}`;
    const device = {
      key, type: 'unifiAccess', instance: door.id,
      label: door.name || door.full_name || door.id,
      icon: '🚪', color: 'blue', sensitive: true,
      sensors: [
        { path: 'contact', name: 'Door', format: 'on-off', homekit: 'contact' },
        // lock → lock_now ends a temporary unlock and the unlock schedule;
        // unlock is the usual one-pulse remote unlock
        { path: 'lock', name: 'Lock', format: 'on-off', controllable: true, type: 'toggle',
          writeOn: 'lock', writeOff: 'unlock', capabilityId: 'lock', homekit: 'lock-rw' },
        { path: 'doorbell', name: 'Doorbell', format: 'on-off' },
        { path: 'keepUnlocked', name: 'Keep unlocked', format: 'on-off', controllable: true, type: 'toggle',
          writeOn: 'keep_unlock', writeOff: 'reset', capabilityId: 'rule' },
        { path: 'keepLocked', name: 'Keep locked', format: 'on-off', controllable: true, type: 'toggle',
          writeOn: 'keep_lock', writeOff: 'reset', capabilityId: 'rule' },
        // unlock for N minutes (lock rule "custom"); setRule takes any rule name
        { path: 'unlockFor', name: 'Unlock for (min)', format: 'number', controllable: true, type: 'range', min: 1, max: 480,
          writeCmd: 'custom', capabilityId: 'unlockFor', hidden: true },
        { path: 'setRule', name: 'Set lock rule', format: 'text', controllable: true, type: 'text',
          writeCmd: 'rule', capabilityId: 'ruleText', hidden: true },
        { path: 'lockRule', name: 'Lock rule', format: 'text' },
        { path: 'lockRuleEnds', name: 'Rule ends', format: 'text' },
        { path: 'lastAccess', name: 'Last access', format: 'text' },
      ],
      homekit: ['contact', 'lock-rw'],
      _writeCapability: (capId, command, args) => this._writeDoor(door.id, capId, command, args),
    };
    this.devices.push(device);
    this.sensorRegistry.registerDevice(device);
    this.store.update(`${key}/doorbell`, 0);
  }

  _registerSystem() {
    const device = {
      key: SYSTEM, type: 'unifiAccess', instance: 'system', label: 'UniFi Access', icon: '🛡', color: 'red', sensitive: true,
      sensors: [
        { path: 'lockdown', name: 'Lockdown', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'lockdown' },
        { path: 'evacuation', name: 'Evacuation', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'evacuation' },
        { path: 'doors', name: 'Doors', format: 'number' },
        { path: 'readers', name: 'Readers', format: 'number' },
        { path: 'openDoors', name: 'Open doors', format: 'number' },
      ],
      homekit: [],
      _writeCapability: (capId, command) => this._writeEmergency(capId, command),
    };
    this.devices.push(device);
    this.sensorRegistry.registerDevice(device);
  }

  async _loadReaders() {
    let list = await this._get('/api/v1/developer/devices');
    if (Array.isArray(list[0])) list = list.flat(); // grouped per hub on some versions
    this._readers.clear();
    for (const d of list) {
      if (!d?.id) continue;
      this._readers.set(d.id, { name: d.alias || d.name || d.id, type: d.type || '', doorId: d.location_id || d.door_id || null });
    }
    this.store.update(`${SYSTEM}/readers`, this._readers.size);
  }

  // ── Polling ───────────────────────────────────────────────

  async _pollImpl() {
    const doors = await this._get('/api/v1/developer/doors');
    for (const d of doors) {
      if (!this._doors.has(d.id)) this._registerDoor(d);
      this._doors.set(d.id, d);
      this._applyDoor(d.id, { dps: d.door_position_status, lock: d.door_lock_relay_status });
    }
    this.store.update(`${SYSTEM}/doors`, doors.length);
    this.store.update(`${SYSTEM}/openDoors`, doors.filter((d) => d.door_position_status === 'open').length);
    if (this._rules) await this._pollRules(doors);
    const em = await this._getData('/api/v1/developer/doors/settings/emergency').catch(() => null);
    if (em && typeof em === 'object') this._applyEmergency(em);
  }

  async _pollRules(doors) {
    for (const d of doors) {
      try {
        this._applyRule(d.id, await this._getData(`/api/v1/developer/doors/${d.id}/lock_rule`));
      } catch (err) {
        if (err.status === 404) { this._rules = false; console.log('[UniFi Access] No lock rules on this Access version (needs 1.24.6+)'); return; }
        throw err;
      }
    }
  }

  // `dps`: open / close / '' (no sensor); `lock`: lock / unlock (REST) or locked / unlocked (WebSocket)
  _applyDoor(id, { dps, lock }) {
    const k = `unifiAccess/${id}`;
    if (dps === 'open' || dps === 'close' || dps === 'closed') this.store.update(`${k}/contact`, dps === 'open' ? 1 : 0);
    if (lock) this.store.update(`${k}/lock`, /^lock(ed)?$/.test(lock) ? 1 : 0);
  }

  _applyRule(id, rule) {
    const k = `unifiAccess/${id}`;
    const type = rule?.type || '';
    this.store.update(`${k}/lockRule`, type || 'none');
    this.store.update(`${k}/keepUnlocked`, type === 'keep_unlock' ? 1 : 0);
    this.store.update(`${k}/keepLocked`, type === 'keep_lock' ? 1 : 0);
    // "keep" rules come back with an end time far in the future (year 2084) — no end
    const ends = Number(rule?.ended_time) || 0;
    this.store.update(`${k}/lockRuleEnds`, ends && ends < 2_000_000_000 && type !== 'keep_lock' && type !== 'keep_unlock'
      ? new Date(ends * 1000).toISOString() : '');
  }

  _applyEmergency(em) {
    if (em.lockdown !== undefined) this.store.update(`${SYSTEM}/lockdown`, em.lockdown ? 1 : 0);
    if (em.evacuation !== undefined) this.store.update(`${SYSTEM}/evacuation`, em.evacuation ? 1 : 0);
  }

  // ── Commands ──────────────────────────────────────────────

  async _writeDoor(doorId, capId, command, args) {
    const k = `unifiAccess/${doorId}`;
    if (capId === 'lock') {
      if (command === 'unlock' || command === 'off' || command === '0') {
        await this._put(`/api/v1/developer/doors/${doorId}/unlock`, ACTOR);
        this.store.update(`${k}/lock`, 0);
      } else {
        await this._setRule(doorId, 'lock_now');
        this.store.update(`${k}/lock`, 1);
      }
    } else if (capId === 'rule') {
      await this._setRule(doorId, command);
    } else if (capId === 'ruleText') {
      // "keep_unlock", "reset", "custom:15", …
      const [type, n] = String(args?.[0] ?? '').trim().toLowerCase().split(':');
      if (type === 'custom') return this._writeDoor(doorId, 'unlockFor', 'custom', [n]);
      await this._setRule(doorId, type);
    } else if (capId === 'unlockFor') {
      const minutes = Math.round(Number(args?.[0]));
      if (!(minutes >= 1 && minutes <= 480)) throw new Error('Unlock time: 1–480 minutes');
      await this._setRule(doorId, 'custom', minutes);
    } else {
      throw new Error(`Unknown capability '${capId}'`);
    }
    if (this._rules) this._applyRule(doorId, await this._getData(`/api/v1/developer/doors/${doorId}/lock_rule`).catch(() => null));
    // a rule moves the lock relay — read it back instead of waiting for the poll
    if (capId !== 'lock') {
      const d = await this._getData(`/api/v1/developer/doors/${doorId}`).catch(() => null);
      if (d?.id) this._applyDoor(d.id, { dps: d.door_position_status, lock: d.door_lock_relay_status });
    }
  }

  async _setRule(doorId, type, interval) {
    if (!RULES.includes(type)) throw new Error(`Unknown lock rule '${type}' (${RULES.join(', ')})`);
    const body = { type };
    if (type === 'custom') body.interval = interval || 10;
    try {
      await this._put(`/api/v1/developer/doors/${doorId}/lock_rule`, body);
    } catch (err) {
      if (err.status === 404) throw new Error('Lock rules need UniFi Access 1.24.6 or newer');
      throw err;
    }
  }

  async _writeEmergency(capId, command) {
    if (capId !== 'lockdown' && capId !== 'evacuation') throw new Error(`Unknown capability '${capId}'`);
    const on = command === 'on' || command === '1' || command === true;
    // one switch at a time: turning one on releases the other
    const body = { lockdown: false, evacuation: false, [capId]: on };
    await this._put('/api/v1/developer/doors/settings/emergency', body);
    this._applyEmergency(body);
  }

  // ── Notifications (WebSocket) ─────────────────────────────

  _connectEvents() {
    if (!WebSocketLib || this._stopped || this.cfg.websocket === false) return;
    const [hostname, port] = this._hostPort();
    const ws = new WebSocketLib(`wss://${hostname}:${port}/api/v1/developer/devices/notifications`, {
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, rejectUnauthorized: false,
    });
    this._ws = ws;
    ws.on('open', () => {
      this._wsBackoff = 5_000;
      ws._lshPing = setInterval(() => { try { ws.ping(); } catch { /* closing */ } }, 30_000);
      console.log('[UniFi Access] Notifications connected');
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; } // "Hello" and other keep-alive text
      try { this._handleEvent(msg); } catch (err) { console.error(`[UniFi Access] Notification: ${err.message}`); }
    });
    ws.on('error', (err) => { if (!/401|404/.test(err.message)) console.error(`[UniFi Access] Notifications: ${err.message}`); else this._wsBackoff = 300_000; });
    ws.on('close', () => {
      clearInterval(ws._lshPing);
      if (this._stopped) return;
      clearTimeout(this._wsReconnect);
      this._wsReconnect = setTimeout(() => this._connectEvents(), this._wsBackoff);
      this._wsBackoff = Math.min(this._wsBackoff * 2, 300_000);
    });
  }

  _handleEvent(msg) {
    const d = msg?.data || {};
    switch (msg?.event) {
      case 'access.remote_view': {        // doorbell ringing (intercom / reader)
        const door = this._doorFor(d);
        if (door) this._ring(door.id, true, d.request_id);
        break;
      }
      case 'access.remote_view.change': { // answered, declined, timed out, canceled
        const id = Object.keys(this._ringing || {}).find((x) => this._ringing[x] === d.remote_call_request_id);
        if (id) this._ring(id, false);
        break;
      }
      case 'access.hw.door_bell':
        if (this._doors.has(d.door_id)) this._ring(d.door_id, true);
        break;
      case 'access.data.device.remote_unlock':
        if (this._doors.has(d.unique_id)) this.store.update(`unifiAccess/${d.unique_id}/lock`, 0);
        break;
      case 'access.data.v2.location.update':
      case 'access.data.device.location_update_v2':
        if (this._doors.has(d.id) && d.state) this._applyDoor(d.id, d.state);
        break;
      case 'access.data.v2.device.update':
        for (const st of d.location_states || []) if (this._doors.has(st.location_id)) this._applyDoor(st.location_id, st);
        break;
      case 'access.data.setting.update':
        this._applyEmergency(d);
        break;
      case 'access.logs.add':
        this._logEntry(d.source || d, msg.door_id);
        break;
      default:
        break;
    }
  }

  // remote_view names the door and the ringing device — match either
  _doorFor(d) {
    const rd = this._readers.get(d.device_id);
    if (rd?.doorId && this._doors.has(rd.doorId)) return this._doors.get(rd.doorId);
    const name = String(d.door_name || '').toLowerCase();
    return [...this._doors.values()].find((x) => (x.name || '').toLowerCase() === name || (x.full_name || '').toLowerCase() === name) || null;
  }

  _ring(doorId, on, requestId) {
    const key = `unifiAccess/${doorId}/doorbell`;
    this._ringing = this._ringing || {};
    clearTimeout(this._ringResets[doorId]);
    if (on) {
      this._ringing[doorId] = requestId || null;
      this.store.update(key, 1);
      console.log(`[UniFi Access] 🔔 Ring: ${this._doors.get(doorId)?.name || doorId}`);
      // a ring that's never answered or canceled still ends (Access times out after ~30 s)
      this._ringResets[doorId] = setTimeout(() => this._ring(doorId, false), 30_000);
    } else {
      delete this._ringing[doorId];
      this.store.update(key, 0);
    }
  }

  // Who opened which door: "Anna · NFC" (event types access.door.unlock etc.)
  _logEntry(src, fallbackDoor) {
    const target = (src.target || []).find((t) => t.type === 'door');
    const doorId = target?.id || fallbackDoor;
    if (!doorId || !this._doors.has(doorId)) return;
    const who = src.actor?.display_name || '';
    const how = src.authentication?.credential_provider || '';
    const result = src.event?.result || '';
    const text = [who, how && how.replace(/_/g, ' ').toLowerCase(), result && result !== 'ACCESS' ? result.toLowerCase() : ''].filter(Boolean).join(' · ');
    if (text) this.store.update(`unifiAccess/${doorId}/lastAccess`, text);
  }

  // ── HTTP ─────────────────────────────────────────────────

  _hostPort() {
    const h = String(this.cfg.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const m = /^(.*):(\d+)$/.exec(h);
    return m ? [m[1], Number(m[2])] : [h, ACCESS_PORT];
  }

  // Developer API wraps every payload as { code, msg, data }
  async _getData(path) {
    const { status, data } = await this._request('GET', path);
    if (status !== 200) { const e = new Error(`HTTP ${status} for ${path}`); e.status = status; throw e; }
    if (data?.code !== 'SUCCESS') throw new Error(`API error for ${path}: ${data?.msg || 'unknown'}`);
    return data.data;
  }

  async _get(path) {
    const data = await this._getData(path);
    if (!Array.isArray(data)) throw new Error(`Unexpected response for ${path}`);
    return data;
  }

  async _put(path, body) {
    const { status, data } = await this._request('PUT', path, body);
    if (status !== 200 || data?.code !== 'SUCCESS') {
      const e = new Error(`HTTP ${status} ${data?.msg || ''}`.trim()); e.status = status; throw e;
    }
    return data.data;
  }

  _request(method, path, body) {
    const [hostname, port] = this._hostPort();
    const payload = body === undefined ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname, port, path, method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.cfg.apiKey}`,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        rejectUnauthorized: false, // local console, self-signed cert
        timeout: 10_000,
      }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: raw }); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}

UnifiAccessClient.RULES = RULES;
module.exports = UnifiAccessClient;
