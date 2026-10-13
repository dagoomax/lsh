'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const express = require('express');
const hasFfmpeg = spawnSync('which', ['ffmpeg']).status === 0;

test('paging to AirPlay speakers: recording + chime played on one, several or all speakers', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const played = [];
  const airplayClient = {
    getSpeakers: () => [{ id: 'kitchen', name: 'Kitchen' }, { id: 'tv', name: 'Salon TV' }],
    async play(id, file) {
      const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
      played.push({ id, dur });
      if (id === 'tv') throw new Error('"Salon TV" asks for a PIN');
    },
  };
  const app = express();
  const router = express.Router();
  require('../src/routes/airplay')(router, { airplayClient, requireAdmin: (req, res, next) => next() });
  app.use('/api', router);
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/airplay/page`;
  // A 1-second "voice message" in the browser's format (webm/opus)
  const rec = path.join(os.tmpdir(), 'lsh-page-test.webm');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-c:a', 'libopus', rec]);
  const body = fs.readFileSync(rec);
  const post = (q) => fetch(`${base}?${q}`, { method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus' }, body }).then(async (r) => [r.status, await r.json()]);
  try {
    let [code, j] = await post('to=kitchen');
    assert.equal(code, 200); assert.deepEqual(j.data, { kitchen: 'ok' });
    assert.ok(played[0].dur > 1.6, `chime + message + tail, got ${played[0].dur}s`);
    [code, j] = await post('to=kitchen&chime=0');
    assert.ok(played[1].dur < 1.2);
    [code, j] = await post('to=all');
    assert.equal(code, 200);
    assert.equal(j.data.kitchen, 'ok'); assert.match(j.data.tv, /PIN/);
    [code, j] = await post('to=tv');
    assert.equal(code, 502); assert.match(j.error, /PIN/);
    [code, j] = await post('to=nope');
    assert.equal(code, 400);
    const [c2] = await fetch(`${base}?to=kitchen`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('not audio') }).then(async (r) => [r.status]);
    assert.equal(c2, 502);
  } finally { srv.close() }
});
