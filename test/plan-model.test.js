'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

// The route keeps its files in persist/plan-model and its state in config.json — both replaced here
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-plan-model-'));
process.env.LSH_PLAN_MODEL_DIR = DIR;
let CONFIG = {};
const helpers = require('../src/routes/helpers');
helpers.readConfigFile = () => JSON.parse(JSON.stringify(CONFIG));
helpers.editPinOk = () => true;
require('../src/config-file-cache').writeConfigFile = (c) => { CONFIG = JSON.parse(JSON.stringify(c)); };

const app = express(); app.use(express.json({ limit: '5mb' }));
const router = express.Router();
require('../src/routes/plan-model')(router);
require('../src/routes/ev-charging')(router, { requireAdmin: (req, res, next) => next(), sensorRegistry: { getDevices: () => [] } }); // home of /settings/home-plan
app.use('/api', router);
const server = http.createServer(app).listen(0);
after(() => { server.close(); fs.rmSync(DIR, { recursive: true, force: true }); });
const call = async (method, url, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`,
    { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, type, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const uri = (buf) => `data:application/octet-stream;base64,${buf.toString('base64')}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest-of-a-picture')]);

test('a .png is accepted as a picture model and served back', async () => {
  const up = await call('POST', '/plan-model/upload', { name: 'Home Render.PNG', data: uri(PNG) });
  assert.equal(up.status, 200);
  assert.equal(up.body.model.format, 'png');
  assert.equal(up.body.model.image, true);
  assert.match(up.body.model.url, /^\/api\/plan-model\/file\/floorplan-[a-z0-9]+\.png$/);
  assert.deepEqual(CONFIG.homePlan.model, up.body.model);
  const file = await call('GET', up.body.model.url.replace('/api', ''));
  assert.equal(file.status, 200);
  assert.match(file.type, /image\/png/);
  assert.ok(file.body.equals(PNG));
});

test('a file that only carries a picture extension is refused', async () => {
  const before = CONFIG.homePlan.model.url;
  for (const name of ['fake.png', 'fake.jpg', 'fake.webp']) {
    const r = await call('POST', '/plan-model/upload', { name, data: uri(Buffer.from('<script>alert(1)</script>')) });
    assert.equal(r.status, 400, name);
  }
  assert.equal((await call('POST', '/plan-model/upload', { name: 'plan.svg', data: uri(PNG) })).status, 400);
  assert.equal(CONFIG.homePlan.model.url, before); // the model that was there is untouched
  assert.equal(fs.readdirSync(DIR).length, 1);
});

test('pins are saved as fractions, merged, and removed with null', async () => {
  let r = await call('POST', '/plan-model/pins', { pins: { 'shelly/a': { x: 0.25, y: 0.5 }, 'hue/b': { x: 0.123456, y: 1 } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.model.pins, { 'shelly/a': { x: 0.25, y: 0.5 }, 'hue/b': { x: 0.1235, y: 1 } });
  r = await call('POST', '/plan-model/pins', { pins: { 'shelly/a': null, 'knx/c': { x: 0, y: 0 }, bad: { x: 1.2, y: 0.5 }, worse: { x: 'left', y: 0.5 }, none: {} } });
  assert.deepEqual(r.body.model.pins, { 'hue/b': { x: 0.1235, y: 1 }, 'knx/c': { x: 0, y: 0 } });
  assert.equal((await call('POST', '/plan-model/pins', { pins: [] })).status, 400);
  assert.equal((await call('POST', '/plan-model/pins', {})).status, 400);
});

test('the box view and pins each belong to their own kind of model', async () => {
  assert.equal((await call('GET', '/plan-model/boxes')).status, 400); // a picture has no boxes
  // a new upload replaces the model, and with it the old pins
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jfif')]);
  const up = await call('POST', '/plan-model/upload', { name: 'photo.jpeg', data: uri(jpg) });
  assert.equal(up.body.model.format, 'jpeg');
  assert.equal(up.body.model.pins, undefined);
  assert.deepEqual(fs.readdirSync(DIR), [up.body.model.url.split('/').pop()]);
  // a 3D model takes no pins
  CONFIG.homePlan.model = { url: '/api/plan-model/file/floorplan-abc.glb', format: 'glb', name: 'home.glb' };
  assert.equal((await call('POST', '/plan-model/pins', { pins: { a: { x: 0.5, y: 0.5 } } })).status, 400);
  await call('POST', '/plan-model/remove', {});
  assert.equal(CONFIG.homePlan.model, undefined);
  assert.equal((await call('POST', '/plan-model/pins', { pins: {} })).status, 400);
});

test('saving the plan in Settings keeps the imported model and its pins', async () => {
  const up = await call('POST', '/plan-model/upload', { name: 'home.png', data: uri(PNG) });
  await call('POST', '/plan-model/pins', { pins: { 'shelly/a': { x: 0.4, y: 0.6 } } });
  const r = await call('POST', '/settings/home-plan', { rooms: [{ name: 'Salon', x: 0, y: 0, w: 3, d: 3 }], singleFloor: true });
  assert.equal(r.status, 200);
  assert.equal(CONFIG.homePlan.rooms.length, 1);
  assert.equal(CONFIG.homePlan.model.url, up.body.model.url);
  assert.deepEqual(CONFIG.homePlan.model.pins, { 'shelly/a': { x: 0.4, y: 0.6 } });
  await call('POST', '/plan-model/remove', {});
  await call('POST', '/settings/home-plan', { rooms: [] });
  assert.equal('model' in CONFIG.homePlan, false);
});
