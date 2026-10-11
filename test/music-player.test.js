'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

process.env.LSH_SPOTIFY_TOKENS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-music-')), 'tokens.json');
const SpotifyClient = require('../src/spotify-client');
const AppleMusic = require('../src/apple-music');
const MusicPlayer = require('../src/music-player');
const { buildInputsXml, buildOutputsXml } = require('../src/loxone-xml');
const { startSimulator } = require('../scripts/spotify-simulator');

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {},
  update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) },
  set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null },
});
const fakeRegistry = () => {
  const devices = new Map();
  return {
    devices, registerDevice: (d) => { if (!devices.has(d.key)) devices.set(d.key, d) },
    async sendCommand(key, p, value) {
      const d = devices.get(key), s = d.sensors.find((x) => x.path === p);
      if (s.type === 'range') return d._writeCapability(s.capabilityId, s.writeCmd, [value]);
      const on = value === true || value === 1 || value === 'on' || value === '1';
      return d._writeCapability(s.capabilityId, on ? s.writeOn : s.writeOff);
    },
  };
};
const pem = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });

test('Music player: source selector routes Spotify / Apple Music, mirrors state, follows replaced clients', async () => {
  const sim = await startSimulator({ port: 0 });
  const base = `http://127.0.0.1:${sim.port}`;
  const store = fakeStore(), registry = fakeRegistry(), clients = {};
  const spotifyCfg = { spotify: { clientId: 'a'.repeat(32), apiBase: `${base}/v1`, accountsBase: base } };
  // apiBase points nowhere useful — verify() just fails, the relay still works
  const amCfg = { appleMusic: { teamId: 'ABCDEFGHIJ', keyId: 'KLMNOPQRST', privateKey: pem, apiBase: 'http://127.0.0.1:9' } };
  clients.spotify = new SpotifyClient(spotifyCfg, store, registry);
  clients.appleMusic = new AppleMusic(amCfg, store, registry);
  const music = new MusicPlayer({}, store, registry, clients);
  try {
    await clients.spotify.start();
    const res = await fetch(clients.spotify.getAuthUrl('http://127.0.0.1:3001/api/spotify/oauth/callback'), { redirect: 'manual' });
    await clients.spotify.finishFromUrl(res.headers.get('location'));
    await clients.appleMusic.start();
    await music.start();

    assert.equal(store.values['music/player/source'], 1);
    assert.equal(store.values['music/player/sourceName'], 'Spotify');
    assert.equal(store.values['music/player/spotifyReady'], 1);
    assert.equal(store.values['music/player/appleMusicReady'], 0);

    // Play on Spotify through the music player; Spotify's state is mirrored
    await registry.sendCommand('music/player', 'playing', '1');
    await clients.spotify.poll();
    assert.equal(store.values['music/player/playing'], 1);
    assert.equal(store.values['music/player/track'], 'Song One');
    await registry.sendCommand('music/player', 'volume', 30);
    await clients.spotify.poll();
    assert.equal(store.values['music/player/volume'], 30);

    // Apple Music has no open page yet → switching while playing fails to start it
    await assert.rejects(registry.sendCommand('music/player', 'source', 2), /No Apple Music player is open/);
    assert.equal(store.values['music/player/source'], 2, 'the source change sticks even when the new source can’t start');
    assert.equal(store.values['music/player/sourceName'], 'Apple Music');
    await clients.spotify.poll();
    assert.equal(store.values['spotify/player/playing'], 0, 'the old source was paused');

    // A Music page opens and plays; its state shows on the music player
    clients.appleMusic.report('page-123456', { name: 'Kitchen iPad', state: { playing: true, volume: 55, track: 'Apple Song', artist: 'Band' } });
    assert.equal(store.values['music/player/track'], 'Apple Song');
    assert.equal(store.values['music/player/device'], 'Kitchen iPad');
    assert.equal(store.values['music/player/volume'], 55);
    await registry.sendCommand('music/player', 'next', '1');
    await registry.sendCommand('music/player', 'volume', 20);
    assert.deepEqual(clients.appleMusic.report('page-123456', {}), [{ cmd: 'next' }, { cmd: 'volume', value: 20 }]);

    // Pulse input back to Spotify while playing → Apple paused, Spotify started
    clients.appleMusic.report('page-123456', { state: { playing: true } });
    await registry.sendCommand('music/player', 'useSpotify', '1');
    assert.deepEqual(clients.appleMusic.report('page-123456', { state: { playing: false } }), [{ cmd: 'pause' }]);
    await clients.spotify.poll();
    assert.equal(store.values['music/player/source'], 1);
    assert.equal(store.values['music/player/playing'], 1);

    // 0 = stop
    await registry.sendCommand('music/player', 'source', 0);
    await clients.spotify.poll();
    assert.equal(store.values['music/player/playing'], 0);
    assert.equal(store.values['music/player/source'], 1);

    // Settings saved → Spotify client replaced; commands reach the new one
    clients.spotify.stop();
    const fresh = new SpotifyClient(spotifyCfg, store, registry);
    await fresh.start();
    clients.spotify = fresh;
    const before = sim.calls.length;
    await registry.sendCommand('music/player', 'playing', '1');
    assert.ok(sim.calls.slice(before).some((x) => x.path.startsWith('/v1/me/player/play')));
    await assert.rejects(registry.sendCommand('music/player', 'source', 3), /0 \(stop\), 1 \(Spotify\) or 2/);
  } finally { music.stop(); clients.spotify?.stop(); clients.appleMusic.stop(); await sim.close() }
});

test('Music player: Loxone templates have numeric I/O only', () => {
  const registry = fakeRegistry();
  new MusicPlayer({}, fakeStore(), registry, {})._register();
  const devices = [registry.devices.get('music/player')];
  const out = buildOutputsXml(devices, { host: 'lsh:3001', token: 'tok' }).join('\n');
  assert.match(out, /Title="LSH Music"/);
  assert.match(out, /sensor=source&amp;value=&lt;v&gt;/);
  assert.match(out, /MinVal="0.0" MaxVal="2.0"/);
  assert.match(out, /0 = stop, 1 = Spotify, 2 = Apple Music/);
  for (const s of ['useSpotify', 'useAppleMusic', 'playing', 'prev', 'next', 'volume']) assert.match(out, new RegExp(`sensor=${s}&amp;`));
  const inp = buildInputsXml(devices, { host: 'lsh:3001', token: 'tok' }).join('\n');
  for (const s of ['source', 'playing', 'volume', 'spotifyReady', 'appleMusicReady']) assert.match(inp, new RegExp(`&quot;path&quot;:&quot;${s}&quot;`));
  for (const s of ['track', 'artist', 'sourceName', 'useSpotify']) assert.doesNotMatch(inp, new RegExp(`&quot;path&quot;:&quot;${s}&quot;`));
});
