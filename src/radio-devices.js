'use strict';

// Radio — the dashboard media player's speakers as LSH devices, so Loxone (and
// flows, HomeKit, MCP) can play the saved stations on them. One device per
// AirPlay speaker (src/airplay-client.js) and Chromecast / Google Home / Nest
// (src/googlehome-client.js):
//
//   radio/airplay-<speaker id>   radio/cast-<host with _>
//     playing      on = play the last station (or station 1), off = stop
//     station      0 = stop, 1…N = play saved station N (Settings order, the
//                  dashboard's Favourites); reads back the station playing, 0
//                  when it's something else or nothing
//     nextStation / prevStation — pulse
//     volume       0–100; on an idle AirPlay speaker it's the level the next
//                  station starts at
//     volumeUp / volumeDown — pulse, ±5
//     mute
//     eq           AirPlay only: equalizer preset 0 = flat, 1 = bass, 2 = vocal,
//                  3 = rock, 4 = jazz, 5 = electronic, 6 = night (the dashboard's
//                  presets); a station playing restarts with it
//     stationName, title, song (the station's current song, ICY StreamTitle),
//     artist, songTitle (the song split at " - "), cover (the station's logo URL),
//     nowPlaying ("RMF FM — Artist - Song") — text: not in the Loxone XML
//     export, but loxoneOut can push them to a Loxone Virtual Text Input
//
//   radio/all — "All speakers": the same controls sent to every speaker at once
//     (Play, Station, Next / Previous station, Volume, Volume + / −, Mute,
//     Equalizer on the AirPlay ones). Reads back: playing = any speaker plays,
//     station = the one they share (0 if different), volume = the average of
//     the playing ones. Each speaker streams on its own, so rooms aren't
//     sample-synchronised.
//
// Saved stations live in config.media.stations (edited from the dashboard), so
// they're re-read on every command and every refresh. Speakers added later
// (Settings, Cast discovery) are picked up by the refresh.
//
// Commands go to the live clients in `clients` (the object the settings routes
// replace clients in). Loxone: Settings → Loxone XML Templates → Radio, or
// GET /api/loxone/outputs.xml?type=radio (and inputs.xml).

const { readConfigCached } = require('./config-file-cache');
const { cleanStations, LIVE_RE, streamTitle } = require('./routes/media');

const REFRESH_MS = 2000;
// the dashboard equalizer's presets (react-dashboard/src/localAudio.js), dB at 60 / 230 / 910 / 3600 / 14000 Hz
const EQ_PRESETS = [
  ['flat', [0, 0, 0, 0, 0]], ['bass', [7, 4, 0, 0, 1]], ['vocal', [-2, -1, 3, 4, 1]], ['rock', [5, 2, -2, 3, 5]],
  ['jazz', [3, 1, -1, 2, 3]], ['electronic', [6, 3, 0, 2, 5]], ['night', [-3, -1, 1, 1, -4]],
];
const VOLUME_STEP = 5;
const SONG_MS = 15000;
const ALL = 'radio/all';

class RadioDevices {
  constructor(config, store, sensorRegistry, clients) {
    this.store = store;
    this.registry = sensorRegistry;
    this.clients = clients;
    this.players = new Map(); // device key → { kind, id, name }
    this.timer = null;
    this.songs = new Map();   // stream url → current song (ICY)
    this.songTimer = null;
    this.all = null;          // the radio/all device
  }

  async start() {
    this._refresh();
    this.timer = setInterval(() => this._refresh(), REFRESH_MS);
    this.timer.unref?.();
    this.songTimer = setInterval(() => this._songs(), SONG_MS);
    this.songTimer.unref?.();
  }

  stop() { clearInterval(this.timer); clearInterval(this.songTimer); clearTimeout(this.songSoon) }

  // the song each playing stream is on (one lookup per distinct stream)
  async _songs() {
    const urls = new Set();
    for (const p of this.players.values()) { const n = this._now(p); if (n.playing && n.url) urls.add(n.url) }
    for (const u of [...this.songs.keys()]) if (!urls.has(u)) this.songs.delete(u);
    await Promise.all([...urls].map((u) => streamTitle(u).then((t) => this.songs.set(u, t || '')).catch(() => {})));
    this._refresh();
  }

  stations() {
    try { return cleanStations(readConfigCached().media?.stations) } catch { return [] }
  }

  _targets() {
    const out = [];
    for (const s of this.clients.airplayClient?.getSpeakers() || []) out.push({ kind: 'airplay', id: s.id, name: s.name, key: `radio/airplay-${s.id}` });
    for (const t of this.clients.googlehome?.targets() || []) out.push({ kind: 'cast', id: t.host, name: t.name, key: `radio/cast-${t.host.replace(/\./g, '_')}`, castKey: t.key });
    return out;
  }

  _refresh() {
    const stations = this.stations();
    const hint = `0 = stop${stations.slice(0, 12).map((s, i) => `, ${i + 1} = ${s.name}`).join('')}${stations.length > 12 ? ', …' : ''}`;
    for (const t of this._targets()) {
      if (!this.players.has(t.key)) this._register(t);
      const p = this.players.get(t.key);
      Object.assign(p, t);
      // the station list can change at any time: keep the range and the hint current
      const st = p.device.sensors.find((s) => s.path === 'station');
      st.max = Math.max(1, stations.length);
      st.hint = hint;
      const now = this._now(p);
      const idx = now.url ? stations.findIndex((s) => s.url === now.url) + 1 : 0;
      this.store.update(`${t.key}/playing`, now.playing ? 1 : 0);
      this.store.update(`${t.key}/station`, now.playing ? idx : 0);
      if (now.playing && idx) this.store.update(`${t.key}/lastStation`, idx);
      this.store.update(`${t.key}/stationName`, now.playing && idx ? stations[idx - 1].name : '');
      this.store.update(`${t.key}/title`, now.playing ? now.title || '' : '');
      const song = now.playing && now.url ? this.songs.get(now.url) || '' : '';
      this.store.update(`${t.key}/song`, song);
      const [artist, songTitle] = splitSong(song);
      this.store.update(`${t.key}/artist`, artist);
      this.store.update(`${t.key}/songTitle`, songTitle);
      this.store.update(`${t.key}/cover`, now.playing && idx ? stations[idx - 1].favicon || '' : '');
      this.store.update(`${t.key}/nowPlaying`, now.playing ? [idx ? stations[idx - 1].name : now.title, song].filter(Boolean).join(' — ') : '');
      if (now.volume != null) this.store.update(`${t.key}/volume`, now.volume);
      else if (this.store.get(`${t.key}/volume`) == null) this.store.update(`${t.key}/volume`, 60);
      this.store.update(`${t.key}/mute`, now.muted ? 1 : 0);
      if (t.kind === 'airplay' && this.store.get(`${t.key}/eq`) == null) this.store.update(`${t.key}/eq`, 0);
    }
    if (this.players.size) this._refreshAll(stations, hint);
  }

  // ── All speakers ──────────────────────────────────────────────────────
  _refreshAll(stations, hint) {
    if (!this.all) this._registerAll();
    this.all.sensors.find((x) => x.path === 'station').max = Math.max(1, stations.length);
    this.all.sensors.find((x) => x.path === 'station').hint = hint;
    const get = (p, k) => this.store.get(`${p.key}/${k}`);
    const ps = [...this.players.values()];
    const on = ps.filter((p) => get(p, 'playing') === 1);
    const st = [...new Set(on.map((p) => get(p, 'station')))];
    const station = on.length && st.length === 1 ? st[0] || 0 : 0;
    const vols = (on.length ? on : ps).map((p) => Number(get(p, 'volume'))).filter(Number.isFinite);
    const set = (k, v) => this.store.update(`${ALL}/${k}`, v);
    set('playing', on.length ? 1 : 0);
    set('station', station);
    if (station) set('lastStation', station);
    set('speakersPlaying', on.length);
    set('volume', vols.length ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : 60);
    set('mute', on.length && on.every((p) => get(p, 'mute') === 1) ? 1 : 0);
    if (this.store.get(`${ALL}/eq`) == null) set('eq', 0);
    set('stationName', station ? stations[station - 1]?.name || '' : '');
    set('nowPlaying', on.map((p) => `${p.name}: ${get(p, 'nowPlaying') || ''}`).join(' · '));
  }

  _registerAll() {
    const sensors = this._sensors(true).filter((x) => !['title', 'song', 'artist', 'songTitle', 'cover'].includes(x.path));
    sensors.splice(sensors.findIndex((x) => x.path === 'stationName'), 0,
      { path: 'speakersPlaying', label: 'Speakers playing', type: 'number' });
    this.all = { key: ALL, label: 'All speakers', type: 'radio', icon: '📻', homekit: [], sensors,
      _writeCapability: (capId, command, args) => this.commandAll(capId, command, args) };
    for (const sn of sensors) sn.ref = `${ALL}/${sn.path}`;
    this.registry.registerDevice(this.all);
  }

  // every speaker at once; fails only if none of them took it
  async commandAll(capId, command, args = []) {
    const ps = [...this.players.values()];
    if (!ps.length) throw new Error('No speakers');
    const stations = this.stations();
    const cur = Number(this.store.get(`${ALL}/station`)) || 0;
    const last = Number(this.store.get(`${ALL}/lastStation`)) || 1;
    const step = (d) => {
      if (!stations.length) throw new Error('No saved stations — add favourites in the dashboard’s media player');
      return (((cur || last) - 1 + d + stations.length) % stations.length) + 1;
    };
    let job;
    switch (capId) {
      case 'playing': job = command === 'play' ? (p) => this.playStation(p, cur || last) : (p) => this.stopPlayer(p); break;
      case 'station': {
        const n = Math.round(Number(args[0]));
        if (!(n >= 0)) throw new Error('Station is a number: 0 = stop, 1… = saved station');
        job = n === 0 ? (p) => this.stopPlayer(p) : (p) => this.playStation(p, n); break;
      }
      case 'nextStation': { const n = step(1); job = (p) => this.playStation(p, n); break }
      case 'prevStation': { const n = step(-1); job = (p) => this.playStation(p, n); break }
      case 'volume': { const v = Number(args[0]); job = (p) => this.setVolume(p, v); break }
      case 'volumeUp': case 'volumeDown': {
        const d = capId === 'volumeUp' ? VOLUME_STEP : -VOLUME_STEP;
        job = (p) => { const v = Number(this.store.get(`${p.key}/volume`)); return this.setVolume(p, Math.max(0, Math.min(100, (Number.isFinite(v) ? v : 50) + d))) };
        break;
      }
      case 'mute': job = (p) => (this._now(p).playing ? this.setMuted(p, command === 'on') : null); break;
      case 'eq': {
        const n = Math.round(Number(args[0]));
        if (!EQ_PRESETS[n]) throw new Error(`Equalizer preset is 0–${EQ_PRESETS.length - 1}`);
        this.store.update(`${ALL}/eq`, n);
        job = (p) => (p.kind === 'airplay' ? this.setEq(p, n) : null); break;
      }
      default: throw new Error(`Unknown command ${capId}`);
    }
    if (['playing', 'station', 'nextStation', 'prevStation'].includes(capId) && !(capId === 'playing' && command !== 'play')) {
      const n = capId === 'playing' ? cur || last : capId === 'station' ? Math.round(Number(args[0])) : null;
      if (n) this.store.update(`${ALL}/lastStation`, n);
    }
    const results = await Promise.allSettled(ps.map((p) => job(p)));
    const failed = results.map((r, i) => (r.status === 'rejected' ? `${ps[i].name}: ${r.reason?.message}` : null)).filter(Boolean);
    if (failed.length === ps.length) throw new Error(failed.join('; '));
    if (failed.length) console.warn(`[Radio] All speakers — ${failed.join('; ')}`);
    setTimeout(() => this._refresh(), 1500).unref?.();
  }

  // what the speaker is doing: { playing, url, title, volume, muted }
  _now(p) {
    if (p.kind === 'airplay') {
      const n = this.clients.airplayClient?.nowPlaying(p.id);
      return n ? { playing: true, url: n.url, title: n.title, volume: n.volume, muted: n.muted } : { playing: false };
    }
    const v = (k) => this.store.get(`${p.castKey}/${k}`);
    const state = String(v('playbackState') || 'idle');
    return { playing: state === 'playing' || state === 'buffering', url: v('mediaUrl') || '', title: v('nowPlaying') || '', volume: v('volume'), muted: v('mute') === 1 };
  }

  // the controls of one speaker (or of All speakers)
  _sensors(withEq) {
    return [
      { path: 'playing', label: 'Play', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'play', writeOff: 'stop', capabilityId: 'playing' },
      { path: 'station', label: 'Station', controllable: true, type: 'range', min: 0, max: 1, step: 1, writeCmd: 'setStation', capabilityId: 'station', hint: '0 = stop' },
      { path: 'nextStation', label: 'Next station', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'nextStation' },
      { path: 'prevStation', label: 'Previous station', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'prevStation' },
      { path: 'volume', label: 'Volume', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setVolume', capabilityId: 'volume' },
      { path: 'volumeUp', label: 'Volume +', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'volumeUp' },
      { path: 'volumeDown', label: 'Volume −', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'volumeDown' },
      { path: 'mute', label: 'Mute', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'mute' },
      ...(withEq ? [{ path: 'eq', label: 'Equalizer', controllable: true, type: 'range', min: 0, max: EQ_PRESETS.length - 1, step: 1, writeCmd: 'setEq', capabilityId: 'eq',
        hint: EQ_PRESETS.map(([n], i) => `${i} = ${n}`).join(', ') }] : []),
      { path: 'stationName', label: 'Station name', type: 'label' },
      { path: 'title', label: 'Stream title', type: 'label' },
      { path: 'song', label: 'Song', type: 'label' },
      { path: 'artist', label: 'Artist', type: 'label' },
      { path: 'songTitle', label: 'Song title', type: 'label' },
      { path: 'cover', label: 'Station logo (URL)', type: 'label' },
      { path: 'nowPlaying', label: 'Now playing (text)', type: 'label' },
    ];
  }

  _register(t) {
    const device = {
      key: t.key, label: t.name, type: 'radio', icon: '📻', homekit: [],
      sensors: this._sensors(t.kind === 'airplay'),
      _writeCapability: (capId, command, args) => this.command(t.key, capId, command, args),
    };
    // unique, last: what Loxone's feedback inputs match on (src/loxone-xml.js)
    for (const sn of device.sensors) sn.ref = `${t.key}/${sn.path}`;
    this.players.set(t.key, { ...t, device });
    this.registry.registerDevice(device);
  }

  async command(key, capId, command, args = []) {
    const p = this.players.get(key);
    if (!p) throw new Error('Unknown radio');
    const stations = this.stations();
    const cur = Number(this.store.get(`${key}/station`)) || 0;
    const last = Number(this.store.get(`${key}/lastStation`)) || 1;
    const step = (d) => {
      if (!stations.length) throw new Error('No saved stations — add favourites in the dashboard’s media player');
      const from = cur || last;
      return ((from - 1 + d + stations.length) % stations.length) + 1;
    };
    switch (capId) {
      case 'playing': return command === 'play' ? this.playStation(p, cur || last) : this.stopPlayer(p);
      case 'station': {
        const n = Math.round(Number(args[0]));
        if (!(n >= 0)) throw new Error('Station is a number: 0 = stop, 1… = saved station');
        return n === 0 ? this.stopPlayer(p) : this.playStation(p, n);
      }
      case 'nextStation': return this.playStation(p, step(1));
      case 'prevStation': return this.playStation(p, step(-1));
      case 'volume': return this.setVolume(p, Number(args[0]));
      case 'volumeUp': case 'volumeDown': {
        const v = Number(this.store.get(`${key}/volume`));
        return this.setVolume(p, Math.max(0, Math.min(100, (Number.isFinite(v) ? v : 50) + (capId === 'volumeUp' ? VOLUME_STEP : -VOLUME_STEP))));
      }
      case 'eq': return this.setEq(p, Math.round(Number(args[0])));
      case 'mute': return this.setMuted(p, command === 'on');
      default: throw new Error(`Unknown command ${capId}`);
    }
  }

  async playStation(p, n) {
    const stations = this.stations();
    const s = stations[n - 1];
    if (!s) throw new Error(stations.length ? `There are ${stations.length} saved stations — ${n} isn’t one of them` : 'No saved stations — add favourites in the dashboard’s media player');
    const volume = Number(this.store.get(`${p.key}/volume`));
    this.store.update(`${p.key}/lastStation`, n);
    if (p.kind === 'cast') {
      const cast = this.clients.googlehome;
      if (!cast) throw new Error('Chromecast isn’t set up');
      await cast.cast(p.id, { url: s.url, title: s.name, live: LIVE_RE.test(s.url) });
    } else {
      const airplay = this.clients.airplayClient;
      if (!airplay) throw new Error('AirPlay isn’t enabled');
      airplay.play(p.id, s.url, { title: s.name, volume: volume >= 0 && volume <= 100 ? volume : undefined, eq: this._eqGains(p) })
        .catch((err) => console.warn(`[Radio] ${p.name}: ${err.message}`));
    }
    this.store.update(`${p.key}/station`, n);
    this.store.update(`${p.key}/playing`, 1);
    this.store.update(`${p.key}/stationName`, s.name);
    clearTimeout(this.songSoon);
    this.songSoon = setTimeout(() => this._songs().catch(() => {}), 3000); // the new station's song, without waiting for the next round
    this.songSoon.unref?.();
  }

  _eqGains(p) {
    const n = Number(this.store.get(`${p.key}/eq`)) || 0;
    return EQ_PRESETS[n]?.[1];
  }

  // AirPlay applies the equalizer when a stream starts: a station playing restarts with it
  async setEq(p, n) {
    if (p.kind !== 'airplay') throw new Error('The equalizer works on AirPlay speakers');
    if (!EQ_PRESETS[n]) throw new Error(`Equalizer preset is 0–${EQ_PRESETS.length - 1}: ${EQ_PRESETS.map(([x], i) => `${i} ${x}`).join(', ')}`);
    this.store.update(`${p.key}/eq`, n);
    const cur = Number(this.store.get(`${p.key}/station`)) || 0;
    if (cur && this.clients.airplayClient?.nowPlaying(p.id)) await this.playStation(p, cur);
  }

  async stopPlayer(p) {
    if (p.kind === 'cast') await this.clients.googlehome?._executeCommand(p.id, 'stop');
    else this.clients.airplayClient?.stop(p.id);
    this.store.update(`${p.key}/playing`, 0);
    this.store.update(`${p.key}/station`, 0);
  }

  async setVolume(p, v) {
    if (!(v >= 0 && v <= 100)) throw new Error('Volume is 0–100');
    v = Math.round(v);
    if (p.kind === 'cast') await this.clients.googlehome?._executeCommand(p.id, 'volume', 'setVolume', [v]);
    else if (this.clients.airplayClient?.nowPlaying(p.id)) this.clients.airplayClient.setVolume(p.id, v);
    this.store.update(`${p.key}/volume`, v); // an idle AirPlay speaker starts the next station at this level
  }

  async setMuted(p, muted) {
    if (p.kind === 'cast') await this.clients.googlehome?._executeCommand(p.id, 'mute', muted ? 'on' : 'off');
    else if (this.clients.airplayClient?.nowPlaying(p.id)) this.clients.airplayClient.setMuted(p.id, muted);
    else throw new Error('Nothing is playing on this speaker');
    this.store.update(`${p.key}/mute`, muted ? 1 : 0);
  }
}

// "Artist - Title" (how stations send it) → [artist, title]; no separator → ['', whole]
function splitSong(song) {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(String(song || '').trim());
  return m ? [m[1].trim(), m[2].trim()] : ['', String(song || '').trim()];
}

module.exports = RadioDevices;
module.exports.splitSong = splitSong;
