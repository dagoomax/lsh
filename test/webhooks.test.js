'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const EventEmitter = require('events');
const WebhookHub = require('../src/webhooks');
const { LshTrigger, keysFrom, verify } = require('../integrations/n8n-nodes-lsh/nodes/LshTrigger/LshTrigger.node');
const { Lsh } = require('../integrations/n8n-nodes-lsh/nodes/Lsh/Lsh.node');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeLsh() {
  const store = new EventEmitter();
  const values = new Map();
  store.get = (k) => values.get(k);
  store.set = (k, v) => { const changed = typeof v === 'object' || values.get(k) !== v; values.set(k, v); store.emit('change', { key: k, value: v, changed }); };
  const registry = {
    getDevices: () => [
      { key: 'shelly/plug-1', label: 'Kettle plug', room: 'Kitchen', sensors: [{ path: 'on', label: 'On', controllable: true, type: 'switch' }, { path: 'power', label: 'Power', unit: 'W' }] },
      { key: 'shelly/plug-10', label: 'Other', sensors: [{ path: 'power', label: 'Power' }] },
    ],
  };
  return { store, registry };
}

test('patterns: * stays in a segment, ** spans them', () => {
  const p = WebhookHub.pattern;
  assert.ok(p('shelly/*/power').test('shelly/plug-1/power'));
  assert.ok(!p('shelly/*/power').test('shelly/a/b/power'));
  assert.ok(p('shelly/**').test('shelly/a/b/power'));
  assert.ok(p('**').test('anything/at/all'));
  assert.ok(!p('shelly/plug-1/**').test('shelly/plug-10/power'), 'a device key is not a prefix of a longer one');
  assert.deepEqual(keysFrom(['shelly/plug-1'], 'on, power', 'airbnb/**'), ['shelly/plug-1/on', 'shelly/plug-1/power', 'airbnb/**']);
  assert.deepEqual(keysFrom(['shelly/plug-1'], '', ''), ['shelly/plug-1/**']);
});

test('hub: batches matching changes, signs them, describes devices, pauses after failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'));
  const got = [];
  let fail = false;
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => { got.push({ headers: req.headers, raw }); res.statusCode = fail ? 500 : 200; res.end('ok'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/hook`;
  const { store, registry } = fakeLsh();
  const hub = new WebhookHub(store, registry, { file: path.join(dir, 'webhooks.json'), batchMs: 50 });
  try {
    assert.throws(() => hub.add({ url: 'ftp://x', keys: ['**'] }), /http/);
    assert.throws(() => hub.add({ url, keys: [] }), /at least one/);
    const s = hub.add({ name: 'n8n: test', url, keys: ['shelly/plug-1/**'] });
    assert.equal((fs.statSync(path.join(dir, 'webhooks.json')).mode & 0o777).toString(8), '600', 'secrets file private');
    assert.equal(hub.list()[0].secret, undefined, 'list hides the secret');

    store.set('shelly/plug-1/power', 5);
    store.set('shelly/plug-1/power', 5); // repeat: ignored
    store.set('shelly/plug-1/power', 1800);
    store.set('shelly/plug-1/on', true);
    store.set('shelly/plug-10/power', 3); // other device
    await wait(150);
    assert.equal(got.length, 1, 'one batched delivery');
    const body = JSON.parse(got[0].raw);
    assert.equal(body.event, 'change');
    assert.equal(got[0].headers['x-lsh-signature'], WebhookHub.sign(s.secret, got[0].raw));
    assert.ok(verify(s.secret, Buffer.from(got[0].raw), got[0].headers['x-lsh-signature']), 'the n8n node accepts it');
    assert.ok(!verify('wrong-secret-wrong-secret', Buffer.from(got[0].raw), got[0].headers['x-lsh-signature']));
    const power = body.changes.find((c) => c.key === 'shelly/plug-1/power');
    assert.deepEqual([power.value, power.device, power.deviceLabel, power.sensor, power.sensorLabel, power.unit, power.room], [1800, 'shelly/plug-1', 'Kettle plug', 'power', 'Power', 'W', 'Kitchen']);
    assert.equal(body.changes.length, 2, 'newest value per key; other device left out');

    // test button
    assert.equal((await hub.test(s.id)).ok, true);
    assert.equal(JSON.parse(got.at(-1).raw).event, 'test');

    // throttle
    hub.update(s.id, { throttleSeconds: 60 });
    store.set('shelly/plug-1/power', 10); store.set('shelly/plug-1/power', 20);
    await wait(150);
    store.set('shelly/plug-1/power', 30);
    await wait(150);
    const after = got.slice(2).map((g) => JSON.parse(g.raw).changes.map((c) => c.value)).flat();
    assert.deepEqual(after, [10], 'at most one per key per throttle window');
    hub.update(s.id, { throttleSeconds: 0 });

    // failures pause it
    fail = true;
    for (let i = 0; i < 20; i++) await hub.deliver(hub.get(s.id), 'change', [{ key: 'shelly/plug-1/on', value: i }]);
    assert.equal(hub.get(s.id).enabled, false);
    assert.equal(hub.get(s.id).last.error, 'HTTP 500');

    // persisted, then removed
    assert.equal(new WebhookHub(null, null, { file: path.join(dir, 'webhooks.json') }).list().length, 1);
    assert.equal(hub.remove(s.id), true);
    assert.equal(hub.remove(s.id), false);
  } finally { hub.stop(); srv.close(); }
});

// n8n's node runtime, reduced to what these nodes call
function n8nContext({ params, lsh, staticData = {}, body, headers = {}, rawBody, items = [{ json: {} }] }) {
  const calls = [];
  const res = { code: 200, status(c) { this.code = c; return this; }, json(j) { this.body = j; return this; } };
  return {
    calls, res,
    getNodeParameter: (n, i, d) => (typeof i !== 'number' && i !== undefined ? (n in params ? params[n] : i) : (n in params ? params[n] : d)),
    getCurrentNodeParameter: (n) => params[n],
    getCredentials: async () => ({ baseUrl: 'http://lsh.local:3000/', apiToken: 'x' }),
    getInputData: () => items,
    continueOnFail: () => false,
    getWorkflowStaticData: () => staticData,
    getNodeWebhookUrl: () => 'http://n8n.local:5678/webhook/abc/webhook',
    getWorkflow: () => ({ id: '7', name: 'Kettle alert' }),
    getRequestObject: () => ({ headers, rawBody }),
    getResponseObject: () => res,
    getBodyData: () => body,
    helpers: {
      httpRequestWithAuthentication: async (cred, o) => { assert.equal(cred, 'lshApi'); calls.push({ method: o.method, url: o.url, body: o.body }); return lsh(o); },
    },
  };
}

test('n8n LSH node: lists, reads, commands, scenes; LSH Trigger subscribes and checks signatures', async () => {
  const devices = [{ key: 'shelly/plug-1', label: 'Kettle plug', room: 'Kitchen', sensors: [{ path: 'on', label: 'On', controllable: true }, { path: 'power', label: 'Power', unit: 'W' }], readings: { on: { value: false }, power: { value: 3, unit: 'W', label: 'Power' } } }];
  const lsh = (o) => {
    if (o.url.endsWith('/api/devices')) return { success: true, data: devices };
    if (o.url.endsWith('/api/devices/shelly/plug-1')) return { success: true, data: devices[0] };
    if (o.url.includes('/command')) return { success: true };
    if (o.url.endsWith('/api/automation/scenes')) return { success: true, data: [{ id: 's1', name: 'Evening' }] };
    if (o.url.endsWith('/run')) return { success: true };
    if (o.url.endsWith('/api/webhooks') && o.method === 'POST') return { success: true, data: { id: 'w1', secret: 's3cret-s3cret-s3cret', url: o.body.url } };
    if (o.url.endsWith('/api/webhooks')) return { success: true, data: [{ id: 'w1', url: 'http://n8n.local:5678/webhook/abc/webhook', enabled: true }] };
    if (o.method === 'DELETE') return { success: true };
    return { success: false, error: 'not found' };
  };
  const node = new Lsh();

  let ctx = n8nContext({ params: { deviceKey: 'shelly/plug-1' }, lsh });
  assert.deepEqual((await node.methods.loadOptions.getControls.call(ctx)).map((o) => o.value), ['on'], 'only controllable values to set');
  assert.equal((await node.methods.loadOptions.getDevices.call(ctx))[0].name, 'Kettle plug (Kitchen)');

  ctx = n8nContext({ params: { resource: 'device', operation: 'sendCommand', deviceKey: 'shelly/plug-1', sensor: 'on', value: 'true' }, lsh });
  let [out] = await node.execute.call(ctx);
  assert.deepEqual(ctx.calls[0], { method: 'POST', url: 'http://lsh.local:3000/api/device/shelly/plug-1/command', body: { sensor: 'on', value: true } }, 'typed value, trailing slash dropped');
  assert.equal(out[0].json.success, true);

  ctx = n8nContext({ params: { resource: 'device', operation: 'getValue', deviceKey: 'shelly/plug-1', sensor: 'power' }, lsh });
  [out] = await node.execute.call(ctx);
  assert.deepEqual([out[0].json.value, out[0].json.unit], [3, 'W']);

  ctx = n8nContext({ params: { resource: 'device', operation: 'getAll', simplify: true, filters: { room: 'kitchen' } }, lsh });
  [out] = await node.execute.call(ctx);
  assert.deepEqual(out[0].json, { key: 'shelly/plug-1', label: 'Kettle plug', room: 'Kitchen', type: null, icon: null, values: { on: false, power: 3 } });

  ctx = n8nContext({ params: { resource: 'scene', operation: 'run', sceneId: 's1' }, lsh });
  await node.execute.call(ctx);
  assert.equal(ctx.calls[0].url, 'http://lsh.local:3000/api/automation/scenes/s1/run');

  ctx = n8nContext({ params: { resource: 'device', operation: 'get', deviceKey: 'nope/x', simplify: true }, lsh });
  await assert.rejects(node.execute.call(ctx), /not found/);

  // trigger: activate → subscribe; deliveries → items; deactivate → unsubscribe
  const trig = new LshTrigger();
  const staticData = {};
  ctx = n8nContext({ params: { devices: ['shelly/plug-1'], sensors: 'power', patterns: '', options: { throttleSeconds: 5 } }, lsh, staticData });
  assert.equal(await trig.webhookMethods.default.checkExists.call(ctx), false);
  await trig.webhookMethods.default.create.call(ctx);
  assert.deepEqual(ctx.calls.at(-1).body, { name: 'n8n: Kettle alert', url: 'http://n8n.local:5678/webhook/abc/webhook', keys: ['shelly/plug-1/power'], throttleSeconds: 5 });
  assert.equal(staticData.webhookId, 'w1');
  assert.equal(await trig.webhookMethods.default.checkExists.call(ctx), true);

  const body = { event: 'change', hub: 'Home', changes: [{ key: 'shelly/plug-1/power', value: 1800, device: 'shelly/plug-1', sensor: 'power' }, { key: 'shelly/plug-1/on', value: true }] };
  const raw = JSON.stringify(body);
  ctx = n8nContext({ params: { output: 'each', options: {} }, lsh, staticData, body, rawBody: Buffer.from(raw), headers: { 'x-lsh-signature': WebhookHub.sign(staticData.secret, raw) } });
  let r = await trig.webhook.call(ctx);
  assert.equal(r.workflowData[0].length, 2);
  assert.equal(r.workflowData[0][0].json.value, 1800);
  assert.equal(r.workflowData[0][0].json.hub, 'Home');

  ctx = n8nContext({ params: { output: 'batch', options: { only: 'true' } }, lsh, staticData, body, rawBody: Buffer.from(raw), headers: { 'x-lsh-signature': WebhookHub.sign(staticData.secret, raw) } });
  r = await trig.webhook.call(ctx);
  assert.deepEqual(r.workflowData[0][0].json.changes.map((c) => c.key), ['shelly/plug-1/on']);

  ctx = n8nContext({ params: { output: 'each', options: {} }, lsh, staticData, body, rawBody: Buffer.from(raw), headers: { 'x-lsh-signature': 'sha256=forged' } });
  r = await trig.webhook.call(ctx);
  assert.equal(r.noWebhookResponse, true);
  assert.equal(ctx.res.code, 401, 'unsigned deliveries are refused');

  ctx = n8nContext({ params: {}, lsh, staticData });
  assert.equal(await trig.webhookMethods.default.delete.call(ctx), true);
  assert.equal(ctx.calls.at(-1).method, 'DELETE');
  assert.equal(staticData.webhookId, undefined);
});
