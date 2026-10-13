'use strict';

// Aquilo liquid-level sensors — status, gateway test and settings (applied
// live). Client: src/aquilo-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;

  router.get('/aquilo/status', (req, res) => {
    const c = clients.aquilo;
    res.json({ success: true, data: c ? c.status() : null });
  });

  // Read a gateway's /state without saving anything
  router.post('/aquilo/test', requireAdmin, async (req, res) => {
    const host = String(req.body?.host || '').trim();
    if (!host) return res.status(400).json({ success: false, error: 'host required' });
    try {
      const { fetchState } = require('../aquilo-client');
      const state = await fetchState(host);
      res.json({ success: true, data: state, message: `Aquilo gateway ${host}: ${state.tanks.length} tank(s) — ${state.tanks.map((t) => `${t.name || t.id} ${t.fill ?? '?'}%`).join(', ') || 'none reported yet'}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/aquilo', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const gateways = (Array.isArray(b.gateways) ? b.gateways : [])
      .map((g) => ({ host: String(g?.host || '').trim(), name: String(g?.name || '').trim() }))
      .filter((g) => g.host)
      .map((g) => (g.name ? g : { host: g.host }));
    const bad = gateways.find((g) => !/^[\w.-]+(:\d{1,5})?$/.test(g.host));
    if (bad) return res.status(400).json({ success: false, error: `"${bad.host}" is not a host or IP (optionally :port)` });
    const names = {};
    for (const [id, n] of Object.entries(b.names || {})) if (String(n || '').trim()) names[String(id)] = String(n).trim();
    const aquilo = {
      gateways,
      pollSeconds: Math.max(30, Number(b.pollSeconds) || 300),
      staleHours: Math.max(1, Number(b.staleHours) || 24),
      overflowPct: Math.min(100, Math.max(1, Number(b.overflowPct) || 90)),
      exclude: [...new Set((b.exclude || []).map(String))],
      names,
    };
    let current;
    try {
      current = readConfigFile();
      writeConfigFile({ ...current, aquilo });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    try {
      if (clients.aquilo) await clients.aquilo.reconfigure(aquilo);
      else if (gateways.length) {
        const AquiloClient = require('../aquilo-client');
        const c = new AquiloClient({ ...current, aquilo }, store, sensorRegistry);
        await c.start();
        clients.aquilo = c;
      }
      res.json({ success: true, message: 'Saved and applied.', data: clients.aquilo?.status() || null });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};
