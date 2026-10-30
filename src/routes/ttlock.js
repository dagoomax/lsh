'use strict';

// TTLock — connection test and settings (applied live: the client runs in
// its own process). Client: src/ttlock-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const INTEGRATIONS = require('../integrations');

const masked = (v) => typeof v === 'string' && v.includes('•');

function fromBody(b, prev = {}) {
  return {
    clientId: String(b.clientId || '').trim(),
    clientSecret: masked(b.clientSecret) ? prev.clientSecret || '' : String(b.clientSecret || '').trim(),
    username: String(b.username || '').trim(),
    password: masked(b.password) ? prev.password || '' : String(b.password || ''),
    region: b.region === 'cn' ? 'cn' : 'eu',
    pollSeconds: Math.max(30, Number(b.pollSeconds) || 60),
  };
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  router.post('/settings/test-ttlock', requireAdmin, async (req, res) => {
    const cfg = fromBody(req.body || {}, readConfigFile().ttlock);
    if (!cfg.clientId || !cfg.clientSecret || !cfg.username || !cfg.password) {
      return res.status(400).json({ success: false, error: 'Client ID, client secret, account and password are all needed' });
    }
    try {
      const locks = await require('../ttlock-client').test(cfg);
      const names = locks.map((l) => `${l.lockAlias || l.lockName}${Number(l.hasGateway) === 1 ? '' : ' (no gateway)'}`);
      res.json({ success: true, message: `TTLock: ${locks.length} lock(s) — ${names.join(', ') || 'none in this account'}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/ttlock', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const ttlock = fromBody(req.body || {}, current.ttlock);
    try {
      writeConfigFile({ ...current, ttlock });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    const it = INTEGRATIONS.find((x) => x.file === 'ttlock-client');
    if (!clients.moduleHost) return res.json({ success: true, message: 'Saved — restart LSH to apply.' });
    try {
      if (it.when({ ttlock }) && !require('fs').existsSync(require('path').join(__dirname, '..', 'ttlock-client.js'))) {
        await require('../module-manager').install(['ttlock'], readConfigFile());
      }
      await clients.moduleHost.apply(it);
      res.json({ success: true, message: 'Saved and applied.' });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};
