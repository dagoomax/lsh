'use strict';

// Solar Accelerator Connect — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Solar Accelerator Connect ──────────────────────────────

  router.post('/settings/test-solaraccelerator', requireAdmin, async (req, res) => {
    const { host, port, password } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const headers = {};
      if (password) headers.Authorization = 'Basic ' + Buffer.from(`admin:${password}`).toString('base64');
      const r = await fetch(`http://${host}${port ? `:${port}` : ''}/api/status`, { headers, signal: AbortSignal.timeout(5000) });
      if (r.status === 401) return res.json({ success: false, error: 'Gateway requires the portal password' });
      if (!r.ok) return res.json({ success: false, error: `Gateway returned HTTP ${r.status}` });
      const data = await r.json();
      if (!data.firmware_version) return res.json({ success: false, error: 'No firmware_version in response — is this really an SA Connect gateway?' });
      if (data.mode !== 'STA') return res.json({ success: false, error: `Gateway is in ${data.mode || '?'} mode — finish its setup wizard first` });
      res.json({ success: true, message: `Connected — firmware ${data.firmware_version}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/solaraccelerator', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, password } = req.body;
    const updated = {
      ...current,
      solaraccelerator: {
        host: host ?? current.solaraccelerator?.host ?? '',
        port: port ? Number(port) : (current.solaraccelerator?.port || undefined),
        password: (password && !password.includes('•')) ? password : (current.solaraccelerator?.password ?? ''),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'Solar Accelerator settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
