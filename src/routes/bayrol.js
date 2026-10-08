'use strict';

// Bayrol — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Bayrol ─────────────────────────────────────────────────────────────

  router.post('/settings/test-bayrol', requireAdmin, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'email and password are required' });
    const https = require('https');
    const HOST  = 'www.bayrol-poolaccess.de';

    // Cookie-aware request helper — mirrors bayrol-client.js so the test
    // exercises the same login flow the poller actually uses.
    let session = '';
    const request = (method, path, body) => new Promise((resolve, reject) => {
      const headers = {};
      if (session) headers['Cookie'] = session;
      if (body) {
        headers['Content-Type']   = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reqH.destroy(); reject(new Error('Connection timeout')); } }, 10000);
      const reqH = https.request({ hostname: HOST, port: 443, path, method, headers }, r => {
        const sess = [].concat(r.headers['set-cookie'] || []).find(c => c.startsWith('PHPSESSID='));
        if (sess) session = sess.split(';')[0];
        let data = '';
        r.on('data', d => (data += d));
        r.on('end', () => { done = true; clearTimeout(timer); resolve({ status: r.statusCode, body: data }); });
      });
      reqH.on('error', err => { if (!done) { done = true; clearTimeout(timer); reject(err); } });
      if (body) reqH.write(body);
      reqH.end();
    });

    try {
      // 1. GET login page → initial PHPSESSID
      await request('GET', '/webview/p/login.php?r=reg');
      // 2. POST credentials
      const loginBody = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&login=Anmelden`;
      await request('POST', '/webview/p/login.php?r=reg', loginBody);
      // 3. Confirm by loading the plants page — only reachable when logged in
      const { body } = await request('GET', '/webview/p/plants.php');
      if (/var\s+clients\s*=\s*\[/.test(body) || /[?&]c=\d+/.test(body)) {
        res.json({ success: true, message: 'Login successful — credentials are valid' });
      } else {
        res.json({ success: false, error: 'Login failed (check credentials)' });
      }
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/bayrol', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { poolName, username, password, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        bayrol: {
          poolName:     poolName     != null ? poolName : (current.bayrol?.poolName || ''),
          username:     username     || current.bayrol?.username     || '',
          password:     (password && !password.includes('•')) ? password : (current.bayrol?.password || ''),
          pollInterval: pollInterval != null ? parseInt(pollInterval) : (current.bayrol?.pollInterval ?? 60),
        },
      });
      res.json({ success: true, message: 'Bayrol settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
