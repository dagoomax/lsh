'use strict';

// Cover art / station logo as a square JPEG, for Loxone (Intercom / Camera
// block image URL, Webpage block) and wall displays:
//   GET /api/loxone/cover/<device key>.jpg  (src/routes/loxone-xml.js)
// The image is whatever the device's `cover` reading points at — Spotify's album
// art, a station's logo — fetched once, converted by ffmpeg (PNG, ICO, WebP,
// JPEG… → 400×400 JPEG, letterboxed on a dark square) and cached. Nothing to
// show → a plain dark square, so the Loxone block never shows a broken image.

const { spawn } = require('child_process');

const SIZE = 400;
const MAX_BYTES = 5 * 1024 * 1024;
const CACHE_MAX = 60;
const cache = new Map(); // source url → Promise<Buffer>
let placeholder = null;

function ffmpegJpeg(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', ...args, '-frames:v', '1', '-q:v', '3', '-f', 'mjpeg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), 10000);
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => err.push(c));
    p.on('error', (e) => { clearTimeout(timer); reject(e) });
    p.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (code === 0 && buf.length) resolve(buf);
      else reject(new Error(Buffer.concat(err).toString().trim().split('\n').pop() || `ffmpeg exited ${code}`));
    });
    p.stdin.on('error', () => {});
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

const FIT = `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x1c1c22,format=yuvj420p`;

async function fromUrl(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'LSH/1.0' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (type && !/^image\/|octet-stream/.test(type)) throw new Error(`not an image (${type})`);
  if (/svg/.test(type) || /\.svg(\?|$)/i.test(url)) throw new Error('SVG logos can’t be converted');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('image too large');
  // small logos (favicons) are upscaled smoothly; a few pixels of padding keep them off the edges
  return ffmpegJpeg(['-i', 'pipe:0', '-vf', FIT], buf);
}

function placeholderJpeg() {
  placeholder ||= ffmpegJpeg(['-f', 'lavfi', '-i', `color=c=0x1c1c22:s=${SIZE}x${SIZE}`]).catch((e) => { placeholder = null; throw e });
  return placeholder;
}

// → Promise<Buffer> (JPEG); never rejects for a bad source — falls back to the placeholder
async function coverJpeg(url) {
  if (!/^https?:\/\/\S+$/i.test(String(url || ''))) return placeholderJpeg();
  if (!cache.has(url)) {
    const p = fromUrl(url).catch((err) => { console.warn(`[Cover] ${url}: ${err.message}`); cache.delete(url); return null });
    cache.set(url, p);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return (await cache.get(url)) || placeholderJpeg();
}

module.exports = { coverJpeg, SIZE };
