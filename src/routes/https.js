'use strict';

// HTTPS / TLS settings — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── HTTPS / TLS settings ───────────────────────────────────────────────────

  router.post('/settings/https', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const {
      httpsEnabled, httpsPort, certFile, keyFile,
      leEnabled, lePort, leDomain, leEmail, leStaging, leCertsDir,
    } = req.body;

    const server = { ...current.server };

    if (httpsEnabled !== undefined) {
      server.https = {
        ...(server.https || {}),
        enabled:  !!httpsEnabled,
        port:     parseInt(httpsPort  || server.https?.port  || 3443),
        certFile: (certFile ?? server.https?.certFile ?? '').trim(),
        keyFile:  (keyFile  ?? server.https?.keyFile  ?? '').trim(),
      };
    }

    if (leEnabled !== undefined) {
      server.letsEncrypt = {
        ...(server.letsEncrypt || {}),
        enabled:  !!leEnabled,
        port:     parseInt(lePort     || server.letsEncrypt?.port     || 443),
        domain:   (leDomain   ?? server.letsEncrypt?.domain   ?? '').trim(),
        email:    (leEmail    ?? server.letsEncrypt?.email    ?? '').trim(),
        staging:  leStaging !== undefined ? !!leStaging : !!(server.letsEncrypt?.staging),
        certsDir: (leCertsDir ?? server.letsEncrypt?.certsDir ?? './certs').trim(),
      };
    }

    try {
      writeConfigFile({ ...current, server });
      res.json({ success: true, message: 'HTTPS settings saved. Restart server to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
