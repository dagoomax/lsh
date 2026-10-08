'use strict';

// Uploaded furniture pictures for the home plan — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const { editPinOk } = require('./helpers');

module.exports = function register(router) {
  // ── Uploaded furniture pictures for the home plan ─────────
  // Body: { name, data } with data a base64 image data-URI. Stored in
  // persist/plan-decor/ and served back through the authed route below.
  const DECOR_IMG_DIR = path.join(__dirname, '..', '..', 'persist', 'plan-decor');
  const DECOR_IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

  router.post('/plan-decor/upload', (req, res) => {
    if (!editPinOk(req)) return res.status(403).json({ success: false, error: 'PIN_REQUIRED' });
    const m = String(req.body?.data || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ success: false, error: 'data must be a png/jpeg/webp/gif data-URI' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return res.status(400).json({ success: false, error: 'Empty image' });
    if (buf.length > 3 * 1024 * 1024) return res.status(400).json({ success: false, error: 'Image too large (max 3 MB)' });
    const base = String(req.body?.name || 'furniture').replace(/\.[^.]*$/, '')
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'furniture';
    const file = `${base}-${Date.now().toString(36)}.${DECOR_IMG_EXT[m[1]]}`;
    fs.mkdirSync(DECOR_IMG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DECOR_IMG_DIR, file), buf);
    res.json({ success: true, url: `/api/plan-decor/img/${file}` });
  });

  router.get('/plan-decor/img/:file', (req, res) => {
    const file = String(req.params.file || '');
    if (!/^[a-z0-9-]+-[a-z0-9]+\.(png|jpg|webp|gif)$/.test(file)) return res.status(400).end();
    res.sendFile(path.join(DECOR_IMG_DIR, file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });
};
