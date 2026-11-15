'use strict';

// Imported floor-plan model (GLB, OBJ, or a rendered picture) — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const { writeConfigFile } = require('../config-file-cache');
const { editPinOk, readConfigFile } = require('./helpers');
const { glbToBoxes } = require('../glb-boxes');

module.exports = function register(router) {
  // ── Imported 3D floor-plan model (GLB or OBJ) ──────────────
  // An alternative to the hand-drawn isometric board: upload a real 3D scan
  // or model of the home and view it directly (Three.js, orbit-controlled)
  // instead of the CSS-extruded room boxes. Only one model is kept at a
  // time — uploading a new one replaces it. Body: { name, data } with data
  // a base64 data-URI; the format (glb/obj) comes from the filename
  // extension since browsers don't reliably report a MIME type for either.
  // LSH_PLAN_MODEL_DIR: the tests point this at a temp folder (an upload clears the directory)
  const MODEL_DIR = process.env.LSH_PLAN_MODEL_DIR || path.join(__dirname, '..', '..', 'persist', 'plan-model');
  // A picture (a render of the home, e.g. out of Blender) is a model too: it
  // is shown flat and devices are pinned onto it by hand (/plan-model/pins).
  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
  const MODEL_EXT = new Set(['glb', 'obj', ...IMAGE_EXT]);
  const FILE_RE = /^floorplan-[a-z0-9]+\.(glb|obj|png|jpe?g|webp)$/;
  // The extension picks the viewer, so a picture must really be that picture
  const isImage = (ext, buf) => (
    ext === 'png' ? buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : ext === 'webp' ? buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP'
        : buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff);

  const clearModelDir = () => {
    try {
      for (const f of fs.readdirSync(MODEL_DIR)) fs.unlinkSync(path.join(MODEL_DIR, f));
    } catch { /* directory doesn't exist yet — nothing to clear */ }
  };

  router.post('/plan-model/upload', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const name = String(req.body?.name || '');
    const ext = name.toLowerCase().split('.').pop();
    if (!MODEL_EXT.has(ext)) return res.status(400).json({ success: false, error: 'File must be .glb, .obj, .png, .jpg or .webp' });
    const m = String(req.body?.data || '').match(/^data:[^;]*;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ success: false, error: 'data must be a base64 data-URI' });
    const buf = Buffer.from(m[1], 'base64');
    if (!buf.length) return res.status(400).json({ success: false, error: 'Empty file' });
    if (buf.length > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: 'Model too large (max 50 MB)' });
    if (IMAGE_EXT.has(ext) && !isImage(ext, buf)) return res.status(400).json({ success: false, error: `Not a valid .${ext} image` });
    try {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
      clearModelDir();
      const file = `floorplan-${Date.now().toString(36)}.${ext}`;
      fs.writeFileSync(path.join(MODEL_DIR, file), buf);
      const cfg = readConfigFile();
      cfg.homePlan = cfg.homePlan || {};
      cfg.homePlan.model = { url: `/api/plan-model/file/${file}`, format: ext, name: name.slice(0, 80), ...(IMAGE_EXT.has(ext) ? { image: true } : {}) };
      writeConfigFile(cfg);
      res.json({ success: true, model: cfg.homePlan.model });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/plan-model/file/:file', (req, res) => {
    const file = String(req.params.file || '');
    if (!FILE_RE.test(file)) return res.status(400).end();
    res.sendFile(path.join(MODEL_DIR, file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // The model reduced to boxes, for the HTML/CSS view of the Plan
  // (PlanHtmlModel.jsx) — see src/glb-boxes.js. GLB only: an OBJ has no
  // per-part bounds without decoding its geometry. Parsed once per file and
  // alignment, then served from memory.
  let boxCache = null;
  router.get('/plan-model/boxes', (req, res) => {
    const model = readConfigFile().homePlan?.model;
    const file = String(model?.url || '').split('/').pop();
    if (!model || !FILE_RE.test(file)) return res.status(404).json({ success: false, error: 'No model uploaded' });
    if (model.format !== 'glb') return res.status(400).json({ success: false, error: 'The HTML view needs a .glb model' });
    const key = [file, model.scale ?? 1, model.rotationX ?? 0, model.rotationY ?? 0].join('|');
    try {
      if (boxCache?.key !== key) {
        const data = glbToBoxes(fs.readFileSync(path.join(MODEL_DIR, file)),
          { scale: Number(model.scale) || 1, rotationX: Number(model.rotationX) || 0, rotationY: Number(model.rotationY) || 0 });
        boxCache = { key, data };
      }
      res.json({ success: true, ...boxCache.data });
    } catch (err) {
      res.status(err.code === 'ENOENT' ? 404 : 500).json({ success: false, error: err.message });
    }
  });

  // Scale/rotation so an imported model (arbitrary native scale/orientation
  // — a common mismatch, e.g. Z-up exports from CAD tools) can be aligned
  // without re-uploading. rotationX/Y are degrees.
  router.post('/plan-model/transform', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const cfg = readConfigFile();
    if (!cfg.homePlan?.model) return res.status(400).json({ success: false, error: 'No model uploaded' });
    const { scale, rotationX, rotationY } = req.body || {};
    cfg.homePlan.model = {
      ...cfg.homePlan.model,
      scale: scale != null ? Number(scale) : (cfg.homePlan.model.scale ?? 1),
      rotationX: rotationX != null ? Number(rotationX) : (cfg.homePlan.model.rotationX ?? 0),
      rotationY: rotationY != null ? Number(rotationY) : (cfg.homePlan.model.rotationY ?? 0),
    };
    writeConfigFile(cfg);
    res.json({ success: true, model: cfg.homePlan.model });
  });

  // Which LSH device sits on which device slot of the model (PlanModelViewer:
  // "<category>:<slot>", e.g. "lighting:light_kitchen", "blinds:win_bed2_e").
  // Body: { bindings: { deviceKey: slotId | null } } — merged; null unassigns
  // (and pins the device as "not on the model", so auto-placement leaves it).
  router.post('/plan-model/bindings', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const cfg = readConfigFile();
    if (!cfg.homePlan?.model) return res.status(400).json({ success: false, error: 'No model uploaded' });
    const patch = req.body?.bindings;
    if (!patch || typeof patch !== 'object') return res.status(400).json({ success: false, error: 'bindings object required' });
    const bindings = { ...(cfg.homePlan.model.bindings || {}) };
    for (const [key, slot] of Object.entries(patch)) {
      if (typeof key !== 'string' || !key || key.length > 200) continue;
      if (slot === null || slot === '') bindings[key] = null;
      else if (typeof slot === 'string' && /^[a-z]+:[a-z0-9_]{1,80}$/.test(slot)) {
        // a slot holds one device — whoever had it is moved off
        for (const [k, v] of Object.entries(bindings)) if (v === slot && k !== key) delete bindings[k];
        bindings[key] = slot;
      }
    }
    cfg.homePlan.model = { ...cfg.homePlan.model, bindings };
    writeConfigFile(cfg);
    res.json({ success: true, model: cfg.homePlan.model });
  });

  // Where each device sits on a picture model, as fractions of the picture's
  // width and height (0–1, origin top-left) so a pin stays put at any size.
  // Body: { pins: { deviceKey: { x, y } | null } } — merged; null takes the
  // device off the picture.
  router.post('/plan-model/pins', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const cfg = readConfigFile();
    if (!cfg.homePlan?.model) return res.status(400).json({ success: false, error: 'No model uploaded' });
    if (!cfg.homePlan.model.image) return res.status(400).json({ success: false, error: 'Pins are for picture models' });
    const patch = req.body?.pins;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return res.status(400).json({ success: false, error: 'pins object required' });
    const pins = { ...(cfg.homePlan.model.pins || {}) };
    for (const [key, pos] of Object.entries(patch)) {
      if (!key || key.length > 200 || key === '__proto__') continue;
      if (pos === null) { delete pins[key]; continue; }
      const x = Number(pos?.x), y = Number(pos?.y);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) continue;
      pins[key] = { x: +x.toFixed(4), y: +y.toFixed(4) };
    }
    cfg.homePlan.model = { ...cfg.homePlan.model, pins };
    writeConfigFile(cfg);
    res.json({ success: true, model: cfg.homePlan.model });
  });

  router.post('/plan-model/remove', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const cfg = readConfigFile();
    if (cfg.homePlan) delete cfg.homePlan.model;
    writeConfigFile(cfg);
    clearModelDir();
    res.json({ success: true });
  });
};
