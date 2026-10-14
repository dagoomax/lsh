'use strict';

// TIDAL — settings, sign-in (OAuth PKCE) and the music hub's browser.
// Client: src/tidal-client.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const MASK = '••••••••';

function redirectUriFor(req, cfg) {
  if (cfg.redirectUri) return cfg.redirectUri;
  const secure = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
  return `${secure ? 'https' : 'http'}://${req.get('host')}/api/tidal/oauth/callback`;
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;
  const td = () => clients.tidal;
  const live = (res) => { const c = td(); if (!c) { res.status(409).json({ success: false, error: 'TIDAL isn’t set up — add the Client ID first' }); return null } return c };
  const run = async (res, fn) => {
    try { res.json({ success: true, data: await fn() }) }
    catch (err) { res.status(/Sign in|revoked/.test(err.message) ? 401 : /slow down/.test(err.message) ? 429 : 400).json({ success: false, error: err.message }) }
  };

  router.get('/settings/tidal', requireAdmin, (req, res) => {
    const t = readConfigFile().tidal || {};
    res.json({ success: true, data: { clientId: t.clientId || '', clientSecret: t.clientSecret ? MASK : '', redirectUri: redirectUriFor(req, t), customRedirect: !!t.redirectUri, countryCode: t.countryCode || '' } });
  });

  router.post('/settings/tidal', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const clientId = String(b.clientId || '').trim();
    if (clientId && !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) return res.status(400).json({ success: false, error: 'That doesn’t look like a TIDAL Client ID (developer.tidal.com → your app)' });
    const countryCode = String(b.countryCode || '').trim().toUpperCase();
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) return res.status(400).json({ success: false, error: 'Country is a 2-letter code, e.g. PL' });
    const redirectUri = String(b.redirectUri || '').trim();
    if (redirectUri && !/^https?:\/\/\S+$/.test(redirectUri)) return res.status(400).json({ success: false, error: 'The redirect URI must start with http:// or https://' });
    const cur = readConfigFile();
    const secretIn = String(b.clientSecret || '').trim();
    const tidal = {
      ...(cur.tidal || {}), clientId: clientId || undefined,
      clientSecret: secretIn.includes('•') ? cur.tidal?.clientSecret : secretIn || undefined,
      redirectUri: redirectUri || undefined, countryCode: countryCode || undefined,
    };
    writeConfigFile({ ...cur, tidal });
    try {
      td()?.stop();
      delete clients.tidal;
      if (tidal.clientId) {
        const TidalClient = require('../tidal-client');
        const c = new TidalClient({ ...cur, tidal }, store, sensorRegistry);
        await c.start();
        clients.tidal = c;
        if (c.error && tidal.clientSecret) return res.json({ success: false, error: c.error });
      }
      res.json({ success: true, message: 'Saved' });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message})` });
    }
  });

  router.get('/tidal/oauth/start', requireAdmin, (req, res) => {
    const c = td();
    if (!c) return res.status(409).send('TIDAL isn’t set up — add the Client ID in Settings first.');
    try { res.redirect(c.getAuthUrl(redirectUriFor(req, readConfigFile().tidal || {}))) }
    catch (err) { res.status(400).send(err.message) }
  });

  // public (the redirect may come from another device); only accepts a state this start made, once
  router.get('/tidal/oauth/callback', async (req, res) => {
    const c = td();
    const page = (ok, text) => res.status(ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TIDAL · LSH</title><body style="font:16px system-ui;background:#000;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:420px;padding:16px"><div style="font-size:48px">${ok ? '✅' : '⚠️'}</div><p>${String(text).replace(/[<>&]/g, '')}</p><p><a style="color:#33ffee" href="/react/">Back to LSH</a></p></div>`);
    if (!c) return page(false, 'TIDAL isn’t set up in LSH.');
    if (req.query.error) return page(false, `TIDAL: ${req.query.error_description || req.query.error}`);
    try {
      const user = await c.exchangeCode(String(req.query.code || ''), String(req.query.state || ''));
      page(true, `Connected as ${user?.name || 'your TIDAL account'}. You can close this tab.`);
    } catch (err) { page(false, err.message) }
  });

  router.post('/tidal/oauth/finish', requireAdmin, (req, res) => { const c = live(res); if (c) run(res, () => c.finishFromUrl(req.body?.url)) });
  router.post('/tidal/disconnect', requireAdmin, (req, res) => { const c = live(res); if (c) run(res, () => { c.disconnect(); return true }) });

  router.get('/tidal/status', (req, res) => {
    const c = td();
    res.json({ success: true, data: c ? c.getStatus() : { configured: false, connected: false } });
  });
  router.get('/tidal/search', (req, res) => { const c = live(res); if (c) run(res, () => c.search(req.query.q || '')) });
  router.get('/tidal/library', (req, res) => { const c = live(res); if (c) run(res, () => c.library()) });
};
module.exports.redirectUriFor = redirectUriFor;
