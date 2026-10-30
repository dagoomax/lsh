'use strict';

/*
 * Kärcher map → isometric "open-top cutaway" PNG (same look as the 3D floor
 * plan mock-up: wood floor, beige wall tops with a dark outline, interior
 * wall faces solid, outer wall faces ghosted so the rooms stay visible).
 *
 * Built from the raw cell grid (see karcher-map.js for the cell values), not
 * from the robot's own wall cells directly: those are 1–2 cells thick, broken
 * at every lidar gap and sprinkled with furniture legs. Instead the floor
 * (room cells, with small enclosed specks filled in) is taken as ground truth
 * and the walls are the band of `wallThickness` cells around it — a clean,
 * closed shell that follows the floor outline exactly.
 *
 * Painter's algorithm on the grid: cells are drawn back to front by view
 * depth, each wall cell as a column (its viewer-facing side faces + top).
 */

const { encodePng } = require('./roborock-map');

const WOOD       = [214, 186, 140];
const WALL_TOP   = [210, 201, 187];
const FACE_LEFT  = [200, 198, 192];   // faces pointing down-left on screen
const FACE_RIGHT = [226, 223, 218];   // faces pointing down-right on screen
const OUTLINE    = [88, 82, 74];
const GHOST      = [255, 255, 255];
const GHOST_LINE = [120, 120, 120];

function renderMap3D(m, {
  cell = 5, wallHeight = 3.4, wallThickness = 4, rotate = -29, elevation = 57,
  specks = 80, minRoom = 400, smooth = 2, pose = null,
} = {}) {
  const { sizeX: W, sizeY: H, grid } = m;
  if (!W || !H || grid.length < W * H) throw new Error('Map has no grid data');
  const res = m.resolution || 0.05;

  // ── 1. Floor mask in image orientation (u right, v down), cropped ──────
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y * W + x] < 10) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error('Map has no floor cells');
  const pad = wallThickness + 1;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const U = x1 - x0 + 1, V = y1 - y0 + 1;
  const at = (gx, gy) => (gx >= 0 && gx < W && gy >= 0 && gy < H ? grid[gy * W + gx] : 0);

  const floor = new Uint8Array(U * V);
  for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) {
    if (at(x0 + u, y1 - v) >= 10) floor[v * U + u] = 1;   // grid row 0 = minY → flip
  }

  // Fill small non-floor islands fully enclosed by floor (furniture legs,
  // lidar shadows) — anything touching the crop edge is outside, never filled.
  const seen = new Uint8Array(U * V);
  for (let i = 0; i < U * V; i++) {
    if (floor[i] || seen[i]) continue;
    const comp = [i]; seen[i] = 1;
    let edge = false;
    for (let k = 0; k < comp.length; k++) {
      const j = comp[k], u = j % U, v = (j / U) | 0;
      if (u === 0 || v === 0 || u === U - 1 || v === V - 1) edge = true;
      for (const n of [j - 1, j + 1, j - U, j + U]) {
        if (n < 0 || n >= U * V || seen[n] || floor[n]) continue;
        if ((n === j - 1 && u === 0) || (n === j + 1 && u === U - 1)) continue;
        seen[n] = 1; comp.push(n);
      }
    }
    if (!edge && comp.length <= specks) for (const j of comp) floor[j] = 1;
  }

  // Square-kernel erode/dilate (chessboard radius r).
  const morph = (src, r, dilate) => {
    const dst = new Uint8Array(U * V);
    for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) {
      let hit = !dilate;
      for (let dv = -r; dv <= r && hit !== dilate; dv++) for (let du = -r; du <= r; du++) {
        const uu = u + du, vv = v + dv;
        const on = uu >= 0 && uu < U && vv >= 0 && vv < V && src[vv * U + uu];
        if (dilate ? on : !on) { hit = dilate; break; }
      }
      dst[v * U + u] = hit ? 1 : 0;
    }
    return dst;
  };
  // Close then open: straightens the robot's ragged edges and drops
  // one-cell slivers along walls without moving the outline.
  if (smooth > 0) {
    const closed = morph(morph(floor, smooth, true), smooth, false);
    const opened = morph(morph(closed, smooth, false), smooth, true);
    floor.set(opened);
  }

  // Drop floor islands smaller than minRoom cells (lidar specks outdoors).
  const lab = new Uint8Array(U * V);
  for (let i = 0; i < U * V; i++) {
    if (!floor[i] || lab[i]) continue;
    const comp = [i]; lab[i] = 1;
    for (let k = 0; k < comp.length; k++) {
      const j = comp[k], u = j % U;
      for (const n of [j - 1, j + 1, j - U, j + U]) {
        if (n < 0 || n >= U * V || lab[n] || !floor[n]) continue;
        if ((n === j - 1 && u === 0) || (n === j + 1 && u === U - 1)) continue;
        lab[n] = 1; comp.push(n);
      }
    }
    if (comp.length < minRoom) for (const j of comp) floor[j] = 0;
  }

  // Walls: non-floor cells within wallThickness (chessboard distance) of floor.
  const wall = new Uint8Array(U * V);
  for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) {
    if (floor[v * U + u]) continue;
    search: for (let dv = -wallThickness; dv <= wallThickness; dv++) {
      for (let du = -wallThickness; du <= wallThickness; du++) {
        const uu = u + du, vv = v + dv;
        if (uu >= 0 && uu < U && vv >= 0 && vv < V && floor[vv * U + uu]) { wall[v * U + u] = 1; break search; }
      }
    }
  }

  // ── 2. Projection ──────────────────────────────────────────────────────
  // Plan rotated by `rotate` degrees, viewed from `elevation` degrees up:
  // screen x = x·cosθ − y·sinθ,  screen y = (x·sinθ + y·cosθ)·sin(e) − z·cos(e).
  // Defaults match the reference render (long axis running steeply down-right).
  const th = (rotate * Math.PI) / 180, el = (elevation * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th), ks = Math.sin(el), kz = Math.cos(el);
  const hPx = (wallHeight / res) * cell * kz;
  const proj = (x, y, z = 0) => [(x * ct - y * st) * cell, (x * st + y * ct) * ks * cell - z];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of [[0, 0], [U, 0], [0, V], [U, V]]) {
    for (const z of [0, hPx]) {
      const [px, py] = proj(x, y, z);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  }
  const w = Math.ceil(maxX - minX) + 4, h = Math.ceil(maxY - minY) + 4;
  const P = (x, y, z = 0) => { const [px, py] = proj(x, y, z); return [px - minX + 2, py - minY + 2]; };

  const kind = (u, v) => {   // 0 empty, 1 floor, 2 wall
    if (u < 0 || u >= U || v < 0 || v >= V) return 0;
    const i = v * U + u;
    return wall[i] ? 2 : floor[i] ? 1 : 0;
  };

  // ── 3. Raster helpers ──────────────────────────────────────────────────
  const out = Buffer.alloc(w * h * 4);
  const blend = (x, y, c, alpha) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4, a = alpha / 255, ia = out[i + 3] / 255;
    const oa = a + ia * (1 - a);
    if (oa <= 0) return;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round((c[k] * a + out[i + k] * ia * (1 - a)) / oa);
    out[i + 3] = Math.round(oa * 255);
  };
  // Convex polygon fill, pixel-centre sampling.
  const fill = (pts, c, alpha = 255) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(h - 1, Math.ceil(maxY)); y++) {
      for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(w - 1, Math.ceil(maxX)); x++) {
        const px = x + 0.5, py = y + 0.5;
        let inside = true, sign = 0;
        for (let k = 0; k < pts.length; k++) {
          const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % pts.length];
          const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
          if (cr === 0) continue;
          const s = cr > 0 ? 1 : -1;
          if (!sign) sign = s; else if (s !== sign) { inside = false; break; }
        }
        if (inside) blend(x, y, c, alpha);
      }
    }
  };
  const line = (p, q, c, alpha = 255, width = 1.6) => {
    const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 2) || 1;
    const r = width / 2;
    for (let s = 0; s <= steps; s++) {
      const x = p[0] + (q[0] - p[0]) * s / steps, y = p[1] + (q[1] - p[1]) * s / steps;
      for (let dy = Math.floor(y - r); dy <= Math.ceil(y + r); dy++) {
        for (let dx = Math.floor(x - r); dx <= Math.ceil(x + r); dx++) {
          if (Math.hypot(dx + 0.5 - x, dy + 0.5 - y) <= r) blend(dx, dy, c, alpha);
        }
      }
    }
  };
  const shade = (c, f) => c.map((x) => Math.max(0, Math.min(255, Math.round(x * f))));
  const hash = (x, y) => { let n = (x * 374761393 + y * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

  // Wood planks: ~15 cm boards along v, staggered ~1.2 m lengths along u.
  const plankW = Math.max(2, Math.round(0.15 / res)), plankL = Math.max(8, Math.round(1.2 / res));
  const woodAt = (u, v) => {
    const row = Math.floor(v / plankW);
    const board = Math.floor((u + hash(row, 7) * plankL) / plankL);
    let f = 0.94 + hash(row, board) * 0.1;
    if (v % plankW === 0) f -= 0.05;                                   // plank seam
    for (const [du, dv] of [[-1, 0], [1, 0], [0, -1], [0, -2]]) {      // soft contact shadow
      if (kind(u + du, v + dv) === 2) { f -= 0.1; break; }
    }
    return shade(WOOD, f);
  };

  // Side faces: [outward normal, edge corners, run direction]. A face is drawn
  // only if it points toward the viewer (normal · view-depth direction > 0).
  const FACES = [
    { n: [0, 1],  e: [[0, 1], [1, 1]], r: [1, 0] },   // south
    { n: [0, -1], e: [[0, 0], [1, 0]], r: [1, 0] },   // north
    { n: [1, 0],  e: [[1, 0], [1, 1]], r: [0, 1] },   // east
    { n: [-1, 0], e: [[0, 0], [0, 1]], r: [0, 1] },   // west
  ].filter((f) => f.n[0] * st + f.n[1] * ct > 1e-6)
   .map((f) => ({ ...f, c: f.n[0] * ct - f.n[1] * st > 0 ? FACE_RIGHT : FACE_LEFT }));

  // ── 4. Draw, back to front (by view depth of the cell centre) ──────────
  const order = [];
  for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) if (floor[v * U + u] || wall[v * U + u]) order.push(v * U + u);
  const depth = (i) => ((i % U) + 0.5) * st + (((i / U) | 0) + 0.5) * ct;
  order.sort((p, q) => depth(p) - depth(q));

  for (const i of order) {
    const u = i % U, v = (i / U) | 0, k = kind(u, v);
    if (k === 1) {
      fill([P(u, v), P(u + 1, v), P(u + 1, v + 1), P(u, v + 1)], woodAt(u, v));
      continue;
    }
    for (const f of FACES) {
      const nk = kind(u + f.n[0], v + f.n[1]);
      if (nk === 2) continue;                         // hidden behind the next wall cell
      const p0 = P(u + f.e[0][0], v + f.e[0][1]), p1 = P(u + f.e[1][0], v + f.e[1][1]);
      const quad = [p0, p1, [p1[0], p1[1] - hPx], [p0[0], p0[1] - hPx]];
      if (nk === 1) {
        fill(quad, f.c);                              // interior face, seen from the room
      } else {
        fill(quad, GHOST, 70);                        // outer face, ghosted
        line(p0, p1, GHOST_LINE, 110, 1);
        // vertical edges only where this face's run ends — no per-cell hatching
        const continues = (du, dv) => kind(u + du, v + dv) === 2 && kind(u + du + f.n[0], v + dv + f.n[1]) !== 2;
        if (!continues(-f.r[0], -f.r[1])) line(p0, [p0[0], p0[1] - hPx], GHOST_LINE, 110, 1);
        if (!continues(f.r[0], f.r[1]))   line(p1, [p1[0], p1[1] - hPx], GHOST_LINE, 110, 1);
      }
    }

    // Top cap + dark outline on edges not shared with another wall cell.
    const t = [P(u, v, hPx), P(u + 1, v, hPx), P(u + 1, v + 1, hPx), P(u, v + 1, hPx)];
    fill(t, WALL_TOP);
    if (kind(u, v - 1) !== 2) line(t[0], t[1], OUTLINE);
    if (kind(u + 1, v) !== 2) line(t[1], t[2], OUTLINE);
    if (kind(u, v + 1) !== 2) line(t[2], t[3], OUTLINE);
    if (kind(u - 1, v) !== 2) line(t[3], t[0], OUTLINE);
  }

  // ── 5. Charger + robot, on the floor ───────────────────────────────────
  const marker = (p, c) => {
    if (!p) return;
    const [x, y] = P((p.x - m.minX) / res - x0, y1 - (p.y - m.minY) / res);
    const r = Math.max(5, cell * 2.2);
    fill(Array.from({ length: 20 }, (_, i) => [x + Math.cos(i * Math.PI / 10) * (r + 2), y + Math.sin(i * Math.PI / 10) * (r + 2) * 0.6]), [255, 255, 255]);
    fill(Array.from({ length: 20 }, (_, i) => [x + Math.cos(i * Math.PI / 10) * r, y + Math.sin(i * Math.PI / 10) * r * 0.6]), c);
  };
  marker(m.charger, [34, 197, 94]);
  marker(pose || m.robot, [239, 68, 68]);

  return { buf: encodePng(w, h, out), w, h };
}

module.exports = { renderMap3D };
