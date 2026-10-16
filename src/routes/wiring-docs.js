'use strict';

// Installation documentation of the wiring emulator — src/wiring-docs.js.
const docs = require('../wiring-docs');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;
  const send = (res, fn) => { try { const d = fn(); if (d === null || d === false) return res.status(404).json({ success: false, error: 'No such installation' }); res.json({ success: true, data: d }) } catch (err) { res.status(400).json({ success: false, error: err.message }) } };

  router.get('/wiring/docs', requireAdmin, (req, res) => send(res, () => docs.list().map(({ diagram, ...d }) => ({ ...d, hasDiagram: !!diagram }))));
  router.post('/wiring/docs', requireAdmin, (req, res) => send(res, () => docs.create(req.body || {})));
  router.patch('/wiring/docs/:id', requireAdmin, (req, res) => send(res, () => docs.update(req.params.id, req.body || {})));
  router.post('/wiring/docs/:id/events', requireAdmin, (req, res) => send(res, () => docs.addEvent(req.params.id, req.body || {})));
  router.delete('/wiring/docs/:id', requireAdmin, (req, res) => send(res, () => docs.remove(req.params.id)));

  // the printable document: ?id= one installation, else all; ?lang=, labels in the query as JSON (?labels=)
  router.get('/wiring/docs/export.html', requireAdmin, (req, res) => {
    const all = docs.list();
    const pick = req.query.id ? all.filter((d) => d.id === req.query.id) : all;
    let labels = {};
    try { labels = JSON.parse(String(req.query.labels || '{}')) } catch { /* defaults */ }
    const title = String(req.query.title || (pick.length === 1 ? pick[0].title : 'Installation documentation')).slice(0, 120);
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.set('Cache-Control', 'no-store');
    if (req.query.download) res.set('Content-Disposition', `attachment; filename="${title.replace(/[^\w.-]+/g, '_') || 'installation'}.html"`);
    res.type('html').send(docs.renderHtml(pick, { title, lang: String(req.query.lang || 'en').slice(0, 5), labels }));
  });
};
