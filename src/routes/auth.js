'use strict';

// Auth — split out of src/api-routes.js; registered in order by createApiRoutes().
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { auth, connectionMgr, relayController, reqIsSecure, requireAdmin, requireInstallerMode, store } = ctx;

  // ── Auth ──────────────────────────────────────────────────────────────────

  router.post('/auth/setup', async (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (auth.hasUsers()) return res.status(409).json({ success: false, error: 'Already set up — sign in instead.' });
    const { adminUsername, adminPassword } = req.body;
    if (!adminUsername || !adminPassword) {
      return res.status(400).json({ success: false, error: 'adminUsername and adminPassword required' });
    }
    if (adminPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    try {
      const user  = await auth.createUser(adminUsername.trim(), adminPassword, 'admin');
      const token = auth.signToken(user);
      auth.setCookie(res, token, reqIsSecure(req));
      res.json({ success: true, user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/auth/login', async (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (auth.isLoginRateLimited(req.ip)) {
      console.warn(`[Auth] Login rate-limited for ${req.ip} — too many recent failures`);
      return res.status(429).json({ success: false, error: 'Too many failed login attempts. Try again in a few minutes.' });
    }
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password required' });
    }
    const user = await auth.authenticate(username, password);
    console.log(`[Auth] Login ${user ? 'OK' : 'FAILED'} for "${username}" from ${req.ip} over ${reqIsSecure(req) ? 'https' : 'http'} — ${(req.headers['user-agent'] || '?').slice(0, 200)}`);
    if (!user) { auth.recordLoginFailure(req.ip); return res.status(401).json({ success: false, error: 'Invalid username or password' }); }
    auth.recordLoginSuccess(req.ip);
    const token = auth.signToken(user);
    auth.setCookie(res, token, reqIsSecure(req));
    res.json({ success: true, user });
  });

  router.post('/auth/logout', (req, res) => {
    if (auth) auth.clearCookie(res);
    res.json({ success: true });
  });

  router.get('/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    // req.user comes straight off the JWT (id/username/role only) — enrich
    // with a fresh permissions read so a revoked flag reflects immediately
    // instead of waiting for the session to expire. API tokens have no
    // underlying user record; they're already admin-equivalent everywhere
    // (see requirePermission above), so report both capabilities as granted.
    // Note: 'terminal' is deliberately NOT granted here for the api-token
    // identity — see the no-bearer-token comment at the top of
    // src/terminal-server.js. An API token stays admin-equivalent for
    // flows/claudeCode but never for the interactive shell.
    const permissions = req.user.id === 'api-token'
      ? { flows: true, claudeCode: true, terminal: false }
      : (auth?.getUsers().find((u) => u.id === req.user.id)?.permissions || { flows: false, claudeCode: false, terminal: false });
    res.json({ success: true, data: { ...req.user, permissions } });
  });

  router.post('/auth/change-password', async (req, res) => {
    if (!auth || !req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }
    const ok = await auth.authenticate(req.user.username, currentPassword);
    if (!ok) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    try {
      await auth.changePassword(req.user.id, newPassword);
      res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/auth/users', (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    res.json({ success: true, data: auth.getUsers(), installerMode: readConfigFile().installerMode === true });
  });

  // Grant/revoke the flows/claudeCode capability flags — see requirePermission
  // and requireInstallerMode above for why both gates are needed here.
  router.put('/auth/users/:id/permissions', requireAdmin, requireInstallerMode, (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    const { flows, claudeCode, terminal } = req.body || {};
    try {
      let permissions;
      if (flows !== undefined) permissions = auth.setPermission(req.params.id, 'flows', flows);
      if (claudeCode !== undefined) permissions = auth.setPermission(req.params.id, 'claudeCode', claudeCode);
      if (terminal !== undefined) permissions = auth.setPermission(req.params.id, 'terminal', terminal);
      res.json({ success: true, data: permissions });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/auth/users', async (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    const { username, password, role = 'viewer' } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'username and password required' });
    if (password.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ success: false, error: 'role must be admin or viewer' });
    try {
      const user = await auth.createUser(username, password, role);
      res.json({ success: true, data: user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/auth/users/:id', (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    try {
      auth.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/auth/tokens', requireAdmin, (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    res.json({ success: true, data: auth.getApiTokens() });
  });

  router.post('/auth/tokens', requireAdmin, (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Token name required' });
    try {
      const token = auth.createApiToken(name);
      res.json({ success: true, token });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete('/auth/tokens/:id', requireAdmin, (req, res) => {
    if (!auth) return res.status(503).json({ success: false, error: 'Auth not configured' });
    try {
      auth.deleteApiToken(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/connection', (req, res) => {
    res.json({ success: true, data: connectionMgr ? connectionMgr.getStatus() : { source: null } });
  });

  router.get('/status', (req, res) => {
    const grouped = store.getGrouped();
    grouped.relays = relayController.getAll();
    res.json({ success: true, data: grouped });
  });

  router.get('/battery', (req, res) => {
    res.json({ success: true, data: store.getGrouped().battery });
  });

  router.get('/solar', (req, res) => {
    res.json({ success: true, data: store.getGrouped().solar });
  });

  router.get('/grid', (req, res) => {
    res.json({ success: true, data: store.getGrouped().grid });
  });

  router.get('/loads', (req, res) => {
    const grouped = store.getGrouped();
    res.json({
      success: true,
      data: { ac: grouped.acLoads, dc: grouped.dcLoads },
    });
  });

  router.get('/relays', (req, res) => {
    res.json({ success: true, data: relayController.getAll() });
  });

  router.post('/relay/:index/state', requireAdmin, async (req, res) => {
    const index = parseInt(req.params.index);
    const { on } = req.body;

    if (typeof on !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Body must contain { "on": true/false }' });
    }

    const relay = relayController.config.relays.find((r) => r.index === index);
    if (!relay) {
      return res.status(404).json({ success: false, error: 'Relay not found' });
    }

    try {
      await relayController.setState(index, on);
      res.json({ success: true, data: { index, on } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
