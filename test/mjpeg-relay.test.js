'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { execSync } = require('child_process');
const MjpegRelay = require('../src/mjpeg-relay');

const hasFfmpeg = (() => { try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true } catch { return false } })();
// a live-paced test pattern instead of an RTSP camera
const SOURCE = ['-re', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10'];

test('MJPEG relay: frame splitting', () => {
  const { takeFrames } = MjpegRelay._test;
  const a = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const b = Buffer.from([0xff, 0xd8, 3]);
  const { frames, rest } = takeFrames(Buffer.concat([Buffer.from([9]), a, b]));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], a);
  assert.deepEqual(rest, b, 'incomplete frame kept for the next chunk');
});

test('MJPEG relay: one shared ffmpeg, multipart frames, stops after the last viewer', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const relay = new MjpegRelay({ idleMs: 200 });
  const server = http.createServer((req, res) => relay.serve('cam', SOURCE, { fps: 5, width: 160 }, req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const read = () => new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let buf = Buffer.alloc(0);
      res.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        const parts = buf.toString('latin1').split('--lshframe').length - 1;
        if (parts >= 2) { res.destroy(); resolve({ type: res.headers['content-type'], buf }) }
      });
    }).on('error', reject);
  });
  try {
    const [a, b] = await Promise.all([read(), read()]);
    assert.equal(a.type, 'multipart/x-mixed-replace; boundary=lshframe');
    assert.match(a.buf.toString('latin1'), /Content-Type: image\/jpeg\r\nContent-Length: \d+\r\n\r\n\xff\xd8/);
    assert.ok(b.buf.length > 0);
    assert.equal(relay.streams.size, 1, 'both viewers share one ffmpeg');

    const jpeg = await relay.frame('cam', SOURCE, { fps: 5, width: 160 });
    assert.equal(jpeg[0], 0xff); assert.equal(jpeg[1], 0xd8);

    const proc = [...relay.streams.values()][0].proc;
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(relay.streams.size, 0, 'stream dropped once nobody watches');
    assert.ok(proc.killed || proc.exitCode !== null, 'ffmpeg stopped');
  } finally {
    relay.stop();
    server.close();
  }
});
