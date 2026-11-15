'use strict';

const crypto = require('crypto');
const platformStatus = require('./platform-status');

let WebSocketLib = null;
try { WebSocketLib = require('ws'); } catch { /* reported in start() */ }

/**
 * Music Assistant (music-assistant.io) — every player of a Music Assistant
 * server as an LSH media device: play/pause, previous/next, stop, volume,
 * mute, power, shuffle, and what is playing (track, artist, album, cover).
 *
 * One WebSocket to the server (`ws://<host>:8095/ws`): the server greets with
 * its info, the client authenticates with a long-lived token (schema ≥ 28 —
 * Music Assistant 2.7 and later; older servers take no token), fetches
 * `players/all` + `player_queues/all`, and from then on follows the pushed
 * `player_*` / `queue_*` events. Nothing is polled.
 *
 * config.musicAssistant:
 *   { url, token?, players?, includeHidden?, name? }
 *   url            server address, e.g. "http://192.168.1.20:8095"
 *   token          long-lived token (Music Assistant → Settings → Profile →
 *                  Long-lived access tokens)
 *   players        optional list of player ids or names — only these are added
 *   includeHidden  also add players hidden in the Music Assistant UI
 *
 * Protocol taken from the official client (music-assistant/client) and models
 * (music-assistant/models). Not yet run against a real Music Assistant
 * server — only against the fake one in test/music-assistant.test.js.
 */

const RECONNECT_MIN = 3000;
const RECONNECT_MAX = 60000;
const COMMAND_TIMEOUT = 15000;
// Players that are a transport of another player (AirPlay/Cast/DLNA leg) or
// not a speaker at all are not devices of their own.
const SKIP_TYPES = new Set(['protocol', 'display', 'visualizer', 'light', 'source']);

const deviceKeyOf = (playerId) => `musicassistant/${String(playerId).replace(/[^A-Za-z0-9_-]+/g, '_')}`;

function wsUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^[a-z]+:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/^http/i, 'ws');
  return /\/ws$/.test(u) ? u : `${u}/ws`;
}

// What a player is playing: the player's own current_media when it has one
// (also covers sources outside the queue — AirPlay, line-in), otherwise the
// current item of its queue.
function nowPlaying(player, queue) {
  const m = player?.current_media;
  const item = queue?.current_item;
  const media = item?.media_item;
  const artists = Array.isArray(media?.artists) ? media.artists.map((a) => a?.name).filter(Boolean).join(', ') : '';
  return {
    track: m?.title || media?.name || item?.name || '',
    artist: m?.artist || artists || '',
    album: m?.album || media?.album?.name || '',
    image: m?.image_url || '',
  };
}

class MusicAssistantClient {
  constructor(config, store, sensorRegistry) {
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._ws = null;
    this._pending = new Map(); // message_id → { resolve, reject, timer, parts }
    this._players = new Map(); // player_id → player
    this._queues = new Map();  // queue_id → queue
    this._registered = new Map(); // player_id → device key
    this._serverInfo = null;
    this._retry = RECONNECT_MIN;
    this._retryTimer = null;
    this._stopping = false;
    this._lastError = '';
    this._ready = false; // signed in and player list loaded
  }

  async start() {
    const cfg = this._config.musicAssistant;
    if (!cfg?.url) return;
    if (!WebSocketLib) {
      console.error('[MusicAssistant] The "ws" package is missing — run npm install');
      platformStatus.set('musicAssistant', false);
      return;
    }
    platformStatus.set('musicAssistant', false);
    this._connect();
  }

  stop() {
    this._stopping = true;
    clearTimeout(this._retryTimer);
    this._failPending(new Error('stopped'));
    try { this._ws?.close(); } catch { /* already closed */ }
  }

  // ── Connection ──────────────────────────────────────────────────────────

  _connect() {
    if (this._stopping) return;
    const cfg = this._config.musicAssistant;
    let ws;
    try { ws = new WebSocketLib(wsUrl(cfg.url), { handshakeTimeout: 10000, maxPayload: 64 * 1024 * 1024 }); }
    catch (err) { this._lastError = err.message; return this._scheduleReconnect(); }
    this._ws = ws;
    let greeted = false;

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!greeted) {
        // the first frame is the bare server info, not wrapped in a result
        greeted = true;
        this._serverInfo = msg;
        this._onGreeting().catch((err) => {
          this._lastError = err.message;
          console.error(`[MusicAssistant] ${err.message}`);
          try { ws.close(); } catch { /* already closed */ }
        });
        return;
      }
      this._onMessage(msg);
    });
    ws.on('error', (err) => { this._lastError = err.message; });
    ws.on('close', () => {
      if (this._ws !== ws) return;
      this._ws = null;
      this._ready = false;
      this._failPending(new Error('connection closed'));
      platformStatus.set('musicAssistant', false);
      if (!this._stopping) {
        console.warn(`[MusicAssistant] Disconnected${this._lastError ? ` (${this._lastError})` : ''} — retrying in ${Math.round(this._retry / 1000)}s`);
        this._scheduleReconnect();
      }
    });
  }

  _scheduleReconnect() {
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this._connect(), this._retry);
    this._retry = Math.min(RECONNECT_MAX, this._retry * 2);
  }

  async _onGreeting() {
    const cfg = this._config.musicAssistant;
    const info = this._serverInfo || {};
    const schema = Number(info.schema_version) || 0;
    if (schema >= 28) {
      if (!cfg.token) throw new Error('This Music Assistant server needs a token — create a long-lived access token in its Settings → Profile and set musicAssistant.token');
      let ok;
      try { ok = await this.command('auth', { token: cfg.token }); }
      catch (err) { throw new Error(`Sign-in refused: ${err.message}`); }
      if (!ok) throw new Error('Sign-in refused: the token is invalid or expired');
    }
    const [players, queues] = await Promise.all([this.command('players/all'), this.command('player_queues/all')]);
    this._players.clear();
    this._queues.clear();
    for (const q of queues || []) if (q?.queue_id) this._queues.set(q.queue_id, q);
    for (const p of players || []) if (p?.player_id) this._players.set(p.player_id, p);
    for (const p of this._players.values()) this._sync(p);
    this._retry = RECONNECT_MIN;
    this._lastError = '';
    this._ready = true;
    platformStatus.set('musicAssistant', true);
    console.log(`[MusicAssistant] Connected to ${info.name || 'server'} ${info.server_version || ''} — ${this._registered.size} player(s)`);
  }

  _onMessage(msg) {
    if (msg.event) return this._onEvent(msg);
    const p = msg.message_id && this._pending.get(msg.message_id);
    if (!p) return;
    if ('error_code' in msg) {
      this._settle(msg.message_id);
      return p.reject(new Error(msg.details || `error ${msg.error_code}`));
    }
    if (msg.partial) { // long lists arrive in chunks
      p.parts = (p.parts || []).concat(msg.result || []);
      return;
    }
    this._settle(msg.message_id);
    p.resolve(p.parts ? p.parts.concat(msg.result || []) : msg.result);
  }

  _onEvent({ event, object_id: id, data }) {
    switch (event) {
      case 'player_added':
      case 'player_updated':
        if (data?.player_id) { this._players.set(data.player_id, data); this._sync(data); }
        break;
      case 'player_removed': {
        this._players.delete(id);
        const key = this._registered.get(id);
        if (key) this._store.update(`${key}/available`, 0);
        break;
      }
      case 'queue_added':
      case 'queue_updated':
        if (data?.queue_id) {
          this._queues.set(data.queue_id, data);
          for (const p of this._players.values()) if (this._queueOf(p) === data) this._sync(p);
        }
        break;
      default: // queue_time_updated and the rest carry nothing LSH shows
    }
  }

  // ── Commands ────────────────────────────────────────────────────────────

  command(command, args = {}) {
    return new Promise((resolve, reject) => {
      const ws = this._ws;
      if (!ws || ws.readyState !== WebSocketLib.OPEN) return reject(new Error('Music Assistant is not connected'));
      const id = crypto.randomUUID().replace(/-/g, '');
      const timer = setTimeout(() => { this._pending.delete(id); reject(new Error(`${command} timed out`)); }, COMMAND_TIMEOUT);
      this._pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ message_id: id, command, args }), (err) => {
        if (err) { this._settle(id); reject(err); }
      });
    });
  }

  _settle(id) {
    const p = this._pending.get(id);
    if (p) { clearTimeout(p.timer); this._pending.delete(id); }
  }

  _failPending(err) {
    for (const [id, p] of this._pending) { clearTimeout(p.timer); this._pending.delete(id); p.reject(err); }
  }

  // ── Players → devices ───────────────────────────────────────────────────

  _wanted(p) {
    const cfg = this._config.musicAssistant;
    if (p.enabled === false || SKIP_TYPES.has(p.type)) return false;
    const only = Array.isArray(cfg.players) ? cfg.players.map((s) => String(s).trim().toLowerCase()).filter(Boolean) : [];
    if (only.length) return only.includes(String(p.player_id).toLowerCase()) || only.includes(String(p.name || '').trim().toLowerCase());
    return cfg.includeHidden || !p.hide_in_ui;
  }

  // The queue a player is playing from: its active source when that is a
  // queue (a group's, when the player is a member), else its own.
  _queueOf(p) {
    return this._queues.get(p.active_source) || this._queues.get(p.active_group) || this._queues.get(p.synced_to) || this._queues.get(p.player_id) || null;
  }

  _sync(p) {
    let key = this._registered.get(p.player_id);
    if (!key) {
      if (!this._wanted(p)) return;
      key = deviceKeyOf(p.player_id);
      this._registered.set(p.player_id, key);
      this._registry.registerDevice(this._buildDevice(p, key));
    }
    const queue = this._queueOf(p);
    const state = p.playback_state || p.state || 'idle';
    const now = nowPlaying(p, queue);
    const set = (path, v) => this._store.update(`${key}/${path}`, v);
    set('available', p.available ? 1 : 0);
    set('playing', state === 'playing' ? 1 : 0);
    set('state', state);
    if (p.powered != null) set('power', p.powered ? 1 : 0);
    if (p.volume_level != null) set('volume', Math.round(p.volume_level));
    if (p.volume_muted != null) set('mute', p.volume_muted ? 1 : 0);
    set('track', now.track);
    set('artist', now.artist);
    set('album', now.album);
    set('image', now.image);
    if (queue) set('shuffle', queue.shuffle_enabled ? 1 : 0);
    const members = (p.group_members || []).filter((id) => id !== p.player_id).map((id) => this._players.get(id)?.name || id);
    const leader = p.synced_to && p.synced_to !== p.player_id ? (this._players.get(p.synced_to)?.name || p.synced_to) : '';
    set('group', leader ? `→ ${leader}` : members.join(', '));
  }

  _buildDevice(p, key) {
    const has = (f) => (p.supported_features || []).includes(f);
    const sensors = [
      { path: 'playing', label: 'Play', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'play', writeOff: 'pause', capabilityId: 'playing' },
      { path: 'prev', label: 'Previous', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'prev' },
      { path: 'next', label: 'Next', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'next' },
      { path: 'stop', label: 'Stop', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'stop' },
      { path: 'volume', label: 'Volume', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setVolume', capabilityId: 'volume' },
      { path: 'mute', label: 'Mute', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'mute' },
      ...(has('power') ? [{ path: 'power', label: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power' }] : []),
      { path: 'shuffle', label: 'Shuffle', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'shuffle' },
      { path: 'track', label: 'Track', type: 'label' },
      { path: 'artist', label: 'Artist', type: 'label' },
      { path: 'album', label: 'Album', type: 'label' },
      { path: 'state', label: 'State', type: 'label' },
      { path: 'group', label: 'Grouped with', type: 'label' },
      { path: 'available', label: 'Available', format: 'on-off' },
      { path: 'image', label: 'Cover', type: 'label', hidden: true },
    ];
    return {
      key, label: p.name || p.display_name || p.player_id, type: 'musicassistant', icon: '🎵', homekit: [],
      playerId: p.player_id, playerType: p.type || 'player',
      sensors,
      _writeCapability: (capId, command, args) => this._write(p.player_id, capId, command, args),
    };
  }

  async _write(playerId, capId, command, args = []) {
    const player = this._players.get(playerId) || {};
    const on = command === 'on' || command === 'play' || args[0] === 1 || args[0] === true;
    switch (capId) {
      case 'playing': return this.command(on ? 'players/cmd/play' : 'players/cmd/pause', { player_id: playerId });
      case 'prev':    return this.command('players/cmd/previous', { player_id: playerId });
      case 'next':    return this.command('players/cmd/next', { player_id: playerId });
      case 'stop':    return this.command('players/cmd/stop', { player_id: playerId });
      case 'volume':  return this.command('players/cmd/volume_set', { player_id: playerId, volume_level: Math.round(Math.min(100, Math.max(0, Number(args[0]) || 0))) });
      case 'mute':    return this.command('players/cmd/volume_mute', { player_id: playerId, muted: on });
      case 'power':   return this.command('players/cmd/power', { player_id: playerId, powered: on });
      case 'shuffle': return this.command('player_queues/shuffle', { queue_id: this._queueOf(player)?.queue_id || playerId, shuffle_enabled: on });
      default: throw new Error(`Unknown capability ${capId}`);
    }
  }

  // ── For the REST routes (src/routes/music-assistant.js) ─────────────────

  status() {
    const i = this._serverInfo || {};
    return {
      connected: this._ready,
      server: i.name || '', version: i.server_version || '', schema: Number(i.schema_version) || 0,
      players: this._registered.size, error: this._lastError,
    };
  }

  getPlayers() {
    return [...this._players.values()].map((p) => {
      const now = nowPlaying(p, this._queueOf(p));
      return {
        id: p.player_id, name: p.name || p.player_id, type: p.type || 'player', available: !!p.available,
        state: p.playback_state || p.state || 'idle', volume: p.volume_level ?? null, muted: !!p.volume_muted,
        device: this._registered.get(p.player_id) || null, ...now,
      };
    });
  }

  // A player given by id, name or LSH device key.
  resolvePlayer(ref) {
    const s = String(ref || '').trim().toLowerCase();
    if (!s) return null;
    for (const p of this._players.values()) {
      if (String(p.player_id).toLowerCase() === s || String(p.name || '').trim().toLowerCase() === s || (this._registered.get(p.player_id) || '').toLowerCase() === s) return p;
    }
    return null;
  }

  // media: a Music Assistant URI ("library://playlist/3", "spotify://track/…")
  // or a list of them; option: play | replace | next | replace_next | add
  async playMedia(ref, media, { option, radio } = {}) {
    const p = this.resolvePlayer(ref);
    if (!p) throw new Error('No matching player');
    const args = { queue_id: p.player_id, media };
    if (option) args.option = option;
    if (radio != null) args.radio_mode = !!radio;
    await this.command('player_queues/play_media', args);
    return { player: p.name || p.player_id };
  }

  async search(query, { types, limit = 10 } = {}) {
    const args = { search_query: String(query), limit: Math.min(50, Math.max(1, Number(limit) || 10)) };
    if (types?.length) args.media_types = types;
    const r = (await this.command('music/search', args)) || {};
    const pick = (list, type) => (list || []).map((it) => ({
      type, name: it.name, uri: it.uri,
      artist: Array.isArray(it.artists) ? it.artists.map((a) => a?.name).filter(Boolean).join(', ') : undefined,
      album: it.album?.name,
    }));
    return [
      ...pick(r.tracks, 'track'), ...pick(r.albums, 'album'), ...pick(r.artists, 'artist'),
      ...pick(r.playlists, 'playlist'), ...pick(r.radio, 'radio'),
    ];
  }
}

// One-off connection check for Settings → "Test connection": connect, sign
// in, count the players. Resolves { server, version, players } or rejects.
function testConnection(url, token, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!WebSocketLib) return reject(new Error('The "ws" package is missing'));
    const config = { musicAssistant: { url, token } };
    const c = new MusicAssistantClient(config, { update() {}, get() { return null; } }, { registerDevice() {}, getDevices: () => [] });
    let ws;
    const done = (err, out) => { clearTimeout(timer); try { ws?.close(); } catch { /* closed */ } c._failPending(new Error('closed')); err ? reject(err) : resolve(out); };
    const timer = setTimeout(() => done(new Error('No answer from the server')), timeout);
    try { ws = new WebSocketLib(wsUrl(url), { handshakeTimeout: timeout }); } catch (err) { return done(err); }
    c._ws = ws;
    let greeted = false;
    ws.on('error', (err) => done(new Error(err.message || 'Connection failed')));
    ws.on('close', () => done(new Error('The server closed the connection')));
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (greeted) return c._onMessage(msg);
      greeted = true;
      if (msg?.server_version == null) return done(new Error('This is not a Music Assistant server'));
      (async () => {
        if (Number(msg.schema_version) >= 28) {
          if (!token) throw new Error('This server needs a long-lived access token');
          let ok;
          try { ok = await c.command('auth', { token }); } catch (err) { throw new Error(`Sign-in refused: ${err.message}`); }
          if (!ok) throw new Error('Sign-in refused: the token is invalid or expired');
        }
        const players = (await c.command('players/all')) || [];
        return { server: msg.name || '', version: msg.server_version, players: players.length };
      })().then((out) => done(null, out), done);
    });
  });
}

module.exports = MusicAssistantClient;
module.exports.testConnection = testConnection;
module.exports.wsUrl = wsUrl;
module.exports.nowPlaying = nowPlaying;
module.exports.deviceKeyOf = deviceKeyOf;
