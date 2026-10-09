'use strict';

// Cameras — split out of src/api-routes.js; registered in order by createApiRoutes().
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { axis, clients, kenik, mobotix, reolink, sensorRegistry, unifiProtect, yale } = ctx;

  // ── Cameras ───────────────────────────────────────────────

  router.get('/cameras', (req, res) => {
    const cfg = readConfigFile();
    const unifiCams = unifiProtect ? unifiProtect.getCameras() : [];

    // Auto-include SmartThings cameras (devices with imageCapture capability)
    const stCams = sensorRegistry
      ? sensorRegistry.getDevices()
          .filter((d) => d.type === 'smartthings' && d.sensors.some((s) => s.path === 'image'))
          .map((d) => {
            const deviceId = d.key.replace('smartthings/', '');
            return {
              name:        d.label,
              url:         '',
              snapshotUrl: `/api/smartthings-camera/${deviceId}/snapshot`,
              mjpegUrl:    '',
              webrtcUrl:   '',
              _smartthings: true,
              _deviceId:   deviceId,
            };
          })
      : [];

    const reolinkCams = reolink ? reolink.getCameras() : [];
    const kenikCams   = kenik ? kenik.getCameras() : [];
    const mobotixCams = mobotix ? mobotix.getCameras() : [];
    const axisCams    = axis ? axis.getCameras() : [];
    const yaleCams    = yale ? yale.getCameras() : [];
    const karcherCams = clients.karcher ? clients.karcher.getCameras() : [];
    const haCams      = clients.homeassistant ? clients.homeassistant.getCameras() : [];
    // Manual cameras with an `onvif` section get PTZ through the generic proxy;
    // ones with an RTSP `url` but no snapshot/MJPEG source of their own (e.g.
    // WHEP-only) get a thumbnail via the generic ffmpeg-grab-a-frame proxy.
    const manualCams = (cfg.cameras || []).map((c, idx) => ({
      ...c,
      ...(c.onvif ? {
        onvif: { ...c.onvif, password: c.onvif.password ? '••••••••' : '' },
        ptzUrl:    `/api/camera/ptz/${idx}`,
        presetUrl: `/api/camera/preset/${idx}`,
        irUrl:     `/api/camera/ir/${idx}`,
      } : {}),
      ...(c.url && !c.snapshotUrl && !c.mjpegUrl ? { snapshotUrl: `/api/camera/snapshot/${idx}` } : {}),
    }));
    res.json({ success: true, data: [...manualCams, ...unifiCams, ...reolinkCams, ...kenikCams, ...mobotixCams, ...axisCams, ...yaleCams, ...stCams, ...karcherCams, ...haCams] });
  });
};
