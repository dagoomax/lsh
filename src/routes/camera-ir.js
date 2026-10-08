'use strict';

// IR / night-mode toggle — GET current mode, POST {mode: 'on'|'off'|'auto'} — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { dedupeVirtualDevices, onvifCfgFor, readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { axis, kenik, manualSnapCache, reolink, requireAdmin } = ctx;

  // ── IR / night-mode toggle — GET current mode, POST {mode: 'on'|'off'|'auto'}
  const irHandler = (getFn, setFn) => ({
    get: async (req, res) => {
      try { res.json({ success: true, data: await getFn(req.params.idx) }); }
      catch (err) { res.status(502).json({ success: false, error: err.message }); }
    },
    post: async (req, res) => {
      const { mode } = req.body || {};
      if (!['on', 'off', 'auto'].includes(mode)) {
        return res.status(400).json({ success: false, error: "mode must be 'on', 'off', or 'auto'" });
      }
      try { await setFn(req.params.idx, mode); res.json({ success: true }); }
      catch (err) { res.status(502).json({ success: false, error: err.message }); }
    },
  });

  {
    const h = irHandler(
      (idx) => { if (!reolink) throw new Error('Reolink unavailable'); return reolink.getIr(idx); },
      (idx, mode) => { if (!reolink) throw new Error('Reolink unavailable'); return reolink.setIr(idx, mode); },
    );
    router.get('/reolink/ir/:idx', h.get);
    router.post('/reolink/ir/:idx', requireAdmin, h.post);
  }
  {
    const h = irHandler(
      (idx) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.getIr(idx); },
      (idx, mode) => { if (!kenik) throw new Error('KENIK unavailable'); return kenik.setIr(idx, mode); },
    );
    router.get('/kenik/ir/:idx', h.get);
    router.post('/kenik/ir/:idx', requireAdmin, h.post);
  }
  {
    const h = irHandler(
      (idx) => { if (!axis) throw new Error('Axis unavailable'); return axis.getIr(idx); },
      (idx, mode) => { if (!axis) throw new Error('Axis unavailable'); return axis.setIr(idx, mode); },
    );
    router.get('/axis/ir/:idx', h.get);
    router.post('/axis/ir/:idx', requireAdmin, h.post);
  }
  {
    const onvifImaging = () => require('../onvif-imaging');
    const h = irHandler(
      (idx) => onvifImaging().getIr(onvifCfgFor(idx)),
      (idx, mode) => onvifImaging().setIr(onvifCfgFor(idx), mode),
    );
    router.get('/camera/ir/:idx', h.get);
    router.post('/camera/ir/:idx', requireAdmin, h.post);
  }

  // WS-Discovery scan for ONVIF cameras on the LAN — used by the Settings
  // "Discover" button so the user doesn't need to already know camera IPs.
  router.get('/onvif/discover', async (req, res) => {
    try {
      const devices = await require('../onvif-discovery').discover();
      res.json({ success: true, data: devices });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Given ONVIF credentials (from discovery or typed in by hand), fetch the
  // camera's real RTSP/snapshot URIs — the Settings "Fetch via ONVIF" button.
  router.post('/onvif/probe', requireAdmin, async (req, res) => {
    const { host, port, username, password } = req.body || {};
    if (!host) return res.status(400).json({ success: false, error: 'host is required' });
    try {
      const result = await require('../onvif-media').probe({ host, port: Number(port) || 80, username, password });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Manual `cameras` entries with only an RTSP `url` (no vendor snapshot API,
  // e.g. WHEP-only sources) — one JPEG frame via ffmpeg, cached 10 s.
  router.get('/camera/snapshot/:idx', (req, res) => {
    const idx = Number(req.params.idx);
    const cam = (readConfigFile().cameras || [])[idx];
    if (!cam?.url) return res.status(404).end();

    const cached = manualSnapCache.get(idx);
    if (cached && Date.now() - cached.at < 10000) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      return res.end(cached.buffer);
    }

    const ffmpegPath = readConfigFile().ffmpegRtsp?.ffmpegPath || 'ffmpeg';
    require('../rtsp-snapshot').grabFrame(cam.url, ffmpegPath)
      .then((buffer) => {
        manualSnapCache.set(idx, { at: Date.now(), buffer });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(buffer);
      })
      .catch((err) => {
        console.error(`[Camera] Snapshot failed (${cam.name || cam.url}): ${err.message}`);
        res.status(502).end();
      });
  });

  router.post('/settings/cameras', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const cameras = req.body;
    if (!Array.isArray(cameras)) {
      return res.status(400).json({ success: false, error: 'Body must be an array of cameras' });
    }
    // `onvif` (PTZ + stream/snapshot auto-fetch) comes from the Settings form
    // now, but fall back to whatever's already saved for that index in case
    // it's missing (e.g. a config-file-only entry the form re-saves as-is).
    // Password comes back masked (••••••••) on an untouched resubmit — GET
    // /api/cameras never sends the real one — so preserve the existing value
    // rather than overwriting it with the placeholder.
    const cleaned = cameras.map(({ name, url, snapshotUrl, mjpegUrl, webrtcUrl, twoWayAudio, onvif }, i) => {
      const prevOnvif = current.cameras?.[i]?.onvif;
      const resolvedOnvif = (onvif && typeof onvif === 'object')
        ? { ...onvif, password: (onvif.password && !onvif.password.includes('•')) ? onvif.password : (prevOnvif?.password || '') }
        : prevOnvif;
      return {
        ...(resolvedOnvif ? { onvif: resolvedOnvif } : {}),
        name:        String(name        || '').trim(),
        url:         String(url         || '').trim(),
        snapshotUrl: String(snapshotUrl || '').trim(),
        mjpegUrl:    String(mjpegUrl    || '').trim(),
        webrtcUrl:   String(webrtcUrl   || '').trim(),
        twoWayAudio: !!twoWayAudio,
      };
    }).filter((c) => c.name || c.url);
    try {
      writeConfigFile({ ...current, cameras: cleaned });
      res.json({ success: true, message: 'Cameras saved' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/virtual', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const devices = req.body;
    if (!Array.isArray(devices)) {
      return res.status(400).json({ success: false, error: 'Body must be an array of virtual devices' });
    }
    const cleaned = dedupeVirtualDevices(devices);
    try {
      writeConfigFile({ ...current, virtual: { devices: cleaned } });
      res.json({ success: true, message: `${cleaned.length} virtual device(s) saved. Restart to apply.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
