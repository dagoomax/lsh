'use strict';

// Dashboard onboarding: a welcome card with a city guide — getting around,
// restaurants and places to visit, sorted by distance from the home.
//
//   GET  /guide?lang=pl          the guide (only when config.onboarding.enabled)
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
      .then((guide) => { job.guideId = gen().save(guide); job.state = 'done'; job.counts = { transport: guide.transport.length, restaurants: guide.restaurants.length, places: guide.places.length }; console.log(`[Guide] Claude wrote a guide for ${city} (${job.searches} searches)`); })
      .catch((err) => { job.state = 'error'; job.error = err.message; console.error(`[Guide] Generating ${city}: ${err.message}`); });
    res.json({ success: true, data: { job: jobId } });
  });

  router.get('/guide/generate/:job', requireAdmin, (req, res) => {
    const j = jobs.get(req.params.job);
    if (!j) return res.status(404).json({ success: false, error: 'No such job' });
    res.json({ success: true, data: { state: j.state, city: j.city, searches: j.searches, guideId: j.guideId || null, counts: j.counts || null, error: j.error || null, seconds: Math.round((Date.now() - j.at) / 1000) } });
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
        sources: city.sources,
        generated: city.generated || null,
      },
    });
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
    };
    try { writeConfigFile({ ...readConfigFile(), onboarding }); }
    catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    res.json({ success: true, message: onboarding.enabled ? 'Saved — the guide is on the dashboard.' : 'Saved — the guide is hidden.' });
  });
};

module.exports.km = km;
