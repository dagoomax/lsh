'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const AuxAirClient = require('../src/auxair-client');

function fakeClient() {
  const client = new AuxAirClient({ auxair: { email: 'a@b.c', password: 'x' } }, { update() {} }, { registerDevice() {} });
  client._devices = [{ endpointId: 'dev1' }];
  client._getParams = async () => { throw new Error('device offline'); }; // every poll fails
  return client;
}

test('auxair-client: re-login also refreshes the device list', async () => {
  // Round 2 fix (02ae0a9) — re-login used to keep the stale device list from
  // the original login, so a device added/removed/re-provisioned on AuxAir's
  // side was never picked up without a manual restart.
  const client = fakeClient();
  let loginCalls = 0, refreshCalls = 0;
  client._login = async () => { loginCalls++; };
  client._refreshDevices = async () => { refreshCalls++; };

  await client._poll();

  assert.equal(loginCalls, 1, 're-login must fire when every device fails');
  assert.equal(refreshCalls, 1, 're-login must also refresh the device list, not just re-authenticate');
});

test('auxair-client: re-login is throttled by the cooldown window', async () => {
  // Without the cooldown, a persistent outage would hammer the login API on
  // every poll cycle.
  const client = fakeClient();
  let loginCalls = 0;
  client._login = async () => { loginCalls++; };
  client._refreshDevices = async () => {};

  await client._poll();
  await client._poll();
  await client._poll();

  assert.equal(loginCalls, 1, 'repeated failures inside the cooldown window must not re-trigger login');
});

test('auxair-client: re-login fires again once the cooldown window has passed', async () => {
  const client = fakeClient();
  let loginCalls = 0;
  client._login = async () => { loginCalls++; };
  client._refreshDevices = async () => {};

  await client._poll();
  assert.equal(loginCalls, 1);

  client._lastReloginAt = Date.now() - 6 * 60 * 1000; // simulate cooldown elapsed
  await client._poll();

  assert.equal(loginCalls, 2, 'a new outage after the cooldown window must trigger login again');
});
