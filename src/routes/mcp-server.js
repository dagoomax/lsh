'use strict';

// MCP Server — settings + MCP bots (src/mcp-bots.js). Registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin, clients } = ctx;
  const bots = () => clients.mcpBots;
  const run = (res, fn) => { try { res.set('Cache-Control', 'no-store').json({ success: true, data: fn() }) } catch (err) { res.status(400).json({ success: false, error: err.message }) } };
  // Bots are managed only from a signed-in admin session — an API token
  // (or a bot) must not be able to mint more credentials.
  const sessionAdmin = (req, res, next) => (req.user?.id === 'api-token'
    ? res.status(403).json({ success: false, error: 'Manage MCP bots from a signed-in admin session, not an API token' })
    : next());

  // ── MCP Server ───────────────────────────────────────────────────────────
  router.post('/settings/mcp', requireAdmin, sessionAdmin, (req, res) => {
    const current = readConfigFile();
    const b = req.body || {};
    const publicUrl = String(b.publicUrl ?? current.mcp?.publicUrl ?? '').trim().replace(/\/+$/, '');
    if (publicUrl && !/^https:\/\/[^\s/]+$/.test(publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl)) {
      return res.status(400).json({ success: false, error: 'Public URL is the https:// address the AI services reach LSH at, e.g. https://lsh.example.ts.net' });
    }
    try {
      writeConfigFile({ ...current, mcp: { ...(current.mcp || {}), enabled: !!b.enabled, allowApiTokens: b.allowApiTokens === true, publicUrl: publicUrl || undefined } });
      res.json({ success: true, message: 'MCP server settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/mcp-bots', requireAdmin, sessionAdmin, (req, res) => run(res, () => {
    const mcp = readConfigFile().mcp || {};
    return { bots: bots().list(), enabled: !!mcp.enabled, publicUrl: mcp.publicUrl || '', allowApiTokens: mcp.allowApiTokens === true };
  }));
  router.post('/mcp-bots', requireAdmin, sessionAdmin, (req, res) => run(res, () => {
    const out = bots().create(req.body || {});
    console.log(`[MCP] ${req.user.username} created bot "${out.bot.name}" (${out.bot.access})`);
    return out; // the token is only ever returned here and on rotate
  }));
  router.put('/mcp-bots/:id', requireAdmin, sessionAdmin, (req, res) => run(res, () => bots().update(req.params.id, req.body || {})));
  router.post('/mcp-bots/:id/rotate', requireAdmin, sessionAdmin, (req, res) => run(res, () => bots().rotate(req.params.id)));
  router.post('/mcp-bots/:id/revoke-oauth', requireAdmin, sessionAdmin, (req, res) => run(res, () => { bots().revokeOAuth(req.params.id); return true }));
  router.delete('/mcp-bots/:id', requireAdmin, sessionAdmin, (req, res) => run(res, () => { bots().remove(req.params.id); console.log(`[MCP] ${req.user.username} removed bot ${req.params.id}`); return true }));
  router.get('/mcp-bots/audit', requireAdmin, sessionAdmin, (req, res) => run(res, () => bots().recent(req.query.bot || null, Math.min(500, Number(req.query.limit) || 100))));
};
