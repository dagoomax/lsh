'use strict';

// Dashboard onboarding: a welcome card with a city guide — getting around,
// restaurants and places to visit, sorted by distance from the home.
//
//   GET  /guide?lang=pl          the guide (only when config.onboarding.enabled),
//                                with the city's ready-made walks and phrasebook
//   GET  /guide/cities           the cities there's a guide for
//   POST /settings/onboarding    { enabled, city, welcome, lat, lon, sections, extras }
//
// config.onboarding = {
//   enabled: true, city: 'katowice',
//   welcome: 'host's own words (optional, replaces the city's)',
//   lat, lon,                    // the home; default: openweather.lat/lon
//   sections: { transport: true, restaurants: true, places: true },
//   extras: [{ name, category: 'restaurant' | 'place' | 'transport', note, address, lat, lon, url }],
// }
//
// City data: src/city-guides/<city>.js ({ pl, en } texts, coordinates).
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const SECTIONS = ['transport', 'restaurants', 'places'];
const CATEGORY = { transport: 'transport', restaurant: 'restaurants', place: 'places' };

const gen = () => require('../guide-generator');

// built-in guides (src/city-guides/*.js — listed here so the module manifest
// ships them) and ones Claude wrote (persist/city-guides/gen-*.json)
const katowice = require('../city-guides/katowice');

const BUILT_IN = { katowice };
function cities() {
  return [...Object.keys(BUILT_IN), ...gen().list().map((g) => g.id)];
}
function loadCity(id) {
  if (String(id).startsWith('gen-')) return gen().load(id);
  return Object.prototype.hasOwnProperty.call(BUILT_IN, id) ? BUILT_IN[id] : null;
}

// great-circle distance, km
function km(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const num = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function homeOf(cfg) {
  const o = cfg.onboarding || {};
  const lat = num(o.lat) ?? num(cfg.openweather?.lat), lon = num(o.lon) ?? num(cfg.openweather?.lon);
  return lat != null && lon != null ? { lat, lon, source: num(o.lat) != null ? 'onboarding' : 'weather' } : null;
}

// One item in the viewer's language, with distance and map links
function view(item, lang, home, cityName) {
  const t = (v) => (v && typeof v === 'object' ? v[lang] || v.en || v.pl || '' : v || '');
  const out = {
    id: item.id, name: t(item.name), text: t(item.text || item.note), kind: t(item.kind), tag: t(item.tag) || item.tag || null,
    address: item.address || null, price: item.price || null, url: item.url || null, icon: item.icon || null, custom: !!item.custom,
  };
  if (item.veg) out.veg = true;
  // photos: https only (Wikimedia Commons), with their credit
  if (item.image?.src && /^https:\/\//.test(item.image.src)) {
    out.image = { src: item.image.src, page: /^https:\/\//.test(item.image.page || '') ? item.image.page : null, author: String(item.image.author || '').slice(0, 120), license: String(item.image.license || '').slice(0, 40) };
  }
  const has = num(item.lat) != null && num(item.lon) != null;
  const where = has ? `${item.lat},${item.lon}` : item.address ? `${item.address}, ${cityName}` : null;
  if (where) out.map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(has ? where : `${t(item.name)}, ${where}`)}`;
  if (has) { out.lat = Number(item.lat); out.lon = Number(item.lon); }
  if (has && home) {
    const d = km([home.lat, home.lon], [Number(item.lat), Number(item.lon)]);
    out.km = Math.round(d * 10) / 10;
    out.walkMin = d <= 3 ? Math.max(1, Math.round((d * 1.3 / 4.8) * 60)) : null; // streets ≈ 1.3 × straight line, 4.8 km/h
    out.directions = `https://www.google.com/maps/dir/?api=1&origin=${home.lat},${home.lon}&destination=${item.lat},${item.lon}&travelmode=${d <= 2 ? 'walking' : 'transit'}`;
  }
  return out;
}

// The page proxy never reaches the LAN, loopback or link-local addresses
async function assertPublicHost(host) {
  const { lookup } = require('dns').promises;
  const addrs = await lookup(host, { all: true });
  for (const { address } of addrs) {
    const v4 = address.replace(/^::ffff:/, '');
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(v4) || /^(::1|fc|fd|fe80)/i.test(address)) {
      throw new Error('Address not allowed');
    }
  }
}

function pageError(res, msg, url) {
  const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" })
    .send(`<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px system-ui;background:#0a1020;color:#e8eefc;display:grid;place-items:center;height:100vh;text-align:center"><div><div style="font-size:40px">🌐</div><p>${esc(msg)}</p><p style="opacity:.6;font-size:12px;word-break:break-all">${esc(url)}</p></div>`);
}

// every link the current guide shows — the only other URLs the QR code endpoint encodes
function guideUrls(cfg) {
  const o = cfg.onboarding || {};
  const city = loadCity(o.city || 'katowice');
  const out = new Set();
  for (const k of SECTIONS) for (const it of city?.[k] || []) { if (it.url) out.add(it.url); if (it.image?.page) out.add(it.image.page); }
  for (const x of city?.sources || []) if (x.url) out.add(x.url);
  for (const e of o.extras || []) if (e.url) out.add(e.url);
  return out;
}

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  router.get('/guide/cities', (req, res) => {
    res.json({
      success: true,
      data: cities().map((id) => { const c = loadCity(id); return { id, name: c?.name?.pl || id, generated: c?.generated || null }; }),
    });
  });

  // Generate with Claude — a job, since the research takes a minute or two
  const jobs = new Map(); // id → { state, city, searches, guideId, error, at }
  router.post('/guide/generate', requireAdmin, (req, res) => {
    const city = String(req.body?.city || '').trim().slice(0, 60);
    if (!city) return res.status(400).json({ success: false, error: 'Which city?' });
    if ([...jobs.values()].some((j) => j.state === 'running')) return res.status(409).json({ success: false, error: 'A guide is already being written' });
    const cfg = readConfigFile();
    const home = homeOf(cfg);
    const jobId = require('crypto').randomBytes(6).toString('hex');
    const job = { state: 'running', city, searches: 0, at: Date.now() };
    jobs.set(jobId, job);
    for (const [k, j] of jobs) if (Date.now() - j.at > 3600_000) jobs.delete(k);
    gen().generate({ city, lat: home?.lat, lon: home?.lon }, { onProgress: (p) => { job.searches = p.searches; } })
      .then(async (guide) => { job.state = 'running'; job.step = 'photos'; await gen().addImages(guide).catch(() => {}); job.guideId = gen().save(guide); job.state = 'done'; job.counts = { transport: guide.transport.length, restaurants: guide.restaurants.length, places: guide.places.length }; console.log(`[Guide] Claude wrote a guide for ${city} (${job.searches} searches)`); })
      .catch((err) => { job.state = 'error'; job.error = err.message; console.error(`[Guide] Generating ${city}: ${err.message}`); });
    res.json({ success: true, data: { job: jobId } });
  });

  router.get('/guide/generate/:job', requireAdmin, (req, res) => {
    const j = jobs.get(req.params.job);
    if (!j) return res.status(404).json({ success: false, error: 'No such job' });
    res.json({ success: true, data: { state: j.state, step: j.step || null, city: j.city, searches: j.searches, guideId: j.guideId || null, counts: j.counts || null, error: j.error || null, seconds: Math.round((Date.now() - j.at) / 1000) } });
  });

  router.delete('/guide/cities/:id', requireAdmin, (req, res) => {
    if (!String(req.params.id).startsWith('gen-')) return res.status(400).json({ success: false, error: 'Only guides written by Claude can be deleted' });
    if (readConfigFile().onboarding?.city === req.params.id) return res.status(400).json({ success: false, error: 'That guide is in use — choose another city first' });
    res.json({ success: gen().remove(req.params.id) });
  });

  router.get('/guide', (req, res) => {
    const cfg = readConfigFile();
    const o = cfg.onboarding || {};
    if (!o.enabled) return res.json({ success: true, data: null });
    const city = loadCity(o.city || 'katowice');
    if (!city) return res.json({ success: false, error: `No guide for "${o.city}"` });
    const lang = String(req.query.lang || 'en').slice(0, 2) === 'pl' ? 'pl' : 'en';
    const home = homeOf(cfg);
    const cityName = city.name[lang] || city.name.en;
    const t = (v) => (v && typeof v === 'object' ? v[lang] || v.en || '' : v || '');
    const on = (k) => o.sections?.[k] !== false;
    const extras = (Array.isArray(o.extras) ? o.extras : []).filter((e) => e?.name);
    const byDistance = (a, b) => (a.km ?? 1e9) - (b.km ?? 1e9);
    const section = (k, sort) => {
      if (!on(k)) return null;
      const items = [
        ...extras.filter((e) => CATEGORY[e.category] === k).map((e, i) => view({ ...e, id: `extra-${i}`, custom: true }, lang, home, cityName)),
        ...city[k].map((it) => view(it, lang, home, cityName)),
      ];
      return sort ? items.sort((a, b) => (b.custom - a.custom) || byDistance(a, b)) : items;
    };
    res.json({
      success: true,
      data: {
        city: city.id, cityName,
        title: (city.title && (city.title[lang] || city.title.en)) || null,
        skyline: city.skyline || null,
        center: city.center,
        welcome: String(o.welcome || '').trim() || city.welcome[lang] || city.welcome.en,
        home: home ? { lat: home.lat, lon: home.lon, source: home.source, centreKm: Math.round(km([home.lat, home.lon], city.center) * 10) / 10 } : null,
        transport: section('transport', false),
        restaurants: section('restaurants', true),
        places: section('places', true),
        // ready-made walks (stops that are on the page) and a Silesian phrasebook
        walks: (city.walks || []).map((w) => {
          const stops = (w.stops || []).filter((key) => { const [k, id] = String(key).split(':'); return on(k) && city[k]?.some((it) => it.id === id && it.lat != null); });
          return stops.length >= 2 ? { id: w.id, icon: w.icon || null, mode: w.mode || 'walking', name: t(w.name), text: t(w.text), stops } : null;
        }).filter(Boolean),
        phrases: (city.phrases || []).map((p) => ({ sl: p.sl, meaning: p[lang] || p.en })),
        sources: city.sources,
        generated: city.generated || null,
        // optional Google Maps Embed API key — embed keys are meant to be public (restrict it to this host)
        mapsKey: o.mapsKey || null,
      },
    });
  });

  // "Add a place": OpenStreetMap search around the city (Nominatim — at most one request a second)
  let lastSearch = 0;
  router.get('/guide/search', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 3) return res.json({ success: true, data: [] });
    const cfg = readConfigFile();
    const city = loadCity(cfg.onboarding?.city || 'katowice');
    const home = homeOf(cfg);
    const c = city?.center || (home ? [home.lat, home.lon] : null);
    const wait = 1100 - (Date.now() - lastSearch);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSearch = Date.now();
    const params = new URLSearchParams({ format: 'jsonv2', q, limit: '6', addressdetails: '1', 'accept-language': String(req.query.lang || 'pl').slice(0, 2) });
    if (c) { params.set('viewbox', `${c[1] - 0.45},${c[0] + 0.3},${c[1] + 0.45},${c[0] - 0.3}`); params.set('bounded', '1'); }
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': 'LSH smart home - onboarding guide (https://github.com/dagoomax/lsh)' }, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`OpenStreetMap search: HTTP ${r.status}`);
      const list = await r.json();
      res.json({
        success: true,
        data: list.map((x, i) => {
          const a = x.address || {};
          const name = x.name || String(x.display_name || '').split(',')[0];
          const lat = Number(x.lat), lon = Number(x.lon);
          return {
            id: `osm-${x.osm_type || 'x'}${x.osm_id || i}`, name,
            address: [[a.road, a.house_number].filter(Boolean).join(' '), a.suburb || a.city_district, a.city || a.town || a.village].filter(Boolean).join(', '),
            kind: x.type && x.type !== 'yes' ? String(x.type).replace(/_/g, ' ') : null, lat, lon,
            km: home ? Math.round(km([home.lat, home.lon], [lat, lon]) * 10) / 10 : null,
          };
        }),
      });
    } catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  // Can one of the guide's links show inside the popup? (X-Frame-Options /
  // CSP frame-ancestors) — remembered for a day
  const frameable = new Map();
  router.get('/guide/frameable', async (req, res) => {
    const url = String(req.query.url || '');
    if (!guideUrls(readConfigFile()).has(url)) return res.status(400).json({ success: false, error: 'Not one of the guide’s links' });
    const hit = frameable.get(url);
    if (hit && Date.now() - hit.at < 86_400_000) return res.json({ success: true, data: { frameable: hit.ok } });
    let ok = false;
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (LSH guide)' }, signal: AbortSignal.timeout(6000) });
      const xfo = String(r.headers.get('x-frame-options') || '').toLowerCase();
      const fa = /frame-ancestors([^;]*)/i.exec(r.headers.get('content-security-policy') || '')?.[1]?.trim() || '';
      ok = r.ok && !xfo && (!fa || /(^|\s)\*(\s|$)/.test(fa));
      r.body?.cancel?.();
    } catch { ok = false; }
    frameable.set(url, { ok, at: Date.now() });
    res.json({ success: true, data: { frameable: ok } });
  });

  // A guide website that refuses to be framed, shown in the popup anyway:
  // LSH fetches the page and serves it with <base href> to the real site,
  // its framing headers dropped and a CSP sandbox that gives it an opaque
  // origin — its scripts can't reach LSH, its cookies or its API. Only https
  // pages on the hosts of the guide's own links, never private addresses.
  router.get('/guide/page', async (req, res) => {
    const bare = (h) => String(h).toLowerCase().replace(/^www\./, '');
    const hosts = new Set([...guideUrls(readConfigFile())].map((u) => { try { return bare(new URL(u).hostname); } catch { return null; } }).filter(Boolean));
    let url;
    try { url = new URL(String(req.query.url || '')); } catch { return pageError(res, 'Not a link'); }
    try {
      for (let hop = 0; hop < 4; hop++) {
        if (url.protocol !== 'https:' || !hosts.has(bare(url.hostname))) return pageError(res, 'Only the guide’s own websites open here', url.href);
        await assertPublicHost(url.hostname);
        const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Accept-Language': String(req.query.lang || 'pl').slice(0, 2) }, signal: AbortSignal.timeout(10000) });
        if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url); r.body?.cancel?.(); continue; }
        if (!/text\/html/i.test(r.headers.get('content-type') || '')) { r.body?.cancel?.(); return pageError(res, 'Not a web page', url.href); }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 4 * 1024 * 1024) return pageError(res, 'The page is too large', url.href);
        let html = buf.toString('utf8');
        html = html.replace(/<meta[^>]+http-equiv=["']?(content-security-policy|x-frame-options|refresh)["']?[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '');
        // the sandbox has no storage or cookies — pages that use them get in-memory stand-ins
        const shim = "function M(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}"
          + "try{Object.defineProperty(window,'localStorage',{value:M(),configurable:true})}catch(e){}try{Object.defineProperty(window,'sessionStorage',{value:M(),configurable:true})}catch(e){}"
          + "try{var c='';Object.defineProperty(document,'cookie',{get:function(){return c},set:function(v){c=(c?c+'; ':'')+String(v).split(';')[0]},configurable:true})}catch(e){}";
        const inject = `<base href="${url.href.replace(/"/g, '&quot;')}"><script>${shim}</script><script>(function(){document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.href;if(!/^https?:/.test(h))return;e.preventDefault();parent.postMessage({lshGuide:'nav',href:h},'*');},true);document.addEventListener('submit',function(e){e.preventDefault();},true);window.open=function(u){if(u)parent.postMessage({lshGuide:'nav',href:new URL(u,location.href).href},'*');return null;};})();</script>`;
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
        res.set({
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': 'sandbox allow-scripts; frame-ancestors \'self\'',
          'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        });
        return res.send(html);
      }
      return pageError(res, 'Too many redirects', url.href);
    } catch (err) {
      return pageError(res, err.message, url?.href);
    }
  });

  // QR code of a trip or one of the guide's links, so a guest takes it to their phone
  router.get('/guide/qr', async (req, res) => {
    const url = String(req.query.url || '');
    const route = /^https:\/\/www\.google\.com\/maps\/(dir|search)\/\?api=1&[^\s<>"]{1,1800}$/.test(url);
    if (!route && !guideUrls(readConfigFile()).has(url)) return res.status(400).json({ success: false, error: 'Only Google Maps links and the guide’s own links' });
    try {
      const svg = await require('qrcode').toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0a1020', light: '#ffffff' } });
      res.type('image/svg+xml').set('Cache-Control', 'private, max-age=600').send(svg);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  router.post('/settings/onboarding', requireAdmin, (req, res) => {
    const b = req.body || {};
    const city = String(b.city || 'katowice');
    if (!loadCity(city)) return res.status(400).json({ success: false, error: 'No guide for that city yet' });
    const lat = num(b.lat), lon = num(b.lon);
    if ((lat == null) !== (lon == null)) return res.status(400).json({ success: false, error: 'Give both latitude and longitude, or neither' });
    if (lat != null && (Math.abs(lat) > 90 || Math.abs(lon) > 180)) return res.status(400).json({ success: false, error: 'Latitude −90…90, longitude −180…180' });
    const extras = [];
    for (const e of Array.isArray(b.extras) ? b.extras : []) {
      const name = String(e?.name || '').trim().slice(0, 80);
      if (!name) continue;
      const x = { name, category: CATEGORY[e.category] ? e.category : 'place' };
      for (const k of ['note', 'address']) if (String(e[k] || '').trim()) x[k] = String(e[k]).trim().slice(0, 300);
      if (String(e.url || '').trim()) {
        try { const u = new URL(String(e.url).trim()); if (/^https?:$/.test(u.protocol)) x.url = u.href; } catch { /* not a link — dropped */ }
      }
      const elat = num(e.lat), elon = num(e.lon);
      if (elat != null && elon != null) Object.assign(x, { lat: elat, lon: elon });
      extras.push(x);
    }
    const onboarding = {
      enabled: !!b.enabled, city,
      ...(String(b.welcome || '').trim() ? { welcome: String(b.welcome).trim().slice(0, 600) } : {}),
      ...(lat != null ? { lat, lon } : {}),
      sections: Object.fromEntries(SECTIONS.map((k) => [k, b.sections?.[k] !== false])),
      ...(extras.length ? { extras } : {}),
      ...(/^[A-Za-z0-9_-]{20,60}$/.test(String(b.mapsKey || '').trim()) ? { mapsKey: String(b.mapsKey).trim() } : {}),
    };
    try { writeConfigFile({ ...readConfigFile(), onboarding }); }
    catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    res.json({ success: true, message: onboarding.enabled ? 'Saved — the guide is on the dashboard.' : 'Saved — the guide is hidden.' });
  });
};

module.exports.km = km;
