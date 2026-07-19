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

// Paths that never require authentication
const PUBLIC_HTML = new Set(['/login.html', '/setup.html']);
const PUBLIC_JS   = new Set(['/login.js', '/setup.js', '/theme.js', '/common.js', '/i18n.js']);
const PUBLIC_API  = ['/api/auth/login', '/api/auth/setup', '/api/webhooks/smartthings'];

function ensurePersist() {
  if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function saveUsers(users) {
  ensurePersist();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadTokens() {
  if (!fs.existsSync(TOKENS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch { return []; }
}

function saveTokens(tokens) {
  ensurePersist();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
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
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
    return { id: user.id, username: user.username, role: user.role };
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
    return loadUsers().map(({ id, username, role, createdAt }) => ({ id, username, role, createdAt }));
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
        if (auth.verifyApiToken(queryToken)) return next();
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }

      // Check Authorization: Bearer header (API token or JWT)
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (auth.verifyApiToken(token)) return next();
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
