'use strict';

// HomeKit QR — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const { generateSetupUri, generateSetupID } = require('../homekit-uri');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { requireAdmin, clients, sensorRegistry } = ctx;

  // ── HomeKit QR ────────────────────────────────────────────
  router.get('/homekit/setup-uri', (req, res) => {
    const cfg = readConfigFile();
    const pin = cfg.homekit?.pin || '031-45-154';
    const setupID = cfg.homekit?.setupID || 'HEJX';
    try {
      const uri = generateSetupUri(pin, setupID);
      res.json({ success: true, data: { uri, pin, setupID } });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Reset HomeKit pairing — deletes hap-nodejs's persisted AccessoryInfo /
  // IdentifierCache files (persist/homekit) so the bridge comes back UNPAIRED
  // on the next restart, ready to add fresh in the Home app (e.g. after
  // renaming the bridge, or when a stale pairing blocks re-adding it). Takes
  // effect on restart — the running bridge keeps its in-memory pairing until
  // then.
  router.post('/homekit/reset-pairing', requireAdmin, (req, res) => {
    try {
      const hapDir = path.join(__dirname, '..', '..', 'persist', 'homekit');
      let removed = 0;
      if (fs.existsSync(hapDir)) {
        for (const f of fs.readdirSync(hapDir)) {
          if (/^(AccessoryInfo|IdentifierCache)\./.test(f)) {
            fs.unlinkSync(path.join(hapDir, f));
            removed++;
          }
        }
      }
      res.json({
        success: true,
        message: removed
          ? `Removed ${removed} pairing file(s). Restart LSH, then re-add the bridge in the Home app with your PIN.`
          : 'No pairing files found — the bridge is already unpaired.',
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── What goes into HomeKit: everything LSH could bridge, and what's excluded ──
  router.get('/homekit/accessories', requireAdmin, (req, res) => {
    const pool = clients.homekitBridge;
    const ex = readConfigFile().homekit?.exclude || {};
    const inHk = (key) => !!pool?.has(key);
    const devices = (pool?.devicesForHomekit?.() || sensorRegistry?.getDevices().filter((d) => d.homekit?.length) || []).map((d) => ({
      key: d.key, label: d.label || d.key, type: d.type || '', room: d.room || null,
      kinds: [...(d.homekit || []), ...((d.sensors || []).some((x) => x.homekit?.service === 'Lightbulb') ? ['light'] : [])],
      bridged: inHk(`device:${d.key}`) || [...(pool?.byKey?.keys() || [])].some((k) => k.startsWith(`device:${d.key}#`)),
    }));
    res.json({ success: true, data: {
      running: !!pool,
      exclude: { devices: ex.devices || [], types: ex.types || [], cameras: ex.cameras || [], scenes: ex.scenes || [], relays: ex.relays || [] },
      devices,
      types: [...new Set(devices.map((d) => d.type).filter(Boolean))].sort(),
      cameras: [...(pool?.cameras?.keys() || [])].map((name) => ({ name, bridged: inHk(`camera:${name}`), standalone: !!pool?.standaloneDone?.has(name) })),
      scenes: (pool?.scenes?.() || []).map((s) => ({ id: s.id, name: s.name, bridged: inHk(`scene:${s.id}`) })),
      relays: (pool?.relays?.() || []).map((r) => ({ index: r.index, name: r.name, bridged: inHk(`relay:${r.index}`) })),
      count: pool?.byKey?.size ?? null,
    } });
  });

  router.post('/settings/homekit-exclude', requireAdmin, (req, res) => {
    const b = req.body || {};
    const list = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter(Boolean))] : []);
    const exclude = { devices: list(b.devices), types: list(b.types), cameras: list(b.cameras), scenes: list(b.scenes), relays: list(b.relays) };
    const cur = readConfigFile();
    try { writeConfigFile({ ...cur, homekit: { ...(cur.homekit || {}), exclude } }) }
    catch (err) { return res.status(500).json({ success: false, error: err.message }) }
    const pool = clients.homekitBridge;
    if (!pool?.applyExclude) return res.json({ success: true, message: 'Saved — HomeKit isn’t running; applies when it starts.' });
    const r = pool.applyExclude(exclude);
    res.json({ success: true, data: r, message: `Saved and applied — ${r.removed} removed from HomeKit, ${r.added} added back.` });
  });
};
