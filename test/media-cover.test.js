'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawnSync } = require('child_process');
const { coverJpeg, SIZE } = require('../src/media-cover');
const { splitSong } = require('../src/radio-devices');

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const jpegSize = (b) => { // width/height from the SOF0 marker
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
};

test('station song split into artist and title', () => {
  assert.deepEqual(splitSong('Tove Lo - Talking Body'), ['Tove Lo', 'Talking Body']);
  assert.deepEqual(splitSong('Zalia – Tylko kochaj mnie'), ['Zalia', 'Tylko kochaj mnie']);
  assert.deepEqual(splitSong('RMF FM'), ['', 'RMF FM']);
  assert.deepEqual(splitSong(''), ['', '']);
});

test('cover art: any image → square JPEG; nothing / broken → placeholder', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  // a 64×32 PNG made by ffmpeg, served like a station's logo
  const png = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x32', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']).stdout;
  const srv = http.createServer((req, res) => {
    if (req.url === '/logo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png) }
    if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>') }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const logo = await coverJpeg(`${base}/logo.png`);
    assert.equal(logo[0], 0xff); assert.equal(logo[1], 0xd8);
    assert.deepEqual(jpegSize(logo), [SIZE, SIZE]);
    const none = await coverJpeg('');
    assert.deepEqual(jpegSize(none), [SIZE, SIZE]);
    const broken = await coverJpeg(`${base}/missing.png`);
    assert.deepEqual(broken, none, 'a broken source gives the placeholder');
    assert.deepEqual(await coverJpeg(`${base}/page`), none, 'not an image → placeholder');
  } finally { srv.close() }
});

test('station titles that are ad-break markers are not songs', () => {
  const { NOT_A_SONG } = require('../src/routes/media');
  for (const t of ['STOP_AD_BREAK', 'START_AD_BREAK', 'Advert', 'Reklama', '-', '']) assert.ok(NOT_A_SONG.test(t), t);
  for (const t of ['Tove Lo - Talking Body', 'ABBA - SOS', 'AC/DC - Thunderstruck', 'RMF FM']) assert.ok(!NOT_A_SONG.test(t), t);
});
