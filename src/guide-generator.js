'use strict';

// Settings → Onboarding → "Generate with Claude": LSH's own Claude (the
// Anthropic API key from Settings → Claude Code) researches a city with web
// search and writes a guide in the shape of src/city-guides/katowice.js —
// getting around, restaurants, places to visit, in Polish and English, with
// coordinates and source links. The result is checked here before it's kept
// (persist/city-guides/<id>.json): text lengths, links (http/https only),
// coordinates near the city; anything that doesn't pass is dropped.
//
// Web pages Claude reads can't do anything but end up as text in the guide:
// there are no tools besides web search, and the dashboard shows the text
// escaped, links only as http(s).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'persist', 'city-guides');
const MAX_KM_FROM_CENTRE = 60;

function claudeConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch { /* none */ }
  const cc = cfg.claudeCode || {};
  return { apiKey: process.env.ANTHROPIC_API_KEY || cc.apiKey || '', model: cc.model || 'claude-opus-5', workspaceId: cc.workspaceId || '' };
}

const slug = (s) => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const SYSTEM = `You write city guides for guests staying in a home. Use web search to check every fact you include against current sources (official city, transport operator and venue sites; the MICHELIN Guide or other reputable guides for restaurants). Include only places that exist and operate now. Prefer fewer, verified items over many guesses. Never invent prices, phone numbers or opening hours; mention a closing day only if a source states it.

Answer with ONE JSON object and nothing else, in a \`\`\`json block, with this shape:
{
  "name": {"pl": "...", "en": "..."},
  "title": {"pl": "Witaj w <miejscownik>", "en": "Welcome to <City>"},
  "center": [lat, lon],
  "welcome": {"pl": "...", "en": "..."},
  "transport": [{"id": "...", "icon": "tram|route|plane|train|bike|car|bus|boat|metro", "name": {"pl","en"}, "text": {"pl","en"}, "url": "https://...", "lat": 0, "lon": 0}],
  "restaurants": [{"id": "...", "name": {"pl","en"}, "kind": {"pl","en"}, "text": {"pl","en"}, "address": "street and number", "lat": 0, "lon": 0, "price": "€|€€|€€€", "tag": "short label", "url": "https://..."}],
  "places": [{"id": "...", "name": {"pl","en"}, "tag": {"pl","en"}, "text": {"pl","en"}, "lat": 0, "lon": 0, "url": "https://..."}],
  "activities": [{"id": "...", "name": {"pl","en"}, "tag": {"pl","en"}, "text": {"pl","en"}, "address": "street and number", "lat": 0, "lon": 0, "url": "https://..."}],
  "sources": [{"name": "...", "url": "https://..."}]
}
Rules: 4–7 transport items (public transport and tickets/apps, airport, main station, bikes, taxis), 4–8 restaurants, 6–12 places, 3–8 activities (things to do or book: tours, theme parks, zoos, boat trips, matches, workshops — not the sights already in places). Texts: one or two short plain sentences each, the Polish one in natural Polish. Coordinates to 5 decimals, of the actual venue; lat/lon optional only for transport items that are not a place. "url" only when you saw the page. Ids: short lowercase latin words.`;

function userPrompt({ city, lat, lon }) {
  return `City: ${city}.${lat != null ? ` The home is at ${lat}, ${lon} — favour what's reasonably near it, but include the city's main sights.` : ''} Today is ${new Date().toISOString().slice(0, 10)}.`;
}

// ── checking what came back ─────────────────────────────────

const str = (v, max = 400) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const text2 = (v, max) => {
  if (typeof v === 'string') return str(v, max) ? { pl: str(v, max), en: str(v, max) } : null;
  if (!v || typeof v !== 'object') return null;
  const pl = str(v.pl, max), en = str(v.en, max);
  return pl || en ? { pl: pl || en, en: en || pl } : null;
};
const link = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const coord = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1e5) / 1e5 : null);
function km(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function sanitize(raw, fallbackName) {
  if (!raw || typeof raw !== 'object') throw new Error('Claude did not return a guide');
  const center = Array.isArray(raw.center) && coord(raw.center[0]) != null && coord(raw.center[1]) != null ? [coord(raw.center[0]), coord(raw.center[1])] : null;
  if (!center) throw new Error('The guide has no city centre coordinates');
  const ids = new Set();
  const id = (v, i, kind) => {
    let x = slug(v) || `${kind}-${i + 1}`;
    while (ids.has(x)) x = `${x}-${i + 1}`;
    ids.add(x);
    return x;
  };
  const place = (it, i, kind) => {
    const name = text2(it?.name, 80);
    if (!name) return null;
    const out = { id: id(it.id || name.en, i, kind), name };
    const lat = coord(it.lat), lon = coord(it.lon);
    if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && km(center, [lat, lon]) <= MAX_KM_FROM_CENTRE) Object.assign(out, { lat, lon });
    for (const k of ['text', 'kind', 'tag']) { const t = k === 'tag' && typeof it.tag === 'string' ? str(it.tag, 40) : text2(it[k], k === 'text' ? 400 : 60); if (t) out[k] = t; }
    if (str(it.address, 120)) out.address = str(it.address, 120);
    if (/^€{1,4}$/.test(String(it.price || ''))) out.price = it.price;
    if (/^[a-z]{2,8}$/.test(String(it.icon || ''))) out.icon = it.icon;
    const u = link(it.url); if (u) out.url = u;
    return out;
  };
  const list = (k, max) => (Array.isArray(raw[k]) ? raw[k] : []).slice(0, max).map((it, i) => place(it, i, k)).filter(Boolean);
  const guide = {
    name: text2(raw.name, 60) || { pl: fallbackName, en: fallbackName },
    title: text2(raw.title, 80),
    center,
    welcome: text2(raw.welcome, 500) || { pl: '', en: '' },
    transport: list('transport', 8),
    restaurants: list('restaurants', 10),
    places: list('places', 14),
    activities: list('activities', 10),
    sources: (Array.isArray(raw.sources) ? raw.sources : []).slice(0, 12).map((s) => ({ name: str(s?.name, 80), url: link(s?.url) })).filter((s) => s.name && s.url),
  };
  if (!guide.places.length && !guide.restaurants.length) throw new Error('The guide came back empty');
  return guide;
}

function extractJson(text) {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(body); } catch { throw new Error('Claude’s answer was not valid JSON'); }
}

// ── the call ─────────────────────────────────────────────────

async function generate({ city, lat, lon }, { client, onProgress = () => {} } = {}) {
  const name = str(city, 60);
  if (!name) throw new Error('Which city?');
  const cc = claudeConfig();
  if (!client) {
    if (!cc.apiKey) throw new Error('No Anthropic API key — add it in Settings → Claude Code');
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: cc.apiKey, ...(cc.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': cc.workspaceId } } : {}) });
  }
  const messages = [{ role: 'user', content: userPrompt({ city: name, lat, lon }) }];
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 12 }];
  let searches = 0;
  let final = null;
  // a server tool turn can pause; continue it until Claude ends its turn
  for (let round = 0; round < 6; round++) {
    let msg;
    try {
      msg = await client.messages.create({ model: cc.model, max_tokens: 16000, system: SYSTEM, tools, messages });
    } catch (err) {
      if (err.status === 401) throw new Error('The Anthropic API key was rejected — check it in Settings → Claude Code');
      if (err.status === 429) throw new Error('Anthropic rate limit or credit limit reached — try again later');
      if (err.status === 400 && /web_search/i.test(err.message || '')) throw new Error('Web search is not enabled for this Anthropic organisation (Console → Settings → Privacy)');
      throw new Error(`Anthropic API: ${err.status || ''} ${err.error?.error?.message || err.message}`.trim());
    }
    searches += msg.content.filter((b) => b.type === 'server_tool_use').length;
    onProgress({ searches });
    if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }
    final = msg;
    break;
  }
  if (!final) throw new Error('Claude did not finish the guide');
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const guide = sanitize(extractJson(text), name);
  return { ...guide, generated: { at: new Date().toISOString(), model: final.model || cc.model, searches, city: name } };
}

// ── photos ──────────────────────────────────────────────────
// Each place's Wikipedia lead image from Wikimedia Commons — kept only with
// a free licence (CC, CC0, public domain), shown with author and licence.

const WIKI_UA = { 'User-Agent': 'LSH smart home - onboarding guide (https://github.com/dagoomax/lsh)' };
const FREE = /^(CC0|CC BY(-SA)? [\d.]+|Public domain|PD.*)$/i;
const plain = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const words = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').split(/[^a-z0-9]+/).filter((w) => w.length > 3);

// the article about the place itself — its title shares a word with the
// place's name and isn't just the city
async function wikiFile(name, city, lang) {
  const want = new Set(words(name).filter((w) => !words(city).includes(w)));
  if (!want.size) return null;
  for (const q of [name, `${name} ${city}`]) {
    const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=4&gsrsearch=${encodeURIComponent(q)}&prop=pageimages&piprop=name`;
    const j = await (await fetch(u, { headers: WIKI_UA, signal: AbortSignal.timeout(8000) })).json();
    const hit = Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index)
      .find((pg) => pg.pageimage && words(pg.title).some((w) => want.has(w)));
    if (hit) return hit.pageimage;
  }
  return null;
}

async function addImages(guide) {
  const city = guide.name?.en || guide.generated?.city || '';
  const items = [...guide.places, ...(guide.activities || []), ...guide.transport.filter((t) => t.lat != null)];
  const files = new Map();
  for (const it of items) {
    for (const lang of ['pl', 'en']) {
      try { const f = await wikiFile(it.name[lang] || it.name.en, city, lang); if (f) { files.set(it, f); break; } } catch { /* no photo */ }
    }
    await new Promise((r) => setTimeout(r, 250)); // be gentle with Wikipedia
  }
  const names = [...new Set(files.values())];
  if (!names.length) return guide;
  const info = {};
  for (let i = 0; i < names.length; i += 20) {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=960&titles=${encodeURIComponent(names.slice(i, i + 20).map((n) => `File:${n}`).join('|'))}`;
    try {
      const j = await (await fetch(u, { headers: WIKI_UA, signal: AbortSignal.timeout(10000) })).json();
      const norm = Object.fromEntries((j.query?.normalized || []).map((n) => [n.to, n.from]));
      for (const pg of Object.values(j.query?.pages || {})) {
        const ii = pg.imageinfo?.[0]; if (!ii) continue;
        info[(norm[pg.title] || pg.title).replace(/^File:/, '')] = ii;
      }
    } catch { /* keep going without */ }
  }
  for (const [it, f] of files) {
    const ii = info[f] || info[f.replace(/_/g, ' ')];
    const m = ii?.extmetadata || {};
    const license = plain(m.LicenseShortName?.value);
    if (!ii?.thumburl || !FREE.test(license)) continue;
    it.image = { src: ii.thumburl.split('?')[0].replace('//thumb.wikimedia.org/', '//upload.wikimedia.org/'), page: ii.descriptionurl, author: plain(m.Artist?.value).replace(/^This (image|file) is a work by .*?user /i, '').split(/\. |When reusing/)[0].slice(0, 100), license };
  }
  return guide;
}

// ── storage ─────────────────────────────────────────────────

function save(guide, dir = DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const id = `gen-${slug(guide.generated?.city || guide.name.en) || crypto.randomBytes(3).toString('hex')}`;
  const tmp = path.join(dir, `${id}.json.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ id, ...guide }, null, 2));
  fs.renameSync(tmp, path.join(dir, `${id}.json`));
  return id;
}

function list(dir = DIR) {
  try {
    return fs.readdirSync(dir).filter((f) => /^gen-[a-z0-9-]+\.json$/.test(f)).map((f) => {
      try { const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return g; } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function load(id, dir = DIR) {
  if (!/^gen-[a-z0-9-]+$/.test(String(id))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')); } catch { return null; }
}

function remove(id, dir = DIR) {
  if (!/^gen-[a-z0-9-]+$/.test(String(id))) return false;
  try { fs.unlinkSync(path.join(dir, `${id}.json`)); return true; } catch { return false; }
}

module.exports = { generate, addImages, sanitize, extractJson, save, list, load, remove, DIR, SYSTEM };
