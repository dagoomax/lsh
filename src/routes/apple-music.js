'use strict';

// Apple Music — settings, developer token for the Music page's MusicKit JS,
// and the browser-player relay. Module: src/apple-music.js.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const MASK = '••••••••';

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;
  const am = () => clients.appleMusic;
  const live = (res) => { const c = am(); if (!c) { res.status(409).json({ success: false, error: 'Apple Music isn’t set up — add the MusicKit key in Settings → Media → Apple Music' }); return null } return c };

  router.get('/settings/apple-music', requireAdmin, (req, res) => {
    const a = readConfigFile().appleMusic || {};
    res.json({ success: true, data: { teamId: a.teamId || '', keyId: a.keyId || '', privateKey: a.privateKey || a.keyFile ? MASK : '', storefront: a.storefront || 'us' } });
  });

  router.post('/settings/apple-music', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const cur = readConfigFile();
    const prev = cur.appleMusic || {};
    const teamId = String(b.teamId || '').trim().toUpperCase();
    const keyId = String(b.keyId || '').trim().toUpperCase();
    const privateKey = String(b.privateKey || '').includes('•') ? prev.privateKey : String(b.privateKey || '').trim();
    const storefront = String(b.storefront || 'us').trim().toLowerCase();
    const errors = [];
    if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) errors.push('Team ID is 10 characters (developer.apple.com → Membership)');
    if (keyId && !/^[A-Z0-9]{10}$/.test(keyId)) errors.push('Key ID is 10 characters (shown next to the MusicKit key)');
    if (!/^[a-z]{2}$/.test(storefront)) errors.push('Storefront is a 2-letter country code, e.g. pl, us, de');
    if (privateKey) {
      try { require('../apple-music').loadKey({ privateKey }) } catch (err) { errors.push(`Private key: ${err.message.includes('MusicKit') ? err.message : 'paste the whole .p8 file, including the BEGIN / END PRIVATE KEY lines'}`) }
    }
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' · ') });
    const appleMusic = { ...prev, teamId: teamId || undefined, keyId: keyId || undefined, privateKey: privateKey || undefined, storefront };
    if (privateKey) delete appleMusic.keyFile;
    writeConfigFile({ ...cur, appleMusic });
    try {
      am()?.stop();
      delete clients.appleMusic;
      if (appleMusic.teamId && appleMusic.keyId && (appleMusic.privateKey || appleMusic.keyFile)) {
        const AppleMusic = require('../apple-music');
        const c = new AppleMusic({ ...cur, appleMusic }, store, sensorRegistry);
        await c.start();
        clients.appleMusic = c;
        const check = await c.verify();
        return res.json({ success: true, message: check.ok ? 'Saved — Apple accepted the developer token' : `Saved, but ${check.error}` });
      }
      res.json({ success: true, message: 'Saved' });
    } catch (err) {
      res.json({ success: true, message: `Saved; ${err.message}` });
    }
  });

  router.get('/apple-music/status', (req, res) => {
    const c = am();
    res.json({ success: true, data: c ? c.getStatus() : { configured: false } });
  });

  // For MusicKit JS in the dashboard (signed-in LSH users only — /api is behind auth)
  router.get('/apple-music/token', (req, res) => {
    const c = live(res); if (!c) return;
    try { res.set('Cache-Control', 'no-store'); res.json({ success: true, data: { developerToken: c.developerToken(), storefront: c.cfg.storefront || 'us' } }) }
    catch (err) { res.status(500).json({ success: false, error: err.message }) }
  });

  // The Music page reports its state; gets back commands queued for it
  router.post('/apple-music/player/:id/report', (req, res) => {
    const c = live(res); if (!c) return;
    try { res.json({ success: true, data: { commands: c.report(req.params.id, req.body) } }) }
    catch (err) { res.status(400).json({ success: false, error: err.message }) }
  });

  // Start something on the open player (flows: POST {kind:'playlist', id:'pl.…'})
  router.post('/apple-music/play', requireAdmin, (req, res) => {
    const c = live(res); if (!c) return;
    try { c.enqueuePlay(req.body?.kind, req.body?.id); res.json({ success: true }) }
    catch (err) { res.status(409).json({ success: false, error: err.message }) }
  });
};
