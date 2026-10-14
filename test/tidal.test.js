'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.LSH_TIDAL_TOKENS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-tidal-')), 'tidal-oauth.json');
const TidalClient = require('../src/tidal-client');
const { startSimulator } = require('../scripts/tidal-simulator');

const cfgFor = (sim, extra = {}) => ({ tidal: { clientId: sim.clientId, clientSecret: sim.clientSecret, apiBase: `${sim.base}/v2`, authBase: `${sim.base}/oauth2`, loginBase: sim.base, ...extra } });

test('TIDAL: catalog search with the app token — artwork, artists, links', async () => {
  const sim = await startSimulator({ port: 0 });
  const c = new TidalClient(cfgFor(sim), {}, {});
  try {
    await c.start();
    assert.equal(c.error, null);
    const r = await c.search('daft');
    const track = r.find((x) => x.kind === 'track' && x.name === 'Get Lucky');
    assert.ok(track, JSON.stringify(r));
    assert.equal(track.sub, 'Daft Punk, Pharrell Williams');
    assert.equal(track.image, 'https://img.example/ram/320.jpg', 'a track shows its album cover, ~320 px');
    assert.equal(track.open, 'https://listen.tidal.com/track/100?play=true', 'opens in TIDAL’s web player');
    assert.equal(track.url, 'https://tidal.com/browse/track/100');
    const album = r.find((x) => x.kind === 'album' && x.name === 'Discovery');
    assert.equal(album.image, 'https://img.example/disc/320.jpg');
    assert.ok(r.some((x) => x.kind === 'artist' && x.name === 'Daft Punk'));
    const q = sim.calls.find((x) => x.path === '/v2/searchResults').query;
    assert.match(q, /countryCode=US/); assert.match(q, /include=albums&include=tracks/, 'arrays as repeated parameters');
    assert.deepEqual(await c.library(), { playlists: [], albums: [] }, 'no library without sign-in');
    assert.equal(c.getStatus().connected, false);
  } finally { c.stop(); await sim.close() }
});

test('TIDAL: sign in with PKCE, then the library and the user’s country', async () => {
  const sim = await startSimulator({ port: 0 });
  const c = new TidalClient(cfgFor(sim, { clientSecret: undefined }), {}, {})
  try {
    await c.start()
    assert.equal(c.getStatus().canSearch, false, 'no secret, no sign-in → no search')
    const redirect = 'http://127.0.0.1:3001/api/tidal/oauth/callback'
    const authUrl = c.getAuthUrl(redirect)
    assert.match(authUrl, /scope=user\.read\+collection\.read\+playlists\.read\+search\.read/)
    const r = await fetch(authUrl, { redirect: 'manual' })
    const landed = r.headers.get('location')
    const user = await c.finishFromUrl(landed)
    assert.equal(user.name, 'gumax'); assert.equal(user.country, 'PL')
    assert.ok(fs.existsSync(process.env.LSH_TIDAL_TOKENS), 'refresh token saved')
    const lib = await c.library()
    assert.deepEqual(lib.playlists.map((p) => p.name), ['Polish Jazz', 'Friday Mix'], 'collection order kept')
    assert.equal(lib.playlists[0].image, 'https://img.example/pj/320.jpg')
    assert.deepEqual(lib.albums.map((a) => a.name), ['Discovery'])
    assert.match(sim.calls.filter((x) => x.path === '/v2/playlists').at(-1).query, /countryCode=PL/, 'the user’s country')
    const r2 = await c.search('get lucky')
    assert.ok(r2.length > 0, 'the user token searches too')
    await assert.rejects(c.finishFromUrl(landed), /expired or was already used/)
    c.disconnect()
    assert.equal(fs.existsSync(process.env.LSH_TIDAL_TOKENS), false)
  } finally { c.stop(); await sim.close() }
})
