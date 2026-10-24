'use strict';

// Imported 3D floor-plan model (GLB or OBJ) — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const { writeConfigFile } = require('../config-file-cache');
const { editPinOk, readConfigFile } = require('./helpers');

module.exports = function register(router) {
  // ── Imported 3D floor-plan model (GLB or OBJ) ──────────────
  // An alternative to the hand-drawn isometric board: upload a real 3D scan
  // or model of the home and view it directly (Three.js, orbit-controlled)
  // instead of the CSS-extruded room boxes. Only one model is kept at a
  // time — uploading a new one replaces it. Body: { name, data } with data
  // a base64 data-URI; the format (glb/obj) comes from the filename
  // extension since browsers don't reliably report a MIME type for either.
  const MODEL_DIR = path.join(__dirname, '..', '..', 'persist', 'plan-model');
  const MODEL_EXT = new Set(['glb', 'obj']);

  const clearModelDir = () => {
    try {
      for (const f of fs.readdirSync(MODEL_DIR)) fs.unlinkSync(path.join(MODEL_DIR, f));
    } catch { /* directory doesn't exist yet — nothing to clear */ }
  };

  router.post('/plan-model/upload', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const name = String(req.body?.name || '');
    const ext = name.toLowerCase().split('.').pop();
    if (!MODEL_EXT.has(ext)) return res.status(400).json({ success: false, error: 'File must be .glb or .obj' });
    const m = String(req.body?.data || '').match(/^data:[^;]*;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ success: false, error: 'data must be a base64 data-URI' });
    const buf = Buffer.from(m[1], 'base64');
    if (!buf.length) return res.status(400).json({ success: false, error: 'Empty file' });
    if (buf.length > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: 'Model too large (max 50 MB)' });
    try {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
      clearModelDir();
      const file = `floorplan-${Date.now().toString(36)}.${ext}`;
      fs.writeFileSync(path.join(MODEL_DIR, file), buf);
      const cfg = readConfigFile();
      cfg.homePlan = cfg.homePlan || {};
      cfg.homePlan.model = { url: `/api/plan-model/file/${file}`, format: ext, name: name.slice(0, 80) };
      writeConfigFile(cfg);
      res.json({ success: true, model: cfg.homePlan.model });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/plan-model/file/:file', (req, res) => {
    const file = String(req.params.file || '');
    if (!/^floorplan-[a-z0-9]+\.(glb|obj)$/.test(file)) return res.status(400).end();
    res.sendFile(path.join(MODEL_DIR, file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
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

  router.post('/plan-model/remove', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const cfg = readConfigFile();
    if (cfg.homePlan) delete cfg.homePlan.model;
    writeConfigFile(cfg);
    clearModelDir();
    res.json({ success: true });
  });
};
