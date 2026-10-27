'use strict';

// KNX — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin, sensorRegistry, store } = ctx;

  // ── KNX ───────────────────────────────────────────────────────────────

  router.post('/settings/test-knx', requireAdmin, (req, res) => {
    const { host, port = 3671 } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const net = require('net');
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => {
      if (done) return; done = true;
      sock.destroy();
      res.json({ success: ok, message: ok ? msg : undefined, error: ok ? undefined : msg });
    };
    sock.setTimeout(5000);
    sock.connect(parseInt(port), host, () => finish(true, `TCP connection to ${host}:${port} succeeded`));
    sock.on('error', err => finish(false, err.message));
    sock.on('timeout', () => finish(false, `Connection to ${host}:${port} timed out`));
  });

  router.post('/settings/knx', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, groupAddresses } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    const sanitized = (groupAddresses || []).map(ga => ({
      address:     (ga.address || '').trim(),
      name:        (ga.name    || '').trim(),
      dpt:         (ga.dpt     || 'DPT1').trim(),
      unit:        (ga.unit    || '').trim() || undefined,
      readable:    ga.readable  !== false,
      writable:    !!ga.writable,
      homekitType: (ga.homekitType || '').trim() || undefined,
    })).filter(ga => ga.address);
    try {
      writeConfigFile({ ...current, knx: { ...current.knx, host: host.trim(), port: parseInt(port) || 3671, groupAddresses: sanitized } });
      res.json({ success: true, message: `KNX settings saved (${sanitized.length} group address(es)). Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── ETS export (src/knx-ets.js) ───────────────────────────────────────
  // LSH devices and scenes as KNX group addresses. Exporting hands out
  // addresses (kept in persist/knx-ets.json), so it's admin-only.
  //   GET /knx/ets.xml   ETS 5/6 group-address import file
  //   GET /knx/ets       the same as JSON, for the Settings preview
  // ?type=a,b limits the devices, ?scenes=0 leaves scenes out, ?mainGroup=
  // overrides knx.ets.mainGroup (0-27; the export takes five main groups).
  const etsExport = (req) => {
    const ets = require('../knx-ets');
    const cfg = readConfigFile().knx || {};
    const mainGroup = req.query.mainGroup != null ? Number(req.query.mainGroup) : (cfg.ets?.mainGroup ?? 20);
    if (!Number.isInteger(mainGroup) || mainGroup < 0 || mainGroup > 27) throw new Error('mainGroup must be 0-27 (the export uses five main groups)');
    let devices = sensorRegistry.getDevices();
    if (req.query.type) {
      const types = new Set(String(req.query.type).split(',').map((t) => t.trim()).filter(Boolean));
      devices = devices.filter((d) => types.has(d.type));
    }
    const automation = ctx.clients?.automation;
    const scenes = req.query.scenes === '0' ? [] : (automation?.scenes || []);
    const map = ets.loadMap();
    const res = ets.allocate(devices, map, { mainGroup, getValue: (k) => store.get(k), scenes });
    if (res.changed) ets.saveMap(map);
    return { ...res, mainGroup, bridge: !!cfg.lshBridge };
  };

  router.get('/knx/ets.xml', requireAdmin, (req, res) => {
    try {
      const { entries, mainGroup } = etsExport(req);
      if (!entries.length) return res.status(404).json({ success: false, error: 'No devices to export' });
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="lsh-knx-group-addresses.xml"');
      res.send(require('../knx-ets').buildEtsXml(entries, { mainGroup }));
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });

  router.get('/knx/ets', requireAdmin, (req, res) => {
    try {
      const { entries, mainGroup, full, bridge } = etsExport(req);
      const counts = {};
      for (const e of entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
      res.json({ success: true, data: { mainGroup, bridge, full, counts, total: entries.length,
        entries: entries.map(({ kind, name, cmd, status, dpt, key }) => ({ kind, name, cmd, status, dpt, key })) } });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });

  router.post('/settings/knx-ets', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const mainGroup = Number(req.body?.mainGroup ?? 20);
    if (!Number.isInteger(mainGroup) || mainGroup < 0 || mainGroup > 27) return res.status(400).json({ success: false, error: 'Main group must be 0-27' });
    try {
      writeConfigFile({ ...current, knx: { ...current.knx, lshBridge: !!req.body?.lshBridge, ets: { ...current.knx?.ets, mainGroup } } });
      res.json({ success: true, message: 'Saved. Restart to apply the bridge.' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });
};
