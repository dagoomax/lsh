'use strict';

// Camera PTZ — split out of src/api-routes.js; registered in order by createApiRoutes().
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { axis, kenik, reolink, requireAdmin } = ctx;

  // ── Camera PTZ ────────────────────────────────────────────
  // Continuous move: the client POSTs { op } on press and { op: 'stop' } on
  // release. op: left | right | up | down | zoomin | zoomout | stop
  const PTZ_OPS = ['left', 'right', 'up', 'down', 'zoomin', 'zoomout', 'stop'];
  const ptzHandler = (fn) => async (req, res) => {
    const { op, speed } = req.body || {};
    if (!PTZ_OPS.includes(op)) {
      return res.status(400).json({ success: false, error: `op must be one of ${PTZ_OPS.join('/')}` });
    }
    try {
      await fn(req.params.idx, op, speed);
      res.json({ success: true });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  };

  router.post('/reolink/ptz/:idx', requireAdmin, ptzHandler((idx, op, speed) => {
    if (!reolink) throw new Error('Reolink unavailable');
    return reolink.ptz(idx, op, speed);
  }));

  router.post('/kenik/ptz/:idx', requireAdmin, ptzHandler((idx, op, speed) => {
    if (!kenik) throw new Error('KENIK unavailable');
    return kenik.ptz(idx, op, speed);
  }));

  router.post('/axis/ptz/:idx', requireAdmin, ptzHandler((idx, op, speed) => {
    if (!axis) throw new Error('Axis unavailable');
    return axis.ptz(idx, op, speed);
  }));

  // Manual `cameras` entries with an `onvif: { host, port, username, password }` section
  router.post('/camera/ptz/:idx', requireAdmin, ptzHandler((idx, op, speed) => {
    const cfg = readConfigFile();
    const cam = (cfg.cameras || [])[Number(idx)];
    // Tuya/Smart Life cameras without ONVIF: `tuyaPtz: { deviceId }` + config.tuyaCloud
    // (or, without keys, the tuya-ipc-terminal login in config.tuyaIpc)
    if (cam?.tuyaPtz) return require('../tuya-cloud-ptz').ptz(cfg.tuyaCloud, cam.tuyaPtz, op, cfg.tuyaIpc);
    if (!cam?.onvif?.host) throw new Error('Camera has no ONVIF config');
    return require('../onvif-ptz').ptz(cam.onvif, op, speed);
  }));

  // Real Tuya command spec for the camera (verifies ptz_control values)
  router.get('/camera/ptz-info/:idx', requireAdmin, async (req, res) => {
    try {
      const cfg = readConfigFile();
      const cam = (cfg.cameras || [])[Number(req.params.idx)];
      if (!cam?.tuyaPtz) throw new Error('Camera has no tuyaPtz config');
      res.json({ success: true, data: await require('../tuya-cloud-ptz').info(cfg.tuyaCloud, cam.tuyaPtz) });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  });
};
