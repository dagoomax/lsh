#!/usr/bin/env node
'use strict';

/*
 * Fetch the current map from a Roborock device (via the cached cloud session)
 * and render it to a PNG.
 *
 *   node scripts/roborock-get-map.js [duid] [outfile.png]
 *
 * Defaults to the first device on the account and public/roborock-map.png.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const RC   = require('../src/roborock-cloud-client');

const DUID = process.argv[2] || null;
const OUT  = process.argv[3] || path.join(__dirname, '..', 'public', 'roborock-map.png');

// ── minimal truecolor+alpha PNG encoder ──────────────────────────────────────
function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const tb  = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([tb, data])) >>> 0, 0);
    return Buffer.concat([len, tb, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Distinct colors per segment id.
const PALETTE = [
  [ 96, 165, 250], [ 52, 211, 153], [251, 191,  36], [244, 114, 182],
  [167, 139, 250], [ 45, 212, 191], [248, 113, 113], [163, 230,  53],
  [ 56, 189, 248], [251, 146,  60], [129, 140, 248], [ 34, 197,  94],
];

function renderMap(raw) {
  if (raw.slice(0, 2).toString() !== 'rr') throw new Error('Not a Roborock map blob');
  let off = raw.readUInt16LE(2);
  let img = null, charger = null, robot = null;
  while (off + 6 <= raw.length) {
    const type = raw.readUInt16LE(off), hlen = raw.readUInt16LE(off + 2), blen = raw.readUInt32LE(off + 4);
    const dataAt = off + hlen;
    if (type === 2) {  // IMAGE
      img = {
        top:  raw.readUInt32LE(off + 12),
        left: raw.readUInt32LE(off + 16),
        h:    raw.readUInt32LE(off + 20),
        w:    raw.readUInt32LE(off + 24),
        px:   raw.slice(dataAt, dataAt + blen),
      };
    } else if (type === 1 && blen >= 8) {  // CHARGER
      charger = { x: raw.readInt32LE(dataAt), y: raw.readInt32LE(dataAt + 4) };
    } else if (type === 8 && blen >= 8) {  // ROBOT_POSITION
      robot = { x: raw.readInt32LE(dataAt), y: raw.readInt32LE(dataAt + 4) };
    }
    if (type === 0) break;
    off = dataAt + blen;
  }
  if (!img) throw new Error('No IMAGE block in map');

  const { w, h, top, left, px } = img;
  const out = Buffer.alloc(w * h * 4); // RGBA, will vertically flip on write
  const put = (x, yTop, r, g, b, a = 255) => {
    if (x < 0 || x >= w || yTop < 0 || yTop >= h) return;
    const i = (yTop * w + x) * 4;
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = px[y * w + x];
      const fly = h - 1 - y;                 // flip vertically for display
      if (v === 0) { put(x, fly, 0, 0, 0, 0); continue; }        // outside → transparent
      if ((v & 0x07) === 1) { put(x, fly, 52, 58, 74); continue; } // wall → dark slate
      const seg = v >> 3;
      const c = PALETTE[seg % PALETTE.length];
      put(x, fly, c[0], c[1], c[2]);          // floor → segment color
    }
  }

  // Overlay charger (green) and robot (red). Roborock uses 50 mm per pixel.
  const disc = (mm, cr, cg, cb) => {
    if (!mm) return;
    const cx = Math.round(mm.x / 50) - left;
    const cy = h - 1 - (Math.round(mm.y / 50) - top);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++)
      if (dx * dx + dy * dy <= 16) put(cx + dx, cy + dy, cr, cg, cb);
  };
  disc(charger, 34, 197, 94);
  disc(robot, 239, 68, 68);

  return { buf: png(w, h, out), w, h, segments: img, charger, robot };
}

(async () => {
  const store = { update: () => {} }, registry = { registerDevice: () => {} };
  const cfg = { roborock: { cloud: { email: process.env.ROBOROCK_EMAIL || undefined, duid: DUID || undefined } } };
  const c = new RC(cfg, store, registry);
  await c.start();
  const dev = DUID ? c._devs.find(d => d.duid === DUID) : c._devs[0];
  if (!dev) { c.stop(); throw new Error(`Device ${DUID} not found`); }
  console.log(`Fetching map for ${dev.name} (${dev.duid})…`);
  const raw = await c.fetchMap(dev);
  c.stop();

  const { buf, w, h, charger, robot } = renderMap(raw);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(`✓ Map ${w}×${h} rendered → ${OUT} (${buf.length} bytes)`);
  if (charger) console.log(`   charger @ ${charger.x},${charger.y} mm`);
  if (robot)   console.log(`   robot   @ ${robot.x},${robot.y} mm`);
  process.exit(0);
})().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
