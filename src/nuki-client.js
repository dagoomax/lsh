'use strict';

// Nuki smart locks (Smart Lock 1.0–4.0, Smart Door) and the Nuki Opener.
//
// Two ways in, use either or both:
//
//   - Nuki Bridge, local HTTP API (port 8080; "Developer mode" on in the
//     Nuki app → Bridge → Manage Bridge, which also shows the token):
//       GET /list                → every paired device + lastKnownState
//       GET /lockAction?nukiId=…&deviceType=…&action=…&nowait=1
//     Requests are signed with the hashed token (ts, rnr, hash =
//     sha256("<ts>,<rnr>,<token>")) so the token itself never goes over the
//     LAN. Shapes and codes are from Nuki's Bridge HTTP API 1.13 as published;
//     its doc page is no longer online and this hasn't been run against a
//     real Bridge from this codebase.
//   - Nuki Web API (cloud; token from web.nuki.io → API): https://api.nuki.io,
//     "Authorization: Bearer <token>" — GET /smartlock, POST
//     /smartlock/{smartlockId}/action. Used for state and control when no
//     Bridge is configured, and always for keypad codes: the guest portal's
//     stay PINs (src/tenant-portal.js) become time-limited keypad codes
//     (auth type 13) via GET/PUT/DELETE /smartlock/{id}/auth — only codes
//     named "LSH-…" are touched (src/lock-codes.js). Endpoint and field names
//     are from Nuki Web API 4.23's swagger.
//
// Each lock is a device nuki/<nukiId>. A Web API smartlockId carries the
// device type above its low 32 bits, which are the Bridge's nukiId.
//
// config.nuki = { bridges: [{ host, port: 8080, token, name }], webToken,
//                 pollSeconds: 15 }

const crypto = require('crypto');
const PollingClient = require('./polling-client');
const { watchLockCodes, diffCodes } = require('./lock-codes');

const WEB = 'https://api.nuki.io';
const TIMEOUT = 10_000;
const OPENER = 2;

// Smart lock state (Bridge lastKnownState.state / Web state.state)
const LOCK_STATE = {
  0: 'Uncalibrated', 1: 'Locked', 2: 'Unlocking', 3: 'Unlocked', 4: 'Locking', 5: 'Unlatched',
  6: "Unlocked (lock 'n' go)", 7: 'Unlatching', 224: 'Wrong entry code', 225: 'Wrong fingerprint',
  254: 'Motor blocked', 255: 'Undefined',
};
const OPENER_STATE = { 0: 'Untrained', 1: 'Online', 3: 'Ring to Open active', 5: 'Open', 7: 'Opening', 253: 'Boot run', 255: 'Undefined' };
const DOOR_STATE = { 0: 'Unavailable', 1: 'Deactivated', 2: 'Closed', 3: 'Open', 4: 'Unknown', 5: 'Calibrating', 16: 'Uncalibrated', 240: 'Removed', 255: 'Unknown' };
// command → action code, per device kind
const ACTIONS = {
  lock: { unlock: 1, lock: 2, unlatch: 3, lockngo: 4 },
  opener: { 'rto-on': 1, 'rto-off': 2, open: 3 },
};

const nukiIdOf = (smartlockId) => Number(BigInt(smartlockId) & 0xffffffffn);

async function call(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? 'no answer in time' : err.cause?.code || err.message);
  }
  if (res.status === 401 || res.status === 403) throw new Error('token rejected (401/403)');
  if (res.status === 402) throw new Error('Nuki Web subscription required for this (402)');
  if (res.status === 503) throw new Error('busy (503) — try again');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

class Bridge {
  constructor(cfg) {
    this.host = String(cfg.host).trim();
    this.port = Number(cfg.port) || 8080;
    this.token = cfg.token;
    this.name = cfg.name || `Nuki Bridge ${this.host}`;
  }

  _auth() {
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rnr = crypto.randomInt(0, 65535);
    const hash = crypto.createHash('sha256').update(`${ts},${rnr},${this.token}`).digest('hex');
    return `ts=${encodeURIComponent(ts)}&rnr=${rnr}&hash=${hash}`;
  }

  get(path, params = '') {
    return call(`http://${this.host}:${this.port}${path}?${params ? `${params}&` : ''}${this._auth()}`);
  }

  list() { return this.get('/list'); }

  async action(nukiId, deviceType, action) {
    const r = await this.get('/lockAction', `nukiId=${nukiId}&deviceType=${deviceType}&action=${action}&nowait=1`);
    if (r && r.success === false) throw new Error('bridge reported the action failed');
    return r;
  }
}

class Web {
  constructor(token, base = WEB) { this.token = token; this.base = base; }
  req(path, method = 'GET', body) {
    return call(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
}

class NukiClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'nuki', logTag: 'Nuki' });
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._bridges = [];
    this._web = null;
    this._locks = new Map(); // nukiId → { bridge?, deviceType, smartlockId? }
    this._codes = null;
  }

  async start() {
    const cfg = this._config.nuki || {};
    this._bridges = (cfg.bridges || []).filter((b) => b?.host && b?.token).map((b) => new Bridge(b));
    // webBase: only for tests / a local simulator
    if (cfg.webToken) this._web = new Web(cfg.webToken, cfg.webBase || WEB);
    if (!this._bridges.length && !this._web) return;
    const src = [this._bridges.length && `${this._bridges.length} bridge(s)`, this._web && 'Nuki Web'].filter(Boolean).join(' + ');
    const seconds = this._bridges.length ? Math.max(5, Number(cfg.pollSeconds) || 15) : Math.max(30, Number(cfg.pollSeconds) || 60);
    console.log(`[Nuki] Started — ${src}, polling every ${seconds}s`);
    this._codes = watchLockCodes(this._store, 'nuki', (lockKey, codes) => this._syncCodes(lockKey, codes), { log: 'Nuki' });
    await this.startPolling(seconds * 1000);
  }

  stop() {
    super.stop();
    this._codes?.stop();
  }

  async _pollImpl() {
    const errors = [];
    let ok = 0;
    for (const b of this._bridges) {
      try {
        for (const d of (await b.list()) || []) {
          ok++;
          this._lock(d.nukiId, d.deviceType, d.name, b);
          this._state(d.nukiId, d.deviceType, d.lastKnownState || {});
        }
      } catch (err) { errors.push(`${b.name}: ${err.message}`); }
    }
    if (this._web) {
      try {
        for (const s of (await this._web.req('/smartlock')) || []) {
          const id = nukiIdOf(s.smartlockId);
          const known = this._locks.get(id);
          this._lock(id, s.type, s.name, known?.bridge, s.smartlockId);
          // the Bridge reports live state; the cloud only when there's no Bridge for it
          if (!known?.bridge) {
            ok++;
            this._state(id, s.type, { ...s.state, batteryChargeState: s.state?.batteryCharge, doorsensorState: s.state?.doorState });
          }
        }
      } catch (err) { errors.push(`Nuki Web: ${err.message}`); }
    }
    if (errors.length && !ok) throw new Error(errors.join('; '));
    if (errors.length) console.warn(`[Nuki] ${errors.join('; ')}`);
  }

  _lock(nukiId, deviceType, name, bridge, smartlockId) {
    const prev = this._locks.get(nukiId) || {};
    this._locks.set(nukiId, { ...prev, deviceType, bridge: bridge || prev.bridge, smartlockId: smartlockId ?? prev.smartlockId });
    const key = `nuki/${nukiId}`;
    if (this._registry.devices.has(key)) return;
    const opener = deviceType === OPENER;
    this._registry.registerDevice({
      key, type: 'nuki', label: name || `Nuki ${nukiId}`, icon: opener ? '🔔' : '🔐',
      homekit: opener ? [] : ['lock-rw'],
      sensors: opener ? [
        { path: 'ringToOpen', name: 'Ring to Open', type: 'toggle', controllable: true, capabilityId: 'rto', writeOn: 'rto-on', writeOff: 'rto-off' },
        { path: 'open', name: 'Open', type: 'trigger', controllable: true, capabilityId: 'open', writeOn: 'open' },
        { path: 'status', name: 'Status', type: 'label' },
        { path: 'batteryCritical', name: 'Battery low', type: 'boolean' },
      ] : [
        { path: 'lock', name: 'Lock', type: 'toggle', format: 'on-off', controllable: true, capabilityId: 'lock', writeOn: 'lock', writeOff: 'unlock', homekit: 'lock-rw' },
        { path: 'open', name: 'Unlatch', type: 'trigger', controllable: true, capabilityId: 'unlatch', writeOn: 'unlatch' },
        { path: 'status', name: 'Status', type: 'label' },
        { path: 'battery', name: 'Battery', type: 'number', unit: '%', homekit: 'battery-level' },
        { path: 'batteryCritical', name: 'Battery low', type: 'boolean' },
        { path: 'door', name: 'Door', type: 'label' },
        { path: 'keypadBatteryCritical', name: 'Keypad battery low', type: 'boolean' },
      ],
      _writeCapability: (capId, command) => this._command(nukiId, command),
    });
  }

  _state(nukiId, deviceType, s) {
    const key = `nuki/${nukiId}`;
    const set = (k, v) => { if (v !== undefined && v !== null) this._store.update(`${key}/${k}`, v); };
    if (deviceType === OPENER) {
      set('status', OPENER_STATE[s.state] ?? s.stateName ?? `State ${s.state}`);
      set('ringToOpen', s.state === 3 ? 1 : 0);
      set('batteryCritical', !!s.batteryCritical);
      return;
    }
    set('lock', s.state === 1 ? 1 : 0);
    set('status', LOCK_STATE[s.state] ?? s.stateName ?? `State ${s.state}`);
    set('battery', Number.isFinite(s.batteryChargeState) ? s.batteryChargeState : null);
    set('batteryCritical', !!s.batteryCritical);
    if (s.doorsensorState != null && s.doorsensorState !== 0) set('door', DOOR_STATE[s.doorsensorState] ?? s.doorsensorStateName ?? `State ${s.doorsensorState}`);
    if (s.keypadBatteryCritical != null) set('keypadBatteryCritical', !!s.keypadBatteryCritical);
  }

  async _command(nukiId, command) {
    const lock = this._locks.get(nukiId);
    if (!lock) throw new Error('Nuki device not found');
    const action = ACTIONS[lock.deviceType === OPENER ? 'opener' : 'lock'][command];
    if (!action) throw new Error(`Unknown Nuki command ${command}`);
    if (lock.bridge) await lock.bridge.action(nukiId, lock.deviceType, action);
    else if (this._web && lock.smartlockId != null) await this._web.req(`/smartlock/${lock.smartlockId}/action`, 'POST', { action });
    else throw new Error('No Bridge or Nuki Web access for this lock');
    console.log(`[Nuki] ${nukiId}: ${command}`);
    setTimeout(() => this._poll().catch(() => {}), 2500).unref?.();
  }

  // Guest-portal stay PINs → keypad codes (auth type 13) through Nuki Web
  async _syncCodes(lockKey, codes) {
    if (!this._web) throw new Error('keypad codes need a Nuki Web API token');
    const lock = this._locks.get(Number(lockKey.split('/')[1]));
    if (lock?.smartlockId == null) throw new Error('lock not found in the Nuki Web account');
    const sid = lock.smartlockId;
    const auths = (await this._web.req(`/smartlock/${sid}/auth?types=13`)) || [];
    const { remove, add } = diffCodes(auths.filter((a) => a.type === 13 || a.type == null).map((a) => ({ id: a.id, name: a.name })), codes);
    for (const r of remove) await this._web.req(`/smartlock/${sid}/auth/${r.id}`, 'DELETE');
    for (const c of add) {
      await this._web.req(`/smartlock/${sid}/auth`, 'PUT', {
        name: c.name, type: 13, code: Number(c.pin), remoteAllowed: false,
        allowedFromDate: c.from, allowedUntilDate: c.to, allowedWeekDays: 127, allowedFromTime: 0, allowedUntilTime: 0,
      });
    }
    return { added: add.length, removed: remove.length };
  }
}

// Settings "Test": list what a Bridge / the Web API sees, without saving
NukiClient.testBridge = (cfg) => new Bridge(cfg).list();
NukiClient.testWeb = (token) => new Web(token).req('/smartlock');
NukiClient.nukiIdOf = nukiIdOf;

module.exports = NukiClient;
