'use strict';

// Automation (rules / scenes / notifications) — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const engineExports = require('../automation-engine');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, requirePermission } = ctx;

  // ── Automation (rules / scenes / notifications) ───────────
  if (clients.automation) {
    const automation = clients.automation;

    router.get('/automation/rules', (req, res) => res.json({ success: true, data: automation.rules }));
    router.post('/automation/rules', requireAdmin, (req, res) => {
      try { res.json({ success: true, data: automation.saveRule(req.body) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    router.delete('/automation/rules/:id', requireAdmin, (req, res) => {
      automation.deleteRule(req.params.id);
      res.json({ success: true });
    });

    // `homekit` = shown in Apple Home (not in config.homekit.exclude.scenes);
    // `inHomekit` = actually published on the running bridge right now.
    const hkScene = (s) => {
      const excluded = (readConfigFile().homekit?.exclude?.scenes || []).map(String).includes(String(s.id));
      const pool = clients.homekitBridge;
      return { ...s, homekit: !excluded, inHomekit: !!pool?.has(`scene:${s.id}`) };
    };
    router.get('/automation/scenes', (req, res) => res.json({ success: true, data: automation.scenes.map(hkScene) }));
    router.post('/automation/scenes', requireAdmin, (req, res) => {
      // homekit / inHomekit are derived fields from the GET above — never stored on the scene
      const { homekit, inHomekit, ...scene } = req.body || {};
      try { res.json({ success: true, data: hkScene(automation.saveScene(scene)) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    router.delete('/automation/scenes/:id', requireAdmin, (req, res) => {
      automation.deleteScene(req.params.id);
      res.json({ success: true });
    });
    router.post('/automation/scenes/:id/run', async (req, res) => {
      try { res.json({ success: true, data: await automation.runScene(req.params.id) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    // Show / hide one scene in Apple Home — the same config.homekit.exclude.scenes
    // list Settings → HomeKit edits, applied to the running bridge at once.
    router.post('/automation/scenes/:id/homekit', requireAdmin, (req, res) => {
      const id = String(req.params.id);
      const scene = automation.scenes.find((s) => String(s.id) === id);
      if (!scene) return res.status(404).json({ success: false, error: 'Scene not found' });
      const on = req.body?.on !== false;
      const cur = readConfigFile();
      const ex = { devices: [], types: [], cameras: [], scenes: [], relays: [], ...(cur.homekit?.exclude || {}) };
      const scenes = new Set((ex.scenes || []).map(String));
      if (on) scenes.delete(id); else scenes.add(id);
      const exclude = { ...ex, scenes: [...scenes] };
      try { writeConfigFile({ ...cur, homekit: { ...(cur.homekit || {}), exclude } }); }
      catch (err) { return res.status(500).json({ success: false, error: err.message }); }
      clients.homekitBridge?.applyExclude?.(exclude);
      res.json({ success: true, data: hkScene(scene), homekitRunning: !!clients.homekitBridge });
    });

    // ── Flows (Node-RED-style) ──
    router.get('/automation/flows', (req, res) => res.json({ success: true, data: automation.flows }));
    router.post('/automation/flows', requireAdmin, requirePermission('flows'), (req, res) => {
      try { res.json({ success: true, data: automation.saveFlow(req.body) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });
    router.delete('/automation/flows/:id', requireAdmin, requirePermission('flows'), (req, res) => {
      automation.deleteFlow(req.params.id);
      res.json({ success: true });
    });
    router.post('/automation/flows/:id/run', async (req, res) => {
      try { res.json({ success: true, data: await automation.runFlow(req.params.id) }); }
      catch (err) { res.status(400).json({ success: false, error: err.message }); }
    });

    // Serves files captured by an `http` node's `saveAs` option — originally
    // JPEG-only (point a camera's snapshotUrl at this), now whatever
    // extension the response's Content-Type mapped to at save time (see
    // SAVEAS_TYPES in automation-engine.js), so a scheduled flow can also
    // re-fetch e.g. a Loxone XML export and serve it from a stable URL. No
    // auth beyond the usual API middleware, same as other snapshot proxies
    // (mobotix/axis/kenik) — filename is sanitized on write, so this can't
    // escape SNAPSHOTS_DIR.
    router.get('/flow-snapshots/:name', (req, res) => {
      const name = engineExports.sanitizeSnapshotName(req.params.name.replace(/\.[a-zA-Z0-9]+$/, ''));
      const dir = engineExports.SNAPSHOTS_DIR;
      let match;
      try { match = fs.readdirSync(dir).find((f) => f.startsWith(`${name}.`)); } catch { /* dir doesn't exist yet */ }
      if (!match) return res.status(404).json({ success: false, error: 'No snapshot saved yet' });
      res.set('Cache-Control', 'no-store');
      res.set('Content-Type', engineExports.mimeForExt(path.extname(match)));
      res.sendFile(path.join(dir, match), (err) => { if (err && !res.headersSent) res.status(404).json({ success: false, error: 'No snapshot saved yet' }); });
    });

    // Serves the Loxone Virtual Input XML (re)generated by a `loxoneXml`
    // flow node — import this once into Loxone Config, same filename
    // sanitization/scoping as the snapshot route above.
    router.get('/flow-loxone/:name', (req, res) => {
      const name = engineExports.sanitizeSnapshotName(req.params.name.replace(/\.xml$/i, ''));
      const file = path.join(engineExports.LOXONE_XML_DIR, `${name}.xml`);
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${name}.xml"`);
      res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).json({ success: false, error: 'No XML generated yet — run the flow at least once' }); });
    });

    router.get('/automation/notifications', (req, res) => res.json({ success: true, data: automation.getNotifications() }));
    // External systems (Node-RED, scripts) can push a notification → toast + log
    router.post('/automation/notifications', requireAdmin, (req, res) => {
      const { level, message, source } = req.body || {};
      if (!message) return res.status(400).json({ success: false, error: 'message required' });
      res.json({ success: true, data: automation.notify(level || 'info', String(message), source || 'api') });
    });
    router.delete('/automation/notifications', requireAdmin, (req, res) => {
      automation.clearNotifications();
      res.json({ success: true });
    });
  }
};
