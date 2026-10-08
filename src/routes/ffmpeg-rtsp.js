'use strict';

// FFmpeg RTSP proxy — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { ffmpegRtsp, requireAdmin } = ctx;

  // ── FFmpeg RTSP proxy ──────────────────────────────────────────────────

  router.get('/rtsp-proxy', (req, res) => {
    if (!ffmpegRtsp) return res.json({ success: true, enabled: false, streams: [] });
    res.json({ success: true, enabled: true, streams: ffmpegRtsp.getStreams() });
  });

  router.post('/settings/ffmpeg-rtsp', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { enabled, basePort, ffmpegPath } = req.body;
    try {
      writeConfigFile({
        ...current,
        ffmpegRtsp: {
          enabled:    !!enabled,
          basePort:   parseInt(basePort)  || 8554,
          ffmpegPath: (ffmpegPath || 'ffmpeg').trim(),
        },
      });
      res.json({ success: true, message: 'FFmpeg RTSP settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
