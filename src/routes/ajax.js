'use strict';

// SIA DC-09 receivers — Ajax and Jablotron: settings (applied live: each
// receiver runs in its own process) and what it has heard.
// Clients: src/ajax-client.js, src/jablotron-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const INTEGRATIONS = require('../integrations');

const masked = (v) => typeof v === 'string' && v.includes('•');

const PROVIDERS = [
  { id: 'ajax', file: 'ajax-client', port: 12128 },
  { id: 'jablotron', file: 'jablotron-client', port: 12129 },
];

module.exports = function register(router, ctx) {
  for (const p of PROVIDERS) registerProvider(router, ctx, p);
};

function registerProvider(router, ctx, p) {
  const { clients, requireAdmin, store } = ctx;

  router.get(`/${p.id}/status`, requireAdmin, (req, res) => {
    const accounts = readConfigFile()[p.id]?.accounts || [];
    res.json({
      success: true,
      data: accounts.map((a) => {
        const key = `${p.id}/${String(a.account).toUpperCase()}`;
        return { account: a.account, name: a.name, online: store.get(`${key}/online`), mode: store.get(`${key}/mode`), lastEvent: store.get(`${key}/lastEvent`), at: store.get(`${key}/event`)?.at || null };
      }),
    });
  });

  router.post(`/settings/${p.id}`, requireAdmin, async (req, res) => {
    const b = req.body || {};
    const current = readConfigFile();
    const prev = current[p.id]?.accounts || [];
    const accounts = [];
    for (const [i, a] of (Array.isArray(b.accounts) ? b.accounts : []).entries()) {
      const account = String(a?.account || '').trim().toUpperCase();
      if (!account) continue;
      if (!/^[0-9A-F]{3,16}$/.test(account)) return res.status(400).json({ success: false, error: `Account "${account}": 3-16 characters 0-9 / A-F, as set on the panel` });
      const key = masked(a.key) ? prev[i]?.key || '' : String(a.key || '');
      if (key && ![16, 24, 32].includes(Buffer.byteLength(key))) return res.status(400).json({ success: false, error: `Account ${account}: the encryption key must be 16, 24 or 32 characters` });
      const names = (text, fallback) => {
        const out = {};
        for (const line of String(text ?? '').split('\n')) {
          const m = /^\s*(\d+)\s*[=:]\s*(.+?)\s*$/.exec(line);
          if (m) out[m[1]] = m[2];
        }
        return text === undefined && fallback ? { ...fallback } : out;
      };
      const zones = names(a.zonesText, a.zones);
      const areas = names(a.areasText, a.areas);
      accounts.push({ account, name: String(a.name || '').trim(), ...(key ? { key } : {}), pingMinutes: Math.max(1, Number(a.pingMinutes) || 1), zones, ...(Object.keys(areas).length ? { areas } : {}) });
    }
    const cfg = { port: Math.min(65535, Math.max(1, Number(b.port) || p.port)), accounts };
    const other = PROVIDERS.find((x) => x.id !== p.id);
    if (accounts.length && current[other.id]?.accounts?.length && Number(current[other.id].port || other.port) === cfg.port) {
      return res.status(400).json({ success: false, error: `Port ${cfg.port} is already used by the ${other.id === 'ajax' ? 'Ajax' : 'Jablotron'} receiver` });
    }
    try {
      writeConfigFile({ ...current, [p.id]: cfg });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    const it = INTEGRATIONS.find((x) => x.file === p.file);
    if (!clients.moduleHost) return res.json({ success: true, message: 'Saved — restart LSH to apply.' });
    try {
      if (accounts.length && !require('fs').existsSync(require('path').join(__dirname, '..', `${p.file}.js`))) {
        await require('../module-manager').install([p.id], readConfigFile());
      }
      await clients.moduleHost.apply(it);
      res.json({ success: true, message: accounts.length ? `Saved — listening on port ${cfg.port}.` : 'Saved — receiver stopped.' });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
}
