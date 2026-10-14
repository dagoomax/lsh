'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

let CONFIG = { media: { stations: [{ name: 'RMF FM', url: 'http://rmf.example/s' }, { name: 'TokFM', url: 'http://tok.example/s' }, { name: 'Radio Zet', url: 'http://zet.example/s' }] } };
require('../src/config-file-cache').readConfigCached = () => CONFIG;
const RadioDevices = require('../src/radio-devices');
const SensorRegistry = require('../src/sensor-registry');
const DataStore = require('../src/data-store');
const { buildInputsXml, buildOutputsXml } = require('../src/loxone-xml');

function setup() {
  const calls = [];
  const eqs = [];
  const sessions = {};
  const airplayClient = {
    getSpeakers: () => [{ id: 'salon', name: 'Salon' }, { id: 'kuchnia', name: 'Kuchnia' }],
    nowPlaying: (id) => sessions[id] || null,
    play: (id, url, opts) => { calls.push(['play', id, url, opts.volume]); eqs.push(opts.eq); sessions[id] = { url, title: opts.title, volume: opts.volume ?? 60, muted: false }; return new Promise(() => {}) },
    stop: (id) => { calls.push(['stop', id]); delete sessions[id] },
    setVolume: (id, v) => { calls.push(['vol', id, v]); sessions[id].volume = v },
    setMuted: (id, m) => { calls.push(['mute', id, m]); sessions[id].muted = m },
  };
  const castState = {};
  const googlehome = {
    targets: () => [{ host: '10.0.0.20', key: 'googlehome/10_0_0_20', name: 'Nest' }],
    cast: async (host, o) => { calls.push(['cast', host, o.url]); Object.assign(castState, { playbackState: 'playing', mediaUrl: o.url, nowPlaying: o.title }) },
    _executeCommand: async (host, cap, cmd, args) => { calls.push(['castcmd', host, cap, args?.[0]]) },
  };
  const store = new DataStore();
  const registry = new SensorRegistry(store);
  const origGet = store.get.bind(store);
  store.get = (k) => (k.startsWith('googlehome/10_0_0_20/') ? castState[k.split('/').pop()] ?? null : origGet(k));
  const radio = new RadioDevices({}, store, registry, { airplayClient, googlehome });
  return { radio, store, registry, calls, sessions, lastEq: () => eqs.at(-1) };
}

test('radio devices: one per AirPlay speaker and Chromecast, stations, volume, mute — as Loxone drives them', async () => {
  const { radio, store, registry, calls, lastEq } = setup();
  await radio.start();
  radio.stop();
  const keys = registry.getDevices().map((d) => d.key).sort();
  assert.deepEqual(keys, ['radio/airplay-kuchnia', 'radio/airplay-salon', 'radio/all', 'radio/cast-10_0_0_20']);
  const set = (key, sensor, value) => registry.sendCommand(key, sensor, value);

  // volume while idle = start level of the next station
  await set('radio/airplay-salon', 'volume', 15);
  await set('radio/airplay-salon', 'station', 2);
  assert.deepEqual(calls.at(-1), ['play', 'salon', 'http://tok.example/s', 15]);
  radio._refresh();
  assert.equal(store.get('radio/airplay-salon/station'), 2);
  assert.equal(store.get('radio/airplay-salon/stationName'), 'TokFM');
  assert.equal(store.get('radio/airplay-salon/playing'), 1);

  await set('radio/airplay-salon', 'nextStation', 1);
  assert.equal(calls.at(-1)[2], 'http://zet.example/s');
  await set('radio/airplay-salon', 'nextStation', 1); // wraps around
  assert.equal(calls.at(-1)[2], 'http://rmf.example/s');
  await set('radio/airplay-salon', 'prevStation', 1);
  assert.equal(calls.at(-1)[2], 'http://zet.example/s');

  await set('radio/airplay-salon', 'volume', 30);
  assert.deepEqual(calls.at(-1), ['vol', 'salon', 30]);
  await set('radio/airplay-salon', 'mute', 1);
  assert.deepEqual(calls.at(-1), ['mute', 'salon', true]);

  await set('radio/airplay-salon', 'playing', 0);
  assert.deepEqual(calls.at(-1), ['stop', 'salon']);
  radio._refresh();
  assert.equal(store.get('radio/airplay-salon/station'), 0);
  // play again = the last station
  await set('radio/airplay-salon', 'playing', 1);
  assert.equal(calls.at(-1)[2], 'http://zet.example/s');

  // volume + / − pulses (±5)
  await set('radio/airplay-salon', 'volumeUp', 1);
  assert.deepEqual(calls.at(-1), ['vol', 'salon', 35]);
  await set('radio/airplay-salon', 'volumeDown', 1);
  assert.deepEqual(calls.at(-1), ['vol', 'salon', 30]);

  // equalizer preset: the station playing restarts with those gains
  await set('radio/airplay-salon', 'eq', 1);
  assert.equal(calls.at(-1)[0], 'play');
  assert.deepEqual(lastEq(), [7, 4, 0, 0, 1]);
  assert.equal(store.get('radio/airplay-salon/eq'), 1);
  await assert.rejects(set('radio/airplay-salon', 'eq', 9), /preset is 0–6/);
  assert.ok(!registry.getDevices().find((d) => d.key === 'radio/cast-10_0_0_20').sensors.some((x) => x.path === 'eq'), 'no equalizer on Chromecast');

  // station 0 stops; a number past the list is refused
  await set('radio/airplay-salon', 'station', 0);
  assert.deepEqual(calls.at(-1), ['stop', 'salon']);
  await assert.rejects(set('radio/airplay-salon', 'station', 9), /3 saved stations/);

  // Chromecast
  await set('radio/cast-10_0_0_20', 'station', 1);
  assert.deepEqual(calls.at(-1), ['cast', '10.0.0.20', 'http://rmf.example/s']);
  radio._refresh();
  assert.equal(store.get('radio/cast-10_0_0_20/station'), 1);
  await set('radio/cast-10_0_0_20', 'playing', 0);
  assert.deepEqual(calls.at(-1), ['castcmd', '10.0.0.20', 'stop', undefined]);

  // the station range follows the saved list
  CONFIG = { media: { stations: [...CONFIG.media.stations, { name: 'Jazz', url: 'http://jazz.example/s' }] } };
  radio._refresh();
  const station = registry.getDevices().find((d) => d.key === 'radio/airplay-salon').sensors.find((s) => s.path === 'station');
  assert.equal(station.max, 4);
  assert.match(station.hint, /4 = Jazz/);
});

test('radio devices in the Loxone export: each speaker reads its own values, unaffected by the station list', async () => {
  const { radio, registry } = setup();
  await radio.start();
  radio.stop();
  const devices = registry.getDevices();
  const inputs = buildInputsXml(devices, { host: 'lsh:3000', token: 't' }).join('');
  const checks = [...inputs.matchAll(/Check="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(checks).size, checks.length, 'every Check pattern is unique');
  assert.ok(checks.includes('&quot;ref&quot;:&quot;radio/airplay-kuchnia/station&quot;,&quot;value&quot;:\\v'));
  // and the pattern really is in /api/devices' JSON (readings = { ...sensor, value })
  const d = registry.getDeviceReadings('radio/airplay-kuchnia');
  assert.ok(JSON.stringify(d).includes('"ref":"radio/airplay-kuchnia/station","value":0'));

  const outputs = buildOutputsXml(devices, { host: 'lsh:3000', token: 't' }).join('');
  assert.match(outputs, /radio%2Fairplay-salon\/set\?sensor=station&amp;value=&lt;v&gt;/);
  assert.match(outputs, /0 = stop, 1 = RMF FM/);
});

test('All speakers: one command plays / changes / stops every speaker, with combined feedback', async () => {
  const { radio, store, registry, calls } = setup();
  await radio.start();
  radio.stop();
  const set = (sensor, value) => registry.sendCommand('radio/all', sensor, value);
  await set('station', 2);
  const plays = calls.filter((c) => c[0] === 'play' || c[0] === 'cast');
  assert.deepEqual(plays.map((c) => [c[0], c[1], c[2]]).sort(), [['cast', '10.0.0.20', 'http://tok.example/s'], ['play', 'kuchnia', 'http://tok.example/s'], ['play', 'salon', 'http://tok.example/s']]);
  radio._refresh();
  assert.equal(store.get('radio/all/playing'), 1);
  assert.equal(store.get('radio/all/station'), 2);
  assert.equal(store.get('radio/all/stationName'), 'TokFM');
  assert.equal(store.get('radio/all/speakersPlaying'), 3);
  assert.match(store.get('radio/all/nowPlaying'), /Salon: TokFM/);

  calls.length = 0;
  await set('nextStation', 1);
  assert.equal(calls.filter((c) => c[2] === 'http://zet.example/s').length, 3);
  calls.length = 0;
  await set('volume', 40);
  assert.deepEqual(calls.filter((c) => c[0] === 'vol').map((c) => c[1]).sort(), ['kuchnia', 'salon']);
  assert.ok(calls.some((c) => c[0] === 'castcmd' && c[2] === 'volume' && c[3] === 40));
  calls.length = 0;
  await set('playing', 0);
  assert.deepEqual(calls.filter((c) => c[0] === 'stop').map((c) => c[1]).sort(), ['kuchnia', 'salon']);
  assert.ok(calls.some((c) => c[0] === 'castcmd' && c[2] === 'stop'));
  radio._refresh();
  assert.equal(store.get('radio/all/speakersPlaying'), 1, 'only the Chromecast fake still reports playing');
});

test('AirPlay receivers get "now playing" info and the station logo (Apple TV screen)', async () => {
  const { radio, store, registry, sessions } = setup();
  const sent = [];
  radio.clients.airplayClient.setMetadata = (id, m) => { sent.push([id, m]); return true };
  await radio.start();
  radio.stop();
  await registry.sendCommand('radio/airplay-salon', 'station', 1);
  radio.songs.set('http://rmf.example/s', 'Tove Lo - Talking Body');
  radio._refresh();
  const last = sent.filter(([id]) => id === 'salon').at(-1)[1];
  assert.deepEqual({ title: last.title, artist: last.artist, album: last.album }, { title: 'Talking Body', artist: 'Tove Lo', album: 'RMF FM' });
  const n = sent.length;
  radio._refresh();
  assert.equal(sent.length, n, 'unchanged info is not re-sent');
  assert.ok(!sent.some(([id]) => id === '10.0.0.20'), 'Chromecast has no AirPlay screen info');
});
