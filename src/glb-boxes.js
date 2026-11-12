'use strict';

// Reduces a GLB floor-plan model to a list of boxes for the HTML/CSS view of
// the Plan (PlanHtmlModel.jsx): one box per mesh node — its footprint on the
// ground, base height, height, yaw and material colour. No geometry is
// decoded: each primitive's POSITION accessor already carries min/max, so
// only the JSON chunk is read. A mesh that is not a box (cylinder, sphere,
// lathe) comes out as its bounding box, flagged `round` when the footprint is
// near square.
//
// Coordinates follow the plan board: x → right, y → down (the model's +Z),
// z → up (the model's +Y), in the model's units, origin at the footprint's
// north-west corner on the ground.

const mul = (a, b) => { // column-major 4×4, a·b
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
};
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const trs = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
    (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
    (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const rotX = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const rotY = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const hex = (c) => '#' + c.slice(0, 3).map((v) => {
  // glTF colours are linear — the browser wants sRGB
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255).toString(16).padStart(2, '0');
}).join('');
const r3 = (v) => Math.round(v * 1000) / 1000;

function readGltf(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
  const len = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB has no JSON chunk');
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
}

// → { w, d, h, boxes: [{ n, x, y, w, d, z, h, r?, c, o?, m, round? }] }
//   x/y = centre of the footprint, w/d = its size before the yaw `r` (degrees,
//   clockwise seen from above), z = base height, h = height, c = colour,
//   o = opacity (when < 1), m = material name without its numeric suffix.
function glbToBoxes(buf, { scale = 1, rotationX = 0, rotationY = 0 } = {}) {
  const g = readGltf(buf);
  const nodes = g.nodes || [];
  const root = mul(rotY(rotationY), mul(rotX(rotationX), trs(undefined, undefined, [scale, scale, scale])));
  const raw = [];

  const visit = (i, parent, depth) => {
    const node = nodes[i];
    if (!node || depth > 64) return;
    const local = node.matrix || trs(node.translation, node.rotation, node.scale);
    const world = mul(parent, local);
    const mesh = node.mesh != null && g.meshes?.[node.mesh];
    if (mesh) {
      for (const prim of mesh.primitives || []) {
        const acc = g.accessors?.[prim.attributes?.POSITION];
        if (!acc?.min || !acc?.max) continue;
        const mat = g.materials?.[prim.material] || {};
        const pbr = mat.pbrMetallicRoughness || {};
        const col = pbr.baseColorFactor || [0.8, 0.8, 0.8, 1];
        const [a, b] = [acc.min, acc.max];
        const centre = apply(world, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
        // upright node (its Y stays vertical): keep the local footprint and a yaw,
        // so a turned chair is a turned box rather than a fat bounding square
        const sy = Math.hypot(world[4], world[5], world[6]);
        const upright = sy > 0 && Math.abs(world[5]) / sy > 0.999;
        let box;
        if (upright) {
          const sx = Math.hypot(world[0], world[2]), sz = Math.hypot(world[8], world[10]);
          let yaw = Math.atan2(world[2], world[0]) * 180 / Math.PI; // board y = model z
          let w = (b[0] - a[0]) * sx, d = (b[2] - a[2]) * sz;
          yaw = ((yaw % 180) + 180) % 180;
          if (Math.abs(yaw - 90) < 0.5) { [w, d] = [d, w]; yaw = 0; }
          if (yaw < 0.5 || yaw > 179.5) yaw = 0;
          const h = (b[1] - a[1]) * sy;
          box = { x: centre[0], y: centre[2], w, d, z: centre[1] - h / 2, h, r: yaw };
        } else {
          let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
          for (let k = 0; k < 8; k++) {
            const p = apply(world, [k & 1 ? b[0] : a[0], k & 2 ? b[1] : a[1], k & 4 ? b[2] : a[2]]);
            lo = lo.map((v, j) => Math.min(v, p[j])); hi = hi.map((v, j) => Math.max(v, p[j]));
          }
          box = { x: (lo[0] + hi[0]) / 2, y: (lo[2] + hi[2]) / 2, w: hi[0] - lo[0], d: hi[2] - lo[2], z: lo[1], h: hi[1] - lo[1], r: 0 };
        }
        box.n = String(node.name || mesh.name || '').replace(/\./g, '_');
        box.c = hex(col);
        if (col[3] != null && col[3] < 0.98) box.o = r3(col[3]);
        box.m = String(mat.name || '').replace(/_\d+$/, '').toLowerCase();
        // 24 vertices is a plain box; anything richer with a square footprint is a cylinder or sphere
        if (acc.count > 24 && Math.abs(box.w - box.d) < 0.08 * Math.max(box.w, box.d)) box.round = 1;
        raw.push(box);
      }
    }
    for (const c of node.children || []) visit(c, world, depth + 1);
  };
  const scene = g.scenes?.[g.scene ?? 0];
  for (const i of scene?.nodes || []) visit(i, root, 0);
  if (!raw.length) return { w: 0, d: 0, h: 0, boxes: [] };

  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const b of raw) {
    // a yawed box reaches further than w/2, d/2 — its half-diagonal bounds it
    const rx = b.r ? Math.hypot(b.w, b.d) / 2 : b.w / 2, ry = b.r ? Math.hypot(b.w, b.d) / 2 : b.d / 2;
    x0 = Math.min(x0, b.x - rx); x1 = Math.max(x1, b.x + rx);
    y0 = Math.min(y0, b.y - ry); y1 = Math.max(y1, b.y + ry);
    z0 = Math.min(z0, b.z); z1 = Math.max(z1, b.z + b.h);
  }
  const boxes = raw.map((b) => {
    const o = { n: b.n, x: r3(b.x - x0), y: r3(b.y - y0), w: r3(b.w), d: r3(b.d), z: r3(b.z - z0), h: r3(b.h), c: b.c, m: b.m };
    if (b.r) o.r = r3(b.r);
    if (b.o != null) o.o = b.o;
    if (b.round) o.round = 1;
    return o;
  });
  return { w: r3(x1 - x0), d: r3(y1 - y0), h: r3(z1 - z0), boxes };
}

module.exports = { glbToBoxes };
