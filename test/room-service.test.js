'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const rsvc = require('../src/room-service');

test('room service: the order cap drops acknowledged orders before unseen ones', () => {
  const orders = [];
  for (let i = 0; i < rsvc.MAX_ORDERS + 50; i++) orders.push({ id: `o${i}`, status: i % 2 ? 'ack' : 'new' });
  const kept = rsvc.trimOrders(orders);
  assert.equal(kept.length, rsvc.MAX_ORDERS);
  assert.equal(kept.filter((o) => o.status === 'new').length, orders.filter((o) => o.status === 'new').length, 'no unseen order lost');
  assert.equal(kept[0].id, 'o0', 'newest first, order kept');
  // nothing but unseen orders: the oldest go
  const allNew = Array.from({ length: rsvc.MAX_ORDERS + 5 }, (_, i) => ({ id: `n${i}`, status: 'new' }));
  assert.deepEqual(rsvc.trimOrders(allNew).map((o) => o.id), allNew.slice(0, rsvc.MAX_ORDERS).map((o) => o.id));
  assert.equal(rsvc.trimOrders(orders.slice(0, 3)).length, 3);
});

test('room service: a card payment can be claimed for one order only', () => {
  const id = `pi_test_${Date.now()}`;
  assert.equal(rsvc.claimIntent(''), false, 'no payment reference');
  assert.equal(rsvc.claimIntent(id), true);
  assert.equal(rsvc.claimIntent(id), false, 'second order with the same payment');
  rsvc.releaseIntent(id); // the first order failed — the payment is free again
  assert.equal(rsvc.claimIntent(id), true);
  rsvc.releaseIntent(id);
});

test('room service: room list', () => {
  assert.deepEqual(rsvc.roomsOf({ roomService: { rooms: [101, ' 102 ', ''] } }), ['101', '102']);
  assert.deepEqual(rsvc.roomsOf({}), []);
});
