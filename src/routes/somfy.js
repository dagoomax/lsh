'use strict';

// Somfy — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Somfy ──────────────────────────────────────────────────────────────

  router.post('/settings/test-somfy', requireAdmin, async (req, res) => {
    const { mode, region = 'europe', host, port = 8443, email, password } = req.body;
    const https = require('https');

    // Cloud mode: Somfy SSO password grant → Bearer token → list devices.
    if (mode === 'cloud') {
      if (!email || !password)
        return res.status(400).json({ success: false, error: 'email and password are required' });
      const CLOUD_HOSTS = { europe: 'ha101-1.overkiz.com', oceania: 'ha201-1.overkiz.com', north_america: 'ha401-1.overkiz.com' };
      const cloudHost = CLOUD_HOSTS[region];
      if (!cloudHost) return res.status(400).json({ success: false, error: `Unknown region: ${region}` });
      const SOMFY_CLIENT_ID     = '0d8e920c-1478-11e7-a377-02dd59bd3041_1ewvaqmclfogo4kcsoo0c8k4kso884owg08sg8c40sk4go4ksg';
      const SOMFY_CLIENT_SECRET = '12k73w1n540g8o4cokg0cw84cog840k84cwggscwg884004kgk';
      const post = (hostname, path, formBody, headers) => new Promise((resolve, reject) => {
        const r = https.request({ hostname, port: 443, path, method: formBody ? 'POST' : 'GET',
          headers: { Accept: 'application/json', ...headers }, timeout: 12000 }, rr => {
          let d = ''; rr.on('data', c => (d += c)); rr.on('end', () => resolve({ status: rr.statusCode, body: d }));
        });
        r.on('error', reject); r.on('timeout', () => { r.destroy(); reject(new Error('Connection timeout')); });
        if (formBody) r.write(formBody); r.end();
      });
      try {
        const form = new URLSearchParams({ grant_type: 'password', client_id: SOMFY_CLIENT_ID, client_secret: SOMFY_CLIENT_SECRET, username: email, password }).toString();
        const tok = await post('accounts.somfy.com', '/oauth/oauth/v2/token/jwt', form, { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) });
        let tj; try { tj = JSON.parse(tok.body); } catch { tj = {}; }
        if (!tj.access_token) {
          return res.json({ success: false, error: tj.error === 'invalid_grant' ? 'Invalid Somfy account email or password' : (tj.error_description || tj.error || `SSO HTTP ${tok.status}`) });
        }
        const dev = await post(cloudHost, '/enduser-mobile-web/enduserAPI/setup/devices', null, { Authorization: `Bearer ${tj.access_token}` });
        let arr; try { arr = JSON.parse(dev.body); } catch { arr = null; }
        if (!Array.isArray(arr)) return res.json({ success: false, error: `Token OK but device list failed (HTTP ${dev.status})` });
        return res.json({ success: true, message: `Cloud login OK — ${arr.length} device(s) found`, data: { count: arr.length } });
      } catch (err) {
        return res.json({ success: false, error: err.message });
      }
    }

    // Local mode: TaHoma box login → JSESSIONID cookie.
    if (!host || !email || !password)
      return res.status(400).json({ success: false, error: 'host, email and password are required' });
    const agent = new https.Agent({ rejectUnauthorized: false });
    const body  = `userId=${encodeURIComponent(email)}&userPassword=${encodeURIComponent(password)}`;
    try {
      await new Promise((resolve, reject) => {
        const reqH = https.request({
          hostname: host, port, agent,
          path: '/enduser-mobile-web/1/enduserAPI/login', method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
          timeout: 10000,
        }, r => {
          const cookies = [].concat(r.headers['set-cookie'] || []);
          r.resume();
          if (cookies.find(c => c.startsWith('JSESSIONID='))) resolve();
          else reject(new Error('Login failed — no session cookie (check credentials)'));
        });
        reqH.on('error', reject);
        reqH.on('timeout', () => { reqH.destroy(); reject(new Error('Connection timeout — check host/port')); });
        reqH.write(body);
        reqH.end();
      });
      res.json({ success: true, message: 'Login successful — TaHoma box reachable' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/somfy', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { mode, region, host, port, token, email, password, devices, pollInterval } = req.body;
    try {
      writeConfigFile({
        ...current,
        somfy: {
          mode:         (mode === 'cloud' || mode === 'local') ? mode : (current.somfy?.mode || 'local'),
          region:       region       || current.somfy?.region       || 'europe',
          host:         host         || current.somfy?.host         || '',
          port:         port         ?? current.somfy?.port         ?? 8443,
          token:        (token    && !token.includes('•'))    ? token    : (current.somfy?.token    || ''),
          email:        email        || current.somfy?.email        || '',
          password:     (password && !password.includes('•')) ? password : (current.somfy?.password || ''),
          devices:      Array.isArray(devices) ? devices : (current.somfy?.devices ?? []),
          pollInterval: pollInterval != null ? parseInt(pollInterval) : (current.somfy?.pollInterval ?? 30),
        },
      });
      res.json({ success: true, message: 'Somfy settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
