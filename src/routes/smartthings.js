'use strict';

// SmartThings — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  // ── SmartThings ───────────────────────────────────────────

  router.post('/settings/test-smartthings', requireAdmin, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });
    try {
      const r = await fetch('https://api.smartthings.com/v1/devices', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401 || r.status === 403) {
        return res.json({ success: false, error: 'Invalid token' });
      }
      if (!r.ok) return res.json({ success: false, error: `SmartThings returned HTTP ${r.status}` });
      const data = await r.json();
      const count = data?.items?.length ?? 0;
      res.json({ success: true, message: `Connected — ${count} device(s) found`, data: { count } });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/smartthings', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { token, deviceIds, webhookUrl, webhookSecret } = req.body;
    const updated = {
      ...current,
      smartthings: {
        token: (token && !token.includes('•')) ? token : (current.smartthings?.token ?? ''),
        deviceIds: Array.isArray(deviceIds) ? deviceIds : (current.smartthings?.deviceIds ?? []),
        webhookUrl: webhookUrl || (current.smartthings?.webhookUrl ?? ''),
        webhookSecret: (webhookSecret && !webhookSecret.includes('•')) ? webhookSecret : (current.smartthings?.webhookSecret ?? ''),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'SmartThings settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // SmartThings webhook endpoint for real-time state updates. Public (see
  // PUBLIC_API in auth.js) since SmartThings' servers, not a logged-in
  // browser, call it — so it must verify itself instead of relying on the
  // session/token auth every other route gets. A shared secret (set in
  // Settings → SmartThings, and configured as a header/query param on the
  // SmartThings-side HTTP action that calls this URL) is required before any
  // event is trusted; without one, an internet-reachable install would let
  // anyone who finds this URL spoof arbitrary sensor state for real devices.
  router.post('/webhooks/smartthings', (req, res) => {
    const smartThings = clients.smartThings; // see note on the /take route above
    if (!smartThings) return res.status(503).json({ success: false, error: 'SmartThings not configured' });

    const configuredSecret = readConfigFile().smartthings?.webhookSecret || '';
    if (!configuredSecret) {
      console.warn('[SmartThings Webhook] Rejected — no webhookSecret configured (Settings → SmartThings)');
      return res.status(503).json({ success: false, error: 'Webhook secret not configured — set one in Settings → SmartThings' });
    }
    const suppliedSecret = req.headers['x-webhook-secret'] || req.query?.secret || '';
    if (suppliedSecret !== configuredSecret) {
      console.warn(`[SmartThings Webhook] Rejected — bad secret from ${req.ip}`);
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }

    try {
      smartThings.handleWebhookEvent(req.body);
      res.json({ success: true });
    } catch (err) {
      console.error(`[SmartThings Webhook] Error: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });
};
