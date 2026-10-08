'use strict';

// Local object detection (COCO-SSD) model selection — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { objectDetection, requireAdmin } = ctx;

  // ── Local object detection (COCO-SSD) model selection ──────
  // Weights aren't vendored — switching downloads the chosen base model
  // fresh from its CDN and validates it loads before persisting the choice,
  // so a bad/offline pick doesn't silently break detection on next restart.
  router.get('/settings/object-detection/model', (req, res) => {
    if (!objectDetection) {
      const { MODEL_BASES } = require('../object-detection');
      return res.json({ success: true, data: { base: null, loading: false, loaded: false, error: null, options: MODEL_BASES } });
    }
    res.json({ success: true, data: objectDetection.getModelStatus() });
  });

  router.post('/settings/object-detection/model', requireAdmin, async (req, res) => {
    if (!objectDetection) {
      return res.status(503).json({ success: false, error: 'Object detection not running — add at least one camera under objectDetection.cameras first' });
    }
    try {
      const data = await objectDetection.setModel((req.body || {}).model);
      const current = readConfigFile();
      writeConfigFile({ ...current, objectDetection: { ...(current.objectDetection || {}), model: data.base } });
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Cameras list + tunables — separate from the model-switch route above
  // since that one validates by actually downloading/loading the model
  // synchronously, while this is a plain config write (see src/object-
  // detection.js's header for why any RTSP URL works here, not just
  // brand-specific integrations).
  router.post('/settings/object-detection', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { cameras, pollInterval, minConfidence, petVerification, requirePetVerification, autoCreateFlows } = req.body || {};
    try {
      const objectDetectionCfg = { ...current.objectDetection };
      if (Array.isArray(cameras)) {
        objectDetectionCfg.cameras = cameras
          .filter((c) => c && c.name && c.url)
          .map((c) => ({
            name: String(c.name).trim(), url: String(c.url).trim(),
            ...(c.model ? { model: String(c.model).trim() } : {}),
          }));
      }
      if (pollInterval !== undefined) objectDetectionCfg.pollInterval = Math.max(5, Number(pollInterval) || 15);
      if (minConfidence !== undefined) objectDetectionCfg.minConfidence = Math.max(0, Math.min(1, Number(minConfidence)));
      if (petVerification !== undefined) objectDetectionCfg.petVerification = !!petVerification;
      if (requirePetVerification !== undefined) objectDetectionCfg.requirePetVerification = !!requirePetVerification;
      if (autoCreateFlows !== undefined) objectDetectionCfg.autoCreateFlows = !!autoCreateFlows;
      writeConfigFile({ ...current, objectDetection: objectDetectionCfg });
      res.json({ success: true, message: 'Object detection settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
