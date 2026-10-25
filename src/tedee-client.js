'use strict';

/**
 * Tedee Bridge client (Tedee smart locks) via the Bridge's own local REST
 * API — no cloud round-trip needed for lock control once "API" is switched
 * on for the Bridge in the Tedee mobile app (Bridge -> Settings -> API),
 * which is also where the `apiToken` used below is shown.
 *
 * Protocol reference: https://docs.tedee.com/bridge-api — base URL
 * `http://<bridge-ip>/v1.0`, every request authenticated via an `api_token`
 * header. Endpoint shapes and the lock-state/doorState/jammed enums are
 * taken from Tedee's own published OpenAPI spec and webhook event-schema
 * docs (github.com/tedee-com/tedee-documentation, bridge-api/spec.json and
 * bridge-api/webhooks/events.md), not guessed.
 *
 * One config entry is one physical Bridge; a Bridge can have several locks
 * paired to it — `GET /lock` returns all of them in a single call, and each
 * becomes its own device in the sensor registry.
 *
 * Keypad PINs for guest stays (guest portal, src/tenant-portal.js) are kept
 * on the lock through the same local API — GET/POST /lock/{id}/pin,
 * DELETE /lock/{id}/pin/{pinId} (5-8 digit `pin`, `alias` ≤ 32 bytes,
 * `startDate`/`endDate` as Unix seconds), per the Bridge API spec 1.19.
 * Only PINs named "LSH-…" are touched (src/lock-codes.js).
 *
 * Untested against real hardware from this codebase — ported faithfully
 * from Tedee's documented wire protocol, but nobody has run this specific
 * file against a real Bridge yet.
 */

const platformStatus = require('./platform-status');
const { watchLockCodes, diffCodes } = require('./lock-codes');

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS     = 2_000;
const REQUEST_TIMEOUT_MS       = 5_000;
// Consecutive failed poll cycles tolerated before the bridge goes offline —
// a Wi-Fi-connected Bridge dropping a request every so often is normal.
const UPDATE_FAILURE_TOLERANCE = 3;

// Lock.state enum — see docs.tedee.com/bridge-api's "Lock state" reference.
const STATE = {
  0: 'Uncalibrated', 1: 'Calibrating', 2: 'Unlocked', 3: 'Semi-locked',
  4: 'Unlocking', 5: 'Locking', 6: 'Locked', 7: 'Pulled', 8: 'Pulling',
  9: 'Unknown', 18: 'Updating',
};
const DOOR_STATE = { 0: 'Not paired', 1: 'Disconnected', 2: 'Opened', 3: 'Closed', 4: 'Uncalibrated' };

/** One request against a Bridge's local REST API. */
async function request(host, apiToken, path, method = 'GET', body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`http://${host}/v1.0${path}`, {
      method,
      headers: {
        api_token: apiToken,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : method !== 'GET' ? { 'Content-Length': '0' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (res.status === 401) throw new Error('invalid API token');
    if (res.status === 404) throw new Error('lock not found on this bridge');
    if (res.status === 405) throw new Error('lock is disconnected from the bridge');
    if (res.status === 409) throw Object.assign(new Error('another PIN operation is in progress'), { busy: true });
    if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`bridge refused the request${body?.['error-description'] ? `: ${body['error-description']}` : ''}`);
    }
    if (res.status === 406) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`lock rejected the command${body?.errorCode ? ` (BLE error ${body.errorCode})` : ''}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.status === 204) return null;
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

class TedeeBridgeDevice {
  constructor(cfg, onLocks) {
    this.host         = cfg.host;
    this.apiToken     = cfg.apiToken;
    this.name         = cfg.name || `Tedee Bridge ${this.host}`;
    this.pollInterval = Math.max(cfg.pollInterval ? cfg.pollInterval * 1000 : DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS);
    this._onLocks     = onLocks; // (locks[]) => void
    this._timer       = null;
    this._failCount   = 0;
  }

  start() {
    this._timer = setInterval(() => this._poll(), this.pollInterval);
    this._poll();
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  lockAction(deviceId, action) {
    return request(this.host, this.apiToken, `/lock/${deviceId}/${action}`, 'POST');
  }

  // PIN operations go over BLE one at a time: 409 = busy, wait and retry
  async pinRequest(path, method = 'GET', body) {
    for (let attempt = 0; ; attempt++) {
      try { return await request(this.host, this.apiToken, path, method, body); }
      catch (err) {
        if (!err.busy || attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  async _poll() {
    try {
      const locks = await request(this.host, this.apiToken, '/lock');
      this._onLocks(locks || []);
      this._failCount = 0;
      platformStatus.set(`tedee-${this.host}`, true);
    } catch (err) {
      this._failCount++;
      console.error(`[Tedee] ${this.name}: poll failed — ${err.message}`);
      if (this._failCount >= UPDATE_FAILURE_TOLERANCE) platformStatus.set(`tedee-${this.host}`, false);
    }
  }
}

class TedeeClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._bridges  = [];
    this._lockBridge = new Map(); // lock id → bridge
    this._codes    = null;
  }

  async start() {
    const cfgDevices = this._config.tedee?.devices || [];
    for (const cfg of cfgDevices) {
      if (!cfg.host || !cfg.apiToken) continue;
      this._addBridge(cfg);
    }
    if (this._bridges.length) {
      this._codes = watchLockCodes(this._store, 'tedee', (lockKey, codes) => this._syncPins(lockKey, codes), { log: 'Tedee' });
    }
  }

  // Make the lock's LSH PINs match the guest portal's wanted codes
  async _syncPins(lockKey, codes) {
    const lockId = lockKey.split('/')[1];
    const bridge = this._lockBridge.get(String(lockId));
    if (!bridge) throw new Error('lock not seen on any configured bridge yet');
    const list = await bridge.pinRequest(`/lock/${lockId}/pin`);
    const existing = (list?.pins || []).map((p) => ({ id: p.id, name: p.alias }));
    const { remove, add } = diffCodes(existing, codes);
    for (const r of remove) await bridge.pinRequest(`/lock/${lockId}/pin/${r.id}`, 'DELETE');
    for (const c of add) {
      if (!/^\d{5,8}$/.test(c.pin)) throw new Error(`PIN for ${c.name} isn't 5-8 digits`);
      await bridge.pinRequest(`/lock/${lockId}/pin`, 'POST', {
        pin: c.pin, alias: c.name,
        startDate: Math.floor(Date.parse(c.from) / 1000), endDate: Math.floor(Date.parse(c.to) / 1000), weekdays: 127,
      });
    }
    return { added: add.length, removed: remove.length };
  }

  stop() {
    for (const bridge of this._bridges) bridge.stop();
    this._bridges = [];
    this._codes?.stop();
  }

  _addBridge(cfg) {
    const bridge = new TedeeBridgeDevice(cfg, (locks) => {
      for (const lock of locks) this._syncLock(bridge, lock);
    });
    bridge.start();
    this._bridges.push(bridge);
    console.log(`[Tedee] Starting: ${cfg.name || cfg.host} (${cfg.host})`);
  }

  _syncLock(bridge, lock) {
    const key = `tedee/${lock.id}`;
    this._lockBridge.set(String(lock.id), bridge);

    if (!this._registry.devices.has(key)) {
      this._registry.registerDevice({
        key,
        type:     'tedee',
        instance: bridge.host,
        label:    lock.name || `Tedee Lock ${lock.id}`,
        icon:     '🔐',
        color:    'gray',
        sensors: [
          { path: 'lock', name: 'Lock', format: 'on-off', controllable: true, type: 'toggle',
            writeOn: 'lock', writeOff: 'unlock', capabilityId: 'lock', homekit: 'lock-rw' },
          { path: 'status',    name: 'Status',  format: 'string' },
          { path: 'battery',   name: 'Battery', format: 'percent', unit: '%', homekit: 'battery-level' },
          { path: 'doorState', name: 'Door',    format: 'string' },
          { path: 'jammed',    name: 'Jammed',  format: 'on-off' },
        ],
        homekit: ['lock-rw', 'battery-level'],
        // capId is always 'lock' — the only controllable sensor here — from
        // both HomeKit (addLockService hardcodes it) and the REST path
        // (sensor.capabilityId below), so it's ignored rather than switched
        // on.
        _writeCapability: async (capId, command) => {
          await bridge.lockAction(lock.id, command === 'lock' ? 'lock' : 'unlock');
        },
      });
    }

    this._store.set(`${key}/lock`, lock.state === 6 ? 1 : 0);
    this._store.set(`${key}/status`, STATE[lock.state] ?? `Unknown (${lock.state})`);
    this._store.set(`${key}/battery`, lock.batteryLevel != null && lock.batteryLevel !== 255 ? lock.batteryLevel : null);
    this._store.set(`${key}/doorState`, DOOR_STATE[lock.doorState] ?? `Unknown (${lock.doorState})`);
    this._store.set(`${key}/jammed`, lock.jammed ? 1 : 0);
  }
}

// Exposed for the Settings "Test Connection" route — probes a Bridge
// without needing a running TedeeClient instance.
TedeeClient.testConnection = ({ host, apiToken }) => request(host, apiToken, '/bridge');

module.exports = TedeeClient;
