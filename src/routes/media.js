'use strict';

// Dashboard media player: play a URL (internet radio, stream, audio file) on a
// Chromecast / Google Home / Nest speaker (src/googlehome-client.js) or an
// AirPlay speaker (src/airplay-client.js), stop it, change its volume, and keep
// a list of saved stations (config.media.stations: [{ name, url }]).
//
//   GET  /media/targets             speakers + what they're playing, saved stations
//   POST /media/play   { target, url, title?, volume?, eq? }  target = cast:<host> | airplay:<id>; eq = 5 gains (dB), AirPlay only
//   POST /media/stop   { target }
//   POST /media/pause | /media/resume { target }   (Cast)
//   POST /media/volume { target, volume }
//   POST /media/mute   { target, muted }
//   POST /media/stations { stations: [{ name, url, favicon? }] }
//   GET  /media/radio?q=&country=   internet radio directory (radio-browser.info, proxied + cached)
//   GET  /media/nowplaying?url=     the stream's current song (ICY metadata), cached 15 s
//   GET  /media/stream?url=         relays an audio stream to this screen (https pages can't
//                                   play http streams; only audio content types pass)
//   GET  /media/spectrum?url=       live spectrum of a stream playing on a speaker, as
//                                   server-sent events (base64, 48 bands 0–255, ~21/s);
//                                   204 when no speaker plays it
//
// Only http(s) URLs are played — never a path on this server.
const http = require('http');
const https = require('https');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const SpectrumHub = require('../media-spectrum');

const spectrum = new SpectrumHub();

const URL_RE = /^https?:\/\/[^\s]+$/i;
const LIVE_RE = /\.(m3u8|pls)(\?|$)|\/(stream|live|listen|radio)\b|icecast|shoutcast|:\d{4,5}\/?(;|$)/i;

function cleanStations(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => {
      const st = { name: String(s?.name || '').trim().slice(0, 80), url: String(s?.url || '').trim() };
      const icon = String(s?.favicon || '').trim();
      if (URL_RE.test(icon) && icon.length < 500) st.favicon = icon;
      return st;
    })
    .filter((s) => s.name && URL_RE.test(s.url))
    .slice(0, 50);
}

// ── internet radio directory (radio-browser.info: free, community-run) ──────
const RB_HOSTS = ['de1.api.radio-browser.info', 'nl1.api.radio-browser.info', 'at1.api.radio-browser.info'];
const radioCache = new Map(); // query → { at, data }
async function radioSearch({ q, country }) {
  const key = `${q}|${country}`;
  const hit = radioCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const params = new URLSearchParams({ limit: '40', hidebroken: 'true', order: 'clickcount', reverse: 'true' });
  if (q) params.set('name', q);
  if (country) params.set('countrycode', country);
  let lastErr;
  for (const host of RB_HOSTS) {
    try {
      const res = await fetch(`https://${host}/json/stations/search?${params}`, { headers: { 'User-Agent': 'LSH/1.0' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const seen = new Set();
      const data = (await res.json())
        .filter((st) => URL_RE.test(st.url_resolved || '') && !seen.has(st.url_resolved) && seen.add(st.url_resolved))
        .map((st) => ({
          name: String(st.name || '').trim().slice(0, 80), url: st.url_resolved,
          favicon: URL_RE.test(st.favicon || '') ? st.favicon : undefined,
          country: st.countrycode || '', codec: st.codec || '', bitrate: st.bitrate || 0, hls: !!st.hls,
          tags: String(st.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3),
        }))
        .filter((st) => st.name);
      radioCache.set(key, { at: Date.now(), data });
      if (radioCache.size > 200) radioCache.delete(radioCache.keys().next().value);
      return data;
    } catch (err) { lastErr = err }
  }
  throw new Error(`Radio directory unreachable (${lastErr?.message || 'no answer'})`);
}

// open an http(s) GET, following up to 3 redirects
function openUrl(url, headers, timeoutMs, hops = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'LSH/1.0', ...headers }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        if (!URL_RE.test(next)) return reject(new Error('Bad redirect'));
        return openUrl(next, headers, timeoutMs, hops + 1).then(resolve, reject);
      }
      resolve({ res, req });
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

// ── what's on: ICY StreamTitle (Icecast / Shoutcast) ────────────────────────
const titleCache = new Map(); // url → { at, title }
// what stations put in StreamTitle that isn't a song: ad-break markers (RMF's
// "STOP_AD_BREAK"), "advert", a lone dash, upper-case tokens with underscores
const NOT_A_SONG = /^(?:[-–—\s.]*|(?:start|stop|begin|end)?_?ad_?(?:break|block)?(?:_(?:start|stop|begin|end))?|ad(?:vert(?:isement)?)?s?|commercials?|reklam[ay]?|[A-Z0-9]+(?:_[A-Z0-9]+)+)$/i;
async function streamTitle(url) {
  const hit = titleCache.get(url);
  if (hit && Date.now() - hit.at < 15000) return hit.title;
  let title = '';
  try {
    const { res, req } = await openUrl(url, { 'Icy-MetaData': '1' }, 6000);
    const metaint = Number(res.headers['icy-metaint']);
    if (res.statusCode === 200 && metaint > 0 && metaint < 1e6) {
      title = await new Promise((resolve) => {
        let got = 0, buf = Buffer.alloc(0);
        const done = (t) => { req.destroy(); resolve(t) };
        const timer = setTimeout(() => done(''), 6000);
        res.on('data', (chunk) => {
          got += chunk.length;
          buf = Buffer.concat([buf, chunk]);
          if (buf.length > metaint + 1) {
            const len = buf[metaint] * 16;
            if (buf.length >= metaint + 1 + len) {
              clearTimeout(timer);
              const meta = buf.subarray(metaint + 1, metaint + 1 + len).toString('utf8');
              done((/StreamTitle='(.*?)';/.exec(meta)?.[1] || '').trim());
            }
          }
          if (got > metaint + 4096 + 1) { clearTimeout(timer); done('') }
        });
        res.on('error', () => { clearTimeout(timer); done('') });
      });
    } else req.destroy();
  } catch { /* no metadata — fine */ }
  if (NOT_A_SONG.test(title)) title = ''; // ad-break markers and the like aren't songs
  titleCache.set(url, { at: Date.now(), title });
  if (titleCache.size > 100) titleCache.delete(titleCache.keys().next().value);
  return title;
}

const AUDIO_TYPE = /^(audio\/|application\/(ogg|octet-stream|x-mpegurl|vnd\.apple\.mpegurl)|video\/mp2t)/i;
const SPECTRUM_CHECK_MS = 15000; // is the station still on a speaker?

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

  // the speakers and what they're playing
  const listTargets = () => {
    const targets = [];
    for (const t of cast()?.targets() || []) {
      const v = (p) => store.get(`${t.key}/${p}`);
      targets.push({ id: `cast:${t.host}`, kind: 'chromecast', name: t.name, deviceKey: t.key,
        state: v('playbackState') || 'idle', title: v('nowPlaying') || '', url: v('mediaUrl') || '', volume: v('volume'), muted: v('mute') === 1 });
    }
    for (const s of airplay()?.getSpeakers() || []) {
      targets.push({ id: `airplay:${s.id}`, kind: 'airplay', name: s.name,
        state: s.playing ? 'playing' : 'idle', title: s.playing?.title || '', url: s.playing?.url || '', volume: s.playing?.volume ?? null, muted: !!s.playing?.muted, since: s.playing?.since });
    }
    return targets;
  };
  const onSpeaker = (url) => listTargets().some((t) => t.url === url && (t.state === 'playing' || t.state === 'buffering'));

  router.get('/media/targets', (req, res) => {
    const targets = listTargets();
    let stations = [];
    try { stations = cleanStations(readConfigFile().media?.stations) } catch { /* no config */ }
    res.json({ success: true, data: { targets, stations } });
  });

  router.post('/media/play', requireAdmin, (req, res) => reply(res, async () => {
    const { kind, id } = parseTarget(req.body?.target);
    const url = String(req.body?.url || '').trim();
    if (!URL_RE.test(url)) throw new Error('Give an http(s) URL of a stream or audio file');
    const title = String(req.body?.title || '').trim().slice(0, 120) || undefined;
    const vol = Number(req.body?.volume);
    const volume = req.body?.volume != null && vol >= 0 && vol <= 100 ? Math.round(vol) : undefined; // start at this level
    if (kind === 'cast') {
      await cast().cast(id, { url, title, live: req.body?.live ?? LIVE_RE.test(url) });
      if (volume !== undefined) await cast()._executeCommand(id, 'volume', 'setVolume', [volume]);
      return 'Playing';
    }
    // AirPlay plays until the stream ends — answer once it has clearly started (or failed early)
    const eq = Array.isArray(req.body?.eq) && req.body.eq.length === 5 ? req.body.eq.map((x) => Math.max(-12, Math.min(12, Number(x) || 0))) : undefined;
    const playing = airplay().play(id, url, { title, volume, eq });
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

  router.get('/media/radio', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().slice(0, 80);
      const country = /^[A-Za-z]{2}$/.test(req.query.country || '') ? String(req.query.country).toUpperCase() : '';
      res.json({ success: true, data: await radioSearch({ q, country }) });
    } catch (err) { res.status(502).json({ success: false, error: err.message }) }
  });

  router.get('/media/nowplaying', requireAdmin, async (req, res) => {
    const url = String(req.query.url || '');
    if (!URL_RE.test(url)) return res.status(400).json({ success: false, error: 'url must be http(s)' });
    res.json({ success: true, data: { title: await streamTitle(url) } });
  });

  router.get('/media/stream', requireAdmin, async (req, res) => {
    const url = String(req.query.url || '');
    if (!URL_RE.test(url)) return res.status(400).end();
    try {
      const { res: up, req: upReq } = await openUrl(url, req.headers.range ? { Range: req.headers.range } : {}, 15000);
      const type = String(up.headers['content-type'] || '');
      if (![200, 206].includes(up.statusCode) || !AUDIO_TYPE.test(type)) { upReq.destroy(); return res.status(415).end() }
      res.status(up.statusCode);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'icy-name']) if (up.headers[h]) res.setHeader(h, up.headers[h]);
      res.setHeader('Cache-Control', 'no-store');
      up.pipe(res);
      const close = () => upReq.destroy();
      req.on('close', close);
      up.on('error', () => res.destroy());
    } catch { if (!res.headersSent) res.status(502).end() }
  });

  router.post('/media/mute', requireAdmin, (req, res) => reply(res, async () => {
    const { kind, id } = parseTarget(req.body?.target);
    const muted = req.body?.muted === true || req.body?.muted === 'true';
    if (kind === 'cast') await cast()._executeCommand(id, 'mute', muted ? 'on' : 'off');
    else airplay().setMuted(id, muted);
    return muted ? 'Muted' : 'Unmuted';
  }));

  // Only while a speaker plays the station: decoding it means downloading it
  // too, and a dashboard left open in a background tab never closes its
  // stream. Once the station has been off every speaker for two checks in a
  // row the stream ends; the EventSource reconnects, and the 204 it gets then
  // is what tells it to stop for good.
  router.get('/media/spectrum', requireAdmin, (req, res) => {
    const url = String(req.query.url || '');
    if (!URL_RE.test(url)) return res.status(400).end();
    if (!onSpeaker(url)) return res.status(204).end();
    let stop;
    try {
      stop = spectrum.watch(url, (frame) => res.write(`data: ${Buffer.from(frame).toString('base64')}\n\n`));
    } catch (err) { return res.status(429).json({ success: false, error: err.message }) }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': spectrum\n\n');
    let check = null, off = 0;
    const done = () => {
      if (!stop) return;
      clearInterval(check);
      stop();
      stop = null;
      if (!res.destroyed && !res.writableEnded) res.end();
    };
    check = setInterval(() => { off = onSpeaker(url) ? 0 : off + 1; if (off >= 2) done() }, SPECTRUM_CHECK_MS);
    req.on('close', done);
    res.on('close', done);
  });

  router.post('/media/stations', requireAdmin, (req, res) => reply(res, () => {
    const stations = cleanStations(req.body?.stations);
    const current = readConfigFile();
    writeConfigFile({ ...current, media: { ...(current.media || {}), stations } });
    return `Saved ${stations.length}`;
  }));
};

module.exports.cleanStations = cleanStations;
module.exports.LIVE_RE = LIVE_RE;
module.exports.streamTitle = streamTitle;
module.exports.NOT_A_SONG = NOT_A_SONG;
