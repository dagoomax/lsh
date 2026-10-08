'use strict';

// UI preferences — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── UI preferences ───────────────────────────────────────
  // Lightweight read for the shared header (common.js) to hide nav links.
  // Also carries the app version — read once at module load (a restart is
  // already required to pick up a new package.json anyway) rather than
  // hitting the filesystem on every request.
  const { version: appVersion } = require('../../package.json');
  router.get('/ui-prefs', (req, res) => {
    const cfg = readConfigFile();
    res.json({ success: true, data: {
      hideMqtt: !!cfg.ui?.hideMqtt,
      hideLogs: !!cfg.ui?.hideLogs,
      hideCssEditor: !!cfg.ui?.hideCssEditor,
      version: appVersion,
    } });
  });

  router.post('/settings/ui', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { hideMqtt, hideLogs, hideCssEditor, customCss } = req.body;
    try {
      writeConfigFile({
        ...current,
        ui: {
          ...current.ui,
          hideMqtt: !!hideMqtt,
          hideLogs: !!hideLogs,
          hideCssEditor: !!hideCssEditor,
          ...(customCss !== undefined ? { customCss: String(customCss) } : {}),
        },
      });
      res.json({ success: true, message: 'Interface settings saved.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
