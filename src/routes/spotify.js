'use strict';

// Spotify — settings, sign-in (OAuth PKCE) and the settings page's player.
// Client: src/spotify-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

// Spotify only accepts https redirect URIs, or http on a loopback address
// (127.0.0.1 / [::1] — not "localhost").
function redirectUriFor(req, cfg) {
  if (cfg.redirectUri) return cfg.redirectUri;
  const host = req.get('host') || '';
  const secure = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
  if (secure || /^(127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return `${secure ? 'https' : 'http'}://${host}/api/spotify/oauth/callback`;
  const port = (host.match(/:(\d+)$/) || [])[1] || (secure ? '443' : '80');
  return `http://127.0.0.1:${port}/api/spotify/oauth/callback`;
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;
  const sp = () => clients.spotify;
  const live = (res) => { const c = sp(); if (!c) { res.status(409).json({ success: false, error: 'Spotify isn’t set up — add the Client ID first' }); return null } return c };
  const run = async (res, fn) => {
    try { res.json({ success: true, data: await fn() }) }
    catch (err) { res.status(/isn’t connected|revoked/.test(err.message) ? 401 : /Premium/.test(err.message) ? 403 : /slow down/.test(err.message) ? 429 : 400).json({ success: false, error: err.message }) }
  };

  router.get('/settings/spotify', requireAdmin, (req, res) => {
    const s = readConfigFile().spotify || {};
    res.json({ success: true, data: { clientId: s.clientId || '', redirectUri: redirectUriFor(req, s), customRedirect: !!s.redirectUri, defaultDevice: s.defaultDevice || '', pollInterval: s.pollInterval || 5 } });
  });

  router.post('/settings/spotify', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const clientId = String(b.clientId || '').trim();
    if (clientId && !/^[0-9a-f]{32}$/i.test(clientId)) return res.status(400).json({ success: false, error: 'The Client ID is 32 hex characters (Spotify dashboard → your app → Settings)' });
    const redirectUri = String(b.redirectUri || '').trim();
    if (redirectUri && !/^(https:\/\/|http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?\/)/.test(redirectUri)) return res.status(400).json({ success: false, error: 'Spotify needs an https:// redirect URI, or http://127.0.0.1:<port>/…' });
    const cur = readConfigFile();
    const spotify = { ...(cur.spotify || {}), clientId: clientId || undefined, redirectUri: redirectUri || undefined, defaultDevice: String(b.defaultDevice || '').trim() || undefined, pollInterval: Math.max(2, Number(b.pollInterval) || 5) };
    writeConfigFile({ ...cur, spotify });
    // Apply now
    try {
      sp()?.stop();
      delete clients.spotify;
      if (spotify.clientId) {
        const SpotifyClient = require('../spotify-client');
        const c = new SpotifyClient({ ...cur, spotify }, store, sensorRegistry);
        await c.start();
        clients.spotify = c;
      }
      res.json({ success: true, message: 'Saved' });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message})` });
    }
  });

  // Sign-in: redirect to Spotify. The callback below is public (no LSH session
  // needed — the redirect may land on 127.0.0.1); it only accepts a state this
  // start created, once, within 15 minutes.
  router.get('/spotify/oauth/start', requireAdmin, (req, res) => {
    const c = sp();
    if (!c) return res.status(409).send('Spotify isn’t set up — add the Client ID in Settings first.');
    try { res.redirect(c.getAuthUrl(redirectUriFor(req, readConfigFile().spotify || {}))) }
    catch (err) { res.status(400).send(err.message) }
  });

  router.get('/spotify/oauth/callback', async (req, res) => {
    const c = sp();
    const page = (ok, text) => res.status(ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spotify · LSH</title><body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:420px;padding:16px"><div style="font-size:48px">${ok ? '✅' : '⚠️'}</div><p>${text.replace(/[<>&]/g, '')}</p><p><a style="color:#1db954" href="/react/settings">Back to LSH</a></p></div>`);
    if (!c) return page(false, 'Spotify isn’t set up in LSH.');
    if (req.query.error) return page(false, `Spotify: ${req.query.error}`);
    try {
      const user = await c.exchangeCode(String(req.query.code || ''), String(req.query.state || ''));
      page(true, `Connected as ${user?.name || 'your Spotify account'}. You can close this tab.`);
    } catch (err) { page(false, err.message) }
  });

  // When the redirect can't reach LSH (other machine): paste the address you landed on
  router.post('/spotify/oauth/finish', requireAdmin, (req, res) => { const c = live(res); if (c) run(res, () => c.finishFromUrl(req.body?.url)) });
  router.post('/spotify/disconnect', requireAdmin, (req, res) => { const c = live(res); if (c) run(res, () => { c.disconnect(); return true }) });

  router.get('/spotify/status', (req, res) => {
    const c = sp();
    res.json({ success: true, data: c ? c.getStatus() : { configured: false, connected: false } });
  });
  router.get('/spotify/devices', (req, res) => { const c = live(res); if (c) run(res, () => c.devices()) });
  router.get('/spotify/playlists', (req, res) => { const c = live(res); if (c) run(res, () => c.playlists()) });
  router.get('/spotify/search', (req, res) => { const c = live(res); if (c) run(res, () => c.search(req.query.q || '')) });
  router.post('/spotify/transfer', requireAdmin, (req, res) => { const c = live(res); if (c) run(res, () => c.transfer(String(req.body?.deviceId || ''), req.body?.play !== false)) });
  router.post('/spotify/play', requireAdmin, (req, res) => { const c = live(res); if (c) run(res, () => c.playUri(String(req.body?.uri || ''), req.body?.deviceId || undefined)) });
};
module.exports.redirectUriFor = redirectUriFor;
