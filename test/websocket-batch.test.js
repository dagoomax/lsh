'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const DataStore = require('../src/data-store');
const setupWebSocket = require('../src/websocket');

const tick = () => new Promise((r) => setImmediate(r));

test('store change events say whether the value changed', () => {
  const store = new DataStore();
  const events = [];
  store.on('change', (e) => events.push(e.changed));
  const obj = { a: 1 };
  store.update('x/1/n', 1);    // new key
  store.update('x/1/n', 1);    // same
  store.set('x/1/n', 2);       // different
  store.update('x/1/s', 'on');
  store.update('x/1/s', 'on');
  store.update('x/1/nan', NaN);
  store.update('x/1/nan', NaN);
  store.update('x/1/o', obj);
  store.update('x/1/o', obj);  // objects always count as changed (may be mutated in place)
  store.update('x/1/z', null);
  store.update('x/1/z', null);
  assert.deepEqual(events, [true, false, true, true, false, true, false, true, true, true, false]);
  assert.equal(store.get('x/1/n'), 2);
});

test('websocket update batches carry changed values only, latest value wins', async () => {
  const store = new DataStore();
  const srv = http.createServer();
  const io = setupWebSocket(srv, store, null, null, null);
  const sent = [];
  io.emit = (event, data) => { if (event === 'update') sent.push({ ...data }); return true };
  try {
    store.update('a/1/x', 1);
    store.update('a/1/y', 'on');
    await tick();
    assert.deepEqual(sent, [{ 'a/1/x': 1, 'a/1/y': 'on' }]);

    // a poll that re-publishes the same values sends nothing at all
    store.update('a/1/x', 1);
    store.update('a/1/y', 'on');
    await tick();
    assert.equal(sent.length, 1);

    // only what changed; objects always go
    store.update('a/1/x', 1);
    store.update('a/1/y', 'off');
    store.update('a/1/list', [1, 2]);
    await tick();
    assert.deepEqual(sent[1], { 'a/1/y': 'off', 'a/1/list': [1, 2] });

    // a key already in the batch keeps the latest value, even when the last
    // set repeated it
    store.update('a/1/x', 5);
    store.update('a/1/x', 5);
    store.update('a/1/y', 'on');
    store.update('a/1/y', 'off');
    await tick();
    assert.deepEqual(sent[2], { 'a/1/x': 5, 'a/1/y': 'off' });
  } finally {
    io.close();
  }
});
