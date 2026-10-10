'use strict';

// Spotify — Web API (https://developer.spotify.com/documentation/web-api).
// Sign-in is OAuth Authorization Code with PKCE, so only a Client ID is needed
// (create an app at developer.spotify.com/dashboard and register the redirect
// URI shown in Settings → Media → Spotify). The refresh token is kept in
// persist/spotify-oauth.json (override with LSH_SPOTIFY_TOKENS).
//
// Registers one LSH device, `spotify/player`: play/pause, previous/next,
// volume, shuffle, plus what's playing and where. Controlling playback needs
// Spotify Premium (Spotify's rule). Extra calls for the settings player:
// devices, transfer, play a URI, playlists, search.
//
// config.spotify = { clientId, redirectUri?, pollInterval = 5 (s), defaultDevice? }
// Tested against scripts/spotify-simulator.js (test/spotify.test.js); apiBase /
// accountsBase in config point it at the simulator.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const platformStatus = require('./platform-status');

const TOKEN_FILE = process.env.LSH_SPOTIFY_TOKENS || path.join(__dirname, '..', 'persist', 'spotify-oauth.json');
const SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private', 'playlist-read-collaborative'];
const KEY = 'spotify/player';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class SpotifyClient {
  constructor(config, store, sensorRegistry) {
    this.cfg = config.spotify || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || 'https://api.spotify.com/v1').replace(/\/$/, '');
    this.accounts = (this.cfg.accountsBase || 'https://accounts.spotify.com').replace(/\/$/, '');
    this.tokens = null;
    this.pending = new Map(); // OAuth state → { verifier, redirectUri, at }
    this.player = null;       // last /me/player
    this.user = null;
    this.error = null;
    this.timer = null;
    this.backoffUntil = 0;
  }

  async start() {
    platformStatus.set('spotify', false);
    try { this.tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) } catch { this.tokens = null }
    this._register();
    if (this.tokens?.refresh_token) await this._afterConnect().catch((err) => { this.error = err.message });
    const every = Math.max(2, Number(this.cfg.pollInterval) || 5) * 1000;
    this.timer = setInterval(() => this.poll().catch(() => {}), every);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    platformStatus.set('spotify', false);
  }

  isConnected() { return !!this.tokens?.refresh_token }

  // ── OAuth (PKCE) ──────────────────────────────────────────────────────────
  getAuthUrl(redirectUri) {
    if (!this.cfg.clientId) throw new Error('Set the Spotify Client ID first');
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    for (const [k, v] of this.pending) if (Date.now() - v.at > 15 * 60 * 1000) this.pending.delete(k);
    this.pending.set(state, { verifier, redirectUri, at: Date.now() });
    const q = new URLSearchParams({
      client_id: this.cfg.clientId, response_type: 'code', redirect_uri: redirectUri, state,
      code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES.join(' '),
    });
    return `${this.accounts}/authorize?${q}`;
  }

  // From the callback (or the URL pasted back when the redirect can't reach LSH)
  async exchangeCode(code, state) {
    const p = this.pending.get(state);
    if (!p) throw new Error('This sign-in link has expired or was already used — press “Connect” again');
    this.pending.delete(state);
    const tok = await this._token({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, client_id: this.cfg.clientId, code_verifier: p.verifier });
    this._saveTokens(tok);
    await this._afterConnect();
    return this.user;
  }

  async finishFromUrl(url) {
    let u;
    try { u = new URL(String(url).trim()) } catch { throw new Error('Paste the whole address you were sent to (it starts with http)') }
    if (u.searchParams.get('error')) throw new Error(`Spotify: ${u.searchParams.get('error')}`);
    const code = u.searchParams.get('code'), state = u.searchParams.get('state');
    if (!code || !state) throw new Error('That address has no sign-in code in it');
    return this.exchangeCode(code, state);
  }

  disconnect() {
    this.tokens = null; this.user = null; this.player = null;
    try { fs.unlinkSync(TOKEN_FILE) } catch {}
    platformStatus.set('spotify', false);
    this._apply(null);
  }

  async _token(form) {
    const res = await fetch(`${this.accounts}/api/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(j.error_description || j.error || `Spotify sign-in failed (HTTP ${res.status})`);
      e.auth = j.error === 'invalid_grant';
      throw e;
    }
    return j;
  }

  _saveTokens(tok) {
    this.tokens = {
      ...(this.tokens || {}),
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || this.tokens?.refresh_token, // PKCE rotates it; keep the old one if none comes
      expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
      scope: tok.scope || this.tokens?.scope,
    };
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
  }

  async _accessToken(force = false) {
    if (!this.tokens?.refresh_token) throw new Error('Spotify isn’t connected');
    if (force || !this.tokens.access_token || Date.now() > this.tokens.expires_at - 60_000) {
      try {
        this._saveTokens(await this._token({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token, client_id: this.cfg.clientId }));
      } catch (err) {
        if (err.auth) { this.disconnect(); throw new Error('Spotify access was revoked — connect again') }
        throw err;
      }
    }
    return this.tokens.access_token;
  }

  async _afterConnect() {
    this.user = await this.call('GET', '/me').then((u) => ({ id: u.id, name: u.display_name || u.id, product: u.product || null }));
    this.error = null;
    await this.poll();
  }

  // ── Web API ───────────────────────────────────────────────────────────────
  async call(method, p, body, retried = false) {
    if (Date.now() < this.backoffUntil) throw new Error('Spotify asked LSH to slow down — try again in a moment');
    const token = await this._accessToken();
    const res = await fetch(`${this.api}${p}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) { await this._accessToken(true); return this.call(method, p, body, true) }
    if (res.status === 429) {
      this.backoffUntil = Date.now() + (Number(res.headers.get('retry-after')) || 5) * 1000;
      throw new Error('Spotify asked LSH to slow down — try again in a moment');
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let j = null; try { j = text ? JSON.parse(text) : null } catch {}
    if (!res.ok) {
      const reason = j?.error?.reason;
      if (reason === 'PREMIUM_REQUIRED') throw new Error('Controlling playback needs Spotify Premium');
      if (reason === 'NO_ACTIVE_DEVICE' || res.status === 404) throw new Error('No Spotify device is active — open Spotify on a phone, computer or speaker, or pick a device');
      throw new Error(j?.error?.message ? `Spotify: ${j.error.message}` : `Spotify HTTP ${res.status}`);
    }
    return j;
  }

  async poll() {
    if (!this.isConnected()) return;
    try {
      this.player = await this.call('GET', '/me/player?additional_types=episode');
      this.error = null;
      platformStatus.set('spotify', true);
      this._apply(this.player);
    } catch (err) {
      this.error = err.message;
      platformStatus.set('spotify', false);
    }
  }

  _register() {
    this.registry.registerDevice({
      key: KEY, label: this.cfg.name || 'Spotify', type: 'spotify', icon: '🎵', homekit: [],
      sensors: [
        { path: 'playing', label: 'Play', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'play', writeOff: 'pause', capabilityId: 'playing' },
        { path: 'prev', label: 'Previous', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'prev' },
        { path: 'next', label: 'Next', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'next' },
        { path: 'volume', label: 'Volume', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setVolume', capabilityId: 'volume' },
        { path: 'shuffle', label: 'Shuffle', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'shuffle' },
        { path: 'track', label: 'Track', type: 'label' },
        { path: 'artist', label: 'Artist', type: 'label' },
        { path: 'album', label: 'Album', type: 'label' },
        { path: 'device', label: 'Playing on', type: 'label' },
        { path: 'repeat', label: 'Repeat', type: 'label' },
      ],
      _writeCapability: (capId, command, args) => this._command(capId, command, args),
    });
  }

  _apply(p) {
    const item = p?.item;
    const set = (k, v) => this.store.update(`${KEY}/${k}`, v);
    set('playing', p?.is_playing ? 1 : 0);
    set('volume', p?.device?.volume_percent ?? null);
    set('shuffle', p?.shuffle_state ? 1 : 0);
    set('track', item?.name || '');
    set('artist', item ? (item.artists || []).map((a) => a.name).join(', ') || item.show?.name || '' : '');
    set('album', item?.album?.name || '');
    set('device', p?.device?.name || '');
    set('repeat', p?.repeat_state || 'off');
  }

  // Play / transfer to the active device, else the default one, else the first available
  async _targetDevice() {
    if (this.player?.device?.id) return null;
    const { devices = [] } = (await this.call('GET', '/me/player/devices')) || {};
    const d = devices.find((x) => x.id === this.cfg.defaultDevice || x.name === this.cfg.defaultDevice) || devices.find((x) => x.is_active) || devices[0];
    return d?.id || null;
  }

  async _command(capId, command, args = []) {
    if (capId === 'playing') {
      if (command === 'pause') await this.call('PUT', '/me/player/pause');
      else { const dev = await this._targetDevice(); await this.call('PUT', `/me/player/play${dev ? `?device_id=${encodeURIComponent(dev)}` : ''}`) }
    } else if (capId === 'next') await this.call('POST', '/me/player/next');
    else if (capId === 'prev') await this.call('POST', '/me/player/previous');
    else if (capId === 'volume') await this.call('PUT', `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(Number(args[0]) || 0)))}`);
    else if (capId === 'shuffle') await this.call('PUT', `/me/player/shuffle?state=${command === 'on'}`);
    else throw new Error(`Unknown Spotify command ${capId}`);
    setTimeout(() => this.poll().catch(() => {}), 400).unref?.();
  }

  // ── For the settings player ──────────────────────────────────────────────
  getStatus() {
    const p = this.player, item = p?.item;
    return {
      configured: !!this.cfg.clientId, connected: this.isConnected(), user: this.user, error: this.error,
      player: p ? {
        playing: !!p.is_playing, shuffle: !!p.shuffle_state, repeat: p.repeat_state, progressMs: p.progress_ms ?? null,
        device: p.device ? { id: p.device.id, name: p.device.name, type: p.device.type, volume: p.device.volume_percent } : null,
        item: item ? {
          name: item.name, uri: item.uri, durationMs: item.duration_ms,
          artist: (item.artists || []).map((a) => a.name).join(', ') || item.show?.name || '',
          album: item.album?.name || '', image: (item.album?.images || item.images || [])[0]?.url || null,
        } : null,
      } : null,
    };
  }

  async devices() {
    const { devices = [] } = (await this.call('GET', '/me/player/devices')) || {};
    return devices.map((d) => ({ id: d.id, name: d.name, type: d.type, active: !!d.is_active, volume: d.volume_percent, restricted: !!d.is_restricted }));
  }

  async transfer(deviceId, play = true) {
    await this.call('PUT', '/me/player', { device_ids: [deviceId], play });
    setTimeout(() => this.poll().catch(() => {}), 600).unref?.();
  }

  // spotify:track:… plays that track; playlists / albums / artists play as a context
  async playUri(uri, deviceId) {
    if (!/^spotify:(track|episode|playlist|album|artist|show):[A-Za-z0-9]+$/.test(String(uri))) throw new Error('Not a Spotify URI');
    const dev = deviceId || (await this._targetDevice());
    const body = /^spotify:(track|episode):/.test(uri) ? { uris: [uri] } : { context_uri: uri };
    await this.call('PUT', `/me/player/play${dev ? `?device_id=${encodeURIComponent(dev)}` : ''}`, body);
    setTimeout(() => this.poll().catch(() => {}), 600).unref?.();
  }

  async playlists() {
    const j = await this.call('GET', '/me/playlists?limit=50');
    return (j?.items || []).filter(Boolean).map((p) => ({ uri: p.uri, name: p.name, image: p.images?.[0]?.url || null, tracks: p.tracks?.total ?? null, owner: p.owner?.display_name || null }));
  }

  async search(q) {
    const j = await this.call('GET', `/search?type=track,playlist,album,artist&limit=6&q=${encodeURIComponent(String(q).slice(0, 100))}`);
    const pick = (list, kind, sub) => (list?.items || []).filter(Boolean).map((x) => ({ kind, uri: x.uri, name: x.name, sub: sub(x), image: (x.album?.images || x.images || [])[0]?.url || null }));
    return [
      ...pick(j?.tracks, 'track', (x) => (x.artists || []).map((a) => a.name).join(', ')),
      ...pick(j?.playlists, 'playlist', (x) => x.owner?.display_name || ''),
      ...pick(j?.albums, 'album', (x) => (x.artists || []).map((a) => a.name).join(', ')),
      ...pick(j?.artists, 'artist', () => ''),
    ];
  }
}

module.exports = SpotifyClient;
module.exports.SCOPES = SCOPES;
