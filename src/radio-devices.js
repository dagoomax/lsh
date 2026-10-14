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
//     mute
//     stationName, title — what's playing (text, not exported to Loxone)
//
// Saved stations live in config.media.stations (edited from the dashboard), so
// they're re-read on every command and every refresh. Speakers added later
// (Settings, Cast discovery) are picked up by the refresh.
//
// Commands go to the live clients in `clients` (the object the settings routes
// replace clients in). Loxone: Settings → Loxone XML Templates → Radio, or
// GET /api/loxone/outputs.xml?type=radio (and inputs.xml).

const { readConfigCached } = require('./config-file-cache');
const { cleanStations, LIVE_RE } = require('./routes/media');

const REFRESH_MS = 2000;

class RadioDevices {
  constructor(config, store, sensorRegistry, clients) {
    this.store = store;
    this.registry = sensorRegistry;
    this.clients = clients;
    this.players = new Map(); // device key → { kind, id, name }
    this.timer = null;
  }

  async start() {
    this._refresh();
    this.timer = setInterval(() => this._refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer) }

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
      if (now.volume != null) this.store.update(`${t.key}/volume`, now.volume);
      else if (this.store.get(`${t.key}/volume`) == null) this.store.update(`${t.key}/volume`, 60);
      this.store.update(`${t.key}/mute`, now.muted ? 1 : 0);
    }
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

  _register(t) {
    const device = {
      key: t.key, label: t.name, type: 'radio', icon: '📻', homekit: [],
      sensors: [
        { path: 'playing', label: 'Play', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'play', writeOff: 'stop', capabilityId: 'playing' },
        { path: 'station', label: 'Station', controllable: true, type: 'range', min: 0, max: 1, step: 1, writeCmd: 'setStation', capabilityId: 'station', hint: '0 = stop' },
        { path: 'nextStation', label: 'Next station', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'nextStation' },
        { path: 'prevStation', label: 'Previous station', type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: 'prevStation' },
        { path: 'volume', label: 'Volume', unit: '%', controllable: true, type: 'range', min: 0, max: 100, rangeFormat: 'percent', writeCmd: 'setVolume', capabilityId: 'volume' },
        { path: 'mute', label: 'Mute', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'mute' },
        { path: 'stationName', label: 'Station name', type: 'label' },
        { path: 'title', label: 'Now playing', type: 'label' },
      ],
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
      airplay.play(p.id, s.url, { title: s.name, volume: volume >= 0 && volume <= 100 ? volume : undefined })
        .catch((err) => console.warn(`[Radio] ${p.name}: ${err.message}`));
    }
    this.store.update(`${p.key}/station`, n);
    this.store.update(`${p.key}/playing`, 1);
    this.store.update(`${p.key}/stationName`, s.name);
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

module.exports = RadioDevices;
