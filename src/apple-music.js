'use strict';

// Apple Music — Apple Music API developer token + a relay for the browser
// player. Apple has no API to control playback on other devices, so music
// plays in the dashboard's Music page (MusicKit JS, signed in with the
// listener's Apple ID; full tracks need an Apple Music subscription).
//
// The server holds the MusicKit private key (Apple Developer account →
// Certificates, IDs & Profiles → Keys → MusicKit) and signs the developer
// token (ES256 JWT, cached; Apple allows up to 6 months — we use 12 h).
//
// The Music page reports its state every couple of seconds; LSH shows it as
// the device `applemusic/player` (play/pause, next/previous, volume, now
// playing). Commands to that device are queued and picked up by the page on
// its next report — so they work while a Music page is open somewhere.
//
// config.appleMusic = { teamId, keyId, privateKey (PEM text of the .p8) | keyFile, storefront = 'us' }

const fs = require('fs');
const crypto = require('crypto');
const platformStatus = require('./platform-status');

const KEY = 'applemusic/player';
const TOKEN_TTL_S = 12 * 3600;
const STALE_MS = 15000;
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function loadKey(cfg) {
  const pem = cfg.privateKey || (cfg.keyFile ? fs.readFileSync(cfg.keyFile, 'utf8') : null);
  if (!pem) throw new Error('No MusicKit private key');
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ec') throw new Error('The MusicKit key must be the EC (.p8) key from your Apple Developer account');
  return key;
}

// ES256 JWT as Apple wants it: header { alg, kid }, claims { iss: team, iat, exp }
function signDeveloperToken({ teamId, keyId, key, ttl = TOKEN_TTL_S, now = Math.floor(Date.now() / 1000) }) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: now, exp: now + ttl }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64url(sig)}`;
}

class AppleMusic {
  constructor(config, store, sensorRegistry) {
    this.cfg = config.appleMusic || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.apiBase = (this.cfg.apiBase || 'https://api.music.apple.com').replace(/\/$/, '');
    this.cached = null;      // { token, exp }
    this.check = null;       // { ok, error, at }
    this.players = new Map(); // playerId → { name, state, at, queue: [] }
    this.timer = null;
  }

  async start() {
    platformStatus.set('appleMusic', false);
    this.key = loadKey(this.cfg);
    this._register();
    this.verify().catch(() => {});
    // Mark a player gone when its page stops reporting
    this.timer = setInterval(() => this._applyActive(), 5000);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); platformStatus.set('appleMusic', false) }

  developerToken() {
    const now = Math.floor(Date.now() / 1000);
    if (!this.cached || this.cached.exp - now < 3600) {
      this.cached = { token: signDeveloperToken({ teamId: this.cfg.teamId, keyId: this.cfg.keyId, key: this.key, now }), exp: now + TOKEN_TTL_S };
    }
    return this.cached.token;
  }

  // Does Apple accept our token? (a one-result catalog search)
  async verify() {
    try {
      const res = await fetch(`${this.apiBase}/v1/catalog/${encodeURIComponent(this.cfg.storefront || 'us')}/search?term=music&types=songs&limit=1`, {
        headers: { Authorization: `Bearer ${this.developerToken()}` },
      });
      if (res.status === 401 || res.status === 403) throw new Error('Apple rejected the developer token — check the Team ID, Key ID and that the key has MusicKit enabled');
      if (!res.ok) throw new Error(`Apple Music API HTTP ${res.status}`);
      this.check = { ok: true, error: null, at: Date.now() };
      platformStatus.set('appleMusic', true);
    } catch (err) {
      this.check = { ok: false, error: err.message, at: Date.now() };
      platformStatus.set('appleMusic', false);
    }
    return this.check;
  }

  _register() {
    this.registry.registerDevice({
      key: KEY, label: this.cfg.name || 'Apple Music', type: 'applemusic', icon: '🎵', homekit: [],
      sensors: [
        { path: 'playing', label: 'Play', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'play', writeOff: 'pause', capabilityId: 'playing' },
        { path: 'prev', label: 'Previous', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'prev' },
        { path: 'next', label: 'Next', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'next' },
        { path: 'volume', label: 'Volume', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setVolume', capabilityId: 'volume' },
        { path: 'track', label: 'Track', type: 'label' },
        { path: 'artist', label: 'Artist', type: 'label' },
        { path: 'album', label: 'Album', type: 'label' },
        { path: 'device', label: 'Playing on', type: 'label' },
      ],
      _writeCapability: (capId, command, args) => this._command(capId, command, args),
    });
    this._applyActive();
  }

  // The player that reported most recently (and isn't stale)
  active() {
    let best = null;
    for (const [id, p] of this.players) if (Date.now() - p.at < STALE_MS && (!best || p.at >= best.at)) best = { id, ...p };
    return best;
  }

  // From the Music page: its state in, queued commands out
  report(playerId, body = {}) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(playerId))) throw new Error('Bad player id');
    const prev = this.players.get(playerId);
    const s = body.state || {};
    const state = {
      playing: !!s.playing, volume: Number.isFinite(s.volume) ? Math.round(s.volume) : null,
      track: String(s.track || '').slice(0, 200), artist: String(s.artist || '').slice(0, 200), album: String(s.album || '').slice(0, 200),
      artwork: /^https:\/\//.test(s.artwork || '') ? s.artwork : null, position: Number(s.position) || 0, duration: Number(s.duration) || 0,
      authorized: !!s.authorized,
    };
    const p = { name: String(body.name || prev?.name || 'Browser').slice(0, 60), state, at: Date.now(), queue: prev?.queue || [] };
    this.players.set(playerId, p);
    this._applyActive();
    const out = p.queue; p.queue = [];
    return out;
  }

  _applyActive() {
    const a = this.active();
    const set = (k, v) => this.store.update(`${KEY}/${k}`, v);
    set('playing', a?.state.playing ? 1 : 0);
    set('volume', a?.state.volume ?? null);
    set('track', a?.state.track || '');
    set('artist', a?.state.artist || '');
    set('album', a?.state.album || '');
    set('device', a ? a.name : '');
  }

  _command(capId, command, args = []) {
    const a = this.active();
    if (!a) throw new Error('No Apple Music player is open — open the Music page in LSH on the device that should play');
    const cmd = capId === 'playing' ? { cmd: command === 'pause' ? 'pause' : 'play' }
      : capId === 'next' ? { cmd: 'next' } : capId === 'prev' ? { cmd: 'prev' }
        : capId === 'volume' ? { cmd: 'volume', value: Math.max(0, Math.min(100, Number(args[0]) || 0)) } : null;
    if (!cmd) throw new Error(`Unknown Apple Music command ${capId}`);
    this.players.get(a.id).queue.push(cmd);
  }

  // Queue "play this" (catalog / library id) for the active player — for flows
  enqueuePlay(kind, id) {
    if (!['song', 'album', 'playlist', 'station'].includes(kind) || !/^[A-Za-z0-9.:_-]{1,80}$/.test(String(id))) throw new Error('Give { kind: song|album|playlist|station, id }');
    const a = this.active();
    if (!a) throw new Error('No Apple Music player is open — open the Music page in LSH on the device that should play');
    this.players.get(a.id).queue.push({ cmd: 'playItem', kind, id: String(id) });
  }

  getStatus() {
    const a = this.active();
    return {
      configured: true, check: this.check, storefront: this.cfg.storefront || 'us',
      active: a ? { id: a.id, name: a.name, ...a.state } : null,
      players: [...this.players.entries()].filter(([, p]) => Date.now() - p.at < STALE_MS).map(([id, p]) => ({ id, name: p.name, playing: p.state.playing })),
    };
  }
}

module.exports = AppleMusic;
module.exports.signDeveloperToken = signDeveloperToken;
module.exports.loadKey = loadKey;
