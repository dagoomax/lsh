'use strict';

// Google Calendar (OAuth, read-only) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { clients, requireAdmin } = ctx;

  // ── Google Calendar (OAuth, read-only) ───────────────────────────────────
  router.get('/google-calendar/oauth/start', (req, res) => {
    const gc = clients.googleCalendar;
    if (!gc) return res.status(503).send('Google Calendar not configured — set clientId/clientSecret in Settings first.');
    const redirectUri = `${req.protocol}://${req.get('host')}/api/google-calendar/oauth/callback`;
    try {
      res.redirect(gc.getAuthUrl(redirectUri));
    } catch (err) {
      res.status(500).send(err.message);
    }
  });

  router.get('/google-calendar/oauth/callback', async (req, res) => {
    const gc = clients.googleCalendar;
    if (!gc) return res.status(503).send('Google Calendar not configured.');
    const { code, error } = req.query;
    if (error) return res.redirect('/react/?gc_error=' + encodeURIComponent(error));
    if (!code) return res.status(400).send('Missing code');
    const redirectUri = `${req.protocol}://${req.get('host')}/api/google-calendar/oauth/callback`;
    try {
      await gc.exchangeCode(code, redirectUri);
      res.redirect('/react/?gc_connected=1');
    } catch (err) {
      res.redirect('/react/?gc_error=' + encodeURIComponent(err.message));
    }
  });

  router.get('/google-calendar/status', (req, res) => {
    const gc = clients.googleCalendar;
    res.json({ success: true, data: { configured: !!gc, connected: !!gc?.isConnected() } });
  });

  router.post('/settings/google-calendar', requireAdmin, (req, res) => {
    const clientId = String(req.body?.clientId || '').trim();
    const clientSecret = String(req.body?.clientSecret || '').trim();
    const calendarId = String(req.body?.calendarId || '').trim() || 'primary';
    try {
      const cfg = readConfigFile();
      cfg.googleCalendar = { clientId, clientSecret, calendarId };
      writeConfigFile(cfg);
      res.json({ success: true, message: 'Saved — restart LSH, then use "Connect with Google".' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
