'use strict';

// AirPlay — play prerecorded audio out to a configured speaker — split out of src/api-routes.js; registered in order by createApiRoutes().
const { Router, raw } = require('express');
const fs   = require('fs');
const path = require('path');
const pagingMessages = require('../paging-messages');
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { airplayClient, requireAdmin } = ctx;

  // ── AirPlay — play prerecorded audio out to a configured speaker ──────
  // src/airplay-client.js. Household broadcast feature, same "any
  // authenticated user" tier as paging/Sonos above — not a config write.
  router.get('/airplay/speakers', (req, res) => {
    res.json({ success: true, data: airplayClient ? airplayClient.getSpeakers() : [] });
  });

  // mDNS scan for AirPlay receivers, independent of whether AirPlay is
  // enabled/configured yet (see AirplayClient.discover doc comment) — the
  // Settings UI's "Scan network" button. requireAdmin: nudges a device on
  // the LAN into responding to a probe, same tier as the config write below.
  router.get('/airplay/discover', requireAdmin, async (req, res) => {
    const AirplayClient = require('../airplay-client');
    const found = await AirplayClient.discover();
    res.json({ success: true, data: found });
  });

  // Replay one of the paging voice messages (src/paging-messages.js) out
  // loud on a speaker — the actual "post prerecorded messages" use case.
  router.post('/airplay/:id/play-message', async (req, res) => {
    if (!airplayClient) return res.status(503).json({ success: false, error: 'AirPlay not configured' });
    const file = pagingMessages.audioFile(req.body?.messageId);
    if (!file) return res.status(404).json({ success: false, error: 'Voice message not found' });
    try {
      await airplayClient.play(req.params.id, file);
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  });

  // Play an arbitrary uploaded audio clip (any format ffmpeg reads) —
  // written to a scratch temp file only for the duration of playback.
  router.post('/airplay/:id/play', raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
    if (!airplayClient) return res.status(503).json({ success: false, error: 'AirPlay not configured' });
    if (!req.body?.length) return res.status(400).json({ success: false, error: 'Empty audio body' });
    const tmpFile = path.join(require('os').tmpdir(), `lsh-airplay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    try {
      fs.writeFileSync(tmpFile, req.body);
      await airplayClient.play(req.params.id, tmpFile);
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    } finally {
      fs.unlink(tmpFile, () => {}); // best-effort cleanup, playback has already finished reading it
    }
  });

  // ── Pairing (Apple TV PIN / AirPlay password) — src/airplay-client.js ──
  const pairRun = async (res, fn) => {
    if (!airplayClient) return res.status(503).json({ success: false, error: 'AirPlay not enabled — enable it, save and restart LSH' });
    try { res.json({ success: true, data: await fn() }) }
    catch (err) { res.status(400).json({ success: false, error: err.message }) }
  };
  router.get('/airplay/:id/access', requireAdmin, (req, res) => pairRun(res, () => airplayClient.access(req.params.id)));
  router.get('/airplay/:id/pair', requireAdmin, (req, res) => pairRun(res, () => airplayClient.pairingStatus(req.params.id)));
  router.post('/airplay/:id/pair', requireAdmin, (req, res) => pairRun(res, () => airplayClient.startPairing(req.params.id)));
  router.post('/airplay/:id/pair/pin', requireAdmin, (req, res) => pairRun(res, () => airplayClient.submitPin(req.params.id, req.body?.pin)));
  router.delete('/airplay/:id/pair', requireAdmin, (req, res) => pairRun(res, () => { airplayClient.cancelPairing(req.params.id); return { removed: airplayClient.unpair(req.params.id) } }));

  router.post('/settings/airplay', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { enabled, speakers } = req.body;
    try {
      const airplay = { ...current.airplay };
      if (enabled !== undefined) airplay.enabled = !!enabled;
      if (Array.isArray(speakers)) {
        const prev = Object.fromEntries((current.airplay?.speakers || []).map((s) => [s.id, s]));
        airplay.speakers = speakers
          .filter((s) => s && s.id && s.host)
          .map((s) => ({
            // AirPlay password (HomePod / Apple TV "Require Password"); •••• keeps the saved one
            ...(() => { const pw = String(s.password ?? '').includes('•') ? prev[String(s.id).trim()]?.password : String(s.password || '').trim(); return pw ? { password: pw } : {} })(),
            id: String(s.id).trim(),
            name: String(s.name || s.id).trim(),
            host: String(s.host).trim(),
            port: Number(s.port) || 5000,
            airplay2: s.airplay2 !== false,
            volume: Math.max(0, Math.min(100, Number(s.volume) || 60)),
          }));
      }
      writeConfigFile({ ...current, airplay });
      res.json({ success: true, message: 'AirPlay settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
