'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

// the routes read config.json through helpers — give them a test config instead
let cfg = {};
require.cache[require.resolve('../src/routes/helpers')] = { exports: { readConfigFile: () => cfg } };
const katowice = require('../src/city-guides/katowice');
const gen = require('../src/guide-generator');
const { km } = require('../src/routes/guide');

function app() {
  const a = express();
  a.use(express.json());
  const r = express.Router();
  require('../src/routes/guide')(r, { requireAdmin: (req, res, next) => next() });
  a.use('/api', r);
  return new Promise((res) => { const s = a.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() })) });
}

test('Katowice guide: both languages, real coordinates, links', () => {
  for (const k of ['transport', 'restaurants', 'places']) {
    assert.ok(katowice[k].length >= 4, k);
    for (const it of katowice[k]) {
      assert.ok(it.name.pl && it.name.en && it.text.pl && it.text.en, `${k}/${it.id} texts`);
      if (it.lat != null) assert.ok(km(katowice.center, [it.lat, it.lon]) < 30 || it.id === 'airport', `${it.id} near Katowice`);
      if (it.url) assert.match(it.url, /^https:\/\//);
    }
  }
  assert.equal(katowice.restaurants.filter((r) => /MICHELIN|Bib/.test(r.tag)).length, 4, 'the four MICHELIN-listed places');
  assert.ok(katowice.restaurants.length >= 12, 'plus local favourites');
  assert.equal(new Set(katowice.restaurants.map((r) => r.id)).size, katowice.restaurants.length, 'unique ids');
});

test('GET /guide: off, then sorted by distance from home, own tips first, language', async () => {
  const s = await app();
  try {
    cfg = {};
    assert.equal((await (await fetch(`${s.url}/api/guide`)).json()).data, null);

    // home in Ligota (the weather location) — Młodnik in Panewniki is the nearest restaurant
    cfg = { openweather: { lat: 50.2268, lon: 18.9897 }, onboarding: { enabled: true, city: 'katowice',
      extras: [{ name: 'Piekarnia', category: 'restaurant', note: 'Rano', lat: 50.227, lon: 18.99 }, { name: 'No coords', category: 'place', address: 'Mariacka 1' }] } };
    let g = (await (await fetch(`${s.url}/api/guide?lang=pl`)).json()).data;
    assert.equal(g.title, 'Witaj w Katowicach');
    assert.equal(g.home.source, 'weather');
    assert.equal(g.restaurants[0].name, 'Piekarnia', 'own tip first');
    assert.equal(g.restaurants[0].custom, true);
    assert.equal(g.restaurants[1].name, 'Młodnik');
    const kms = g.restaurants.slice(1).map((r) => r.km);
    assert.deepEqual(kms, [...kms].sort((a, b) => a - b), 'nearest first');
    assert.match(g.restaurants[1].directions, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=50\.2268,18\.9897&destination=50\.23049,18\.94138/);
    const noCoords = g.places.find((p) => p.name === 'No coords');
    assert.equal(noCoords.km, undefined);
    assert.match(noCoords.map, /query=No%20coords%2C%20Mariacka%201%2C%20Katowice/);
    assert.equal(g.transport[0].id, 'ztm', 'transport keeps its order');

    g = (await (await fetch(`${s.url}/api/guide?lang=de`)).json()).data;
    assert.equal(g.title, 'Welcome to Katowice', 'other languages get English');

    const spodek = g.places.find((x) => x.id === 'spodek');
    assert.match(spodek.image.src, /^https:\/\/upload\.wikimedia\.org\//, 'Wikimedia photo');
    assert.equal(spodek.image.license, 'CC BY 4.0');
    assert.equal(typeof spodek.lat, 'number', 'coordinates for the map');

    // trip QR: Google Maps route links only
    const ok = await fetch(`${s.url}/api/guide/qr?url=${encodeURIComponent('https://www.google.com/maps/dir/?api=1&origin=50.2,19&destination=50.26,19.02&travelmode=walking')}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /svg/);
    assert.match(await ok.text(), /<svg/);
    assert.equal((await fetch(`${s.url}/api/guide/qr?url=${encodeURIComponent('https://evil.example/x')}`)).status, 400);
    // the guide's own links pass, anything else doesn't (QR and the embed check)
    assert.equal((await fetch(`${s.url}/api/guide/qr?url=${encodeURIComponent('https://www.nospr.org.pl/en')}`)).status, 200);
    assert.equal((await fetch(`${s.url}/api/guide/frameable?url=${encodeURIComponent('http://169.254.169.254/latest')}`)).status, 400);
    // the page proxy: only https pages on the guide's own sites, served sandboxed
    for (const bad of ['https://evil.example/', 'http://www.nospr.org.pl/en', 'https://127.0.0.1/']) {
      const r = await fetch(`${s.url}/api/guide/page?url=${encodeURIComponent(bad)}`);
      assert.match(await r.text(), /Only the guide’s own websites/, bad);
      assert.match(r.headers.get('content-security-policy'), /^sandbox;/, 'error page fully sandboxed');
    }

    // walks point at stops on the page; phrasebook in the viewer's language; vegetarian flag
    assert.ok(g.walks.length >= 3);
    for (const w of g.walks) for (const key of w.stops) { const [k, id] = key.split(':'); assert.ok(g[k].some((x) => x.id === id && x.lat != null), key); }
    assert.equal(g.phrases.find((p) => p.sl === 'Pyrsk!').meaning, 'Hi!');
    assert.equal(g.restaurants.find((r) => r.id === 'falla').veg, true);
    assert.equal(g.restaurants.find((r) => r.id === 'tatiana').veg, undefined);

    cfg.onboarding.sections = { transport: false, restaurants: true, places: true };
    g = (await (await fetch(`${s.url}/api/guide`)).json()).data;
    assert.equal(g.transport, null);
    cfg.onboarding.sections = { transport: true, restaurants: false, places: true };
    g = (await (await fetch(`${s.url}/api/guide`)).json()).data;
    assert.ok(g.walks.every((w) => w.stops.every((k) => k.startsWith('places:'))), 'walks drop stops in hidden sections');
  } finally { s.close() }
});

test('generator: Claude’s guide is checked before it is kept', async () => {
  const raw = {
    name: { pl: 'Gliwice', en: 'Gliwice' }, title: { pl: 'Witaj w Gliwicach', en: 'Welcome to Gliwice' }, center: [50.2945, 18.6714],
    welcome: { pl: 'Cześć', en: 'Hi' },
    transport: [{ id: 'ztm', icon: 'tram', name: { pl: 'Tramwaj', en: 'Tram' }, text: 'GZM', url: 'javascript:alert(1)' }],
    restaurants: [
      { id: 'a', name: { pl: 'A', en: 'A' }, kind: { pl: 'x', en: 'x' }, text: { pl: 'ok\u0007', en: 'ok' }, lat: 50.29, lon: 18.67, price: '€€', url: 'https://a.example' },
      { id: 'far', name: { en: 'Far' }, lat: 52.23, lon: 21.01, price: 'cheap' },
      { name: '' },
    ],
    places: [{ id: 'a', name: { pl: 'Radiostacja', en: 'Radio Tower' }, lat: 50.3135, lon: 18.6886 }],
    sources: [{ name: 'GZM', url: 'https://metropoliaztm.pl' }, { name: 'bad', url: 'file:///etc/passwd' }],
  };
  const g = gen.sanitize(raw, 'Gliwice');
  assert.equal(g.transport[0].url, undefined, 'only http(s) links');
  assert.equal(g.transport[0].text.pl, 'GZM', 'plain string → both languages');
  assert.equal(g.restaurants.length, 2, 'nameless item dropped');
  assert.equal(g.restaurants[0].text.pl, 'ok', 'control characters removed');
  assert.equal(g.restaurants[1].lat, undefined, 'coordinates 250 km away dropped');
  assert.equal(g.restaurants[1].price, undefined);
  assert.notEqual(g.places[0].id, g.restaurants[0].id, 'ids unique');
  assert.deepEqual(g.sources.map((x) => x.name), ['GZM']);
  assert.throws(() => gen.sanitize({ ...raw, center: null }, 'X'), /centre/);
  assert.throws(() => gen.extractJson('no json here'), /JSON/);

  // a stand-in Anthropic client: one paused web-search turn, then the answer
  const calls = [];
  const client = { messages: { create: async (p) => {
    calls.push(p);
    if (calls.length === 1) return { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'server_tool_use', name: 'web_search' }] };
    return { stop_reason: 'end_turn', model: 'claude-test', content: [{ type: 'server_tool_use' }, { type: 'text', text: 'Here:\n```json\n' + JSON.stringify(raw) + '\n```' }] };
  } } };
  const progress = [];
  const out = await gen.generate({ city: 'Gliwice', lat: 50.29, lon: 18.67 }, { client, onProgress: (p) => progress.push(p.searches) });
  assert.equal(calls.length, 2, 'continued after pause_turn');
  assert.equal(calls[1].messages.length, 2, 'the paused turn is sent back');
  assert.equal(calls[0].tools[0].type.startsWith('web_search'), true);
  assert.match(calls[0].messages[0].content, /Gliwice.*50\.29, 18\.67/);
  assert.deepEqual(progress, [2, 3]);
  assert.equal(out.generated.searches, 3);
  assert.equal(out.generated.model, 'claude-test');

  const bad = { messages: { create: async () => { throw Object.assign(new Error('401 invalid x-api-key'), { status: 401 }) } } };
  await assert.rejects(gen.generate({ city: 'Gliwice' }, { client: bad }), /API key was rejected — check it in Settings → Claude Code/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guides-'));
  const id = gen.save(out, dir);
  assert.equal(id, 'gen-gliwice');
  assert.equal(gen.load(id, dir).title.pl, 'Witaj w Gliwicach');
  assert.deepEqual(gen.list(dir).map((x) => x.id), ['gen-gliwice']);
  assert.equal(gen.load('../../etc/passwd', dir), null, 'ids only');
  assert.equal(gen.remove(id, dir), true);
});
