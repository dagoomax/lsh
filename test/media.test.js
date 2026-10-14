'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let CONFIG = { media: { stations: [{ name: 'Radio 357', url: 'https://stream.radio357.pl/' }] } };
require('../src/routes/helpers').readConfigFile = () => JSON.parse(JSON.stringify(CONFIG));
require('../src/config-file-cache').writeConfigFile = (c) => { CONFIG = JSON.parse(JSON.stringify(c)) };
const media = require('../src/routes/media');
const { castContentType } = (() => { try { return require('../src/googlehome-client') } catch { return {} } })();

test('media player: targets, play / stop / volume on Cast and AirPlay, stations', async () => {
  const calls = [];
  const castClient = {
    targets: () => [{ host: '10.0.0.20', key: 'googlehome/10_0_0_20', name: 'Kitchen Nest' }],
    cast: async (host, opts) => { calls.push(['cast', host, opts]) },
    _executeCommand: async (host, cap, cmd, args) => { calls.push(['cmd', host, cap, args?.[0]]) },
  };
  let playing = null;
  const airplayClient = {
    getSpeakers: () => [{ id: 'homepod', name: 'HomePod', playing }],
    play: (id, url, opts) => { calls.push(['airplay', id, url, opts.title]); playing = { title: opts.title, volume: 60 }; return new Promise(() => {}) },
    stop: (id) => { calls.push(['airplay-stop', id]); playing = null },
    setVolume: (id, v) => { calls.push(['airplay-vol', id, v]) },
  };
  const store = { get: (k) => ({ 'googlehome/10_0_0_20/playbackState': 'playing', 'googlehome/10_0_0_20/nowPlaying': 'Jazz', 'googlehome/10_0_0_20/volume': 35 })[k] ?? null };
  const app = express(); app.use(express.json());
  const router = express.Router();
  media(router, { clients: { googlehome: castClient, airplayClient }, store, requireAdmin: (req, res, next) => next() });
  app.use('/api', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const t = (await fetch(`${base}/media/targets`).then((r) => r.json())).data;
    assert.deepEqual(t.targets.map((x) => [x.id, x.kind, x.state]), [['cast:10.0.0.20', 'chromecast', 'playing'], ['airplay:homepod', 'airplay', 'idle']]);
    assert.equal(t.targets[0].title, 'Jazz');
    assert.equal(t.stations.length, 1);

    assert.equal((await post('/media/play', { target: 'cast:10.0.0.20', url: 'file:///etc/passwd' })).status, 400, 'no local files');
    assert.equal((await post('/media/play', { target: 'bogus', url: 'https://x/a.mp3' })).status, 400);

    assert.equal((await post('/media/play', { target: 'cast:10.0.0.20', url: 'https://ice.example.com/stream', title: 'News' })).success, true);
    assert.deepEqual(calls.at(-1), ['cast', '10.0.0.20', { url: 'https://ice.example.com/stream', title: 'News', live: true }]);
    await post('/media/play', { target: 'cast:10.0.0.20', url: 'https://cdn.example.com/song.mp3' });
    assert.equal(calls.at(-1)[2].live, false, 'a file is not a live stream');

    const a = await post('/media/play', { target: 'airplay:homepod', url: 'https://stream.radio357.pl/', title: 'Radio 357' });
    assert.equal(a.message, 'Playing');
    assert.deepEqual(calls.at(-1), ['airplay', 'homepod', 'https://stream.radio357.pl/', 'Radio 357']);
    assert.equal((await fetch(`${base}/media/targets`).then((r) => r.json())).data.targets[1].title, 'Radio 357');

    assert.equal((await post('/media/pause', { target: 'airplay:homepod' })).status, 400, 'AirPlay can only stop');
    await post('/media/pause', { target: 'cast:10.0.0.20' });
    assert.deepEqual(calls.at(-1), ['cmd', '10.0.0.20', 'pause', undefined]);
    await post('/media/volume', { target: 'airplay:homepod', volume: 40 });
    await post('/media/volume', { target: 'cast:10.0.0.20', volume: 20 });
    await post('/media/stop', { target: 'airplay:homepod' });
    await post('/media/stop', { target: 'cast:10.0.0.20' });
    assert.deepEqual(calls.slice(-4), [['airplay-vol', 'homepod', 40], ['cmd', '10.0.0.20', 'volume', 20], ['airplay-stop', 'homepod'], ['cmd', '10.0.0.20', 'stop', undefined]]);
    assert.equal((await post('/media/volume', { target: 'cast:10.0.0.20', volume: 140 })).status, 400);

    await post('/media/stations', { stations: [{ name: 'A', url: 'https://a.example/s' }, { name: 'bad', url: 'ftp://x' }, { name: '', url: 'https://b' }] });
    assert.deepEqual(CONFIG.media.stations, [{ name: 'A', url: 'https://a.example/s' }]);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('Cast content type from the URL', { skip: !castContentType && 'Cast library not installed' }, () => {
  assert.equal(castContentType('https://x/a.MP3?x=1'), 'audio/mpeg');
  assert.equal(castContentType('https://x/live.m3u8'), 'application/x-mpegURL');
  assert.equal(castContentType('https://x/a.flac'), 'audio/flac');
  assert.equal(castContentType('https://x/stream'), 'audio/mpeg');
});
