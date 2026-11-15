'use strict';

// Music Assistant: players, play a library item / URI, search — on top of the
// per-player devices (src/music-assistant-client.js). Registered in order by
// createApiRoutes().

const { readConfigFile, writeConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  // ── Settings ─────────────────────────────────────────────
  const tokenOf = (req, current) => {
    const t = String(req.body?.token ?? '').trim();
    return !t || t.includes('•') ? (current.musicAssistant?.token || '') : t;
  };

  router.post('/settings/music-assistant', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const url = String(req.body?.url ?? '').trim();
    try {
      const next = { ...current };
      if (!url) delete next.musicAssistant; // an empty address switches it off
      else {
        const players = Array.isArray(req.body.players) ? req.body.players.map((s) => String(s).trim()).filter(Boolean) : (current.musicAssistant?.players || []);
        next.musicAssistant = { url, token: tokenOf(req, current), ...(players.length ? { players } : {}), ...(req.body.includeHidden ? { includeHidden: true } : {}) };
      }
      writeConfigFile(next);
      res.json({ success: true, message: 'Music Assistant settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-music-assistant', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const url = String(req.body?.url || current.musicAssistant?.url || '').trim();
    if (!url) return res.json({ success: false, error: 'No server address specified' });
    try {
      const r = await require('../music-assistant-client').testConnection(url, tokenOf(req, current));
      res.json({ success: true, message: `Connected to ${r.server || 'Music Assistant'} ${r.version} — ${r.players} player(s)` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  const param = (req, name) => req.body?.[name] ?? req.query[name];
  const need = (res) => {
    const ma = clients.musicAssistant;
    if (!ma) res.status(503).json({ success: false, error: 'Music Assistant not enabled' });
    return ma;
  };
  const fail = (res, err) => res.status(/No matching/.test(err.message) ? 404 : /not connected/.test(err.message) ? 503 : 500)
    .json({ success: false, error: err.message });

  router.get('/music-assistant/status', (req, res) => {
    const ma = clients.musicAssistant;
    res.json({ success: true, data: ma ? ma.status() : { connected: false, players: 0, error: 'not enabled' } });
  });

  router.get('/music-assistant/players', (req, res) => {
    const ma = clients.musicAssistant;
    res.json({ success: true, data: ma ? ma.getPlayers() : [] });
  });

  // GET + POST so Loxone/automations can trigger with a simple query too.
  // player: id, name or LSH device key; media: a Music Assistant URI (or a
  // list of them); option: play | replace | next | replace_next | add
  const playHandler = async (req, res) => {
    const ma = need(res);
    if (!ma) return;
    const player = param(req, 'player');
    const media = param(req, 'media');
    if (!player || !media) return res.status(400).json({ success: false, error: 'player and media required' });
    const option = param(req, 'option');
    if (option && !['play', 'replace', 'next', 'replace_next', 'add'].includes(option)) return res.status(400).json({ success: false, error: 'invalid option' });
    const radio = param(req, 'radio');
    try {
      res.json({ success: true, ...(await ma.playMedia(player, media, { option, radio: radio == null || radio === '' ? undefined : radio === true || radio === '1' || radio === 'true' })) });
    } catch (err) { fail(res, err); }
  };
  router.post('/music-assistant/play', playHandler);
  router.get('/music-assistant/play', playHandler);

  router.get('/music-assistant/search', async (req, res) => {
    const ma = need(res);
    if (!ma) return;
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ success: false, error: 'q required' });
    const types = String(req.query.types || '').split(',').map((t) => t.trim()).filter(Boolean);
    try { res.json({ success: true, data: await ma.search(q, { types, limit: req.query.limit }) }); }
    catch (err) { fail(res, err); }
  });
};
