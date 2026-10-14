'use strict';

// LG webOS TVs — Settings (the TV list), discovery and pairing.
// Client: src/lgwebos-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const IP_RE = /^[0-9a-z.:-]+$/i;
const MAC_RE = /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i;

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;
  const tvList = (c) => (Array.isArray(c?.tvs) ? c.tvs : c?.host ? [c] : []);

  const restart = async (cfg) => {
    clients.lgwebos?.stop();
    delete clients.lgwebos;
    if (!tvList(cfg).length) return;
    const LgWebosClient = require('../lgwebos-client');
    const c = new LgWebosClient({ lgwebos: cfg }, store, sensorRegistry);
    await c.start();
    clients.lgwebos = c;
  };

  router.get('/settings/lgwebos', requireAdmin, (req, res) => {
    const tvs = tvList(readConfigFile().lgwebos);
    const live = new Map((clients.lgwebos?.tvs || []).map((t) => [t.host, t.info()]));
    res.json({ success: true, data: tvs.map((t) => ({ host: t.host, name: t.name || '', mac: t.mac || '', ...(live.get(t.host) ? { live: live.get(t.host) } : {}) })) });
  });

  // the whole list; applied at once (TVs connect, a new one asks on screen)
  router.post('/settings/lgwebos', requireAdmin, async (req, res) => {
    const seen = new Set();
    const tvs = (Array.isArray(req.body?.tvs) ? req.body.tvs : []).map((t) => ({
      host: String(t?.host || '').trim(), name: String(t?.name || '').trim().slice(0, 60) || undefined,
      mac: String(t?.mac || '').trim() || undefined,
    })).filter((t) => t.host && !seen.has(t.host) && seen.add(t.host));
    for (const t of tvs) {
      if (!IP_RE.test(t.host)) return res.status(400).json({ success: false, error: `“${t.host}” isn’t an address` });
      if (t.mac && !MAC_RE.test(t.mac)) return res.status(400).json({ success: false, error: `“${t.mac}” isn’t a MAC address (like a8:23:fe:12:34:56)` });
    }
    const cur = readConfigFile();
    const next = { ...(cur.lgwebos || {}), tvs };
    delete next.host; delete next.name; delete next.mac;
    writeConfigFile({ ...cur, lgwebos: next });
    try { await restart(next) } catch (err) { return res.json({ success: true, message: `Saved; restart LSH to apply (${err.message})` }) }
    res.json({ success: true, message: tvs.length ? `Saved — ${tvs.length} TV(s). A TV not paired yet asks on its screen to allow LSH.` : 'Saved' });
  });

  router.post('/lgwebos/discover', requireAdmin, async (req, res) => {
    try { res.json({ success: true, data: await require('../lgwebos-client').discover() }) }
    catch (err) { res.json({ success: false, error: err.message }) }
  });

  // forget the pairing and ask again on the TV
  router.post('/lgwebos/pair', requireAdmin, (req, res) => {
    try { clients.lgwebos?.repair(String(req.body?.host || '')); res.json({ success: true, message: 'Look at the TV: allow LSH there' }) }
    catch (err) { res.status(400).json({ success: false, error: err.message }) }
  });

  router.get('/lgwebos/status', (req, res) => {
    res.json({ success: true, data: (clients.lgwebos?.tvs || []).map((t) => t.info()) });
  });
};
