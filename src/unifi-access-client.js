'use strict';

const https          = require('https');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

// UniFi Access's local "Developer API" — a fixed port on the same console,
// separate from the UniFi Protect proxy this repo already talks to. Auth is
// a single Bearer token (Settings → Security → Advanced → API Token in the
// Access console), no session/cookie handshake needed.
const ACCESS_PORT = 12445;
const POLL_MS     = 30_000;

class UnifiAccessClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this.cfg            = config.unifiAccess;
    this.store          = store;
    this.sensorRegistry = sensorRegistry;
    this.devices        = [];
    this.pollTimer      = null;
  }

  async start() {
    await this._discoverDoors();
    platformStatus.set('unifiAccess', true);
    this.pollTimer = setInterval(() => this._poll().catch(() => {}), POLL_MS);
    console.log(`[UniFi Access] Started — ${this.devices.length} door(s)`);
  }

  stop() {
    clearInterval(this.pollTimer);
  }

  // ── Discovery ─────────────────────────────────────────────

  async _discoverDoors() {
    const doors = await this._get('/api/v1/developer/doors');
    for (const door of doors) this._registerDoor(door);
    this._applyDoors(doors);
  }

  _registerDoor(door) {
    const deviceKey = `unifiAccess/${door.id}`;
    const device = {
      key: deviceKey, type: 'unifiAccess', instance: door.id,
      label: door.full_name || door.name || door.id,
      icon: '🚪', color: 'blue',
      sensors: [
        { path: 'contact', name: 'Door', format: 'on-off', homekit: 'contact' },
        // Only "unlock" is a real remote action — Access doors re-lock
        // themselves on their own schedule/timeout; there is no "lock now"
        // call in the Developer API, so writeOn is a deliberate no-op (see
        // _writeCapability below, matches every other Access integration).
        { path: 'lock', name: 'Lock', format: 'on-off', controllable: true, type: 'toggle',
          writeOn: 'lock', writeOff: 'unlock', capabilityId: 'lock', homekit: 'lock-rw' },
      ],
      homekit: ['contact', 'lock-rw'],
      _writeCapability: (capId, command) => this._writeCapability(door.id, capId, command),
    };
    this.devices.push(device);
    this.sensorRegistry.registerDevice(device);
  }

  _applyDoors(doors) {
    for (const door of doors) {
      const k = `unifiAccess/${door.id}`;
      this.store.update(`${k}/contact`, door.door_position_status === 'open' ? 1 : 0);
      this.store.update(`${k}/lock`, door.door_lock_relay_status === 'lock' ? 1 : 0);
    }
  }

  // ── Commands ──────────────────────────────────────────────

  async _writeCapability(doorId, capId, command) {
    if (capId !== 'lock') throw new Error(`Unknown capability '${capId}'`);
    if (command === 'lock') {
      // No remote "lock" call exists — the door secures itself automatically.
      // The next poll corrects the store back to the door's real state.
      console.log('[UniFi Access] Ignoring "lock" — doors re-lock themselves; only unlock is remote-controllable');
      return;
    }
    const { status, data } = await this._request('PUT', `/api/v1/developer/doors/${doorId}/unlock`);
    if (status !== 200 || data?.code !== 'SUCCESS') {
      throw new Error(`Unlock failed: HTTP ${status} ${data?.msg || ''}`.trim());
    }
  }

  // ── Polling ───────────────────────────────────────────────

  async _poll() {
    let doors;
    try {
      doors = await this._get('/api/v1/developer/doors');
    } catch (err) {
      console.error(`[UniFi Access] Poll failed: ${err.message}`);
      platformStatus.set('unifiAccess', false);
      return;
    }
    platformStatus.set('unifiAccess', true);
    this._applyDoors(doors);
  }

  // ── HTTP ─────────────────────────────────────────────────

  async _get(path) {
    const { status, data } = await this._request('GET', path);
    if (status !== 200) throw new Error(`HTTP ${status} for ${path}`);
    // Developer API wraps every payload as { code, msg, data }
    if (data?.code !== 'SUCCESS') throw new Error(`API error for ${path}: ${data?.msg || 'unknown'}`);
    if (!Array.isArray(data.data)) throw new Error(`Unexpected response for ${path}`);
    return data.data;
  }

  _request(method, path) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.cfg.host,
        port:     ACCESS_PORT,
        path,
        method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.cfg.apiKey}`,
        },
        rejectUnauthorized: false, // local console, self-signed cert
      }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: raw }); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = UnifiAccessClient;
