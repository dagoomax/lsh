'use strict';

// LAN scanner (src/lsh-lan.js — tool module `lsh-lan`, installed on demand),
// saved devices (src/lsh-lan-inventory.js) and the device monitor
// (src/lsh-lan-monitor.js).
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { requireAdmin, store, sensorRegistry, clients } = ctx;

  const load = (res) => {
    try {
      const lan = require('../lsh-lan');
      require.resolve('multicast-dns');
      return lan;
    } catch {
      res.status(409).json({ success: false, needsModule: true, module: 'lsh-lan', error: 'The LAN scanner module is not installed on this LSH host' });
      return null;
    }
  };

  // Monitor singleton — started here when monitoring is switched on at runtime.
  const monitor = (cfg) => {
    try {
      const m = require('../lsh-lan-monitor').getMonitor({ config: { lshLan: cfg }, store, sensorRegistry, automation: clients.automation });
      return m;
    } catch { return null; }
  };
  const ensureMonitor = (lanCfg) => {
    if (!lanCfg.enabled) return null;
    const m = monitor(lanCfg);
    if (m) { m.configure(lanCfg); m.start(); }
    return m;
  };
  const enableMonitoring = () => {
    const current = readConfigFile();
    const lanCfg = { checkSeconds: 60, autoScanMinutes: 0, notifyNew: true, notifyOffline: true, ...(current.lshLan || {}) };
    if (!lanCfg.enabled) {
      lanCfg.enabled = true;
      writeConfigFile({ ...current, lshLan: lanCfg });
    }
    return ensureMonitor(lanCfg);
  };

  // Full sweep of this host's LAN(s): ~15–40 s depending on network size.
  // Every scan updates the saved-device list (new / ip-changed tags).
  router.post('/lsh-lan/scan', requireAdmin, async (req, res) => {
    const lan = load(res);
    if (!lan) return;
    try {
      const data = await lan.scan();
      const { newDevices, baseline } = lan.inventory.mergeScan(data);
      res.json({ success: true, data: { ...data, newDevices: newDevices.length, baseline } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/lsh-lan/inspect', requireAdmin, async (req, res) => {
    const lan = load(res);
    if (!lan) return;
    try {
      res.json({ success: true, data: await lan.inspect({ ip: String(req.body?.ip || '').trim() }) });
    } catch (err) {
      res.status(/Invalid/.test(err.message) ? 400 : 500).json({ success: false, error: err.message });
    }
  });

  // ── Saved devices ────────────────────────────────────────
  router.get('/lsh-lan/devices', requireAdmin, (req, res) => {
    const lan = load(res);
    if (!lan) return;
    const cfg = readConfigFile().lshLan || {};
    const m = cfg.enabled ? monitor(cfg) : null;
    res.json({
      success: true,
      data: lan.inventory.list((k) => m?.statusOf(k) || null),
      tags: lan.inventory.allTags(),
      settings: { checkSeconds: 60, autoScanMinutes: 0, notifyNew: true, notifyOffline: true, enabled: false, ...cfg },
      monitorRunning: !!m?.running,
    });
  });

  router.patch('/lsh-lan/devices/:key', requireAdmin, (req, res) => {
    const lan = load(res);
    if (!lan) return;
    try {
      const dev = lan.inventory.update(req.params.key, req.body || {});
      if (dev.monitored) enableMonitoring();
      res.json({ success: true, data: dev });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  router.delete('/lsh-lan/devices/:key', requireAdmin, (req, res) => {
    const lan = load(res);
    if (!lan) return;
    try {
      lan.inventory.remove(req.params.key);
      res.json({ success: true });
    } catch (err) {
      res.status(409).json({ success: false, error: err.message });
    }
  });

  // Mark known: clears "new" / "ip-changed" (all devices, or body.keys)
  router.post('/lsh-lan/devices/acknowledge', requireAdmin, (req, res) => {
    const lan = load(res);
    if (!lan) return;
    lan.inventory.acknowledge(Array.isArray(req.body?.keys) ? req.body.keys : null);
    res.json({ success: true });
  });

  router.post('/settings/lsh-lan', requireAdmin, (req, res) => {
    const b = req.body || {};
    const current = readConfigFile();
    const lanCfg = {
      ...(current.lshLan || {}),
      enabled: b.enabled !== undefined ? !!b.enabled : !!current.lshLan?.enabled,
      checkSeconds: Math.min(Math.max(parseInt(b.checkSeconds) || 60, 15), 3600),
      autoScanMinutes: Math.min(Math.max(parseInt(b.autoScanMinutes) || 0, 0), 1440),
      notifyNew: b.notifyNew !== false,
      notifyOffline: b.notifyOffline !== false,
    };
    if (lanCfg.autoScanMinutes > 0 && lanCfg.autoScanMinutes < 5) lanCfg.autoScanMinutes = 5;
    try {
      writeConfigFile({ ...current, lshLan: lanCfg });
      const m = ensureMonitor(lanCfg);
      if (!lanCfg.enabled) monitor(lanCfg)?.stop();
      res.json({ success: true, message: lanCfg.enabled ? `Monitoring on${m ? '' : ' — restart LSH to start it'}.` : 'Monitoring off.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
