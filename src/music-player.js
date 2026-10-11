'use strict';

// Music — one player device in front of Spotify and Apple Music, with a source
// selector. Made for Loxone (GET /api/loxone/music.zip): one set of Virtual
// Outputs / Inputs drives whichever service is selected, so the Loxone side
// doesn't change when you switch.
//
// Registers `music/player`:
//   source       0 = stop, 1 = Spotify, 2 = Apple Music (a Loxone Radio
//                Buttons block's output wires straight in). Switching while
//                playing pauses the old source and starts the new one.
//   useSpotify / useAppleMusic — pulse inputs for the same thing
//   playing, prev, next, volume — sent to the selected source
//   spotifyReady / appleMusicReady — Spotify signed in / a Music page is open
//   track, artist, album, device — mirrored from the selected source
//
// Commands go to the live client in `clients` (the same object the settings
// routes replace a client in), not through the source's registry device, so
// they reach the current client after its settings are saved.
//
// config.music = { enabled = true, name = 'Music', defaultSource = 1 }
// Started by server.js when Spotify or Apple Music is configured at boot.

const KEY = 'music/player';
const SOURCES = {
  1: { client: 'spotify', device: 'spotify/player', label: 'Spotify' },
  2: { client: 'appleMusic', device: 'applemusic/player', label: 'Apple Music' },
};
// Readings copied from the selected source's device
const MIRROR = ['playing', 'volume', 'track', 'artist', 'album', 'device'];

class MusicPlayer {
  constructor(config, store, sensorRegistry, clients) {
    this.cfg = config.music || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.clients = clients;
    this.timer = null;
    this.onChange = ({ key, value }) => {
      const src = SOURCES[this.source()];
      if (!src || !key.startsWith(`${src.device}/`)) return;
      const k = key.slice(src.device.length + 1);
      if (MIRROR.includes(k)) this.store.update(`${KEY}/${k}`, value);
    };
  }

  async start() {
    if (!SOURCES[this.source()]) this.store.update(`${KEY}/source`, SOURCES[this.cfg.defaultSource] ? Number(this.cfg.defaultSource) : 1);
    this._register();
    this.store.on('change', this.onChange);
    this._mirrorAll();
    this._ready();
    this.timer = setInterval(() => this._ready(), 5000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.store.off('change', this.onChange);
  }

  source() { return Number(this.store.get(`${KEY}/source`)) || 0 }

  _register() {
    this.registry.registerDevice({
      key: KEY, label: this.cfg.name || 'Music', type: 'music', icon: '🎵', homekit: [],
      sensors: [
        { path: 'source', label: 'Source', controllable: true, type: 'range', min: 0, max: 2, step: 1, writeCmd: 'setSource', capabilityId: 'source', hint: '0 = stop, 1 = Spotify, 2 = Apple Music' },
        { path: 'useSpotify', label: 'Spotify', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'useSpotify' },
        { path: 'useAppleMusic', label: 'Apple Music', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'useAppleMusic' },
        { path: 'playing', label: 'Play', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'play', writeOff: 'pause', capabilityId: 'playing' },
        { path: 'prev', label: 'Previous', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'prev' },
        { path: 'next', label: 'Next', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'next' },
        { path: 'volume', label: 'Volume', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setVolume', capabilityId: 'volume' },
        { path: 'spotifyReady', label: 'Spotify ready', type: 'boolean', format: 'on-off' },
        { path: 'appleMusicReady', label: 'Apple Music ready', type: 'boolean', format: 'on-off' },
        { path: 'sourceName', label: 'Source', type: 'label' },
        { path: 'track', label: 'Track', type: 'label' },
        { path: 'artist', label: 'Artist', type: 'label' },
        { path: 'album', label: 'Album', type: 'label' },
        { path: 'device', label: 'Playing on', type: 'label' },
      ],
      _writeCapability: (capId, command, args) => this._command(capId, command, args),
    });
  }

  _mirrorAll() {
    const src = SOURCES[this.source()];
    this.store.update(`${KEY}/sourceName`, src ? src.label : '');
    for (const k of MIRROR) {
      const v = src ? this.store.get(`${src.device}/${k}`) : null;
      this.store.update(`${KEY}/${k}`, k === 'playing' ? (v ? 1 : 0) : (v ?? (k === 'volume' ? null : '')));
    }
  }

  _ready() {
    this.store.update(`${KEY}/spotifyReady`, this.clients.spotify?.isConnected() ? 1 : 0);
    this.store.update(`${KEY}/appleMusicReady`, this.clients.appleMusic?.active() ? 1 : 0);
  }

  _client(n) {
    const src = SOURCES[n];
    const c = src && this.clients[src.client];
    if (!c) throw new Error(`${src ? src.label : 'That source'} isn’t set up in LSH`);
    return c;
  }

  // Both clients take the same (capId, command, args) as their own devices
  async _send(n, capId, command, args) { return this._client(n)._command(capId, command, args) }

  async setSource(n) {
    n = Math.round(Number(n));
    const cur = this.source();
    if (n === 0) { if (SOURCES[cur]) await this._send(cur, 'playing', 'pause'); return }
    if (!SOURCES[n]) throw new Error('Source is 0 (stop), 1 (Spotify) or 2 (Apple Music)');
    if (n === cur) return;
    const wasPlaying = !!this.store.get(`${KEY}/playing`);
    if (wasPlaying && SOURCES[cur]) await this._send(cur, 'playing', 'pause').catch(() => {});
    this.store.update(`${KEY}/source`, n);
    this._mirrorAll();
    if (wasPlaying) await this._send(n, 'playing', 'play');
  }

  async _command(capId, command, args = []) {
    if (capId === 'source') return this.setSource(args[0]);
    if (capId === 'useSpotify') return this.setSource(1);
    if (capId === 'useAppleMusic') return this.setSource(2);
    const n = this.source();
    if (!SOURCES[n]) throw new Error('No music source selected');
    return this._send(n, capId, command, args);
  }
}

module.exports = MusicPlayer;
module.exports.SOURCES = SOURCES;
