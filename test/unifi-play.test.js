'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const SensorRegistry = require('../src/sensor-registry');
const UnifiPlayClient = require('../src/unifi-play-client');

const { encodeBinme, decodeBinme } = UnifiPlayClient;

let tls = null;
try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-sim-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=play-sim',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  tls = { dir, certFile: path.join(dir, 'cert.pem'), keyFile: path.join(dir, 'key.pem') };
} catch { /* no openssl */ }

const fakeStore = () => Object.assign(new EventEmitter(), {
  values: {},
  update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) },
  set(k, v) { this.update(k, v) },
  get(k) { return this.values[k] ?? null },
  getTimestamp() { return Date.now() },
});
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)) } };

// Console with the Play app: GET /proxy/apollo/api/v1/devices (shape from ha-unifiplay's docs)
function apollo() {
  const devices = [{
    id: 'dev-1', name: 'Living room', mac: 'AABBCCDDEEFF', platform: 'UPL-AMP', firmware: '1.0.41', ip: '10.0.0.60', state: 'MANAGED_BY_OTHER',
    info: { locating: false, volume: 25, source: 'lineIn', stream_playing: false, service: '' },
    now_playing: { song: 'Song A', artist: 'Artist A', album: 'Album A', length: 200, current: 10, cover_path: '' },
  }];
  const server = https.createServer({ key: fs.readFileSync(tls.keyFile), cert: fs.readFileSync(tls.certFile) }, (req, res) => {
    if (req.headers['x-api-key'] !== 'playkey') { res.writeHead(401); return res.end() }
    if (req.url === '/proxy/apollo/api/v1/devices') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ err: null, type: 'collection', data: devices })) }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, devices, close: () => new Promise((x) => server.close(x)) })));
}

// mqtt.connect stand-in: records publishes, lets the test push status frames
function fakeMqtt() {
  const clients = [];
  return {
    clients,
    connect(url, opts) {
      const c = Object.assign(new EventEmitter(), {
        url, opts, connected: false, published: [], subs: [],
        subscribe(t) { this.subs.push(t) },
        publish(topic, payload) { this.published.push({ topic, ...decodeBinme(payload) }) },
        end() { this.connected = false },
      });
      clients.push(c);
      setImmediate(() => { c.connected = true; c.emit('connect') });
      return c;
    },
  };
}

test('UniFi Play: binme framing round-trip (plain and zlib)', () => {
  const buf = encodeBinme({ id: 'x', type: 'request', timestamp: 1, action: 'set_volume' }, { volume: 30, info_sync: true });
  assert.equal(buf[0], 0x01);
  assert.equal(buf.readUInt32BE(4), JSON.stringify({ id: 'x', type: 'request', timestamp: 1, action: 'set_volume' }).length);
  assert.deepEqual(decodeBinme(buf), { header: { id: 'x', type: 'request', timestamp: 1, action: 'set_volume' }, body: { volume: 30, info_sync: true } });

  const z = require('zlib').deflateSync(Buffer.from(JSON.stringify({ volume: 7 })));
  const h = Buffer.from(JSON.stringify({ name: 'info', type: 'event' }));
  const part = (type, fmt, comp, data) => { const b = Buffer.alloc(8); b[0] = type; b[1] = fmt; b[2] = comp; b.writeUInt32BE(data.length, 4); return Buffer.concat([b, data]) };
  assert.deepEqual(decodeBinme(Buffer.concat([part(1, 1, 0, h), part(2, 1, 1, z)])).body, { volume: 7 });
  assert.equal(decodeBinme(Buffer.from([2, 1, 0, 0, 0, 0, 0, 0])), null, 'no header → not a message');
});

test('UniFi Play: console devices read-only without a client certificate', { skip: !tls && 'needs openssl' }, async () => {
  const sim = await apollo();
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const c = new UnifiPlayClient({ unifiPlay: { host: `127.0.0.1:${sim.port}`, apiKey: 'playkey' } }, store, registry, { mqtt: fakeMqtt() });
  try {
    await c.start();
    await until(() => store.values['unifiPlay/aabbccddeeff/volume'] === 25);
    const dev = registry.devices.get('unifiPlay/aabbccddeeff');
    assert.equal(dev.model, 'PowerAmp');
    assert.equal(dev.sensors.find((s) => s.path === 'volume').controllable, undefined);
    assert.equal(store.values['unifiPlay/aabbccddeeff/source'], 'lineIn');
    assert.equal(store.values['unifiPlay/aabbccddeeff/title'], 'Song A');
    assert.equal(store.values['unifiPlay/aabbccddeeff/online'], 1);
    assert.deepEqual(c.status().map((d) => d.mqtt), [false]);
  } finally { c.stop(); await sim.close() }
});

test('UniFi Play: MQTT control — volume, mute, source, player, live info', { skip: !tls && 'needs openssl' }, async () => {
  const sim = await apollo();
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const mqtt = fakeMqtt();
  const c = new UnifiPlayClient({ unifiPlay: { host: `127.0.0.1:${sim.port}`, apiKey: 'playkey', mqtt: { certFile: tls.certFile, keyFile: tls.keyFile } } }, store, registry, { mqtt });
  const v = (k) => store.values[`unifiPlay/aabbccddeeff/${k}`];
  try {
    await c.start();
    await until(() => mqtt.clients[0]?.connected && mqtt.clients[0].published.length >= 2);
    const cl = mqtt.clients[0];
    assert.equal(cl.url, 'mqtts://10.0.0.60:8883');
    assert.ok(cl.opts.cert && cl.opts.key, 'client certificate passed');
    assert.deepEqual(cl.published.map((p) => p.header.action), ['info', 'metadata']);
    assert.match(cl.published[0].topic, /^UPL-MOB\/[0-9a-f-]{36}\/action$/);

    await registry.sendCommand('unifiPlay/aabbccddeeff', 'volume', 40);
    assert.deepEqual(cl.published.at(-1).body, { volume: 40, info_sync: true });
    await registry.sendCommand('unifiPlay/aabbccddeeff', 'muted', '1');
    assert.deepEqual(cl.published.at(-1).body, { volume: 0, info_sync: true });
    await registry.sendCommand('unifiPlay/aabbccddeeff', 'muted', '0');
    assert.deepEqual(cl.published.at(-1).body, { volume: 40, info_sync: true }, 'unmute restores the last level');
    await registry.sendCommand('unifiPlay/aabbccddeeff', 'source', 'streaming');
    assert.deepEqual(cl.published.at(-1), { ...cl.published.at(-1), body: { source: 'streaming' } });
    await assert.rejects(registry.sendCommand('unifiPlay/aabbccddeeff', 'source', 'usb'), /Source: streaming, speakers, lineIn/, 'PowerAmp has no USB input');
    await registry.sendCommand('unifiPlay/aabbccddeeff', 'player', 'previous');
    assert.deepEqual(cl.published.at(-1).body, { action: 'prev' });
    await registry.sendCommand('unifiPlay/aabbccddeeff', 'locate', '1');
    assert.deepEqual(cl.published.at(-1).body, { enable: true });

    // live events: ours, and another speaker's retained status that must be ignored
    cl.emit('message', 'UPL-AMP/AABBCCDDEEFF/status', encodeBinme({ name: 'info', type: 'event' }, { volume: 55, muted: false, source: 'speakers', stream_playing: true, service: 'airplay' }));
    cl.emit('message', 'UPL-DEVICE/112233445566/status', encodeBinme({ name: 'info', type: 'event' }, { volume: 3 }));
    cl.emit('message', 'UPL-AMP/AABBCCDDEEFF/status', encodeBinme({ name: 'metadata', type: 'event' }, { title: 'Live song', artist: 'Band' }));
    assert.equal(v('volume'), 55);
    assert.equal(v('playing'), 1);
    assert.equal(v('service'), 'airplay');
    assert.equal(v('title'), 'Live song');
  } finally { c.stop(); await sim.close() }
});

test('UniFi Play: direct speaker learns its MAC from the info answer', { skip: !tls && 'needs openssl' }, async () => {
  const store = fakeStore(), registry = new SensorRegistry(store, 'en');
  const mqtt = fakeMqtt();
  const c = new UnifiPlayClient({ unifiPlay: { devices: [{ host: '10.0.0.61', name: 'Patio' }], mqtt: { certFile: tls.certFile, keyFile: tls.keyFile } } }, store, registry, { mqtt });
  try {
    await c.start();
    await until(() => mqtt.clients[0]?.connected);
    const cl = mqtt.clients[0];
    cl.emit('message', 'UPL-DEVICE/0A0B0C0D0E0F/status', encodeBinme({ name: 'info', type: 'event' }, { volume: 12, source: 'spdif' }));
    assert.equal(store.values['unifiPlay/ip_10_0_0_61/volume'], 12);
    assert.deepEqual(c.status(), [{ key: 'unifiPlay/ip_10_0_0_61', name: 'Patio', model: 'PoE Audio Port', ip: '10.0.0.61', mac: '0A0B0C0D0E0F', mqtt: true }]);
    await registry.sendCommand('unifiPlay/ip_10_0_0_61', 'source', 'usb');
    assert.deepEqual(cl.published.at(-1).body, { source: 'usb' });
  } finally { c.stop() }
});
