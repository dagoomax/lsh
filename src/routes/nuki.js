'use strict';

// Nuki — connection tests and settings (applied live: the client runs in
// its own process, restarted with the new config). Client: src/nuki-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const INTEGRATIONS = require('../integrations');

const MASK = '••••••••';
const masked = (v) => typeof v === 'string' && v.includes('•');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;
  const Nuki = () => require('../nuki-client');

  // Probe a Bridge ({ host, port, token }) or Nuki Web ({ webToken }) without saving.
  // A masked token from the form means "the saved one" (by bridge index).
  router.post('/settings/test-nuki', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const saved = readConfigFile().nuki || {};
    try {
      if (b.webToken !== undefined) {
        const token = masked(b.webToken) ? saved.webToken : String(b.webToken).trim();
        if (!token) return res.status(400).json({ success: false, error: 'Nuki Web API token required' });
        const locks = (await Nuki().testWeb(token)) || [];
        return res.json({ success: true, message: `Nuki Web: ${locks.length} device(s) — ${locks.map((l) => l.name).join(', ') || 'none'}` });
      }
      const host = String(b.host || '').trim();
      if (!host) return res.status(400).json({ success: false, error: 'Bridge IP required' });
      const token = masked(b.token) ? saved.bridges?.[Number(b.index)]?.token : String(b.token || '').trim();
      if (!token) return res.status(400).json({ success: false, error: 'Bridge token required' });
      const list = (await Nuki().testBridge({ host, port: b.port, token })) || [];
      res.json({ success: true, message: `Bridge ${host}: ${list.length} device(s) — ${list.map((d) => d.name).join(', ') || 'none paired'}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/nuki', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const current = readConfigFile();
    const prev = current.nuki || {};
    const bridges = (Array.isArray(b.bridges) ? b.bridges : []).map((x, i) => ({
      name: String(x?.name || '').trim(),
      host: String(x?.host || '').trim(),
      port: Number(x?.port) || 8080,
      token: masked(x?.token) ? prev.bridges?.[i]?.token || '' : String(x?.token || '').trim(),
    })).filter((x) => x.host && x.token);
    const bad = bridges.find((x) => !/^[\w.-]+$/.test(x.host));
    if (bad) return res.status(400).json({ success: false, error: `"${bad.host}" is not an IP or host name` });
    const webToken = masked(b.webToken) ? prev.webToken || '' : String(b.webToken || '').trim();
    const nuki = { bridges, ...(webToken ? { webToken } : {}), pollSeconds: Math.max(5, Number(b.pollSeconds) || 15) };
    try {
      writeConfigFile({ ...current, nuki });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    const it = INTEGRATIONS.find((x) => x.file === 'nuki-client');
    if (!clients.moduleHost) return res.json({ success: true, message: 'Saved — restart LSH to apply.' });
    try {
      if ((bridges.length || webToken) && !require('fs').existsSync(require('path').join(__dirname, '..', 'nuki-client.js'))) {
        await require('../module-manager').install(['nuki'], readConfigFile());
      }
      await clients.moduleHost.apply(it);
      res.json({ success: true, message: 'Saved and applied.' });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};

module.exports.MASK = MASK;
