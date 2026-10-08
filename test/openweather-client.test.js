'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OpenWeatherClient = require('../src/openweather-client');

// The "a failed first poll must not stop polling" guarantee (round 1 fix,
// 6d565bf) now lives in PollingClient — tested behaviorally in
// test/polling-client.test.js.
test('openweather-client: is a PollingClient', () => {
  const PollingClient = require('../src/polling-client');
  assert.ok(new OpenWeatherClient({}, {}, {}) instanceof PollingClient);
});

test('openweather-client: a poll already in flight is not started twice', async () => {
  // Round 2 fix (02ae0a9) — arming the interval before the first poll
  // resolves (the fix above) opened a new race: if a poll ran long, the next
  // tick could start a second overlapping poll against the same in-flight
  // state. Guarded with an in-memory this._polling flag.
  const client = new OpenWeatherClient({ openweather: { apiKey: 'x', lat: 0, lon: 0 } }, {
    update() {},
  }, { registerDevice() {} });

  let implCalls = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  client._pollImpl = async () => {
    implCalls++;
    await firstGate; // simulate a slow in-flight request
  };

  const firstCall = client._poll(); // not awaited — still in flight
  await client._poll(); // should be skipped, not queued

  assert.equal(implCalls, 1, 'a second poll must not run while the first is still in flight');

  releaseFirst();
  await firstCall;

  await client._poll(); // now that the first has finished, polling again must work
  assert.equal(implCalls, 2, 'polling must resume normally once the in-flight poll finishes');
});
