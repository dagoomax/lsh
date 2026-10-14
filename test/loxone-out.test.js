'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const EventEmitter = require('events');
const LoxoneOutClient = require('../src/loxone-out-client');

test('Loxone push: text and numbers to Virtual Inputs, current values on start, only real changes, unknown input explained', async () => {
  const got = [];
  const known = new Set(['LSH Salon2 gra', 'LSH Salon2 stacja']);
  const srv = http.createServer((req, res) => {
    const m = /^\/dev\/sps\/io\/([^/]+)\/(.*)$/.exec(req.url);
    const name = decodeURIComponent(m[1]);
    got.push([name, decodeURIComponent(m[2]), req.headers.authorization]);
    res.end(`<LL control="x" value="1" Code="${known.has(name) ? 200 : 404}"/>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const vals = { 'radio/airplay-salon2/nowPlaying': 'RMF FM — Zalia - Tylko kochaj mnie' };
    const store = new EventEmitter();
    store.get = (k) => vals[k] ?? null;
    const c = new LoxoneOutClient({ loxoneOut: { host: '127.0.0.1', port: srv.address().port, username: 'admin', password: 'pw', mappings: [
      { storeKey: 'radio/airplay-salon2/nowPlaying', virtualInput: 'LSH Salon2 gra' },
      { storeKey: 'radio/airplay-salon2/station', virtualInput: 'LSH Salon2 stacja' },
    ] } }, store);
    c.start();
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(got.map((g) => g.slice(0, 2)), [['LSH Salon2 gra', 'RMF FM — Zalia - Tylko kochaj mnie']]);
    assert.equal(got[0][2], `Basic ${Buffer.from('admin:pw').toString('base64')}`);

    // a change is sent once; the same value re-emitted is not
    for (let i = 0; i < 3; i++) store.emit('change', { key: 'radio/airplay-salon2/station', value: 2 });
    await new Promise((r) => setTimeout(r, 400));
    store.emit('change', { key: 'radio/airplay-salon2/station', value: 2 });
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(got.slice(1).map((g) => g.slice(0, 2)), [['LSH Salon2 stacja', '2']]);

    await assert.rejects(c.push('LSH Kuchnia gra', 'x'), /no Virtual Input called “LSH Kuchnia gra”/);
    c.stop();
  } finally { srv.close() }
});
