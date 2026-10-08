'use strict';

// Private (locally-added) agenda events — never synced to/from Google — split out of src/api-routes.js; registered in order by createApiRoutes().
const privateEvents = require('../private-events');

module.exports = function register(router) {
  // ── Private (locally-added) agenda events — never synced to/from Google ─
  router.post('/agenda/private', (req, res) => {
    const { date, title, time } = req.body || {};
    if (!date || !title) return res.status(400).json({ success: false, error: 'date and title required' });
    const item = privateEvents.add({ date, title, time });
    res.json({ success: true, data: item });
  });

  router.delete('/agenda/private/:id', (req, res) => {
    const ok = privateEvents.remove(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  });
};
