'use strict';

// Ajax — SIA DC-09 receiver settings (applied live: the receiver runs in its
// own process) and what it has heard. Client: src/ajax-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const INTEGRATIONS = require('../integrations');

const masked = (v) => typeof v === 'string' && v.includes('•');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store } = ctx;

  router.get('/ajax/status', requireAdmin, (req, res) => {
    const accounts = readConfigFile().ajax?.accounts || [];
    res.json({
      success: true,
      data: accounts.map((a) => {
        const key = `ajax/${String(a.account).toUpperCase()}`;
        return { account: a.account, name: a.name, online: store.get(`${key}/online`), mode: store.get(`${key}/mode`), lastEvent: store.get(`${key}/lastEvent`), at: store.get(`${key}/event`)?.at || null };
      }),
    });
  });

  router.post('/settings/ajax', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const current = readConfigFile();
    const prev = current.ajax?.accounts || [];
    const accounts = [];
    for (const [i, a] of (Array.isArray(b.accounts) ? b.accounts : []).entries()) {
      const account = String(a?.account || '').trim().toUpperCase();
      if (!account) continue;
      if (!/^[0-9A-F]{3,16}$/.test(account)) return res.status(400).json({ success: false, error: `Account "${account}": 3-16 characters 0-9 / A-F, as set in the Ajax app` });
      const key = masked(a.key) ? prev[i]?.key || '' : String(a.key || '');
      if (key && ![16, 24, 32].includes(Buffer.byteLength(key))) return res.status(400).json({ success: false, error: `Account ${account}: the encryption key must be 16, 24 or 32 characters` });
      const zones = {};
      for (const line of String(a.zonesText ?? '').split('\n')) {
        const m = /^\s*(\d+)\s*[=:]\s*(.+?)\s*$/.exec(line);
        if (m) zones[m[1]] = m[2];
      }
      if (a.zonesText === undefined && a.zones) Object.assign(zones, a.zones);
      accounts.push({ account, name: String(a.name || '').trim(), ...(key ? { key } : {}), pingMinutes: Math.max(1, Number(a.pingMinutes) || 1), zones });
    }
    const ajax = { port: Math.min(65535, Math.max(1, Number(b.port) || 12128)), accounts };
    try {
      writeConfigFile({ ...current, ajax });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    const it = INTEGRATIONS.find((x) => x.file === 'ajax-client');
    if (!clients.moduleHost) return res.json({ success: true, message: 'Saved — restart LSH to apply.' });
    try {
      if (accounts.length && !require('fs').existsSync(require('path').join(__dirname, '..', 'ajax-client.js'))) {
        await require('../module-manager').install(['ajax'], readConfigFile());
      }
      await clients.moduleHost.apply(it);
      res.json({ success: true, message: accounts.length ? `Saved — listening on port ${ajax.port}.` : 'Saved — receiver stopped.' });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};
