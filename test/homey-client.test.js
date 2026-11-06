'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const HomeyClient = require('../src/homey-client');
const platformStatus = require('../src/platform-status');

const lamp = {
  id: 'lamp-1', name: 'Lamp', class: 'light', capabilities: ['onoff', 'dim'],
  capabilitiesObj: { onoff: { value: true }, dim: { value: 0.5 } },
};

async function harness(t) {
  const state = { status: 200, body: {} };
  const server = http.createServer((req, res) => {
    res.writeHead(state.status, { 'Content-Type': 'application/json' });
    res.end(typeof state.body === 'string' ? state.body : JSON.stringify(state.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const store = { values: {}, update(k, v) { this.values[k] = v } };
  const devices = new Map();
  const registry = { registerDevice: (d) => devices.set(d.key, d) };
  const client = new HomeyClient(
    { homey: { host: `127.0.0.1:${server.address().port}`, token: 't', pollInterval: 3600 } },
    store, registry,
  );
  t.after(() => { client.stop(); server.closeAllConnections(); server.close() });
  return { state, store, devices, client };
}

test('picks up devices that appear after a start during Homey boot', async (t) => {
  const h = await harness(t);
  await h.client.start();
  assert.equal(h.devices.size, 0);
  assert.equal(platformStatus.getAll().homey, false, 'an empty Homey must not read as connected');

  h.state.body = { [lamp.id]: lamp };
  await h.client._poll();
  assert.ok(h.devices.has('homey/lamp-1'));
  assert.equal(h.store.values['homey/lamp-1/onoff'], 1);
  assert.equal(h.store.values['homey/lamp-1/dim'], 50);
  assert.equal(platformStatus.getAll().homey, true);
});

test('registers a device once and keeps refreshing its values', async (t) => {
  const h = await harness(t);
  let registered = 0;
  const seen = h.client._registry.registerDevice;
  h.client._registry.registerDevice = (d) => { registered++; seen(d) };
  h.state.body = [lamp];
  await h.client.start();
  h.state.body = [{ ...lamp, capabilitiesObj: { onoff: { value: false }, dim: { value: 0.2 } } }];
  await h.client._poll();
  assert.equal(registered, 1);
  assert.equal(h.store.values['homey/lamp-1/onoff'], 0);
  assert.equal(h.store.values['homey/lamp-1/dim'], 20);
});

test('a device unavailable at first is added once it comes up', async (t) => {
  const h = await harness(t);
  h.state.body = [lamp, { ...lamp, id: 'lamp-2', available: false }];
  await h.client.start();
  assert.equal(h.devices.size, 1);
  h.state.body = [lamp, { ...lamp, id: 'lamp-2', available: true }];
  await h.client._poll();
  assert.equal(h.devices.size, 2);
});

test('a 403 reports the reason and recovers without a restart', async (t) => {
  const h = await harness(t);
  h.state.status = 403;
  h.state.body = 'Subscription Inactive';
  const errors = [];
  const original = console.error;
  console.error = (m) => errors.push(String(m));
  try { await h.client.start() } finally { console.error = original }
  assert.equal(platformStatus.getAll().homey, false);
  assert.match(errors.join('\n'), /403.*Subscription Inactive/);

  h.state.status = 200;
  h.state.body = [lamp];
  await h.client._poll();
  assert.equal(platformStatus.getAll().homey, true);
  assert.equal(h.devices.size, 1);
});
