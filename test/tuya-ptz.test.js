'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ptz, hasZoom } = require('../src/tuya-cloud-ptz');

// a tuya-ipc-terminal session folder with one user_*.json
function sessionDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-tuya-'));
  fs.writeFileSync(path.join(dir, 'user_eu-central_x.json'), JSON.stringify({
    sessionData: { serverHost: 'protect-eu.example', cookies: [{ name: 'a', value: '1' }, { name: 'b', value: '2' }] },
  }));
  return dir;
}

function stubFetch(reply = { success: true, result: true }) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { status: 200, json: async () => reply }; };
  return { calls, restore: () => { global.fetch = orig; } };
}

test('smartlife PTZ: start with the direction word, end on stop, session cookies', async () => {
  const cfg = { deviceId: 'dev1', via: 'smartlife', session: sessionDir() };
  const f = stubFetch();
  try {
    await ptz(undefined, cfg, 'right');
    await ptz(undefined, cfg, 'stop');
  } finally { f.restore(); }
  assert.equal(f.calls[0].url, 'https://protect-eu.example/api/jarvis/ptz/start');
  assert.deepEqual(f.calls[0].body, { devId: 'dev1', direction: 'right' });
  assert.equal(f.calls[0].opts.headers.Cookie, 'a=1; b=2');
  assert.equal(f.calls[1].url, 'https://protect-eu.example/api/jarvis/ptz/end');
  assert.deepEqual(f.calls[1].body, { devId: 'dev1' });
});

test('smartlife PTZ: no zoom, errors carry the portal message', async () => {
  const cfg = { deviceId: 'dev1', via: 'smartlife', session: sessionDir() };
  assert.equal(hasZoom(cfg), false);
  assert.equal(hasZoom({ deviceId: 'x' }), true);
  await assert.rejects(ptz(undefined, cfg, 'zoomin'), /no zoom/);
  const f = stubFetch({ success: false, errorMsg: 'Not login' });
  try { await assert.rejects(ptz(undefined, cfg, 'up'), /Smart Life PTZ: Not login/); } finally { f.restore(); }
});
