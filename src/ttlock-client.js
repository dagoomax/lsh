'use strict';

// TTLock — locks sold under many brands (TTLock app, Sciener-based locks)
// through the TTLock Open Platform cloud API. Needs an app registered at
// the TTLock open platform (client id + secret) and the TTLock app account
// the locks are in. Remote state, lock/unlock and passcodes need the lock
// to be connected to a TTLock gateway (G2/G3/G4) — locks without one show
// their battery only.
//
//   token   POST <host>/oauth2/token (form) client_id, client_secret,
//           username, password = lowercase MD5 → access_token, refresh_token,
//           expires_in (s, ~90 days); refresh with grant_type=refresh_token.
//           Kept in persist/ttlock-token.json so restarts don't log in again.
//   calls   <host>/v3/<path>, clientId + accessToken + date (ms) in the query;
//           POST bodies are form-encoded. HTTP 200 even on errors — errcode
//           0/absent = OK, 10004 = token expired (refresh, retry once).
//   locks   GET lock/list · GET lock/queryOpenState (state 0 locked,
//           1 unlocked, 2 unknown; sensorState 0 open, 1 closed) ·
//           GET lock/lock, lock/unlock
//   codes   GET lock/listKeyboardPwd · POST keyboardPwd/add (addType 2 =
//           through the gateway, keyboardPwdType 3 = period, startDate /
//           endDate in ms) · POST keyboardPwd/delete (deleteType 2)
//
// The guest portal's stay PINs (src/tenant-portal.js) become period
// passcodes on the lock — only ones named "LSH-…" are touched
// (src/lock-codes.js). TTLock's own documentation site no longer serves
// these pages; the shapes above follow the Home Assistant TTLock
// integration (jbergler/hass-ttlock). Not run against a real lock from
// this codebase — scripts/ttlock-simulator.js stands in for the cloud.
//
// config.ttlock = { clientId, clientSecret, username, password,
//                   region: 'eu' | 'cn', pollSeconds: 60 }

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PollingClient = require('./polling-client');
const { watchLockCodes, diffCodes } = require('./lock-codes');

const HOSTS = { eu: 'https://euapi.ttlock.com', cn: 'https://cnapi.ttlock.com' };
const TOKEN_FILE = path.join(__dirname, '..', 'persist', 'ttlock-token.json');
const TIMEOUT = 15_000;
const TOKEN_EXPIRED = 10004;

const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
const STATE = { 0: 'Locked', 1: 'Unlocked', 2: 'Unknown' };

class TTLockApi {
  constructor(cfg, { tokenFile = cfg.tokenFile || TOKEN_FILE } = {}) {
    this.cfg = cfg;
    this.host = cfg.apiBase || HOSTS[cfg.region] || HOSTS.eu; // apiBase: tests / simulator only
    this.tokenFile = tokenFile;
    this.token = null;
    this._queue = Promise.resolve(); // gateway commands go one at a time
  }

  async _form(url, fields, method = 'POST') {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        ...(method === 'POST' ? { body: new URLSearchParams(fields).toString() } : {}),
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (err) {
      throw new Error(err.name === 'TimeoutError' ? 'TTLock cloud did not answer in time' : err.cause?.code || err.message);
    }
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { throw new Error(`TTLock: HTTP ${res.status}, not JSON`); }
    if (!res.ok) throw new Error(`TTLock: HTTP ${res.status}${body.errmsg ? ` — ${body.errmsg}` : ''}`);
    if (body.errcode && body.errcode !== 0) {
      throw Object.assign(new Error(`TTLock: ${body.errmsg || body.description || 'error'} (${body.errcode})`), { errcode: body.errcode });
    }
    return body;
  }

  _loadToken() {
    try {
      const all = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
      const t = all[`${this.host}|${this.cfg.username}`];
      if (t?.access_token) this.token = t;
    } catch { /* none saved */ }
  }

  _saveToken(t) {
    this.token = { ...t, obtained: Date.now() };
    let all = {};
    try { all = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')); } catch { /* new file */ }
    all[`${this.host}|${this.cfg.username}`] = this.token;
    fs.mkdirSync(path.dirname(this.tokenFile), { recursive: true });
    fs.writeFileSync(this.tokenFile, JSON.stringify(all, null, 2), { mode: 0o600 });
  }

  async login() {
    // TTLock's own docs name the fields clientId/clientSecret, OAuth clients
    // send client_id/client_secret — both are sent
    const t = await this._form(`${this.host}/oauth2/token`, {
      client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret,
      clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret,
      username: this.cfg.username, password: md5(this.cfg.password),
    });
    if (!t.access_token) throw new Error('TTLock: login returned no access token');
    this._saveToken(t);
  }

  async refresh() {
    if (!this.token?.refresh_token) return this.login();
    try {
      const t = await this._form(`${this.host}/oauth2/token`, {
        grant_type: 'refresh_token', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret,
        refresh_token: this.token.refresh_token,
      });
      if (!t.access_token) throw new Error('no access token');
      this._saveToken({ ...this.token, ...t });
    } catch {
      await this.login();
    }
  }

  async _ensureToken() {
    if (!this.token) this._loadToken();
    if (!this.token) return this.login();
    const ttl = (Number(this.token.expires_in) || 7776000) * 1000;
    if (Date.now() > (this.token.obtained || 0) + ttl - 24 * 3600_000) await this.refresh();
  }

  async call(method, p, params = {}, retried = false) {
    await this._ensureToken();
    const auth = { clientId: this.cfg.clientId, accessToken: this.token.access_token, date: String(Date.now()) };
    const url = new URL(`${this.host}/v3/${p}`);
    for (const [k, v] of Object.entries(method === 'GET' ? { ...params, ...auth } : auth)) url.searchParams.set(k, v);
    try {
      return await this._form(url.toString(), method === 'POST' ? params : {}, method);
    } catch (err) {
      if (err.errcode === TOKEN_EXPIRED && !retried) { await this.refresh(); return this.call(method, p, params, true); }
      throw err;
    }
  }

  // commands relayed by a gateway over Bluetooth: one at a time
  serial(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }
}

class TTLockClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'ttlock', logTag: 'TTLock' });
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._api = null;
    this._locks = new Map(); // lockId → { hasGateway }
    this._codes = null;
  }

  async start() {
    const cfg = this._config.ttlock || {};
    if (!cfg.clientId || !cfg.clientSecret || !cfg.username || !cfg.password) return;
    this._api = new TTLockApi(cfg);
    const seconds = Math.max(30, Number(cfg.pollSeconds) || 60);
    console.log(`[TTLock] Started — ${cfg.username}, polling every ${seconds}s`);
    this._codes = watchLockCodes(this._store, 'ttlock', (lockKey, codes) => this._syncCodes(lockKey, codes), { log: 'TTLock' });
    await this.startPolling(seconds * 1000);
  }

  stop() {
    super.stop();
    this._codes?.stop();
  }

  async _pollImpl() {
    const res = await this._api.call('GET', 'lock/list', { pageNo: 1, pageSize: 1000 });
    for (const l of res.list || []) {
      const id = l.lockId;
      const hasGateway = Number(l.hasGateway) === 1;
      this._locks.set(id, { hasGateway });
      this._register(id, l.lockAlias || l.lockName || `TTLock ${id}`);
      const key = `ttlock/${id}`;
      this._store.update(`${key}/gateway`, hasGateway);
      if (Number.isFinite(l.electricQuantity)) this._store.update(`${key}/battery`, l.electricQuantity);
      if (!hasGateway) { this._store.update(`${key}/status`, 'No gateway'); continue; }
      try {
        const s = await this._api.serial(() => this._api.call('GET', 'lock/queryOpenState', { lockId: id }));
        this._store.update(`${key}/lock`, s.state === 0 ? 1 : 0);
        this._store.update(`${key}/status`, STATE[s.state] ?? `State ${s.state}`);
        if (s.sensorState === 0 || s.sensorState === 1) this._store.update(`${key}/door`, s.sensorState === 0 ? 'Open' : 'Closed');
        if (Number.isFinite(s.electricQuantity)) this._store.update(`${key}/battery`, s.electricQuantity);
      } catch (err) {
        this._store.update(`${key}/status`, `Unreachable (${err.message.replace(/^TTLock: /, '')})`);
      }
    }
  }

  _register(id, name) {
    const key = `ttlock/${id}`;
    if (this._registry.devices.has(key)) return;
    this._registry.registerDevice({
      key, type: 'ttlock', label: name, icon: '🔐', homekit: ['lock-rw'],
      sensors: [
        { path: 'lock', name: 'Lock', type: 'toggle', format: 'on-off', controllable: true, capabilityId: 'lock', writeOn: 'lock', writeOff: 'unlock', homekit: 'lock-rw' },
        { path: 'status', name: 'Status', type: 'label' },
        { path: 'battery', name: 'Battery', type: 'number', unit: '%', homekit: 'battery-level' },
        { path: 'door', name: 'Door', type: 'label' },
        { path: 'gateway', name: 'Gateway', type: 'boolean' },
      ],
      _writeCapability: (capId, command) => this._command(id, command),
    });
  }

  async _command(id, command) {
    if (!this._locks.get(id)?.hasGateway) throw new Error('This lock has no TTLock gateway — remote lock/unlock needs one');
    const p = command === 'lock' ? 'lock/lock' : 'lock/unlock';
    await this._api.serial(() => this._api.call('GET', p, { lockId: id }));
    this._store.update(`ttlock/${id}/lock`, command === 'lock' ? 1 : 0);
    this._store.update(`ttlock/${id}/status`, command === 'lock' ? 'Locked' : 'Unlocked');
    console.log(`[TTLock] ${id}: ${command}`);
  }

  // Guest-portal stay PINs → period passcodes, added and removed via the gateway
  async _syncCodes(lockKey, codes) {
    const id = Number(lockKey.split('/')[1]);
    const lock = this._locks.get(id);
    if (!lock) throw new Error('lock not found in the TTLock account');
    if (!lock.hasGateway) throw new Error('passcodes from LSH need the lock connected to a TTLock gateway');
    const res = await this._api.call('GET', 'lock/listKeyboardPwd', { lockId: id, pageNo: 1, pageSize: 100 });
    const existing = (res.list || []).map((p) => ({ id: p.keyboardPwdId, name: p.keyboardPwdName }));
    const { remove, add } = diffCodes(existing, codes);
    for (const r of remove) {
      await this._api.serial(() => this._api.call('POST', 'keyboardPwd/delete', { lockId: id, keyboardPwdId: r.id, deleteType: 2 }));
    }
    for (const c of add) {
      await this._api.serial(() => this._api.call('POST', 'keyboardPwd/add', {
        lockId: id, keyboardPwd: c.pin, keyboardPwdName: c.name, keyboardPwdType: 3,
        startDate: Date.parse(c.from), endDate: Date.parse(c.to), addType: 2,
      }));
    }
    return { added: add.length, removed: remove.length };
  }
}

// Settings "Test": log in (with the given, unsaved settings) and list the locks
TTLockClient.test = async (cfg) => {
  const api = new TTLockApi(cfg, { tokenFile: path.join(require('os').tmpdir(), `lsh-ttlock-test-${process.pid}.json`) });
  await api.login();
  const res = await api.call('GET', 'lock/list', { pageNo: 1, pageSize: 1000 });
  try { fs.unlinkSync(api.tokenFile); } catch { /* already gone */ }
  return res.list || [];
};
TTLockClient.TTLockApi = TTLockApi;
TTLockClient.md5 = md5;

module.exports = TTLockClient;
