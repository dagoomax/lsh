'use strict';

// Sonos: URL playback + TTS announcements — split out of src/api-routes.js; registered in order by createApiRoutes().
const cameraLog = require('../camera-log');
const detectionBoxes = require('../detection-boxes');
const { getDb } = require('../mongo');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { axis, clients, kenik, mobotix, reolink, requireAdmin, sensorRegistry, store, unifiProtect, yale } = ctx;

  // ── Sonos: URL playback + TTS announcements ───────────────
  // GET + POST so Loxone/automations can trigger with a simple query too.
  const sonosParam = (req, name) => req.body?.[name] ?? req.query[name];

  router.get('/sonos/players', (req, res) => {
    const sonos = clients.sonos;
    res.json({ success: true, data: sonos ? sonos.getPlayers() : [] });
  });

  const announceHandler = async (req, res) => {
    const sonos = clients.sonos;
    if (!sonos) return res.status(503).json({ success: false, error: 'Sonos not enabled' });
    const text = sonosParam(req, 'text');
    if (!text) return res.status(400).json({ success: false, error: 'text required' });
    const volume = sonosParam(req, 'volume');
    try {
      const players = await sonos.announceMany(sonosParam(req, 'host'), String(text), {
        lang: sonosParam(req, 'lang'),
        volume: volume != null && volume !== '' ? Number(volume) : undefined,
      });
      res.json({ success: true, players });
    } catch (err) {
      res.status(err.message.includes('No matching') ? 404 : 500).json({ success: false, error: err.message });
    }
  };
  router.post('/sonos/announce', announceHandler);
  router.get('/sonos/announce', announceHandler);

  const playUrlHandler = async (req, res) => {
    const sonos = clients.sonos;
    if (!sonos) return res.status(503).json({ success: false, error: 'Sonos not enabled' });
    const url = sonosParam(req, 'url');
    if (!url) return res.status(400).json({ success: false, error: 'url required' });
    try {
      const players = await sonos.playUrlMany(sonosParam(req, 'host'), String(url), sonosParam(req, 'meta'));
      res.json({ success: true, players });
    } catch (err) {
      res.status(err.message.includes('No matching') ? 404 : 500).json({ success: false, error: err.message });
    }
  };
  router.post('/sonos/play-url', playUrlHandler);
  router.get('/sonos/play-url', playUrlHandler);

  // Fetches a SmartThings AV Platform media URL and proxies the bytes onto res.
  // The image attribute is marked "sensitive" in SmartThings' capability schema,
  // and its media host (…ec2.st-av.net) enforces that at the media layer, not
  // just the device-status layer: an OAuth SmartApp access token gets a 400
  // ("Request missing Bearer token") — turns out it *was* sending one, the
  // media host just rejects OAuth-scoped tokens for sensitive media outright
  // (confirmed: same request, same code, 500 "Error response from AV Platform"
  // even with a valid OAuth token and a freshly-captured image). A Personal
  // Access Token works. PATs created after Dec 2024 expire in 24h, so this
  // needs a fresh one periodically from https://account.smartthings.com/tokens
  // — falls back to the OAuth/legacy token if unset, which will 500 upstream
  // but at least degrades to the existing "no snapshot" behavior instead of
  // silently sending no auth at all.
  async function proxySmartThingsMedia(url, res) {
    try {
      const { buffer, contentType } = await require('../smartthings-media').fetchMedia(url, clients.smartThings);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'no-cache');
      res.send(buffer);
    } catch (err) {
      res.status(502).send('Image fetch failed: ' + err.message);
    }
  }

  // SmartThings camera snapshot proxy — always the device's *current* image.
  router.get('/smartthings-camera/:deviceId/snapshot', async (req, res) => {
    const { deviceId } = req.params;
    const imageUrl = store.get(`smartthings/${deviceId}/image`);
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      return res.status(404).send('No snapshot available — trigger a capture first');
    }
    await proxySmartThingsMedia(imageUrl, res);
  });

  // Yale doorbell camera snapshot proxy — same idea as the SmartThings one
  // above: the image lives at a per-doorbell `secure_url` that yale-client.js
  // refreshes on every poll into the store, and needs an `Authorization:
  // <contentToken>` header (the raw token, no "Bearer" prefix — see
  // yalexs's Doorbell.async_get_doorbell_image) that must never reach the
  // browser directly.
  router.get('/yale-camera/:deviceId/snapshot', async (req, res) => {
    const { deviceId } = req.params;
    const imageUrl = store.get(`yale/${deviceId}/image`);
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      return res.status(404).send('No snapshot available yet');
    }
    const contentToken = yale ? yale.getContentToken(deviceId) : '';
    try {
      const upstream = await fetch(imageUrl, { headers: { Authorization: contentToken } });
      if (!upstream.ok) return res.status(502).send(`Image fetch failed: HTTP ${upstream.status}`);
      res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.set('Cache-Control', 'no-cache');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      res.status(502).send('Image fetch failed: ' + err.message);
    }
  });

  // Same proxy, but for an arbitrary past capture's URL — lets the camera
  // event log's "Snapshot updated" entries stay clickable after a newer
  // capture has replaced the device's *current* image (which is all the
  // route above can ever serve). Host allowlisted to SmartThings' own media
  // domain so this can't be turned into an open image-fetching proxy.
  router.get('/smartthings-camera/image-proxy', async (req, res) => {
    const { url } = req.query;
    if (!url || !/^https:\/\/[a-z0-9.-]+\.ec2\.st-av\.net\//i.test(url)) {
      return res.status(400).send('Invalid or disallowed image URL');
    }
    await proxySmartThingsMedia(url, res);
  });

  // Trigger SmartThings imageCapture.take command
  // Sends a device command through SmartThings' regular (OAuth-fine, unlike
  // the sensitive-media routes above) command endpoint.
  // clients.smartThings (not a destructured local) — the client is registered
  // onto apiClients after createApiRoutes() already ran, so a destructured
  // copy taken at the top of this function would stay undefined forever.
  async function sendSmartThingsCommand(deviceId, capability, command, args = []) {
    const smartThings = clients.smartThings;
    const token = smartThings ? await smartThings.getToken().catch(() => null)
                              : readConfigFile().smartthings?.token;
    if (!token) throw new Error('No SmartThings token configured');
    const r = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: [{ component: 'main', capability, command, arguments: args }] }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return token;
  }

  router.post('/smartthings-camera/:deviceId/take', async (req, res) => {
    const { deviceId } = req.params;
    try {
      await sendSmartThingsCommand(deviceId, 'imageCapture', 'take');
      // Resolve camera name from registry for log
      const dev = sensorRegistry?.getDevices?.()?.find?.(d => d.instance === deviceId);
      cameraLog.push(dev?.label || deviceId, 'capture-triggered');
      res.json({ success: true, message: 'Capture triggered — snapshot will update within a few seconds' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Camera position presets (cameraPreset capability) — SmartThings exposes
  // save/recall of named positions for this camera, not live directional
  // pan/tilt/zoom movement (no "move" command exists in its capability set,
  // confirmed against the live capability schema). "create" with no data
  // argument has the device capture its own current position; there's no
  // API-level way to move the camera first, so this only usefully saves
  // wherever it's already pointed (e.g. after repositioning it by hand or
  // via the SmartThings app itself).
  router.get('/smartthings-camera/:deviceId/presets', async (req, res) => {
    const { deviceId } = req.params;
    const smartThings = clients.smartThings;
    const token = smartThings ? await smartThings.getToken().catch(() => null)
                              : readConfigFile().smartthings?.token;
    if (!token) return res.status(401).json({ success: false, error: 'No SmartThings token configured' });
    try {
      const r = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const status = await r.json();
      res.json({ success: true, data: status.components?.main?.cameraPreset?.presets?.value || [] });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  });

  router.post('/smartthings-camera/:deviceId/presets', requireAdmin, async (req, res) => {
    const { deviceId } = req.params;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    try {
      await sendSmartThingsCommand(deviceId, 'cameraPreset', 'create', [name]);
      res.json({ success: true, message: 'Preset saved' });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/smartthings-camera/:deviceId/presets/:presetId/execute', requireAdmin, async (req, res) => {
    const { deviceId, presetId } = req.params;
    try {
      await sendSmartThingsCommand(deviceId, 'cameraPreset', 'execute', [presetId]);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.delete('/smartthings-camera/:deviceId/presets/:presetId', requireAdmin, async (req, res) => {
    const { deviceId, presetId } = req.params;
    try {
      await sendSmartThingsCommand(deviceId, 'cameraPreset', 'delete', [presetId]);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Camera event log
  router.get('/camera-log', (req, res) => {
    const camera = req.query.camera || null;
    const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json({ success: true, data: cameraLog.getRecent(limit, camera) });
  });

  // Latest object-detection bounding boxes for a camera (initial state for
  // the modal's live overlay — live updates arrive over the 'detection-boxes'
  // socket event).
  router.get('/detection-boxes', (req, res) => {
    res.json({ success: true, data: detectionBoxes.get(req.query.camera || '') });
  });

  // Detection counts per class ("12 person, 3 cat today") from the Mongo
  // history object-detection.js writes (see its _saveDetectionRecords) —
  // requires config.mongo.uri; without it there's simply no history to
  // count from. objectDetections.camera is written under
  // objectDetection.cameras[].name, which can differ from the display
  // camera name passed here (see motionSource elsewhere) — resolve the
  // same way homekit-bridge.js does, just in reverse.
  router.get('/objectdetect/stats', async (req, res) => {
    const displayName = req.query.camera;
    if (!displayName) return res.status(400).json({ success: false, error: 'camera is required' });

    const db = getDb();
    if (!db) return res.json({ success: true, data: { today: [], week: [] } });

    const cfg = readConfigFile();
    const camCfg = (cfg.cameras || []).find((c) => c.name === displayName);
    const odCamera = camCfg?.motionSource || displayName;

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek  = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const countsSince = (since) => db.collection('objectDetections').aggregate([
      { $match: { camera: odCamera, ts: { $gte: since } } },
      { $group: { _id: '$class', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();

    try {
      const [today, week] = await Promise.all([countsSince(startOfToday), countsSince(startOfWeek)]);
      res.json({
        success: true,
        data: {
          today: today.map((r) => ({ class: r._id, count: r.count })),
          week:  week.map((r) => ({ class: r._id, count: r.count })),
        },
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Detection timeline: a thumbnail gallery of the annotated snapshots
  // object-detection.js already saves to Mongo (see _saveDetectionRecords).
  // Grouped by poll (exact ts), not by individual class — every prediction
  // kept from the same poll shares one annotated frame (all boxes drawn on
  // it together), so showing one thumbnail per detected class would repeat
  // the identical image several times in a row.
  router.get('/objectdetect/timeline', async (req, res) => {
    const displayName = req.query.camera;
    if (!displayName) return res.status(400).json({ success: false, error: 'camera is required' });

    const db = getDb();
    if (!db) return res.json({ success: true, data: [] });

    const cfg = readConfigFile();
    const camCfg = (cfg.cameras || []).find((c) => c.name === displayName);
    const odCamera = camCfg?.motionSource || displayName;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    try {
      const groups = await db.collection('objectDetections').aggregate([
        { $match: { camera: odCamera } },
        { $sort: { ts: -1 } },
        { $group: { _id: '$ts', classes: { $push: { class: '$class', score: '$score' } }, imageId: { $first: '$_id' } } },
        { $sort: { _id: -1 } },
        { $limit: limit },
      ]).toArray();
      res.json({
        success: true,
        data: groups.map((g) => ({ ts: g._id, classes: g.classes, imageId: g.imageId.toString() })),
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // Serves one detection's annotated JPEG by Mongo _id (shared across every
  // class detected in that same poll — see the timeline route above).
  // Detection images are immutable once written, so this is cached hard.
  router.get('/objectdetect/image/:id', async (req, res) => {
    const db = getDb();
    if (!db) return res.status(404).end();
    let ObjectId;
    try { ({ ObjectId } = require('mongodb')); } catch { return res.status(404).end(); }
    try {
      const doc = await db.collection('objectDetections').findOne({ _id: new ObjectId(req.params.id) });
      if (!doc?.image) return res.status(404).end();
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=604800, immutable');
      res.send(doc.image.buffer);
    } catch {
      res.status(404).end();
    }
  });

  // UniFi Protect snapshot proxy (avoids CORS + self-signed TLS in browser)
  router.get('/unifi/snapshot/:cameraId', (req, res) => {
    if (!unifiProtect) return res.status(503).end();
    unifiProtect.proxySnapshot(req.params.cameraId, res);
  });

  // Reolink snapshot proxy — keeps camera credentials server-side
  router.get('/reolink/snapshot/:idx', (req, res) => {
    if (!reolink) return res.status(503).end();
    reolink.proxySnapshot(req.params.idx, res);
  });

  // MOBOTIX snapshot proxy — keeps camera credentials server-side
  router.get('/mobotix/snapshot/:idx', (req, res) => {
    if (!mobotix) return res.status(503).end();
    mobotix.proxySnapshot(req.params.idx, res);
  });

  // Axis snapshot proxy — keeps camera credentials server-side
  router.get('/axis/snapshot/:idx', (req, res) => {
    if (!axis) return res.status(503).end();
    axis.proxySnapshot(req.params.idx, res);
  });

  // KENIK snapshot proxy — one ffmpeg-grabbed RTSP frame, credentials stay server-side
  router.get('/kenik/snapshot/:idx', (req, res) => {
    if (!kenik) return res.status(503).end();
    kenik.proxySnapshot(req.params.idx, res);
  });
};
