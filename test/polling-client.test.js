'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const PollingClient = require('../src/polling-client');
const platformStatus = require('../src/platform-status');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Scripted extends PollingClient {
  // results: array of 'ok' | 'fail', consumed one per poll ('ok' after it runs out)
  constructor(key, results) {
    super({ statusKey: key, logTag: key, maxBackoffMs: 80 });
    this.results = results;
    this.calls = 0;
  }
  async _pollImpl() {
    this.calls++;
    if ((this.results.shift() || 'ok') === 'fail') throw new Error('boom');
  }
}

test('polling-client: a failed first poll does not stop polling', async () => {
  const c = new Scripted('t-firstfail', ['fail']);
  await c.startPolling(10);
  assert.equal(platformStatus.getAll()['t-firstfail'], false);
  await sleep(120);
  c.stopPolling();
  assert.ok(c.calls >= 2, `expected a retry after the failed first poll, got ${c.calls} call(s)`);
  assert.equal(platformStatus.getAll()['t-firstfail'], true, 'a later success marks the platform connected');
});

test('polling-client: status is false before the first poll and tracks each outcome', async () => {
  const c = new Scripted('t-status', ['ok', 'fail']);
  await c.startPolling(1000);
  assert.equal(platformStatus.getAll()['t-status'], true);
  await c._poll();
  assert.equal(platformStatus.getAll()['t-status'], false);
  c.stopPolling();
});

test('polling-client: consecutive failures back off, capped, and reset on success', async () => {
  const c = new Scripted('t-backoff', []);
  c._intervalMs = 10;
  assert.equal(c._nextDelay(), 10);
  c._failures = 1; assert.equal(c._nextDelay(), 20);
  c._failures = 3; assert.equal(c._nextDelay(), 80);
  c._failures = 10; assert.equal(c._nextDelay(), 80, 'capped at maxBackoffMs');
  await c._poll();
  assert.equal(c._failures, 0, 'a success resets the backoff');
});

test('polling-client: polls never overlap', async () => {
  const c = new Scripted('t-overlap', []);
  let release;
  c._pollImpl = async () => { c.calls++; await new Promise((r) => { release = r; }); };
  const first = c._poll();
  await c._poll(); // skipped while the first is in flight
  assert.equal(c.calls, 1);
  release();
  await first;
});

test('polling-client: stopPolling stops the schedule', async () => {
  const c = new Scripted('t-stop', []);
  await c.startPolling(10);
  c.stopPolling();
  const n = c.calls;
  await sleep(50);
  assert.equal(c.calls, n);
});
