'use strict';

// Yale doorbell cameras — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Yale doorbell cameras ────────────────────────────────────────────────
  // Two-step flow because the Yale/August API ties the very first login for
  // a given installId to a one-time email/SMS code (see yale-client.js's
  // header comment) — "Test Connection" attempts login and, if that install
  // isn't verified yet, sends the code and tells the UI to show the code
  // field; "Verify" submits it. Both instantiate a fresh YaleAuthenticator,
  // which is safe because it reads/writes the same persist/yale-auth.json
  // installId + token cache yale-client.js's poller uses, so this doesn't
  // need its own session state.

  router.post('/settings/test-yale', requireAdmin, async (req, res) => {
    const { username, password, loginMethod } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'username and password are required' });
    try {
      const { YaleAuthenticator } = require('../yale-client');
      const auth = new YaleAuthenticator({ username, password, loginMethod });
      const state = await auth.login();
      if (state === 'authenticated') {
        res.json({ success: true, message: 'Login successful — this account is already verified.' });
      } else if (state === 'requires_validation') {
        await auth.sendVerificationCode();
        res.json({ success: true, requiresVerification: true, message: `Verification code sent via ${loginMethod === 'phone' ? 'SMS' : 'email'} — enter it below.` });
      } else {
        res.json({ success: false, error: 'Login failed — check the username and password.' });
      }
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/verify-yale', requireAdmin, async (req, res) => {
    const { username, password, loginMethod, code } = req.body;
    if (!username || !password || !code) return res.status(400).json({ success: false, error: 'username, password and code are required' });
    try {
      const { YaleAuthenticator } = require('../yale-client');
      const auth = new YaleAuthenticator({ username, password, loginMethod });
      const state = await auth.validateVerificationCode(code);
      if (state === 'authenticated') {
        res.json({ success: true, message: 'Verified! Save your settings and restart LSH to start polling.' });
      } else {
        res.json({ success: false, error: `Verification did not complete (${state}) — check the code and try again.` });
      }
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/yale', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { username, password, loginMethod, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        yale: {
          username:     username     || current.yale?.username     || '',
          password:     (password && !password.includes('•')) ? password : (current.yale?.password || ''),
          loginMethod:  loginMethod === 'phone' ? 'phone' : 'email',
          pollInterval: pollInterval != null ? parseInt(pollInterval) : (current.yale?.pollInterval ?? 30),
        },
      });
      res.json({ success: true, message: 'Yale settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
