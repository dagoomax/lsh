'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const WS = require('ws');
const WebSocketServer = WS.WebSocketServer || WS.Server; // ws 7 has only .Server
const SensorRegistry = require('../src/sensor-registry');
const MusicAssistantClient = require('../src/music-assistant-client');
const { wsUrl, nowPlaying, deviceKeyOf, testConnection } = MusicAssistantClient;

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null }, getTimestamp() { return Date.now() },
});
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error('timed out waiting');
};

// A stand-in for a Music Assistant server: the greeting, token sign-in,
// players + queues, the player commands, and pushed events.
async function fakeServer({ schema = 29 } = {}) {
  const state = {
    calls: [], sockets: new Set(),
    players: [
      { player_id: 'kitchen', name: 'Kitchen', type: 'player', available: true, enabled: true, powered: true, playback_state: 'playing',
        volume_level: 30, volume_muted: false, supported_features: ['power', 'volume_set', 'pause'], group_members: [], active_source: 'kitchen',
        current_media: { uri: 'library://track/1', title: 'Blue in Green', artist: 'Miles Davis', album: 'Kind of Blue', image_url: 'http://ma/img/1' } },
      { player_id: 'up:stairs 1', name: 'Upstairs', type: 'group', available: true, enabled: true, playback_state: 'idle', volume_level: 55,
        volume_muted: true, supported_features: ['volume_set'], group_members: ['up:stairs 1', 'kitchen'] },
      { player_id: 'ap_kitchen', name: 'Kitchen (AirPlay)', type: 'protocol', available: true, enabled: true, playback_state: 'idle' },
      { player_id: 'hidden', name: 'Garage', type: 'player', available: true, enabled: true, hide_in_ui: true, playback_state: 'idle' },
      { player_id: 'off', name: 'Disabled', type: 'player', available: false, enabled: false, playback_state: 'idle' },
    ],
    queues: [
      { queue_id: 'kitchen', active: true, shuffle_enabled: true, state: 'playing', current_item: { name: 'ignored — the player has current_media' } },
      { queue_id: 'up:stairs 1', active: false, shuffle_enabled: false, state: 'idle',
        current_item: { name: 'Queue item', media_item: { name: 'So What', artists: [{ name: 'Miles Davis' }, { name: 'John Coltrane' }], album: { name: 'Kind of Blue' } } } },
    ],
  };
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  wss.on('connection', (ws) => {
    state.sockets.add(ws);
    let authed = schema < 28;
    ws.on('close', () => state.sockets.delete(ws));
    ws.send(JSON.stringify({ server_id: 'abc', server_version: '2.7.1', schema_version: schema, min_supported_schema_version: 24, name: 'Home' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      state.calls.push(m);
      const reply = (result, extra = {}) => ws.send(JSON.stringify({ message_id: m.message_id, result, ...extra }));
      const fail = (code, details) => ws.send(JSON.stringify({ message_id: m.message_id, error_code: code, details }));
      if (m.command === 'auth') { authed = m.args.token === 'good'; return authed ? reply({ authenticated: true }) : fail(20, 'Invalid token'); }
      if (!authed) return fail(20, 'Authentication required');
      switch (m.command) {
        case 'players/all': // in two chunks, as the real server does for long lists
          ws.send(JSON.stringify({ message_id: m.message_id, result: state.players.slice(0, 2), partial: true }));
          return reply(state.players.slice(2));
        case 'player_queues/all': return reply(state.queues);
        case 'players/cmd/volume_set': {
          const p = state.players.find((x) => x.player_id === m.args.player_id);
          if (!p) return fail(3, 'Player not found');
          p.volume_level = m.args.volume_level;
          reply(null);
          return state.push('player_updated', p.player_id, p);
        }
        case 'music/search': return reply({ tracks: [{ name: 'So What', uri: 'library://track/2', artists: [{ name: 'Miles Davis' }], album: { name: 'Kind of Blue' } }], playlists: [{ name: 'Jazz', uri: 'library://playlist/3' }] });
        default: return reply(null);
      }
    });
  });
  state.push = (event, object_id, data) => { for (const ws of state.sockets) ws.send(JSON.stringify({ event, object_id, data })); };
  state.url = `http://127.0.0.1:${wss.address().port}`;
  state.close = () => new Promise((r) => { for (const ws of state.sockets) ws.terminate(); wss.close(r); });
  state.last = (command) => [...state.calls].reverse().find((c) => c.command === command);
  return state;
}

async function boot(server, cfg = {}) {
  const store = fakeStore();
  const registry = new SensorRegistry(store);
  const client = new MusicAssistantClient({ musicAssistant: { url: server.url, token: 'good', ...cfg } }, store, registry);
  await client.start();
  return { store, registry, client };
}

test('wsUrl, deviceKeyOf', () => {
  assert.equal(wsUrl('http://192.168.1.20:8095'), 'ws://192.168.1.20:8095/ws');
  assert.equal(wsUrl('https://ma.example.com/'), 'wss://ma.example.com/ws');
  assert.equal(wsUrl('192.168.1.20:8095/ws'), 'ws://192.168.1.20:8095/ws');
  assert.equal(deviceKeyOf('up:stairs 1'), 'musicassistant/up_stairs_1');
});

test('nowPlaying prefers the player media, falls back to the queue item', () => {
  assert.deepEqual(nowPlaying({ current_media: { title: 'T', artist: 'A', album: 'L', image_url: 'I' } }, { current_item: { name: 'Q' } }),
    { track: 'T', artist: 'A', album: 'L', image: 'I' });
  assert.deepEqual(nowPlaying({}, { current_item: { name: 'Q', media_item: { name: 'M', artists: [{ name: 'X' }, { name: 'Y' }], album: { name: 'Al' } } } }),
    { track: 'M', artist: 'X, Y', album: 'Al', image: '' });
  assert.deepEqual(nowPlaying({}, null), { track: '', artist: '', album: '', image: '' });
});

test('signs in, registers the real players and mirrors their state', async () => {
  const server = await fakeServer();
  const { store, registry, client } = await boot(server);
  try {
    await until(() => client.status().connected);
    assert.equal(server.calls[0].command, 'auth'); // before anything else
    assert.equal(server.calls[0].args.token, 'good');
    assert.match(server.calls[0].message_id, /^[0-9a-f]{32}$/);

    // the protocol leg, the hidden and the disabled player are not devices
    assert.deepEqual(registry.getDevices().map((d) => d.key).sort(), ['musicassistant/kitchen', 'musicassistant/up_stairs_1']);
    const v = (k) => store.values[`musicassistant/${k}`];
    assert.equal(v('kitchen/playing'), 1);
    assert.equal(v('kitchen/volume'), 30);
    assert.equal(v('kitchen/mute'), 0);
    assert.equal(v('kitchen/power'), 1);
    assert.equal(v('kitchen/track'), 'Blue in Green');
    assert.equal(v('kitchen/artist'), 'Miles Davis');
    assert.equal(v('kitchen/shuffle'), 1);
    assert.equal(v('up_stairs_1/playing'), 0);
    assert.equal(v('up_stairs_1/mute'), 1);
    assert.equal(v('up_stairs_1/track'), 'So What');
    assert.equal(v('up_stairs_1/artist'), 'Miles Davis, John Coltrane');
    assert.equal(v('up_stairs_1/group'), 'Kitchen');
    // power only where the speaker has it
    const paths = (key) => registry.getDevices().find((d) => d.key === key).sensors.map((s) => s.path);
    assert.ok(paths('musicassistant/kitchen').includes('power'));
    assert.ok(!paths('musicassistant/up_stairs_1').includes('power'));
    assert.equal(client.status().players, 2);
    assert.equal(client.status().version, '2.7.1');
  } finally { client.stop(); await server.close(); }
});

test('commands go out with the right names and arguments; events come back', async () => {
  const server = await fakeServer();
  const { store, registry, client } = await boot(server);
  try {
    await until(() => client.status().connected);
    await registry.sendCommand('musicassistant/kitchen', 'volume', 42);
    assert.deepEqual(server.last('players/cmd/volume_set').args, { player_id: 'kitchen', volume_level: 42 });
    await until(() => store.values['musicassistant/kitchen/volume'] === 42); // from the pushed player_updated

    await registry.sendCommand('musicassistant/kitchen', 'playing', 0);
    assert.deepEqual(server.last('players/cmd/pause').args, { player_id: 'kitchen' });
    await registry.sendCommand('musicassistant/kitchen', 'playing', 1);
    assert.deepEqual(server.last('players/cmd/play').args, { player_id: 'kitchen' });
    await registry.sendCommand('musicassistant/kitchen', 'next', true);
    assert.ok(server.last('players/cmd/next'));
    await registry.sendCommand('musicassistant/kitchen', 'prev', true);
    assert.ok(server.last('players/cmd/previous'));
    await registry.sendCommand('musicassistant/kitchen', 'mute', 1);
    assert.deepEqual(server.last('players/cmd/volume_mute').args, { player_id: 'kitchen', muted: true });
    await registry.sendCommand('musicassistant/kitchen', 'power', 0);
    assert.deepEqual(server.last('players/cmd/power').args, { player_id: 'kitchen', powered: false });
    await registry.sendCommand('musicassistant/kitchen', 'shuffle', 0);
    assert.deepEqual(server.last('player_queues/shuffle').args, { queue_id: 'kitchen', shuffle_enabled: false });
    // the id goes to the server as it is, not as the sanitized device key
    await registry.sendCommand('musicassistant/up_stairs_1', 'stop', true);
    assert.deepEqual(server.last('players/cmd/stop').args, { player_id: 'up:stairs 1' });

    // a queue update changes what its player shows
    server.push('queue_updated', 'up:stairs 1', { queue_id: 'up:stairs 1', shuffle_enabled: true, current_item: { name: 'Radio Nowy Świat' } });
    await until(() => store.values['musicassistant/up_stairs_1/track'] === 'Radio Nowy Świat');
    assert.equal(store.values['musicassistant/up_stairs_1/shuffle'], 1);

    // a player that appears later is added; one that goes is marked unavailable
    server.push('player_added', 'bath', { player_id: 'bath', name: 'Bathroom', type: 'player', available: true, enabled: true, playback_state: 'paused', volume_level: 10 });
    await until(() => registry.getDevices().some((d) => d.key === 'musicassistant/bath'));
    assert.equal(store.values['musicassistant/bath/state'], 'paused');
    server.push('player_removed', 'bath', null);
    await until(() => store.values['musicassistant/bath/available'] === 0);
  } finally { client.stop(); await server.close(); }
});

test('play media and search', async () => {
  const server = await fakeServer();
  const { client } = await boot(server);
  try {
    await until(() => client.status().connected);
    assert.deepEqual(await client.playMedia('Upstairs', 'library://playlist/3', { option: 'replace' }), { player: 'Upstairs' });
    assert.deepEqual(server.last('player_queues/play_media').args, { queue_id: 'up:stairs 1', media: 'library://playlist/3', option: 'replace' });
    await client.playMedia('musicassistant/kitchen', 'library://track/2'); // by device key
    assert.equal(server.last('player_queues/play_media').args.queue_id, 'kitchen');
    await assert.rejects(client.playMedia('nowhere', 'x'), /No matching player/);

    const found = await client.search('miles', { types: ['track', 'playlist'], limit: 5 });
    assert.deepEqual(server.last('music/search').args, { search_query: 'miles', limit: 5, media_types: ['track', 'playlist'] });
    assert.deepEqual(found, [
      { type: 'track', name: 'So What', uri: 'library://track/2', artist: 'Miles Davis', album: 'Kind of Blue' },
      { type: 'playlist', name: 'Jazz', uri: 'library://playlist/3', artist: undefined, album: undefined },
    ]);
    assert.equal(client.getPlayers().length, 5); // every player the server has, not just the devices
  } finally { client.stop(); await server.close(); }
});

test('player filter and hidden players', async () => {
  const server = await fakeServer();
  const a = await boot(server, { players: ['upstairs', 'hidden'] });
  const b = await boot(server, { includeHidden: true });
  try {
    await until(() => a.client.status().connected && b.client.status().connected);
    assert.deepEqual(a.registry.getDevices().map((d) => d.label).sort(), ['Garage', 'Upstairs']);
    assert.deepEqual(b.registry.getDevices().map((d) => d.label).sort(), ['Garage', 'Kitchen', 'Upstairs']);
  } finally { a.client.stop(); b.client.stop(); await server.close(); }
});

test('a wrong or missing token is reported, an old server needs none', async () => {
  const server = await fakeServer();
  const old = await fakeServer({ schema: 24 });
  try {
    assert.deepEqual(await testConnection(server.url, 'good'), { server: 'Home', version: '2.7.1', players: 5 });
    await assert.rejects(testConnection(server.url, 'bad'), /Sign-in refused: Invalid token/);
    await assert.rejects(testConnection(server.url, ''), /needs a long-lived access token/);
    assert.equal((await testConnection(old.url, '')).players, 5);
    assert.ok(!old.calls.some((c) => c.command === 'auth'));
    await assert.rejects(testConnection('http://127.0.0.1:9', 'x', 1500));

    // the running client does not report itself connected with a bad token
    const { client } = await boot(server, { token: 'bad' });
    await until(() => /Sign-in refused/.test(client.status().error));
    assert.equal(client.status().connected, false);
    client.stop();
  } finally { await server.close(); await old.close(); }
});

test('reconnects after the server drops the connection', async () => {
  const server = await fakeServer();
  const { store, client } = await boot(server);
  try {
    await until(() => client.status().connected);
    client._retry = 50; // not the real 3 s
    for (const ws of server.sockets) ws.terminate();
    await until(() => !client.status().connected);
    server.players[0].volume_level = 77;
    await until(() => client.status().connected && store.values['musicassistant/kitchen/volume'] === 77);
  } finally { client.stop(); await server.close(); }
});
