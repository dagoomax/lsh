'use strict';

// Ring cameras / video doorbells — snapshot proxy, status, sign-in. See src/ring-client.js.
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

// ring-client.js is an on-demand module: on a core-only install it is not
// there until the Ring module is installed
function ringAuth(opts) {
  let RingAuth;
  try { ({ RingAuth } = require('../ring-client')); } catch {
    throw new Error('The Ring module is not installed — install it in Settings → Integration Modules');
  }
  return new RingAuth(opts);
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  // Snapshot proxy — the Ring access token never reaches the browser
  router.get('/ring/snapshot/:id', async (req, res) => {
    if (!clients.ring) return res.status(503).end();
    try {
      const buffer = await clients.ring.getSnapshot(req.params.id);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(buffer);
    } catch (err) {
      res.status(/Unknown Ring camera/.test(err.message) ? 404 : 502).end();
    }
  });

  router.get('/ring/status', (req, res) => {
    const cfg = readConfigFile().ring;
    let signedIn = false;
    try { signedIn = ringAuth({ authFile: cfg?.authFile, seedToken: cfg?.refreshToken }).signedIn(); } catch { /* module not installed */ }
    res.json({ success: true, data: clients.ring ? clients.ring.status() : { signedIn, cameras: [] } });
  });

  // Sign in to Ring. Two steps when the account has two-step verification
  // (every Ring account does): the first call answers { needs2fa, prompt },
  // the second repeats it with `code`. The password is used for the sign-in
  // and never stored — only Ring's refresh token is (persist/ring-auth.json).
  router.post('/settings/ring/login', requireAdmin, async (req, res) => {
    const { email, password, code } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, error: 'email and password are required' });
    try {
      const current = readConfigFile();
      const auth = ringAuth({ authFile: current.ring?.authFile, endpoints: current.ring?.endpoints });
      const out = await auth.login(String(email), String(password), String(code || ''));
      if (out.needs2fa) return res.json({ success: true, needs2fa: true, message: out.prompt });
      if (!current.ring) writeConfigFile({ ...current, ring: { pollInterval: 60 } });
      res.json({ success: true, message: clients.ring ? 'Signed in to Ring.' : 'Signed in to Ring. Restart to apply.' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });
};
