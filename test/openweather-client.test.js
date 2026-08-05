'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OpenWeatherClient = require('../src/openweather-client');

test('openweather-client: retry interval is armed before the first poll resolves', () => {
  // Round 1 fix (6d565bf) — a failed initial poll (transient network blip at
  // boot) used to leave the client with no interval at all, since setInterval
  // was only called after the first poll succeeded. Regression-tested
  // structurally: this is an ordering guarantee inside start(), and the real
  // poll interval has a hard 60s floor, which makes a true timed test slow
  // and flaky for no extra confidence over asserting the ordering itself.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'openweather-client.js'), 'utf8');
  const startBody = src.slice(src.indexOf('async start()'), src.indexOf('stop() {'));
  const setIntervalIdx = startBody.indexOf('this._timer = setInterval');
  const firstPollIdx = startBody.indexOf('await this._poll(true)');

  assert.ok(setIntervalIdx !== -1, 'start() must arm the retry interval');
  assert.ok(firstPollIdx !== -1, 'start() must run an initial poll');
  assert.ok(setIntervalIdx < firstPollIdx, 'the interval must be armed before the initial poll runs, not after');
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
