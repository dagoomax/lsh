'use strict';

// Custom CSS themes — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Custom CSS themes ────────────────────────────────────
  // "Built-in" themes ship with the app (react-dashboard/public/css-themes/
  // — bundled into dist/ by Vite, read-only from here); "custom" ones are
  // whatever an admin has saved from the CSS editor's Themes row, living in
  // persist/css-themes/ like every other user-generated file (plan-decor
  // images, flow snapshots, …). Loading a theme just copies its text into
  // the live Custom CSS field client-side — these routes never touch
  // ui.customCss themselves.
  const BUILTIN_THEME_DIR = path.join(__dirname, '..', '..', 'react-dashboard', 'public', 'css-themes');
  const CUSTOM_THEME_DIR = path.join(__dirname, '..', '..', 'persist', 'css-themes');

  // Same sanitization as plan-decor uploads above — keeps the filename
  // confined to its directory (no `..`, no path separators) regardless of
  // what a client sends.
  function sanitizeThemeName(raw) {
    return String(raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function listCssThemes(dir) {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4)).sort();
    } catch {
      return [];
    }
  }

  router.get('/settings/css-themes', (req, res) => {
    res.json({ success: true, data: {
      builtin: listCssThemes(BUILTIN_THEME_DIR),
      custom: listCssThemes(CUSTOM_THEME_DIR),
    } });
  });

  router.get('/settings/css-themes/:kind/:name', (req, res) => {
    const dir = req.params.kind === 'builtin' ? BUILTIN_THEME_DIR
      : req.params.kind === 'custom' ? CUSTOM_THEME_DIR : null;
    const name = sanitizeThemeName(req.params.name);
    if (!dir || !name) return res.status(400).json({ success: false, error: 'kind must be builtin or custom, name required' });
    try {
      const css = fs.readFileSync(path.join(dir, `${name}.css`), 'utf8');
      res.json({ success: true, data: { css } });
    } catch {
      res.status(404).json({ success: false, error: 'Theme not found' });
    }
  });

  router.post('/settings/css-themes/custom/:name', requireAdmin, (req, res) => {
    const name = sanitizeThemeName(req.params.name);
    if (!name) return res.status(400).json({ success: false, error: 'Invalid theme name' });
    const css = String((req.body || {}).css ?? '');
    if (css.length > 200 * 1024) return res.status(400).json({ success: false, error: 'CSS too large (max 200 KB)' });
    fs.mkdirSync(CUSTOM_THEME_DIR, { recursive: true });
    fs.writeFileSync(path.join(CUSTOM_THEME_DIR, `${name}.css`), css);
    res.json({ success: true, data: { name } });
  });

  router.delete('/settings/css-themes/custom/:name', requireAdmin, (req, res) => {
    const name = sanitizeThemeName(req.params.name);
    if (!name) return res.status(400).json({ success: false, error: 'Invalid theme name' });
    try { fs.unlinkSync(path.join(CUSTOM_THEME_DIR, `${name}.css`)); } catch { /* already gone */ }
    res.sendStatus(204);
  });
};
