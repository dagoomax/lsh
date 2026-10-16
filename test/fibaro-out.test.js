'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const EventEmitter = require('events');
const FibaroOutClient = require('../src/fibaro-out-client');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Fibaro push: current values on start, only real changes, a failed push is retried', async () => {
  const got = [];
  let failNext = 0;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET') return res.end(JSON.stringify([{ name: 'LSH_SatelArmed' }, { name: 'LSH_zone_3_state' }]));
      got.push([req.method, req.url, JSON.parse(body).value]);
      if (failNext) { failNext--; res.statusCode = 500; return res.end('busy') }
      res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const errors = console.error;
  console.error = () => {};
  try {
    const store = new EventEmitter();
    store.getAll = () => ({ 'satel/partition/1/armed': true, 'satel/zone/3/state': 0, 'other/key': 5 });
    const c = new FibaroOutClient({ fibaroOut: { host: '127.0.0.1', port: srv.address().port, mappings: [
      { storeKey: 'satel/partition/1/armed', variable: 'LSH_SatelArmed' },
      { storePrefix: 'satel/zone/', variablePrefix: 'LSH_zone_' },
    ] } }, store);
    await c.start();
    await wait(100);
    assert.deepEqual(got.sort(), [
      ['PUT', '/api/globalVariables/LSH_SatelArmed', '1'],
      ['PUT', '/api/globalVariables/LSH_zone_3_state', '0'],
    ]);

    // re-emitted unchanged values (every poll) are not sent again; a change is
    got.length = 0;
    for (let i = 0; i < 3; i++) {
      store.emit('change', { key: 'satel/partition/1/armed', value: true });
      store.emit('change', { key: 'satel/zone/3/state', value: 0 });
      await wait(250);
    }
    assert.deepEqual(got, []);
    store.emit('change', { key: 'satel/zone/3/state', value: 1 });
    await wait(300);
    assert.deepEqual(got, [['PUT', '/api/globalVariables/LSH_zone_3_state', '1']]);

    // the Home Center refuses one: the same value comes round again and is retried
    got.length = 0;
    failNext = 1;
    store.emit('change', { key: 'satel/zone/3/state', value: 2 });
    await wait(300);
    store.emit('change', { key: 'satel/zone/3/state', value: 2 });
    await wait(300);
    assert.deepEqual(got, [
      ['PUT', '/api/globalVariables/LSH_zone_3_state', '2'],
      ['PUT', '/api/globalVariables/LSH_zone_3_state', '2'],
    ]);
    c.stop();
  } finally {
    console.error = errors;
    srv.close();
  }
});
