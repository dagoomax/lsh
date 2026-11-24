'use strict';

// Visual PTZ waypoints — saved views a pan/tilt camera can go back to, for
// cameras without presets of their own (Tuya / Smart Life cameras reached
// through the web player's PTZ, which only has move and stop).
//
// Timing moves doesn't work on those: a press of a quarter second already
// turns ~15°, the cloud adds latency to both start and stop, and a move
// followed by its exact opposite often doesn't land on the same view
// (measured on a real camera, 2026-10-28). So a waypoint is a picture:
//
//   save   grab a frame, keep it (persist/ptz-waypoints/<camera>/<id>.jpg)
//   goto   compare the live frame with the saved one — edge images, so the
//          hall light being on or off matters less — find how far the view is
//          shifted (dx, dy), pulse the PTZ in proportion, look again, until
//          the shift is within about half the camera's smallest step. Each
//          pulse also measures what it actually moved, so the camera's
//          direction, smallest step (a tap: start then stop at once, ~7 px
//          here) and speed are learned (persist/ptz-waypoints.json → calib)
//          instead of configured.
//          When the saved view isn't in the picture at all, it pans around in
//          steps looking for it.
//
// Frames come from go2rtc's frame API when the camera's webrtcUrl is a
// go2rtc one (fast, the stream stays open), else from snapshotUrl, else one
// RTSP grab (slow through a cloud relay).
//
// Per camera, config.cameras[i].waypoints: false turns it off; an object sets
// { settleMs = 3500 (wait after a move, covers the stream's delay),
//   maxSteps = 16, tolerancePx = 3 }.
//
// Devices: ptz/<camera> with a "Go to <name>" trigger per waypoint, for
// flows and scenes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const W = 96, H = 54;            // matching resolution
const MAX_DX = 48, MAX_DY = 28;  // largest shift searched (px at W×H)
const IN_VIEW = 0.58;            // least match score for "the saved view is in the picture" (real matches
                                 // scored 0.6–0.93 on Wejście, a textured wall by chance up to 0.53)

// ── image matching ─────────────────────────────────────────────────────────

// JPEG → W×H luminance (box-averaged)
function toGray(jpegBuf) {
  const img = require('jpeg-js').decode(jpegBuf, { useTArray: true, formatAsRGBA: false });
  const { width: iw, height: ih, data } = img;
  const ch = data.length / (iw * ih);
  const out = new Float32Array(W * H), cnt = new Float32Array(W * H);
  for (let y = 0; y < ih; y += 2) {
    const oy = Math.min(H - 1, Math.floor((y * H) / ih));
    for (let x = 0; x < iw; x += 2) {
      const ox = Math.min(W - 1, Math.floor((x * W) / iw));
      const i = (y * iw + x) * ch;
      out[oy * W + ox] += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      cnt[oy * W + ox]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= cnt[i] || 1;
  return out;
}

// 3×3 box blur — a wider, smoother match peak
function blur(g) {
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += g[yy * W + xx]; n++ }
      }
      o[y * W + x] = s / n;
    }
  }
  return o;
}

// Sobel edge strength — what the view looks like, mostly independent of how lit it is
function edges(g) {
  g = blur(g);
  const e = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = (dx, dy) => g[(y + dy) * W + x + dx];
      const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1);
      const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1);
      e[y * W + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return blur(e);
}

// Where does `target` sit in `live`? → { dx, dy, score }: live(x+dx, y+dy) ≈ target(x, y),
// score = normalized correlation over the overlap (needs ≥ 40 % of the frame)
function findShift(live, target, { maxDx = MAX_DX, maxDy = MAX_DY } = {}) {
  let best = { dx: 0, dy: 0, score: -1 };
  const all = [];
  for (let dy = -maxDy; dy <= maxDy; dy++) {
    for (let dx = -maxDx; dx <= maxDx; dx++) {
      const x0 = Math.max(1, 1 - dx), x1 = Math.min(W - 1, W - 1 - dx);
      const y0 = Math.max(1, 1 - dy), y1 = Math.min(H - 1, H - 1 - dy);
      const n = (x1 - x0) * (y1 - y0);
      if (n < 0.4 * W * H) continue;
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = y0; y < y1; y++) {
        const ro = y * W, rl = (y + dy) * W + dx;
        for (let x = x0; x < x1; x++) {
          const a = target[ro + x], b = live[rl + x];
          sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
        }
      }
      const cov = sab - (sa * sb) / n, va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
      const score = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
      // a small preference for small shifts, so flat areas don't win by chance
      const s = score - 0.0005 * (Math.abs(dx) + Math.abs(dy));
      all.push([dx, dy, score]);
      if (s > best.s || best.s === undefined) best = { dx, dy, score, s };
    }
  }
  // How clearly the match stands out from shifts along each axis: a real view
  // gives one clear peak; a wrong view or a blank wall a flat field; a single
  // vertical edge (a door frame) pins x down but says nothing about y.
  let sx = -1, sy = -1;
  for (const [dx, dy, sc] of all) {
    const ax = Math.abs(dx - best.dx), ay = Math.abs(dy - best.dy);
    if (ax >= 8 && ay <= 2 && sc > sx) sx = sc;
    if (ay >= 6 && ax <= 2 && sc > sy) sy = sc;
  }
  const r = (v) => Math.round(v * 1000) / 1000;
  return { dx: best.dx, dy: best.dy, score: r(best.score), mx: r(best.score - sx), my: r(best.score - sy) };
}

// per axis: is the shift along it known?
const MARGIN = 0.06;
// a best match on the edge of the searched range may lie beyond it — not known
const sure = (m, axis) => m.score >= IN_VIEW && (axis === 'x' ? m.mx : m.my) >= MARGIN
  && (axis === 'x' ? Math.abs(m.dx) < MAX_DX : Math.abs(m.dy) < MAX_DY);
// the saved view is in the picture: clear on both axes (one alone also
// happens for a wrong view lined up by chance)
const inView = (m) => sure(m, 'x') && sure(m, 'y');

const view = (jpegBuf) => edges(toGray(jpegBuf));

// ── frames ─────────────────────────────────────────────────────────────────

// go2rtc's frame API from a go2rtc WebRTC URL (http://host:1984/api/webrtc?src=x)
function go2rtcFrameUrl(webrtcUrl) {
  try {
    const u = new URL(webrtcUrl);
    if (!/\/api\/webrtc$/.test(u.pathname) || !u.searchParams.get('src')) return null;
    return `${u.origin}${u.pathname.replace(/webrtc$/, 'frame.jpeg')}?src=${encodeURIComponent(u.searchParams.get('src'))}`;
  } catch { return null; }
}

function frameSource(cam, ffmpegPath) {
  const g = cam.webrtcUrl && go2rtcFrameUrl(cam.webrtcUrl);
  const http = g || (/^https?:/.test(cam.snapshotUrl || '') ? cam.snapshotUrl : null);
  if (http) {
    return async () => {
      // go2rtc answers 500 now and then while its source reconnects
      for (let i = 1; ; i++) {
        try {
          const r = await fetch(`${http}${http.includes('?') ? '&' : '?'}_=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
          if (!r.ok) throw new Error(`frame: HTTP ${r.status}`);
          return Buffer.from(await r.arrayBuffer());
        } catch (err) {
          if (i >= 3) throw err;
          await sleep(1500);
        }
      }
    };
  }
  if (cam.url) return () => require('./rtsp-snapshot').grabFrame(cam.url, ffmpegPath);
  return null;
}

// ── waypoints ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (name) => (name || 'camera').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'camera';

class PtzWaypoints {
  // cams: [{ name, slug, ptz(op), frame(), opts }]
  constructor({ cams = [], store = null, registry = null, file, dir } = {}) {
    this.file = file || path.join(__dirname, '..', 'persist', 'ptz-waypoints.json');
    this.dir = dir || path.join(__dirname, '..', 'persist', 'ptz-waypoints');
    this.store = store;
    this.registry = registry;
    this.cams = new Map(cams.map((c) => [c.slug, c]));
    this.busy = new Map(); // slug → running goto
    try { this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { this.db = {} }
  }

  // From config.cameras: every camera with PTZ (Tuya or ONVIF) unless waypoints: false
  static fromConfig(config, store, registry) {
    const ffmpegPath = config.ffmpegRtsp?.ffmpegPath || 'ffmpeg';
    const cams = [];
    (config.cameras || []).forEach((cam, idx) => {
      if (cam.waypoints === false) return;
      let ptz = null;
      if (cam.tuyaPtz) ptz = (op) => require('./tuya-cloud-ptz').ptz(config.tuyaCloud, cam.tuyaPtz, op, config.tuyaIpc);
      else if (cam.onvif?.host) ptz = (op) => require('./onvif-ptz').ptz(cam.onvif, op);
      const frame = frameSource(cam, ffmpegPath);
      if (!ptz || !frame) return;
      cams.push({ name: cam.name, slug: slugify(cam.name), idx, ptz, frame, opts: typeof cam.waypoints === 'object' ? cam.waypoints : {} });
    });
    return new PtzWaypoints({ cams, store, registry });
  }

  start() {
    for (const c of this.cams.values()) this._registerDevice(c);
    if (this.cams.size) console.log(`[Waypoints] ${[...this.cams.values()].map((c) => `${c.name} (${this.list(c.slug).length})`).join(', ')}`);
  }

  camera(slugOrIdx) {
    const c = this.cams.get(String(slugOrIdx)) || [...this.cams.values()].find((x) => String(x.idx) === String(slugOrIdx));
    if (!c) throw new Error('This camera has no waypoints (no PTZ or no frame source)');
    return c;
  }

  _entry(slug) { return (this.db[slug] ||= { waypoints: [], calib: {} }) }
  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.db, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
  _img(slug, id) { return path.join(this.dir, slug, `${id}.jpg`) }

  list(slug) {
    return (this.db[slug]?.waypoints || []).map(({ id, name, created, lastScore }) => ({ id, name, created, lastScore }));
  }

  image(slug, id) {
    const f = this._img(slug, String(id).replace(/[^a-z0-9]/gi, ''));
    return fs.existsSync(f) ? f : null;
  }

  async save(slug, name) {
    const c = this.camera(slug);
    const jpg = await c.frame();
    view(jpg); // must decode
    const e = this._entry(c.slug);
    const id = crypto.randomBytes(4).toString('hex');
    fs.mkdirSync(path.join(this.dir, c.slug), { recursive: true });
    fs.writeFileSync(this._img(c.slug, id), jpg);
    const wp = { id, name: String(name || '').trim().slice(0, 60) || `Waypoint ${e.waypoints.length + 1}`, created: new Date().toISOString() };
    e.waypoints.push(wp);
    this._save();
    this._registerDevice(c);
    return wp;
  }

  rename(slug, id, name) {
    const c = this.camera(slug);
    const wp = this._entry(c.slug).waypoints.find((w) => w.id === id);
    if (!wp) throw new Error('No such waypoint');
    wp.name = String(name || '').trim().slice(0, 60) || wp.name;
    this._save();
    this._registerDevice(c);
    return wp;
  }

  remove(slug, id) {
    const c = this.camera(slug);
    const e = this._entry(c.slug);
    e.waypoints = e.waypoints.filter((w) => w.id !== id);
    try { fs.unlinkSync(this._img(c.slug, id)) } catch {}
    this._save();
    this._registerDevice(c);
  }

  // Go to a waypoint. One at a time per camera. → { ok, steps, score, dx, dy, message }
  goto(slug, id, onStep) {
    const c = this.camera(slug);
    if (this.busy.get(c.slug)) throw new Error('Already moving to a waypoint');
    const wp = this._entry(c.slug).waypoints.find((w) => w.id === id);
    if (!wp) throw new Error('No such waypoint');
    const run = this._goto(c, wp, onStep).finally(() => {
      this.busy.delete(c.slug);
      this.store?.set(`ptz/${c.slug}/moving`, 0);
    });
    this.busy.set(c.slug, run);
    this.store?.set(`ptz/${c.slug}/moving`, 1);
    return run;
  }

  async _goto(c, wp, onStep = () => {}) {
    const o = { settleMs: 3500, maxSteps: 16, tolerancePx: 3, searchMs: 400, ...c.opts };
    const target = view(fs.readFileSync(this._img(c.slug, wp.id)));
    const e = this._entry(c.slug);
    // learned per axis — sign: +1 when pressing right/down moves the picture's
    // content toward −x/−y; tapPx: what a tap moves; msPerPx: each further px
    const cal = (e.calib ||= {});
    cal.x ||= { sign: 1, tapPx: 7, msPerPx: 7, n: 0 };
    cal.y ||= { sign: 1, tapPx: 9, msPerPx: 8, n: 0 };
    const pulse = async (op, ms) => {
      await c.ptz(op);
      if (ms) await sleep(ms);
      await c.ptz('stop');
      await sleep(o.settleMs);
    };
    const tol = (axis) => Math.max(o.tolerancePx, Math.round(cal[axis].tapPx * 0.6));

    const grab = async (tag) => {
      const jpg = await c.frame();
      if (this.debugDir) fs.writeFileSync(path.join(this.debugDir, `${wp.id}-${tag}.jpg`), jpg);
      return view(jpg);
    };
    let cur = await grab(0);
    let m = findShift(cur, target);
    let searched = 0, searchDir = 'right';
    for (let step = 1; step <= o.maxSteps; step++) {
      onStep({ step, ...m });
      const offX = Math.abs(m.dx) > tol('x');
      const offY = Math.abs(m.dy) > tol('y');
      if (inView(m) && !offX && !offY) {
        return this._done(c, wp, { ok: true, steps: step - 1, ...m });
      }
      let axis = null, op, ms;
      if (inView(m)) {
        // the larger error of the axes that are known and still off
        const ex = offX ? Math.abs(m.dx) : 0;
        const ey = offY ? Math.abs(m.dy) : 0;
        axis = ex >= ey ? 'x' : 'y';
        const err = axis === 'x' ? m.dx : m.dy;
        const a = cal[axis];
        // target content at +dx in the live picture → turn toward +x
        const toward = Math.sign(err) * a.sign;
        op = axis === 'x' ? (toward > 0 ? 'right' : 'left') : (toward > 0 ? 'down' : 'up');
        ms = Math.abs(err) <= a.tapPx * 1.6 ? 0 : Math.round(Math.max(60, Math.min(1500, (Math.abs(err) - a.tapPx) * a.msPerPx)));
      } else {
        // not in view: pan around in steps, turning back at an end stop
        if (++searched > Math.ceil(360 / 20)) break;
        op = searchDir; ms = o.searchMs;
      }
      await pulse(op, ms);
      const next = await grab(step);
      if (!axis) {
        const moved = findShift(next, cur);
        if (moved.score >= 0.8 && Math.abs(moved.dx) <= 1) searchDir = searchDir === 'right' ? 'left' : 'right';
      }
      // learn from what the pulse really did: how far the old picture moved
      if (axis) {
        const moved = findShift(next, cur);
        const px = axis === 'x' ? moved.dx : moved.dy;
        if (sure(moved, axis) && Math.abs(px) >= 2) {
          const a = cal[axis], k = Math.min(a.n, 4);
          const pressed = op === 'right' || op === 'down' ? 1 : -1;
          a.sign = -Math.sign(px) * pressed; // content moves opposite to the turn
          // a reading far off what is known is more likely a bad match than a new speed
          const near = (v, ref) => v >= ref / 2 && v <= ref * 2;
          if (ms === 0) { if (near(Math.abs(px), a.tapPx)) a.tapPx = Math.round(((a.tapPx * k + Math.abs(px)) / (k + 1)) * 10) / 10 }
          else if (Math.abs(px) > a.tapPx + 1) {
            const v = ms / (Math.abs(px) - a.tapPx);
            if (near(v, a.msPerPx)) a.msPerPx = Math.round(Math.max(3, Math.min(25, (a.msPerPx * k + v) / (k + 1))) * 10) / 10;
          }
          a.n++;
        }
      }
      cur = next;
      m = findShift(cur, target);
    }
    return this._done(c, wp, { ok: false, steps: o.maxSteps, ...m, message: !inView(m) ? 'The saved view wasn’t found — aim the camera near it and try again' : 'Got close but not exact' });
  }

  _done(c, wp, r) {
    wp.lastScore = r.score;
    this._save();
    this.store?.set(`ptz/${c.slug}/waypoint`, r.ok ? wp.name : '');
    return r;
  }

  // ptz/<slug>: one trigger per waypoint (flows, scenes), the current waypoint, moving
  _registerDevice(c) {
    if (!this.registry) return;
    const key = `ptz/${c.slug}`;
    const sensors = [
      ...this.list(c.slug).map((w) => ({ path: `goto_${w.id}`, label: `Go to ${w.name}`, controllable: true, type: 'trigger', writeOn: 'goto', writeOff: 'goto', capabilityId: w.id })),
      { path: 'waypoint', label: 'Waypoint', type: 'label' },
      { path: 'moving', label: 'Moving', format: 'on-off', type: 'boolean' },
    ];
    const existing = this.registry.devices?.get(key);
    if (existing) { existing.sensors = sensors; this.registry.emit?.('devices-changed'); return }
    this.registry.registerDevice({
      key, label: `${c.name} waypoints`, type: 'ptz-waypoints', icon: '📍', category: 'Media', sensors,
      _writeCapability: (id) => { this.goto(c.slug, id).catch((err) => console.error(`[Waypoints] ${c.name}: ${err.message}`)) },
    });
  }
}

module.exports = PtzWaypoints;
Object.assign(module.exports, { IN_VIEW, inView, sure, toGray, edges, findShift, view, go2rtcFrameUrl, frameSource, slugify, W, H });
