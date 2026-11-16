'use strict';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

// the routes read config.json through helpers, and the licence decides access
let cfg = {};
let hotel = true;
require.cache[require.resolve('../src/routes/helpers')] = { exports: { readConfigFile: () => cfg } };
require.cache[require.resolve('../src/license')] = { exports: { resolveLicense: () => ({ limits: { hotel } }) } };
const written = [];
require.cache[require.resolve('../src/config-file-cache')] = { exports: { writeConfigFile: (c) => { written.push(c); cfg = c; } } };

const laundry = require('../src/laundry');
const backup = fs.existsSync(laundry.ORDERS_FILE) ? fs.readFileSync(laundry.ORDERS_FILE) : null;
after(() => { if (backup) fs.writeFileSync(laundry.ORDERS_FILE, backup); else fs.rmSync(laundry.ORDERS_FILE, { force: true }); });

const items = [
  { id: 'shirt', category: 'Wash', name: 'Shirt', price: 25 },
  { id: 'coat', name: 'Coat', price: 90.5 },
  { id: 'hidden', name: 'Hidden', price: 1, available: false },
];
const base = () => ({ laundry: { enabled: true, currency: 'EUR', expressSurchargePct: 50, standardHours: 24, expressHours: 4, rooms: ['101'], items } });

function server() {
  const a = express();
  a.use(express.json());
  const r = express.Router();
  require('../src/routes/laundry')(r, { requireAdmin: (req, res, next) => next() });
  a.use('/api', r);
  return new Promise((res) => {
    const s = a.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${s.address().port}/api`;
      const call = async (method, p, body) => {
        const x = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
        return { status: x.status, json: await x.json() };
      };
      res({ call, close: () => s.close() });
    });
  });
}

beforeEach(() => { cfg = base(); hotel = true; laundry.saveOrders([]); });

test('the Node page is the generated copy of the Go page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'core-go', 'laundry_page.html'), 'utf8');
  assert.equal(require('../src/laundry-page'), html, 'run node scripts/gen-laundry-page.js');
});

test('prices come from the server and express adds the surcharge', async () => {
  const s = await server();
  const r = await s.call('POST', '/order/laundry/place', { room: '101', express: true,
    items: [{ id: 'shirt', qty: 2, price: 0 }, { id: 'coat', qty: 1 }, { id: 'hidden', qty: 5 }, { id: 'nope', qty: 1 }, { id: 'toString', qty: 1 }, { id: 'shirt', qty: 100 }] });
  s.close();
  const o = r.json.data;
  assert.equal(r.status, 200);
  assert.deepEqual(o.items.map((i) => [i.id, i.qty, i.price]), [['shirt', 2, 25], ['coat', 1, 90.5]]);
  assert.deepEqual([o.subtotal, o.surcharge, o.total], [140.5, 70.25, 210.75]);
  assert.equal(o.payment, 'room');
  assert.equal(o.paid, false);
  assert.equal(o.status, 'requested');
  assert.equal(o.pickup, 'As soon as possible');
  assert.ok(Math.abs(o.dueAt - o.at - 4 * 3600000) < 1000);
});

test('express is ignored when switched off', async () => {
  cfg.laundry.express = false;
  const s = await server();
  const { json } = await s.call('POST', '/order/laundry/place', { room: '101', express: true, items: [{ id: 'shirt', qty: 1 }] });
  s.close();
  assert.equal(json.data.express, false);
  assert.equal(json.data.total, 25);
});

test('refuses bad orders', async () => {
  const s = await server();
  const place = (b) => s.call('POST', '/order/laundry/place', { items: [{ id: 'shirt', qty: 1 }], ...b });
  assert.equal((await place({ room: '' })).status, 400);
  assert.equal((await place({ room: '999' })).status, 400);
  assert.equal((await place({ room: '101', items: [] })).status, 400);
  delete cfg.laundry.rooms;
  cfg.roomService = { rooms: ['202'] };
  assert.equal((await place({ room: '101' })).status, 400, 'falls back to the room-service list');
  assert.equal((await place({ room: '202' })).status, 200);
  hotel = false;
  assert.equal((await place({ room: '202' })).status, 404);
  assert.equal((await s.call('GET', '/order/laundry/menu')).status, 404);
  s.close();
});

test('the guest menu leaves out hidden items and the room list', async () => {
  const s = await server();
  const { json } = await s.call('GET', '/order/laundry/menu');
  s.close();
  assert.deepEqual(json.data.items.map((i) => i.id), ['shirt', 'coat']);
  assert.equal(json.data.rooms, undefined);
});

test('status flow, public tracker and delete rules', async () => {
  const s = await server();
  const { json: { data: o } } = await s.call('POST', '/order/laundry/place', { room: '101', note: 'Silk', items: [{ id: 'shirt', qty: 1 }] });

  const pub = (await s.call('GET', `/order/laundry/status/${o.id}`)).json.data;
  assert.equal(pub.room, undefined);
  assert.equal(pub.note, undefined);
  assert.equal(pub.status, 'requested');
  assert.equal((await s.call('GET', '/order/laundry/status/nope')).status, 404);

  assert.equal((await s.call('POST', `/laundry/orders/${o.id}/status`, { status: 'bogus' })).status, 400);
  const c = (await s.call('POST', `/laundry/orders/${o.id}/status`, { status: 'collected' })).json.data;
  assert.deepEqual(c.history.map((h) => h.status), ['requested', 'collected']);
  assert.ok(c.dueAt >= o.dueAt, 'the turnaround restarts at collection');
  await s.call('POST', `/laundry/orders/${o.id}/status`, { status: 'collected' });
  assert.equal(laundry.loadOrders()[0].history.length, 2, 'a repeat is not a change');

  assert.equal(laundry.openForRoom('101').length, 1);
  assert.equal((await s.call('DELETE', `/laundry/orders/${o.id}`)).status, 409);
  await s.call('DELETE', '/laundry/orders/finished');
  assert.equal(laundry.loadOrders().length, 1, 'clearing finished keeps open orders');

  await s.call('POST', `/laundry/orders/${o.id}/status`, { status: 'delivered' });
  assert.equal(laundry.openForRoom('101').length, 0);
  assert.equal((await s.call('DELETE', '/laundry/orders/finished')).status, 200);
  assert.equal(laundry.loadOrders().length, 0);
  s.close();
});

test('the cap drops finished orders before open ones', () => {
  const open = { id: 'old-open', status: 'cleaning' };
  const list = [...Array.from({ length: 500 }, (_, i) => ({ id: `d${i}`, status: 'delivered' })), open];
  const kept = laundry.trimOrders(list);
  assert.equal(kept.length, 500);
  assert.ok(kept.includes(open));
  assert.ok(!kept.some((o) => o.id === 'd499'));
});

test('daily summary skips cancelled orders', () => {
  const at = Date.now();
  const date = laundry.localDay(at); // same local-day bucketing dailySummary uses (UTC slice breaks near midnight in +TZ)
  laundry.saveOrders([
    { id: 'a', at, status: 'delivered', total: 10.5, currency: 'EUR' },
    { id: 'b', at, status: 'cancelled', total: 99, currency: 'EUR' },
    { id: 'c', at: at - 864e5 * 3, status: 'cleaning', total: 5, currency: 'EUR' },
  ]);
  assert.deepEqual(laundry.dailySummary(date), { orders: 1, open: 1, revenue: { EUR: 10.5 } });
});

test('the guest page is served, with or without a room in the path', async () => {
  const a = express();
  a.use('/laundry', laundry.pageRouter());
  const s = await new Promise((res) => { const x = a.listen(0, '127.0.0.1', () => res(x)); });
  const base = `http://127.0.0.1:${s.address().port}/laundry`;
  for (const url of [base, `${base}?room=101`, `${base}/101`]) {
    const r = await fetch(url);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(await r.text(), /api\/order\/laundry\/menu/);
  }
  s.close();
});
