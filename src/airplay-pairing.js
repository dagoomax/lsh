'use strict';

// Remembered AirPlay 2 pairings — so an Apple TV / HomePod that asks for a PIN
// (on-screen code, "first time only") or an AirPlay password is paired once
// and then accepts LSH without asking again.
//
// @lox-audioserver/node-airplay-sender can do the HomeKit pair-setup (with the
// PIN the Apple TV shows) but makes up a fresh identity every session and
// forgets it, so the TV would ask for a new PIN every time. This module
// patches its RTSP client (the library has no hook for it):
//   • after a successful pair-setup it saves the identity LSH used (pairing id
//     + Ed25519 key) and the device's long-term public key, per speaker;
//   • on the next connection to that speaker it skips pair-setup and goes
//     straight to pair-verify with the saved identity — no PIN.
// Stored in persist/airplay-pairings.json (override LSH_AIRPLAY_PAIRINGS),
// file mode 600 — it's a credential.

const fs = require('fs');
const path = require('path');

const FILE = process.env.LSH_AIRPLAY_PAIRINGS || path.join(__dirname, '..', 'persist', 'airplay-pairings.json');

// RTSP client states (dist/core/rtsp.js)
const RECORD = 3, PAIR_PIN_START = 14, PAIR_SETUP_3 = 20, PAIR_VERIFY_HAP_1 = 21, SETUP_AP2_1 = 23;

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} } }
function write(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

const get = (speakerId) => load()[speakerId] || null;
const list = () => load();
function save(speakerId, entry) { const all = load(); all[speakerId] = { ...entry, pairedAt: new Date().toISOString() }; write(all) }
function remove(speakerId) { const all = load(); if (!all[speakerId]) return false; delete all[speakerId]; write(all); return true }

// host → { speakerId, creds | null, onSaved?, resumed? } for connections in progress
const sessions = new Map();
function attach(host, speakerId, { onSaved } = {}) {
  const s = { speakerId, creds: get(speakerId), onSaved, resumed: false, verified: false };
  sessions.set(host, s);
  return s;
}
function detach(host) { sessions.delete(host) }

let installed = false;
function install() {
  if (installed) return;
  const dist = path.dirname(require.resolve('@lox-audioserver/node-airplay-sender'));
  const { Client } = require(path.join(dist, 'core', 'rtsp.js'));
  const { Credentials } = require(path.join(dist, 'homekit', 'credentials.js'));
  const proto = Client.prototype;

  // The sender passes the speaker's TXT records (which say "PIN required")
  // inside the options object, but the core reads them from a separate
  // argument — so they never arrive and it always tries transient pairing.
  const core = require(path.join(dist, 'core', 'index.js'));
  const AirTunes = core.default || core;
  const add = AirTunes.prototype.add;
  AirTunes.prototype.add = function (host, options, mode = 0, txt = '') {
    return add.call(this, host, options, mode, txt || options?.txt || '');
  };

  const send = proto.sendNextRequest;
  proto.sendNextRequest = function (...args) {
    const s = sessions.get(this.hostip);
    // Known device: verify with the saved identity instead of asking for a PIN
    // (also on the library's automatic reconnects — but not forever if the
    // device has forgotten us: then it falls back to asking for a PIN)
    if (s?.creds && this.status === PAIR_PIN_START && (this._lshResumes || 0) < 2) {
      const c = s.creds;
      this._lshResumes = (this._lshResumes || 0) + 1;
      s.resumed = true;
      this.pairingId = c.pairingId;
      this.privateKey = Uint8Array.from(Buffer.from(c.privateKey, 'hex'));
      this.seed = Buffer.from(c.seed, 'hex');
      this.credentials = new Credentials('sdsds', Buffer.from(c.identifier, 'hex'), c.pairingId, Buffer.from(c.publicKey, 'hex'), this.seed);
      this.status = PAIR_VERIFY_HAP_1;
    }
    // RECORD derives the event-channel keys from this.srp.computeK(), which only
    // exists after a pair-setup in this same connection. A resumed session
    // skipped that (pair-verify only), so the library threw "computeK is not a
    // function" and the speaker timed out. AirPlay 2 derives them from the
    // pair-verify shared secret then, as it already does for the control keys.
    if (this.status === RECORD && this.sharedSecret && typeof this.srp?.computeK !== 'function') {
      const k = Buffer.from(this.sharedSecret);
      this.srp = { computeK: () => k };
    }
    return send.apply(this, args);
  };

  const proc = proto.processData;
  proto.processData = function (...args) {
    const before = this.status;
    const r = proc.apply(this, args);
    // the device accepted the saved identity: it answered the first encrypted
    // request (the library doesn't check pair-verify's error code itself)
    if (before === SETUP_AP2_1 && this.status !== SETUP_AP2_1) { const s = sessions.get(this.hostip); if (s) s.verified = true }
    // pair-setup just finished: keep the identity for next time
    if (before === PAIR_SETUP_3 && this.status === PAIR_VERIFY_HAP_1 && this.credentials && this.privateKey) {
      const s = sessions.get(this.hostip);
      if (s) {
        const entry = {
          host: this.hostip,
          pairingId: String(this.pairingId),
          privateKey: Buffer.from(this.privateKey).toString('hex'),
          seed: Buffer.from(this.seed).toString('hex'),
          identifier: Buffer.from(this.credentials.identifier || []).toString('hex'),
          publicKey: Buffer.from(this.credentials.publicKey || []).toString('hex'),
        };
        save(s.speakerId, entry);
        s.creds = entry;
        try { s.onSaved?.(entry) } catch {}
      }
    }
    return r;
  };
  installed = true;
}

module.exports = { install, attach, detach, get, list, save, remove, FILE };
