'use strict';

// Matter bridge setup (pairing code / QR) — split out of src/api-routes.js; registered in order by createApiRoutes().
const QRCode = require('qrcode');
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  // ── Matter bridge setup (pairing code / QR) ────────────────
  router.get('/matter/bridge/setup', async (req, res) => {
    const bridge = clients.matterBridge;
    if (!bridge) return res.status(404).json({ success: false, error: 'Matter bridge not enabled' });
    const info = bridge.getSetupInfo();
    // Rendered server-side (not the CDN-script client-side approach HomeKit's
    // QR uses) so the dashboard doesn't depend on reaching an external CDN
    // to show a pairing code — this is the only thing standing between a
    // fresh install and commissioning working at all.
    if (info.qrPairingCode) {
      try { info.qrDataUri = await QRCode.toDataURL(info.qrPairingCode, { width: 220, margin: 1 }); }
      catch { /* setup still usable via the manual code if this fails */ }
    }
    res.json({ success: true, data: info });
  });

  router.post('/settings/matter', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { bridge, controller } = req.body;
    try {
      writeConfigFile({
        ...current,
        matter: {
          bridge: {
            enabled: !!bridge?.enabled,
            port: bridge?.port ? Number(bridge.port) : (current.matter?.bridge?.port || 5540),
            passcode: bridge?.passcode ?? current.matter?.bridge?.passcode ?? '',
            discriminator: bridge?.discriminator ?? current.matter?.bridge?.discriminator ?? '',
          },
          controller: {
            enabled: !!controller?.enabled,
          },
        },
      });
      res.json({ success: true, message: 'Matter settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
