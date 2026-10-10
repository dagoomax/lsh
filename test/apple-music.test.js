'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const EventEmitter = require('events');
const AppleMusic = require('../src/apple-music');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const fakeStore = () => Object.assign(new EventEmitter(), { values: {}, update(k, v) { this.values[k] = v }, set(k, v) { this.values[k] = v } });
const fakeRegistry = () => {
  const devices = new Map();
  return {
    devices, registerDevice: (d) => devices.set(d.key, d),
    async sendCommand(key, p, value) {
      const d = devices.get(key), s = d.sensors.find((x) => x.path === p);
      if (s.type === 'range') return d._writeCapability(s.capabilityId, s.writeCmd, [value]);
      return d._writeCapability(s.capabilityId, value ? s.writeOn : s.writeOff);
    },
  };
};

test('Apple Music developer token: ES256 JWT Apple accepts (verifies with the public key)', () => {
  const tok = AppleMusic.signDeveloperToken({ teamId: 'ABCDE12345', keyId: 'KEY1234567', key: crypto.createPrivateKey(PEM), now: 1000 });
  const [h, c, sig] = tok.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepEqual(dec(h), { alg: 'ES256', kid: 'KEY1234567' });
  assert.deepEqual(dec(c), { iss: 'ABCDE12345', iat: 1000, exp: 1000 + 12 * 3600 });
  assert.equal(Buffer.from(sig, 'base64url').length, 64, 'raw r||s signature, not DER');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => AppleMusic.loadKey({ privateKey: rsa }), /EC/);
});

test('Apple Music: token check against the API, browser player relay, device commands', async () => {
  let auth = null;
  const srv = http.createServer((req, res) => { auth = req.headers.authorization; res.writeHead(req.url.startsWith('/v1/catalog/pl/search') ? 200 : 404, { 'Content-Type': 'application/json' }); res.end('{"results":{}}') });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const store = fakeStore(), registry = fakeRegistry();
  const am = new AppleMusic({ appleMusic: { teamId: 'ABCDE12345', keyId: 'KEY1234567', privateKey: PEM, storefront: 'pl', apiBase: `http://127.0.0.1:${srv.address().port}` } }, store, registry);
  try {
    await am.start();
    const check = await am.verify();
    assert.equal(check.ok, true);
    assert.equal(auth, `Bearer ${am.developerToken()}`);
    assert.equal(am.developerToken(), am.developerToken(), 'cached');

    // No player open → commands explain what to do
    assert.throws(() => am._command('next', 'trigger'), /open the Music page/);
    assert.equal(store.values['applemusic/player/device'], '');

    // A Music page reports in
    let out = am.report('tablet-abc123', { name: 'Kitchen tablet', state: { playing: true, volume: 40, track: 'Song', artist: 'Artist', album: 'Album', artwork: 'https://is1-ssl.mzstatic.com/x.jpg', authorized: true } });
    assert.deepEqual(out, []);
    assert.equal(store.values['applemusic/player/playing'], 1);
    assert.equal(store.values['applemusic/player/device'], 'Kitchen tablet');
    assert.equal(store.values['applemusic/player/track'], 'Song');

    // Dashboard / flow commands are queued for that page and handed over once
    await registry.sendCommand('applemusic/player', 'playing', false);
    await registry.sendCommand('applemusic/player', 'next', true);
    await registry.sendCommand('applemusic/player', 'volume', 75);
    am.enqueuePlay('playlist', 'pl.u-abc123');
    assert.throws(() => am.enqueuePlay('playlist', '../etc'), /kind/);
    out = am.report('tablet-abc123', { name: 'Kitchen tablet', state: { playing: false } });
    assert.deepEqual(out, [{ cmd: 'pause' }, { cmd: 'next' }, { cmd: 'volume', value: 75 }, { cmd: 'playItem', kind: 'playlist', id: 'pl.u-abc123' }]);
    assert.deepEqual(am.report('tablet-abc123', { state: {} }), []);
    assert.throws(() => am.report('../x', {}), /Bad player id/);

    // The most recent player wins; a silent one goes stale
    am.report('phone-xyz789', { name: 'Phone', state: { playing: true, track: 'Other' } });
    assert.equal(am.getStatus().active.name, 'Phone');
    am.players.get('phone-xyz789').at -= 60000; am.players.get('tablet-abc123').at -= 60000;
    am._applyActive();
    assert.equal(store.values['applemusic/player/device'], '');
    assert.equal(store.values['applemusic/player/playing'], 0);
  } finally { am.stop(); srv.close() }

  // Apple says no → explained
  const bad = http.createServer((req, res) => { res.writeHead(401); res.end() });
  await new Promise((r) => bad.listen(0, '127.0.0.1', r));
  const am2 = new AppleMusic({ appleMusic: { teamId: 'ABCDE12345', keyId: 'KEY1234567', privateKey: PEM, apiBase: `http://127.0.0.1:${bad.address().port}` } }, fakeStore(), fakeRegistry());
  await am2.start();
  assert.match((await am2.verify()).error, /rejected the developer token/);
  am2.stop(); bad.close();
});
