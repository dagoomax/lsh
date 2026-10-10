'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

process.env.LSH_SPOTIFY_TOKENS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-spotify-')), 'tokens.json');
const SpotifyClient = require('../src/spotify-client');
const { redirectUriFor } = require('../src/routes/spotify');
const { startSimulator } = require('../scripts/spotify-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), { values: {}, update(k, v) { this.values[k] = v }, set(k, v) { this.values[k] = v } });
const fakeRegistry = () => {
  const devices = new Map();
  return {
    devices, registerDevice: (d) => devices.set(d.key, d),
    async sendCommand(key, p, value) {
      const d = devices.get(key), s = d.sensors.find((x) => x.path === p);
      if (s.type === 'range') return d._writeCapability(s.capabilityId, s.writeCmd, [value]);
      const on = value === true || value === 1 || value === 'on';
      return d._writeCapability(s.capabilityId, on ? s.writeOn : s.writeOff);
    },
  };
};

// Follow /authorize like a browser would and hand back the URL Spotify redirects to
async function authorize(url) {
  const res = await fetch(url, { redirect: 'manual' });
  assert.equal(res.status, 302);
  return res.headers.get('location');
}

test('Spotify: PKCE sign-in, player state in the store, playback control, token refresh', async () => {
  const sim = await startSimulator({ port: 0 });
  const base = `http://127.0.0.1:${sim.port}`;
  const store = fakeStore(), registry = fakeRegistry();
  const c = new SpotifyClient({ spotify: { clientId: 'a'.repeat(32), apiBase: `${base}/v1`, accountsBase: base } }, store, registry);
  try {
    await c.start();
    assert.equal(c.isConnected(), false);
    const url = c.getAuthUrl('http://127.0.0.1:3001/api/spotify/oauth/callback');
    const q = new URL(url).searchParams;
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.match(q.get('scope'), /user-modify-playback-state/);

    // The redirect couldn't reach LSH → the user pastes the address
    const back = await authorize(url);
    const user = await c.finishFromUrl(back);
    assert.equal(user.name, 'LSH User');
    assert.ok(JSON.parse(fs.readFileSync(process.env.LSH_SPOTIFY_TOKENS)).refresh_token);
    await assert.rejects(c.finishFromUrl(back), /expired or was already used/);

    // Nothing playing anywhere
    assert.equal(store.values['spotify/player/playing'], 0);
    assert.equal(store.values['spotify/player/device'], '');

    // Play with no active device → goes to the first available one
    await registry.sendCommand('spotify/player', 'playing', true);
    await c.poll();
    assert.equal(store.values['spotify/player/playing'], 1);
    assert.equal(store.values['spotify/player/track'], 'Song One');
    assert.equal(store.values['spotify/player/artist'], 'Artist A');
    assert.equal(store.values['spotify/player/device'], 'Pixel');

    await registry.sendCommand('spotify/player', 'next', true);
    await registry.sendCommand('spotify/player', 'volume', 42);
    await registry.sendCommand('spotify/player', 'shuffle', true);
    await c.poll();
    assert.equal(store.values['spotify/player/track'], 'Song Two');
    assert.equal(store.values['spotify/player/artist'], 'Artist B, Artist C');
    assert.equal(store.values['spotify/player/volume'], 42);
    assert.equal(store.values['spotify/player/shuffle'], 1);

    await c.transfer('dev-kitchen');
    await c.playUri('spotify:track:1111111111111111111111');
    await c.poll();
    const s = c.getStatus();
    assert.equal(s.player.device.name, 'Kitchen speaker');
    assert.equal(s.player.item.name, 'Song One');
    assert.equal(s.player.item.image, 'https://i.scdn.co/image/x');
    assert.ok(sim.calls.some((x) => x.path.startsWith('/v1/me/player/play') && x.body && JSON.parse(x.body).uris?.[0] === 'spotify:track:1111111111111111111111'));
    await c.playUri('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
    assert.ok(sim.calls.some((x) => x.path.startsWith('/v1/') && x.body && JSON.parse(x.body).context_uri === 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'));
    await assert.rejects(c.playUri('https://evil.example/x'), /Not a Spotify URI/);

    assert.equal((await c.playlists())[0].name, 'Today’s Top Hits');
    assert.deepEqual((await c.search('song')).map((x) => x.kind), ['track', 'track', 'artist']);
    assert.equal((await c.devices()).find((d) => d.active).name, 'Kitchen speaker');

    // Expired access token → refreshed once, transparently
    sim.expireNext = true;
    await registry.sendCommand('spotify/player', 'playing', false);
    await c.poll();
    assert.equal(store.values['spotify/player/playing'], 0);
    assert.ok(sim.calls.filter((x) => x.path === '/api/token').length >= 2);

    // Free account → a clear message
    sim.premium = false;
    await assert.rejects(registry.sendCommand('spotify/player', 'playing', true), /Premium/);

    c.disconnect();
    assert.equal(c.isConnected(), false);
    assert.equal(fs.existsSync(process.env.LSH_SPOTIFY_TOKENS), false);
  } finally { c.stop(); await sim.close() }
});

test('Spotify redirect URI: https or loopback as-is, otherwise 127.0.0.1 on the same port', () => {
  const req = (host, protocol = 'http', xfp) => ({ protocol, get: (h) => (h === 'host' ? host : h === 'x-forwarded-proto' ? xfp : undefined) });
  assert.equal(redirectUriFor(req('127.0.0.1:3001'), {}), 'http://127.0.0.1:3001/api/spotify/oauth/callback');
  assert.equal(redirectUriFor(req('lsh.example.net', 'https'), {}), 'https://lsh.example.net/api/spotify/oauth/callback');
  assert.equal(redirectUriFor(req('qlsh21.ts.net:3000', 'http', 'https'), {}), 'https://qlsh21.ts.net:3000/api/spotify/oauth/callback');
  assert.equal(redirectUriFor(req('192.168.1.20:3000'), {}), 'http://127.0.0.1:3000/api/spotify/oauth/callback');
  assert.equal(redirectUriFor(req('localhost:3001'), {}), 'http://127.0.0.1:3001/api/spotify/oauth/callback');
  assert.equal(redirectUriFor(req('x'), { redirectUri: 'https://my/cb' }), 'https://my/cb');
});
