'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

const PERSIST_DIR  = path.join(__dirname, '..', 'persist');
const USERS_FILE   = path.join(PERSIST_DIR, 'users.json');
const TOKENS_FILE  = path.join(PERSIST_DIR, 'api-tokens.json');
const CONFIG_PATH  = path.join(__dirname, '..', 'config.json');
const COOKIE_NAME  = 'lsh-session';
const SALT_ROUNDS  = 12;
const TOKEN_TTL    = '7d';

// API tokens (POST /api/auth/tokens) have no user/role of their own — they're
// static machine-to-machine credentials, not tied to a person. Minting one is
// itself an admin-only action (see requireAdmin in api-routes.js), so a
// request authenticated via a valid token is treated as admin-equivalent —
// whoever holds it was deliberately handed it by an admin. Previously the
// middleware called next() here without setting req.user at all, which meant
// every admin-role check (req.user?.role !== 'admin') silently rejected
// legitimate token-authenticated requests as unauthorized.
const API_TOKEN_USER = { id: 'api-token', username: 'api-token', role: 'admin' };

// Login brute-force throttling — in-memory per-IP sliding window. Single
// fork process (no cluster), so no shared store is needed; resets on
// restart, an acceptable tradeoff for a self-hosted single-household app
// versus pulling in a rate-limiting dependency for one endpoint.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;
const _loginFailures = new Map(); // ip -> [failure timestamps]

function recentFailures(ip, now) {
  const kept = (_loginFailures.get(ip) || []).filter(t => now - t < LOGIN_WINDOW_MS);
  if (kept.length) _loginFailures.set(ip, kept);
  else _loginFailures.delete(ip);
  return kept;
}

// Paths that never require authentication
const PUBLIC_HTML = new Set(['/login.html', '/setup.html']);
const PUBLIC_JS   = new Set(['/login.js', '/setup.js', '/theme.js', '/common.js', '/i18n.js']);
const PUBLIC_API  = ['/api/auth/login', '/api/auth/setup', '/api/webhooks/smartthings'];

function ensurePersist() {
  if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
}

// In-memory cache — loadUsers()/loadTokens() are on the auth middleware's
// hot path (every request), so they'd otherwise do a synchronous disk read
// + JSON.parse on every single request just to check "is this array
// non-empty" or "does this token exist". Single fork process (no cluster),
// and saveUsers()/saveTokens() are the only mutators, so an in-process
// cache invalidated there stays consistent with no cross-process gap.
let _usersCache = null;
function loadUsers() {
  if (_usersCache) return _usersCache;
  if (!fs.existsSync(USERS_FILE)) return (_usersCache = []);
  try { _usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { _usersCache = []; }
  return _usersCache;
}

function saveUsers(users) {
  ensurePersist();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  _usersCache = users;
}

let _tokensCache = null;
function loadTokens() {
  if (_tokensCache) return _tokensCache;
  if (!fs.existsSync(TOKENS_FILE)) return (_tokensCache = []);
  try { _tokensCache = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch { _tokensCache = []; }
  return _tokensCache;
}

function saveTokens(tokens) {
  ensurePersist();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  _tokensCache = tokens;
}

let _jwtSecret = null;
function jwtSecret() {
  if (_jwtSecret) return _jwtSecret;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (cfg.jwtSecret) { _jwtSecret = cfg.jwtSecret; return _jwtSecret; }
      // Auto-generate and persist
      _jwtSecret = crypto.randomBytes(32).toString('hex');
      cfg.jwtSecret = _jwtSecret;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      return _jwtSecret;
    }
  } catch { /* ignore */ }
  _jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  return _jwtSecret;
}

const auth = {
  COOKIE_NAME,

  hasUsers() { return loadUsers().length > 0; },

  // Login brute-force throttling (see LOGIN_MAX_ATTEMPTS/_loginFailures above)
  isLoginRateLimited(ip) { return recentFailures(ip, Date.now()).length >= LOGIN_MAX_ATTEMPTS; },
  recordLoginFailure(ip) {
    const now = Date.now();
    _loginFailures.set(ip, [...recentFailures(ip, now), now]);
  },
  recordLoginSuccess(ip) { _loginFailures.delete(ip); },

  async createUser(username, password, role = 'admin') {
    const users = loadUsers();
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error('Username already exists');
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = {
      id:        crypto.randomBytes(8).toString('hex'),
      username:  username.trim(),
      passwordHash,
      role,
      // Sensitive capabilities beyond plain admin/viewer — off by default even
      // for admins. Only settable via setPermission(), which itself requires
      // installerMode (see requireInstallerMode in api-routes.js): granting
      // these needs filesystem/config access, not just a web admin session.
      permissions: { flows: false, claudeCode: false },
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
    return { id: user.id, username: user.username, role: user.role, permissions: user.permissions };
  },

  async authenticate(username, password) {
    const users = loadUsers();
    const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? { id: user.id, username: user.username, role: user.role } : null;
  },

  async changePassword(userId, newPassword) {
    const users = loadUsers();
    const user  = users.find(u => u.id === userId);
    if (!user) throw new Error('User not found');
    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    saveUsers(users);
  },

  getUsers() {
    // Users created before permissions existed have no `permissions` field —
    // normalize to the same all-false default createUser() now seeds, rather
    // than letting `undefined.flows` throw wherever this gets read.
    return loadUsers().map(({ id, username, role, createdAt, permissions }) => ({
      id, username, role, createdAt,
      permissions: { flows: !!permissions?.flows, claudeCode: !!permissions?.claudeCode },
    }));
  },

  // Live per-user capability check — reads storage fresh every call (not the
  // JWT) so a revoked permission takes effect on a held session's very next
  // request, not just after re-login.
  hasPermission(userId, key) {
    const user = loadUsers().find(u => u.id === userId);
    return !!user?.permissions?.[key];
  },

  // key must be 'flows' or 'claudeCode'; caller (requireInstallerMode in
  // api-routes.js) is what actually gates who may call this.
  setPermission(userId, key, value) {
    if (!['flows', 'claudeCode'].includes(key)) throw new Error(`Unknown permission '${key}'`);
    const users = loadUsers();
    const user  = users.find(u => u.id === userId);
    if (!user) throw new Error('User not found');
    user.permissions = { flows: !!user.permissions?.flows, claudeCode: !!user.permissions?.claudeCode, [key]: !!value };
    saveUsers(users);
    return user.permissions;
  },

  deleteUser(id) {
    const users = loadUsers();
    const idx   = users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error('User not found');
    if (users.length === 1) throw new Error('Cannot delete the last user');
    users.splice(idx, 1);
    saveUsers(users);
  },

  // API tokens — static bearer tokens for machine-to-machine access
  createApiToken(name) {
    const tokens = loadTokens();
    const token  = crypto.randomBytes(32).toString('hex');
    tokens.push({
      id:        crypto.randomBytes(8).toString('hex'),
      name:      name.trim(),
      token,
      createdAt: new Date().toISOString(),
    });
    saveTokens(tokens);
    return token;
  },

  verifyApiToken(token) {
    if (!token) return false;
    return loadTokens().some(t => t.token === token);
  },

  getApiTokens() {
    return loadTokens().map(({ id, name, createdAt }) => ({ id, name, createdAt }));
  },

  // Value lookup for server-side embedding (e.g. generated Loxone templates).
  // Never expose this through an API response.
  getApiTokenValue(id) {
    return loadTokens().find(t => t.id === id)?.token || null;
  },

  deleteApiToken(id) {
    saveTokens(loadTokens().filter(t => t.id !== id));
  },

  signToken(user) {
    return jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      jwtSecret(),
      { expiresIn: TOKEN_TTL }
    );
  },

  verifyToken(token) {
    try { return jwt.verify(token, jwtSecret()); } catch { return null; }
  },

  // Parse JWT from cookie header string (for socket.io handshake)
  verifyFromCookieHeader(cookieHeader = '') {
    const match = cookieHeader.match(/(?:^|;\s*)lsh-session=([^;]+)/);
    if (!match) return null;
    return this.verifyToken(decodeURIComponent(match[1]));
  },

  setCookie(res, token, isSecure) {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure:   !!isSecure,
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });
  },

  clearCookie(res) {
    res.clearCookie(COOKIE_NAME);
  },

  // Express auth middleware
  middleware(isSecure = false) {
    return (req, res, next) => {
      const p = req.path;

      // Static assets needed by unauthenticated pages — always public.
      // Never applies to /api/* (dynamic data must authenticate even when the
      // path looks like an asset, e.g. /api/roborock/:duid/map.png).
      if (
        !p.startsWith('/api/') && (
          PUBLIC_HTML.has(p) ||
          PUBLIC_JS.has(p) ||
          p.endsWith('.css') ||
          p.endsWith('.svg') ||
          p.endsWith('.ico') ||
          p.endsWith('.png') ||
          p.endsWith('.woff2') ||
          p.endsWith('.woff') ||
          p.endsWith('manifest.json') ||
          p.startsWith('/lib/') ||
          p.startsWith('/i18n/') ||
          p.startsWith('/socket.io/') ||
          // React PWA shell: static files only (all data comes from /api,
          // which stays authenticated). Must be public — the iOS home-screen
          // webapp has manifest scope /react/, and a 302 to /login.html at
          // launch would leave that scope (Safari opens out-of-scope pages in
          // a separate context whose cookie the webapp never gets); the app
          // shows its own in-app LoginScreen instead.
          p === '/react' ||
          p.startsWith('/react/') ||
          p.startsWith('/.well-known/')
        )
      ) return next();

      // Login/setup API endpoints are always public
      if (PUBLIC_API.some(a => p.startsWith(a))) return next();

      // First-run guard: no users yet → force setup
      if (!auth.hasUsers()) {
        if (p.startsWith('/api/')) {
          return res.status(503).json({ success: false, error: 'Server not configured. Go to /setup.html to create your admin account.' });
        }
        return res.redirect('/setup.html');
      }

      // Check ?token= query param (API tokens only)
      const queryToken = req.query?.token;
      if (queryToken) {
        if (auth.verifyApiToken(queryToken)) { req.user = API_TOKEN_USER; return next(); }
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }

      // Check Authorization: Bearer header (API token or JWT)
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (auth.verifyApiToken(token)) { req.user = API_TOKEN_USER; return next(); }
        const payload = auth.verifyToken(token);
        if (payload) { req.user = payload; return next(); }
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }

      // Check session cookie
      const sessionCookie = req.cookies?.[COOKIE_NAME];
      if (sessionCookie) {
        const payload = auth.verifyToken(sessionCookie);
        if (payload) { req.user = payload; return next(); }
        auth.clearCookie(res);
      }

      // Not authenticated
      if (p.startsWith('/api/')) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
      return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    };
  },
};

module.exports = auth;
