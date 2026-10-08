'use strict';

// VRM test + partial save — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile, vrmGetInstallation, vrmResolveAuth } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── VRM test + partial save ───────────────────────────────
  router.post('/settings/test-vrm', requireAdmin, async (req, res) => {
    const { email, password, apiToken, installationId } = req.body;
    try {
      const { authHeader } = await vrmResolveAuth({ apiToken, email, password });
      const method = apiToken?.trim() ? 'API token' : 'email/password';

      if (installationId) {
        const name = await vrmGetInstallation(installationId, authHeader);
        return res.json({ success: true, message: `Connected via ${method} — installation: "${name}"` });
      }
      res.json({ success: true, message: `VRM login successful via ${method}` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-vrm-live', requireAdmin, async (req, res) => {
    const { email, password, apiToken, installationId } = req.body;
    if (!installationId) {
      return res.status(400).json({ success: false, error: 'Installation ID is required' });
    }
    if (!apiToken && (!email || !password)) {
      return res.status(400).json({ success: false, error: 'Provide an API token or email + password' });
    }

    try {
      // Step 1: Resolve auth
      const { authHeader } = await vrmResolveAuth({ apiToken, email, password });
      const headers = { 'x-authorization': authHeader };

      // Step 2: Get installation name
      const instName = await vrmGetInstallation(installationId, headers['x-authorization']);

      // Step 3: Fetch live diagnostics
      const diagRes = await fetch(
        `https://vrmapi.victronenergy.com/v2/installations/${installationId}/diagnostics?count=1000`,
        { headers }
      );
      if (!diagRes.ok) {
        return res.json({ success: false, error: `Could not fetch live data (${diagRes.status})` });
      }
      const diagData = await diagRes.json();
      const records = diagData?.records || [];

      // Map diagnostic idDataAttributes to readable values
      const find = (codes) => {
        for (const code of codes) {
          const r = records.find((x) => x.idDataAttribute === code);
          if (r && r.formattedValue !== undefined) return r.formattedValue;
          if (r && r.rawValue !== undefined) return r.rawValue;
        }
        return null;
      };

      // VRM attribute IDs for common values
      const live = {
        installationName: instName,
        soc:         find([852, 855]),          // Battery SOC %
        voltage:     find([859, 806]),          // Battery voltage V
        solar:       find([855, 743, 790]),     // PV power W
        grid:        find([860, 808]),          // Grid power W
        consumption: find([817, 858]),          // AC consumption W
        state:       find([846, 847]),          // System state
        timestamp:   records[0]?.timestamp ?? null,
      };

      res.json({ success: true, data: live });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/vrm', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { email, password, apiToken, installationId } = req.body;
    const updated = {
      ...current,
      vrm: {
        ...current.vrm,
        apiToken: (apiToken && !apiToken.includes('•')) ? apiToken : (current.vrm?.apiToken ?? ''),
        email: email ?? current.vrm?.email ?? '',
        installationId: installationId ?? current.vrm?.installationId ?? '',
        password: (password && !password.includes('•'))
          ? password
          : current.vrm?.password || '',
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'VRM settings saved' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
