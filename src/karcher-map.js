'use strict';

/*
 * Kärcher Home Robots map: decrypt the cloud map file and render it to a PNG.
 *
 * Ported from the MIT-licensed python-karcher (utils.get_map_enc_key /
 * decrypt_map, karcher.get_map_data) — the file is base64 of AES-128-ECB
 * ciphertext whose plaintext is a hex string of a (usually zlib-deflated)
 * protobuf `RobotMap` message (python-karcher's mapdata.proto). Protobuf is
 * decoded by hand below rather than pulling in protobufjs for one message.
 *
 * Cell values seen on a real RCV3 (2026-10): 0 = unknown, 1 = scanned but
 * unreachable (lidar seen through doors/windows), 255 = wall/obstacle,
 * >= 10 = floor of the room with that roomId. Not documented upstream —
 * inferred from the data, so treat the colour mapping as best-effort.
 */

const crypto = require('crypto');
const zlib   = require('zlib');
const { encodePng } = require('./roborock-map');

// ── decryption ──────────────────────────────────────────────────────────────

function mapKey(sn, mac, productId) {
  const sub = String(mac).replace(/:/g, '').toLowerCase() + String(productId);
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(sub.slice(0, 16), 'utf8'), null);
  const enc = Buffer.concat([c.update(`${sn}+${productId}+${sn}`, 'utf8'), c.final()]).toString('base64');
  return Buffer.from(crypto.createHash('md5').update(enc, 'utf8').digest('hex').slice(8, 24), 'utf8');
}

function decryptMap(sn, mac, productId, body) {
  const d = crypto.createDecipheriv('aes-128-ecb', mapKey(sn, mac, productId), null);
  const hex = Buffer.concat([d.update(Buffer.from(body.toString('utf8'), 'base64')), d.final()]).toString('utf8');
  const raw = Buffer.from(hex, 'hex');
  try { return zlib.inflateSync(raw); } catch { return raw; }
}

// ── minimal protobuf reader ─────────────────────────────────────────────────

function fields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let r = 0, mul = 1, c;
    do { c = buf[i++]; r += (c & 0x7f) * mul; mul *= 128; } while (c & 0x80);
    return r;
  };
  while (i < buf.length) {
    const key = varint();
    const fn = Math.floor(key / 8), wt = key & 7;
    let v;
    if (wt === 0) v = varint();
    else if (wt === 2) { const len = varint(); v = buf.subarray(i, i + len); i += len; }
    else if (wt === 5) { v = buf.readFloatLE(i); i += 4; }
    else if (wt === 1) { v = buf.readDoubleLE(i); i += 8; }
    else throw new Error(`Unsupported protobuf wire type ${wt}`);
    out.push([fn, v]);
  }
  return out;
}
const msg = (buf) => (buf ? Object.fromEntries(fields(buf)) : {});
const repeated = (buf, fn) => fields(buf).filter(([n]) => n === fn).map(([, v]) => v);

// RobotMap field numbers (python-karcher mapdata.proto).
function parseMap(buf) {
  const top = msg(buf);
  const head = msg(top[3]);
  return {
    sizeX: head[2], sizeY: head[3], minX: head[4] || 0, minY: head[5] || 0, resolution: head[8] || 0.05,
    grid: top[4] ? msg(top[4])[1] || Buffer.alloc(0) : Buffer.alloc(0),
    charger: top[7] ? { x: msg(top[7])[1] || 0, y: msg(top[7])[2] || 0 } : null,
    robot: top[8] && msg(top[8])[3] !== undefined ? { x: msg(top[8])[3], y: msg(top[8])[4] || 0 } : null,
    path: top[6] ? repeated(top[6], 2).map((b) => { const p = msg(b); return { x: p[2] || 0, y: p[3] || 0 }; }) : [],
    rooms: repeated(buf, 12).map((b) => { const r = msg(b); return { id: r[1], name: r[2] ? r[2].toString('utf8') : '' }; }),
  };
}

// ── rendering ───────────────────────────────────────────────────────────────

const ROOM_COLORS = [
  [ 96, 165, 250], [ 52, 211, 153], [251, 191,  36], [244, 114, 182],
  [167, 139, 250], [ 45, 212, 191], [248, 113, 113], [163, 230,  53],
];
const WALL        = [148, 156, 170];
const UNREACHABLE = [ 52,  58,  74];

// Renders `m` (from parseMap) cropped to its content, `scale` px per cell,
// transparent background. `pose` (optional) overrides the robot position.
function renderMap(m, { scale = 3, pad = 8, pose = null } = {}) {
  const { sizeX: W, sizeY: H, grid } = m;
  if (!W || !H || grid.length < W * H) throw new Error('Map has no grid data');

  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!grid[y * W + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error('Map is empty');
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);

  const w = (x1 - x0 + 1) * scale, h = (y1 - y0 + 1) * scale;
  const out = Buffer.alloc(w * h * 4);
  const put = (px, py, c, a = 255) => {
    if (px < 0 || px >= w || py < 0 || py >= h) return;
    const i = (py * w + px) * 4;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = a;
  };

  // Grid row 0 is minY — flip vertically so +y points up in the image.
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    const v = grid[gy * W + gx];
    if (!v) continue;
    const c = v === 255 ? WALL : v === 1 ? UNREACHABLE : v >= 10 ? ROOM_COLORS[(v - 10) % ROOM_COLORS.length] : WALL;
    const ox = (gx - x0) * scale, oy = (y1 - gy) * scale;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(ox + dx, oy + dy, c);
  }

  const toPx = (p) => ({
    x: ((p.x - m.minX) / m.resolution - x0) * scale,
    y: (y1 - (p.y - m.minY) / m.resolution) * scale,
  });
  const disc = (p, r, c) => {
    if (!p) return;
    const { x, y } = toPx(p);
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r) put(Math.round(x + dx), Math.round(y + dy), c);
      else if (d2 <= (r + 1) * (r + 1)) put(Math.round(x + dx), Math.round(y + dy), [255, 255, 255]);
    }
  };

  // Cleaning path (history poses) as a thin white trail.
  for (let i = 1; i < m.path.length; i++) {
    const a = toPx(m.path[i - 1]), b = toPx(m.path[i]);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s <= steps; s++) {
      put(Math.round(a.x + (b.x - a.x) * s / steps), Math.round(a.y + (b.y - a.y) * s / steps), [255, 255, 255], 200);
    }
  }

  disc(m.charger, 2 * scale, [34, 197, 94]);
  disc(pose || m.robot, 2 * scale, [239, 68, 68]);

  return { buf: encodePng(w, h, out), w, h, rgba: out };
}

module.exports = { decryptMap, parseMap, renderMap };
