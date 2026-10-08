'use strict';

// HomeKit QR — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const { generateSetupUri, generateSetupID } = require('../homekit-uri');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── HomeKit QR ────────────────────────────────────────────
  router.get('/homekit/setup-uri', (req, res) => {
    const cfg = readConfigFile();
    const pin = cfg.homekit?.pin || '031-45-154';
    const setupID = cfg.homekit?.setupID || 'HEJX';
    try {
      const uri = generateSetupUri(pin, setupID);
      res.json({ success: true, data: { uri, pin, setupID } });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Reset HomeKit pairing — deletes hap-nodejs's persisted AccessoryInfo /
  // IdentifierCache files (persist/homekit) so the bridge comes back UNPAIRED
  // on the next restart, ready to add fresh in the Home app (e.g. after
  // renaming the bridge, or when a stale pairing blocks re-adding it). Takes
  // effect on restart — the running bridge keeps its in-memory pairing until
  // then.
  router.post('/homekit/reset-pairing', requireAdmin, (req, res) => {
    try {
      const hapDir = path.join(__dirname, '..', '..', 'persist', 'homekit');
      let removed = 0;
      if (fs.existsSync(hapDir)) {
        for (const f of fs.readdirSync(hapDir)) {
          if (/^(AccessoryInfo|IdentifierCache)\./.test(f)) {
            fs.unlinkSync(path.join(hapDir, f));
            removed++;
          }
        }
      }
      res.json({
        success: true,
        message: removed
          ? `Removed ${removed} pairing file(s). Restart LSH, then re-add the bridge in the Home app with your PIN.`
          : 'No pairing files found — the bridge is already unpaired.',
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
