'use strict';

// Dashboard media player: play a URL (internet radio, stream, audio file) on a
// Chromecast / Google Home / Nest speaker (src/googlehome-client.js) or an
// AirPlay speaker (src/airplay-client.js), stop it, change its volume, and keep
// a list of saved stations (config.media.stations: [{ name, url }]).
//
//   GET  /media/targets             speakers + what they're playing, saved stations
//   POST /media/play   { target, url, title? }     target = cast:<host> | airplay:<id>
//   POST /media/stop   { target }
//   POST /media/pause | /media/resume { target }   (Cast)
//   POST /media/volume { target, volume }
//   POST /media/stations { stations: [{ name, url }] }
//
// Only http(s) URLs are played — never a path on this server.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const URL_RE = /^https?:\/\/[^\s]+$/i;
const LIVE_RE = /\.(m3u8|pls)(\?|$)|\/(stream|live|listen|radio)\b|icecast|shoutcast|:\d{4,5}\/?(;|$)/i;

function cleanStations(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => ({ name: String(s?.name || '').trim().slice(0, 80), url: String(s?.url || '').trim() }))
    .filter((s) => s.name && URL_RE.test(s.url))
    .slice(0, 50);
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store } = ctx;
  const cast = () => clients.googlehome;
  const airplay = () => clients.airplayClient;

  const parseTarget = (t) => {
    const m = /^(cast|airplay):(.+)$/.exec(String(t || ''));
    if (!m) throw new Error('target must be cast:<host> or airplay:<speaker id>');
    if (m[1] === 'cast' && !cast()) throw new Error('No Chromecast / Google Home devices are configured');
    if (m[1] === 'airplay' && !airplay()) throw new Error('AirPlay is not enabled');
    return { kind: m[1], id: m[2] };
  };
  const reply = (res, fn) => Promise.resolve().then(fn)
    .then((message) => res.json({ success: true, message }))
    .catch((err) => res.status(/must be|not configured|not enabled|Unknown|URL/.test(err.message) ? 400 : 502).json({ success: false, error: err.message }));

  router.get('/media/targets', (req, res) => {
    const targets = [];
    for (const t of cast()?.targets() || []) {
      const v = (p) => store.get(`${t.key}/${p}`);
      targets.push({ id: `cast:${t.host}`, kind: 'chromecast', name: t.name, deviceKey: t.key,
        state: v('playbackState') || 'idle', title: v('nowPlaying') || '', volume: v('volume'), muted: v('mute') === 1 });
    }
    for (const s of airplay()?.getSpeakers() || []) {
      targets.push({ id: `airplay:${s.id}`, kind: 'airplay', name: s.name,
        state: s.playing ? 'playing' : 'idle', title: s.playing?.title || '', volume: s.playing?.volume ?? null, since: s.playing?.since });
    }
    let stations = [];
    try { stations = cleanStations(readConfigFile().media?.stations) } catch { /* no config */ }
    res.json({ success: true, data: { targets, stations } });
  });

  router.post('/media/play', requireAdmin, (req, res) => reply(res, async () => {
    const { kind, id } = parseTarget(req.body?.target);
    const url = String(req.body?.url || '').trim();
    if (!URL_RE.test(url)) throw new Error('Give an http(s) URL of a stream or audio file');
    const title = String(req.body?.title || '').trim().slice(0, 120) || undefined;
    if (kind === 'cast') {
      await cast().cast(id, { url, title, live: req.body?.live ?? LIVE_RE.test(url) });
      return 'Playing';
    }
    // AirPlay plays until the stream ends — answer once it has clearly started (or failed early)
    const playing = airplay().play(id, url, { title });
    playing.catch((err) => console.warn(`[Media] AirPlay ${id}: ${err.message}`));
    const early = await Promise.race([playing.then(() => 'ended', (err) => { throw err }), new Promise((r) => setTimeout(() => r('playing'), 4000))]);
    return early === 'ended' ? 'Played' : 'Playing';
  }));

  router.post('/media/stop', requireAdmin, (req, res) => reply(res, async () => {
    const { kind, id } = parseTarget(req.body?.target);
    if (kind === 'cast') {
      const t = cast().targets().find((x) => x.host === id);
      if (!t) throw new Error(`Unknown Cast device ${id}`);
      await cast()._executeCommand(id, 'stop');
    } else airplay().stop(id);
    return 'Stopped';
  }));

  // pause / resume: Cast only (an AirPlay stream can only be stopped)
  for (const [path, cap] of [['pause', 'pause'], ['resume', 'play']]) {
    router.post(`/media/${path}`, requireAdmin, (req, res) => reply(res, async () => {
      const { kind, id } = parseTarget(req.body?.target);
      if (kind !== 'cast') throw new Error('Unknown action for an AirPlay speaker — use stop');
      await cast()._executeCommand(id, cap);
      return path === 'pause' ? 'Paused' : 'Playing';
    }));
  }

  router.post('/media/volume', requireAdmin, (req, res) => reply(res, async () => {
    const { kind, id } = parseTarget(req.body?.target);
    const v = Number(req.body?.volume);
    if (!(v >= 0 && v <= 100)) throw new Error('volume must be 0–100');
    if (kind === 'cast') await cast()._executeCommand(id, 'volume', 'setVolume', [v]);
    else airplay().setVolume(id, v);
    return `Volume ${Math.round(v)}%`;
  }));

  router.post('/media/stations', requireAdmin, (req, res) => reply(res, () => {
    const stations = cleanStations(req.body?.stations);
    const current = readConfigFile();
    writeConfigFile({ ...current, media: { ...(current.media || {}), stations } });
    return `Saved ${stations.length}`;
  }));
};

module.exports.cleanStations = cleanStations;
module.exports.LIVE_RE = LIVE_RE;
