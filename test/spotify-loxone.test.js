'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.LSH_SPOTIFY_TOKENS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-sp-lox-')), 'tokens.json');
const SpotifyClient = require('../src/spotify-client');
const SensorRegistry = require('../src/sensor-registry');
const DataStore = require('../src/data-store');
const { startSimulator } = require('../scripts/spotify-simulator');
const { buildInputsXml, buildOutputsXml } = require('../src/loxone-xml');

test('Spotify for Loxone: favourite playlists and speakers by number, "→ speaker" pulses, feedback', async () => {
  const sim = await startSimulator({ port: 0 });
  const base = `http://127.0.0.1:${sim.port}`;
  try {
    const store = new DataStore();
    const registry = new SensorRegistry(store);
    const c = new SpotifyClient({ spotify: { clientId: 'a'.repeat(32), apiBase: `${base}/v1`, accountsBase: base,
      favourites: [{ name: 'Top Hits', uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' }, { name: 'Jazz', uri: 'spotify:playlist:1111111111111111111111' }],
      speakers: [{ name: 'Kitchen speaker' }, { name: 'Pixel' }] } }, store, registry);
    await c.start();
    // sign in through the simulator (auto-approves)
    const url = new URL(c.getAuthUrl('http://127.0.0.1:3000/api/spotify/oauth/callback'));
    const back = await fetch(url, { redirect: 'manual' });
    const cb = new URL(back.headers.get('location'));
    await c.exchangeCode(cb.searchParams.get('code'), cb.searchParams.get('state'));
    const set = (sensor, value) => registry.sendCommand('spotify/player', sensor, value);
    const dev = registry.getDevices().find((d) => d.key === 'spotify/player');
    assert.ok(dev.sensors.some((s) => s.path === 'to_kitchen_speaker' && s.label === '→ Kitchen speaker'));

    // pulse "→ Kitchen speaker": transfer + play
    await set('to_kitchen_speaker', 1);
    const tr = sim.calls.filter((x) => x.method === 'PUT' && x.path === '/v1/me/player').at(-1);
    assert.deepEqual(JSON.parse(tr.body), { device_ids: ['dev-kitchen'], play: true });
    await c.poll();
    assert.equal(store.get('spotify/player/speaker'), 1);

    // Playlist 1 → plays that playlist as a context; feedback = 1
    await set('playlist', 1);
    assert.equal(JSON.parse(sim.calls.filter((x) => x.path.startsWith('/v1/me/player/play')).at(-1).body).context_uri, 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
    await c.poll();
    assert.equal(store.get('spotify/player/playlist'), 1);
    assert.equal(store.get('spotify/player/cover'), 'https://i.scdn.co/image/x', 'album cover for Loxone');
    assert.match(store.get('spotify/player/nowPlaying'), / — /);
    assert.equal(store.get('spotify/player/playing'), 1);

    // Speaker 2 = Pixel
    await set('speaker', 2);
    assert.deepEqual(JSON.parse(sim.calls.filter((x) => x.method === 'PUT' && x.path === '/v1/me/player').at(-1).body).device_ids, ['dev-phone']);
    await c.poll();
    assert.equal(store.get('spotify/player/speaker'), 2);

    // Playlist 0 = pause; unknown numbers / speakers explain themselves
    await set('playlist', 0);
    await c.poll();
    assert.equal(store.get('spotify/player/playing'), 0);
    await assert.rejects(set('playlist', 5), /2 favourite playlists/);
    c.setLists({ favourites: c.favourites(), speakers: [{ name: 'Garaż' }] });
    await assert.rejects(set('to_garaz', 1), /can’t see “Garaż”/);

    // Settings change: the controls follow, the Loxone feedback patterns don't change
    const before = buildInputsXml([dev], { host: 'h', token: 't' })[0];
    c.setLists({ favourites: [...c.favourites(), { name: 'Rock', uri: 'spotify:playlist:2222222222222222222222' }], speakers: [{ name: 'Garaż' }, { name: 'Pixel' }] });
    const after = buildInputsXml([registry.getDevices().find((d) => d.key === 'spotify/player')], { host: 'h', token: 't' })[0];
    const checks = (x) => [...x.matchAll(/Check="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(checks(after), checks(before));
    const out = buildOutputsXml([registry.getDevices().find((d) => d.key === 'spotify/player')], { host: 'h', token: 't' })[0];
    assert.match(out, /Title="Spotify → Garaż"/);
    assert.match(out, /3 = Rock/);
    c.stop();
  } finally { await sim.close() }
});
