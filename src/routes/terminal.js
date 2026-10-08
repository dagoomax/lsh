'use strict';

// Embedded Linux terminal — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin, requireInstallerMode, requirePermission } = ctx;

  // ── Embedded Linux terminal ──────────────────────────────
  // Real interactive shell (see src/terminal-server.js — a Socket.IO
  // namespace at '/terminal', not a route below) — admin-only, 'terminal'
  // permission-flag-only (installer-mode-granted, see above), local/LAN-only,
  // AND config.terminal.enabled must be explicitly turned on. Strictly more
  // powerful than the Claude Code chat above (an uncontained shell, not
  // confined to this repo), so it gets every one of that feature's gates
  // plus the enabled flag — see src/terminal-server.js for the full
  // reasoning. This route only reports status; the socket namespace itself
  // re-checks every gate independently on connection.
  const terminalServer = require('../terminal-server');
  const requireTerminalAccess = [requireAdmin, requirePermission('terminal'), (req, res, next) => {
    if (!terminalServer.isLocalRequest(req)) {
      return res.status(403).json({ success: false, error: 'Terminal is only reachable from localhost/LAN, not over remote access' });
    }
    next();
  }];

  router.get('/terminal/status', requireTerminalAccess, (req, res) => {
    res.json({ success: true, data: { enabled: terminalServer.readTerminalConfig().enabled } });
  });

  router.post('/settings/terminal', requireAdmin, requireInstallerMode, (req, res) => {
    const current = readConfigFile();
    try {
      writeConfigFile({ ...current, terminal: { enabled: !!(req.body || {}).enabled } });
      res.json({ success: true, message: 'Terminal setting saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Note: the public (unauthenticated) GET /custom.css this settings key
  // feeds is registered in server.js, not here — auth.js's middleware never
  // exempts anything under /api/* (by design: dynamic data must stay gated
  // even when a path looks like a static asset), so it has to live outside
  // the /api prefix to actually be reachable pre-login, same as /i18n/*.json
  // vs the gated /api/i18n/*.json.
};
