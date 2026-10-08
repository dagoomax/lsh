'use strict';

// Embedded Claude Code chat — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router, ctx) {
  const { requireAdmin, requirePermission } = ctx;

  // ── Embedded Claude Code chat ────────────────────────────
  // Real code-editing agent (see src/claude-code-client.js) — admin-only,
  // 'claudeCode' permission-flag-only (installer-mode-granted, see above),
  // AND local/LAN-only, all three gated below on every route, not just the
  // read ones.
  const claudeCode = require('../claude-code-client');
  const requireLocalAdmin = [requireAdmin, requirePermission('claudeCode'), (req, res, next) => {
    if (!claudeCode.isLocalRequest(req)) {
      return res.status(403).json({ success: false, error: 'Claude Code chat is only reachable from localhost/LAN, not over remote access' });
    }
    next();
  }];

  router.get('/claude-code/status', requireLocalAdmin, (req, res) => {
    const cc = claudeCode.readClaudeCodeConfig();
    res.json({ success: true, data: { enabled: cc.enabled, configured: !!cc.apiKey, model: cc.model } });
  });

  router.get('/claude-code/history', requireLocalAdmin, (req, res) => {
    res.json({ success: true, data: { messages: claudeCode.getHistory() } });
  });

  router.post('/claude-code/message', requireLocalAdmin, async (req, res) => {
    const text = String((req.body || {}).message || '').trim();
    if (!text) return res.status(400).json({ success: false, error: 'message is required' });
    try {
      const result = await claudeCode.sendMessage(text);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[ClaudeCode] message failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/claude-code/reset', requireLocalAdmin, (req, res) => {
    claudeCode.resetConversation();
    res.sendStatus(204);
  });
};
