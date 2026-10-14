'use strict';

// TIDAL — the official TIDAL API (developer.tidal.com, openapi.tidal.com/v2,
// JSON:API). Create an app at developer.tidal.com and copy its Client ID and
// Client Secret into Settings → Media → TIDAL; register the redirect URI shown
// there to sign in.
//
//   catalog search      app token (client credentials) — works without sign-in
//   your playlists /    user sign-in: OAuth Authorization Code with PKCE,
//   albums              scopes user.read collection.read playlists.read search.read;
//                       the refresh token is kept in persist/tidal-oauth.json
//   playback            not offered: TIDAL's API has no remote control / "TIDAL
//                       Connect" and plays (DRM) only through its own Player SDK —
//                       items carry a TIDAL_AUTOPLAY_WEB link that starts them in
//                       TIDAL's web player, and a share link for the apps
//
// config.tidal = { clientId, clientSecret, redirectUri?, countryCode? }
// Tested against scripts/tidal-simulator.js (test/tidal.test.js) — apiBase /
// authBase / loginBase in config point it there. Not yet tried against TIDAL.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const platformStatus = require('./platform-status');

const TOKEN_FILE = process.env.LSH_TIDAL_TOKENS || path.join(__dirname, '..', 'persist', 'tidal-oauth.json');
const SCOPES = ['user.read', 'collection.read', 'playlists.read', 'search.read'];
const JSONAPI = 'application/vnd.api+json';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const KIND = { albums: 'album', tracks: 'track', playlists: 'playlist', artists: 'artist' };

class TidalClient {
  constructor(config, store, sensorRegistry) {
    this.cfg = config.tidal || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || 'https://openapi.tidal.com/v2').replace(/\/$/, '');
    this.authBase = (this.cfg.authBase || 'https://auth.tidal.com/v1/oauth2').replace(/\/$/, '');
    this.loginBase = (this.cfg.loginBase || 'https://login.tidal.com').replace(/\/$/, '');
    this.tokens = null;  // user tokens
    this.app = null;     // { access_token, expires_at } — client credentials
    this.pending = new Map(); // OAuth state → { verifier, redirectUri, at }
    this.user = null;
    this.error = null;
  }

  async start() {
    platformStatus.set('tidal', false);
    try { this.tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) } catch { this.tokens = null }
    try {
      if (this.tokens?.refresh_token) await this._afterConnect();
      else { await this._appToken(); platformStatus.set('tidal', true) }
      this.error = null;
    } catch (err) { this.error = err.message }
  }

  stop() { platformStatus.set('tidal', false) }

  isConnected() { return !!this.tokens?.refresh_token }

  getStatus() {
    return { configured: !!this.cfg.clientId, canSearch: !!(this.cfg.clientSecret || this.isConnected()), connected: this.isConnected(), user: this.user, error: this.error };
  }

  // ── OAuth (PKCE) ──────────────────────────────────────────────────────────
  getAuthUrl(redirectUri) {
    if (!this.cfg.clientId) throw new Error('Set the TIDAL Client ID first');
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    for (const [k, v] of this.pending) if (Date.now() - v.at > 15 * 60 * 1000) this.pending.delete(k);
    this.pending.set(state, { verifier, redirectUri, at: Date.now() });
    const q = new URLSearchParams({
      response_type: 'code', client_id: this.cfg.clientId, redirect_uri: redirectUri, scope: SCOPES.join(' '),
      code_challenge_method: 'S256', code_challenge: challenge, state,
    });
    return `${this.loginBase}/authorize?${q}`;
  }

  async exchangeCode(code, state) {
    const p = this.pending.get(state);
    if (!p) throw new Error('This sign-in link has expired or was already used — press “Connect” again');
    this.pending.delete(state);
    this._saveTokens(await this._token({ grant_type: 'authorization_code', client_id: this.cfg.clientId, code, redirect_uri: p.redirectUri, code_verifier: p.verifier }));
    await this._afterConnect();
    return this.user;
  }

  async finishFromUrl(url) {
    let u;
    try { u = new URL(String(url).trim()) } catch { throw new Error('Paste the whole address you were sent to (it starts with http)') }
    if (u.searchParams.get('error')) throw new Error(`TIDAL: ${u.searchParams.get('error_description') || u.searchParams.get('error')}`);
    const code = u.searchParams.get('code'), state = u.searchParams.get('state');
    if (!code || !state) throw new Error('That address has no sign-in code in it');
    return this.exchangeCode(code, state);
  }

  disconnect() {
    this.tokens = null; this.user = null;
    try { fs.unlinkSync(TOKEN_FILE) } catch { /* not signed in */ }
    platformStatus.set('tidal', !!this.app);
  }

  async _token(form, basic = false) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (basic) headers.Authorization = `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`;
    const res = await fetch(`${this.authBase}/token`, { method: 'POST', headers, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(j.error_description || j.error || `TIDAL sign-in failed (HTTP ${res.status})`);
      e.auth = j.error === 'invalid_grant' || res.status === 401;
      throw e;
    }
    return j;
  }

  _saveTokens(tok) {
    this.tokens = {
      ...(this.tokens || {}),
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || this.tokens?.refresh_token,
      expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
      scope: tok.scope || this.tokens?.scope,
    };
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
  }

  async _userToken(force = false) {
    if (force || !this.tokens.access_token || Date.now() > this.tokens.expires_at - 60_000) {
      try {
        this._saveTokens(await this._token({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token, client_id: this.cfg.clientId }));
      } catch (err) {
        if (err.auth) { this.disconnect(); throw new Error('TIDAL access was revoked — connect again') }
        throw err;
      }
    }
    return this.tokens.access_token;
  }

  // client-credentials token for the catalog (no user needed)
  async _appToken(force = false) {
    if (!this.cfg.clientId || !this.cfg.clientSecret) throw new Error('Add the TIDAL Client Secret to search without signing in');
    if (force || !this.app || Date.now() > this.app.expires_at - 60_000) {
      const t = await this._token({ grant_type: 'client_credentials' }, true);
      this.app = { access_token: t.access_token, expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
    }
    return this.app.access_token;
  }

  async _afterConnect() {
    const j = await this.call('/users/me', {}, { user: true });
    const a = j?.data?.attributes || {};
    this.user = { id: j?.data?.id, name: a.username || [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email || 'TIDAL', country: a.country || null };
    this.error = null;
    platformStatus.set('tidal', true);
  }

  country() { return (this.cfg.countryCode || this.user?.country || 'US').toUpperCase() }

  // GET with JSON:API; params: { key: value | [values] } (arrays → repeated keys)
  async call(p, params = {}, { user = false, retried = false } = {}) {
    const useUser = user || this.isConnected();
    if (user && !this.isConnected()) throw new Error('Sign in to TIDAL first');
    const token = useUser ? await this._userToken() : await this._appToken();
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) if (x !== undefined && x !== null && x !== '') q.append(k, x);
    const res = await fetch(`${this.api}${p}${q.toString() ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${token}`, Accept: JSONAPI }, signal: AbortSignal.timeout(15000) });
    if (res.status === 401 && !retried) {
      if (useUser) await this._userToken(true); else await this._appToken(true);
      return this.call(p, params, { user, retried: true });
    }
    if (res.status === 429) throw new Error('TIDAL asked LSH to slow down — try again in a moment');
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.errors?.[0]?.detail ? `TIDAL: ${j.errors[0].detail}` : `TIDAL HTTP ${res.status}`);
    return j;
  }

  // ── catalog / library → { kind, id, name, sub, image, url, open } ─────────
  async search(q) {
    const term = String(q || '').trim().slice(0, 200);
    if (!term) return [];
    const j = await this.call('/searchResults', { 'filter[query]': term, countryCode: this.country(), include: ['albums', 'tracks', 'playlists', 'artists'] });
    const res = [].concat(j?.data || [])[0];
    const rel = (k) => (res?.relationships?.[k]?.data || []).slice(0, 8).map((x) => x.id);
    const [tracks, albums, playlists, artists] = await Promise.all([
      this._items('tracks', rel('tracks')), this._items('albums', rel('albums')),
      this._items('playlists', rel('playlists')), this._items('artists', rel('artists')),
    ]);
    return [...tracks, ...albums, ...playlists, ...artists];
  }

  async library() {
    if (!this.isConnected()) return { playlists: [], albums: [] };
    const ids = async (p) => {
      const j = await this.call(p, { countryCode: this.country() }, { user: true });
      return (j?.data || []).map((x) => x.id).slice(0, 40);
    };
    const [pl, al] = await Promise.all([
      ids('/userCollectionPlaylists/me/relationships/items').catch(() => []),
      ids('/userCollectionAlbums/me/relationships/items').catch(() => []),
    ]);
    const [playlists, albums] = await Promise.all([this._items('playlists', pl), this._items('albums', al)]);
    return { playlists, albums };
  }

  // fetch resources by id (20 per call) with artwork + artists, in the given order
  async _items(type, ids) {
    if (!ids.length) return [];
    const include = { albums: ['coverArt', 'artists'], tracks: ['albums', 'artists'], playlists: ['coverArt'], artists: ['profileArt'] }[type];
    const docs = [];
    for (let i = 0; i < ids.length; i += 20) docs.push(await this.call(`/${type}`, { 'filter[id]': ids.slice(i, i + 20), countryCode: this.country(), include }));
    const data = docs.flatMap((d) => d?.data || []);
    const inc = new Map(docs.flatMap((d) => d?.included || []).map((r) => [`${r.type}:${r.id}`, r]));
    const get = (r) => (r ? inc.get(`${r.type}:${r.id}`) : null);
    // tracks show their album's cover: fetch those albums' artwork
    let albumArt = new Map();
    if (type === 'tracks') {
      const albumIds = [...new Set(data.map((t) => t.relationships?.albums?.data?.[0]?.id).filter(Boolean))];
      if (albumIds.length) {
        const al = await this._items('albums', albumIds);
        albumArt = new Map(al.map((a) => [a.id, a.image]));
      }
    }
    const byId = new Map(data.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => {
      const a = r.attributes || {};
      const artists = (r.relationships?.artists?.data || []).map((x) => get(x)?.attributes?.name).filter(Boolean).join(', ');
      const artRel = r.relationships?.coverArt?.data?.[0] || r.relationships?.profileArt?.data?.[0];
      let image = pickArt(get(artRel));
      if (type === 'tracks') image = albumArt.get(r.relationships?.albums?.data?.[0]?.id) || null;
      const link = (t) => (a.externalLinks || []).find((l) => l?.meta?.type === t)?.href;
      return {
        kind: KIND[type], id: r.id, name: a.title || a.name || '',
        sub: type === 'playlists' ? (a.numberOfItems != null ? `${a.numberOfItems}` : '') : artists,
        image,
        url: link('TIDAL_SHARING') || `https://tidal.com/browse/${KIND[type]}/${r.id}`,
        open: link('TIDAL_AUTOPLAY_WEB') || link('TIDAL_SHARING') || `https://listen.tidal.com/${KIND[type]}/${r.id}`,
      };
    });
  }
}

// an artwork resource → the file closest to 320 px
function pickArt(art) {
  const files = art?.attributes?.files || [];
  if (!files.length) return null;
  const sorted = files.slice().sort((x, y) => Math.abs((x.meta?.width || 0) - 320) - Math.abs((y.meta?.width || 0) - 320));
  return sorted[0]?.href || null;
}

module.exports = TidalClient;
module.exports.pickArt = pickArt;
module.exports.SCOPES = SCOPES;
