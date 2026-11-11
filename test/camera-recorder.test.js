'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const EventEmitter = require('events');
const CameraRecorder = require('../src/camera-recorder');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function store() {
  const s = new EventEmitter(); s.data = {};
  s.set = (key, value) => { s.data[key] = value; s.emit('change', { key, value }); };
  s.get = (k) => s.data[k];
  return s;
}

test('records while motion lasts, then postSeconds; lists, serves and deletes the clip', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-rec-'));
  // a 60 s test video stands in for the camera's stream
  const src = path.join(dir, 'src.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', src]);
  const s = store();
  const rec = new CameraRecorder({ recordingsDir: path.join(dir, 'rec'), cameras: [{ name: 'Wejście', url: src, record: { postSeconds: 1 } }] }, s, null);
  rec.start();
  assert.deepEqual(rec.cameras().map((c) => [c.slug, c.days, c.maxMB]), [['wej-cie', 7, 2000]]);

  s.set('objectdetect/wej-cie/any/detected', 1);
  await wait(1500);
  assert.equal(s.get('recorder/wej-cie/recording'), 1);
  s.set('objectdetect/wej-cie/any/detected', 0);
  for (let i = 0; i < 40 && s.get('recorder/wej-cie/recording') !== 0; i++) await wait(250);
  await wait(1500); // thumbnail

  const [day] = rec.days('wej-cie');
  const [clip] = rec.clips('wej-cie', day);
  assert.equal(clip.trigger, 'motion');
  assert.ok(clip.seconds >= 2, `clip lasted ${clip.seconds} s`);
  assert.ok(clip.size > 2048);
  assert.ok(clip.thumb, 'thumbnail made');
  assert.equal(s.get('recorder/wej-cie/clips'), 1);
  const f = rec.file('wej-cie', day, `${clip.id}.mp4`);
  assert.match(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f]).toString(), /h264[\s\S]*aac/);

  assert.equal(rec.file('wej-cie', day, '../../src.mp4'), null, 'no path escapes');
  assert.equal(rec.file('wej-cie', '..', `${clip.id}.mp4`), null);
  rec.remove('wej-cie', day, clip.id);
  assert.equal(rec.clips('wej-cie', day).length, 0);
  rec.stop();
});

test('prunes days past the limit and the oldest clips over maxMB', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-rec-'));
  const s = store();
  const rec = new CameraRecorder({ recordingsDir: dir, cameras: [{ name: 'Cam', url: 'rtsp://x/y', record: { days: 2, maxMB: 50 } }] }, s, null);
  const day = (n) => { const d = new Date(Date.now() - n * 86400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const put = (n, id, mb) => { const d = path.join(dir, 'cam', day(n)); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${id}.mp4`), Buffer.alloc(mb * 1e6)); fs.writeFileSync(path.join(d, `${id}.json`), '{}'); };
  put(5, '100000', 1); put(1, '080000', 30); put(0, '090000', 30);
  rec._prune();
  assert.deepEqual(rec.days('cam'), [day(0)], 'old day gone, older clip over the size limit gone');
  assert.deepEqual(rec.clips('cam', day(0)).map((c) => c.id), ['090000']);
  assert.equal(s.get('recorder/cam/clips'), 1);
});

test('motion during a fixed-length manual clip does not cancel its stop', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-rec-'));
  const src = path.join(dir, 'src.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', src]);
  const s = store();
  const rec = new CameraRecorder({ recordingsDir: path.join(dir, 'rec'), cameras: [{ name: 'Gate', url: src, record: { postSeconds: 1 } }] }, s, null);
  rec.start();
  rec.trigger('gate', 'manual', 2);
  await wait(500);
  s.set('objectdetect/gate/any/detected', 1); // motion starts and stays on
  for (let i = 0; i < 32 && s.get('recorder/gate/recording') !== 0; i++) await wait(250);
  assert.equal(s.get('recorder/gate/recording'), 0, 'the manual clip ended on its own timer');
  rec.stop();
});
