'use strict';

// Device manuals — private GitHub repo, downloaded on demand and cached
// (src/manuals.js).
const manuals = require('../manuals');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  router.get('/manuals', async (req, res) => {
    try { res.json({ success: true, data: await manuals.list(readConfigFile(), { refresh: req.query.refresh === '1' }) }) }
    catch (err) { res.status(err.auth ? 403 : 502).json({ success: false, error: err.message, needsToken: !!err.auth }) }
  });

  // The PDF itself — fetched from GitHub the first time, then from the cache
  router.get('/manuals/:id/pdf', async (req, res) => {
    try {
      const { path: p, manual } = await manuals.get(readConfigFile(), req.params.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${manual.file.split('/').pop()}"`);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.sendFile(p);
    } catch (err) {
      res.status(err.auth ? 403 : err.status === 404 ? 404 : 502).json({ success: false, error: err.message, needsToken: !!err.auth });
    }
  });

  router.delete('/manuals/:id', requireAdmin, (req, res) => {
    res.json({ success: true, data: { removed: manuals.remove(req.params.id) } });
  });

  router.post('/settings/manuals', requireAdmin, async (req, res) => {
    const current = readConfigFile();
    const prev = current.manuals || {};
    const b = req.body || {};
    const token = String(b.githubToken ?? '').includes('•') ? prev.githubToken : String(b.githubToken || '').trim() || undefined;
    if (token && !/^(github_pat_|ghp_|gho_|ghs_)[A-Za-z0-9_]{20,}$/.test(token)) return res.status(400).json({ success: false, error: 'That doesn’t look like a GitHub token (github_pat_… or ghp_…)' });
    const next = { ...prev, githubToken: token, repo: String(b.repo || prev.repo || '').trim() || undefined };
    try {
      writeConfigFile({ ...current, manuals: next });
      const data = await manuals.list({ ...current, manuals: next }, { refresh: true }).catch((e) => ({ error: e.message }));
      res.json({ success: true, message: data.error ? `Saved, but: ${data.error}` : `Saved — ${data.manuals.length} manuals available.` });
    } catch (err) { res.status(500).json({ success: false, error: err.message }) }
  });
};
