const { Router, raw } = require('express');
const { readConfigFile, dedupeVirtualDevices } = require('./routes/helpers');

// Route groups, in registration order (Express matches in that order — keep
// it). Each exports register(router, ctx); ctx is built in createApiRoutes().
const ROUTE_GROUPS = [
  require('./routes/auth'),
  require('./routes/devices'),
  require('./routes/history'),
  require('./routes/device-customization'),
  require('./routes/plan-decor'),
  require('./routes/plan-model'),
  require('./routes/home-plan'),
  require('./routes/ev-charging'),
  require('./routes/tariff'),
  require('./routes/private-events'),
  require('./routes/missed-calls'),
  require('./routes/google-calendar'),
  require('./routes/agenda'),
  require('./routes/lock-pin'),
  require('./routes/loxone-xml'),
  require('./routes/automation'),
  require('./routes/satel-zones'),
  require('./routes/cameras'),
  require('./routes/object-detection'),
  require('./routes/sip'),
  require('./routes/paging'),
  require('./routes/airplay'),
  require('./routes/sonos'),
  require('./routes/simulators'),
  require('./routes/camera-ptz'),
  require('./routes/camera-ptz-presets'),
  require('./routes/camera-patrol'),
  require('./routes/camera-siren'),
  require('./routes/camera-ir'),
  require('./routes/reolink'),
  require('./routes/mobotix'),
  require('./routes/axis'),
  require('./routes/solaredge'),
  require('./routes/solaraccelerator'),
  require('./routes/sofar'),
  require('./routes/tauron-tariff'),
  require('./routes/smartthings'),
  require('./routes/satel-settings'),
  require('./routes/unifi-protect'),
  require('./routes/vrm'),
  require('./routes/backup'),
  require('./routes/homekit'),
  require('./routes/matter'),
  require('./routes/ui-preferences'),
  require('./routes/css-themes'),
  require('./routes/claude-code'),
  require('./routes/terminal'),
  require('./routes/modules'),
  require('./routes/settings'),
  require('./routes/mongodb'),
  require('./routes/dreame'),
  require('./routes/mc6'),
  require('./routes/roborock'),
  require('./routes/somfy-covers'),
  require('./routes/homey'),
  require('./routes/openweather'),
  require('./routes/mcp-server'),
  require('./routes/airly'),
  require('./routes/vitodens'),
  require('./routes/thermomix'),
  require('./routes/dyson'),
  require('./routes/grenton'),
  require('./routes/wled'),
  require('./routes/somfy'),
  require('./routes/bayrol'),
  require('./routes/loxone'),
  require('./routes/waveshare'),
  require('./routes/tedee'),
  require('./routes/yale'),
  require('./routes/broadlink'),
  require('./routes/esphome'),
  require('./routes/lgthinq'),
  require('./routes/fibaro'),
  require('./routes/webrtc-whep'),
  require('./routes/smartbob'),
  require('./routes/arduino'),
  require('./routes/suppla'),
  require('./routes/knx'),
  require('./routes/domatiq'),
  require('./routes/ffmpeg-rtsp'),
  require('./routes/logs'),
  require('./routes/mqtt-explorer'),
  require('./routes/https'),
  require('./routes/lsh-ble'),
];

function createApiRoutes(store, relayController, sensorRegistry, connectionMgr, clients = {}) {
  const { unifiProtect, reolink, kenik, mobotix, axis, yale, simulators, mqttExplorer, auth, isSecure, ffmpegRtsp, sipServer, pagingManager, openweather, objectDetection, airplayClient } = clients;
  const manualSnapCache = new Map(); // manual camera idx → { at, buffer }, for /camera/snapshot/:idx

  // Secure cookie flag per request, not per server: with both HTTP and HTTPS
  // listeners up, a login over plain http (e.g. phone → http://<lan-ip>:3001)
  // must not get a Secure cookie — browsers silently drop it and the user
  // loops on the login screen. Only localhost is exempt from that rule, which
  // is why the bug never shows on the dev machine itself.
  const reqIsSecure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';
  const router = Router();

  // Gate a route to admin-role users. The blanket auth.middleware() only
  // proves a request is authenticated as *someone* — 'viewer' is a real,
  // separately-issued role (see POST /auth/users) meant for read-only
  // access, so anything that writes config, controls a device/relay, or
  // touches credentials/tokens/alarm/automation needs this on top of that.
  // Deliberately NOT applied to: self-service routes (logout, own password
  // change), PIN *verify* endpoints (no state change), live-call handling
  // (SIP answer/reject/hangup/talk), paging/Sonos/agenda (shared household
  // features), running an already-defined scene/flow, or camera *viewing*
  // (WebRTC offer, on-demand snapshot) — those stay available to viewers.
  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    next();
  };

  // Gate a route to a specific per-user capability (currently 'flows' or
  // 'claudeCode') — a layer *above* requireAdmin, not a replacement for it:
  // an admin no longer automatically has these, they must be granted the
  // flag explicitly (via requireInstallerMode below). API tokens are exempt
  // — they're already "deliberately handed out by an admin" (see the
  // API_TOKEN_USER comment near the top of this file), not an interactive
  // session someone could click into Flows/Claude Code from.
  const requirePermission = (key) => (req, res, next) => {
    if (req.user?.id === 'api-token') return next();
    if (!auth || !auth.hasPermission(req.user?.id, key)) {
      return res.status(403).json({ success: false, error: `Missing '${key}' permission — ask an admin with installer mode enabled to grant it in Settings → Security` });
    }
    next();
  };

  // Gate a route to only work while config.json's top-level `installerMode`
  // is true. This is what makes granting flows/claudeCode permissions harder
  // to reach than just being a web admin — flipping it requires filesystem
  // access to the box LSH runs on, not just a browser session. Deliberately
  // config-file-only, no in-app toggle (an in-app toggle would defeat the
  // point). Read fresh via readConfigFile() so it applies immediately, no
  // restart needed, same as every other config.json-driven route here.
  const requireInstallerMode = (req, res, next) => {
    if (readConfigFile().installerMode !== true) {
      return res.status(403).json({ success: false, error: 'Installer mode is off — set "installerMode": true in config.json to grant permissions' });
    }
    next();
  };

  const ctx = {
    store, relayController, sensorRegistry, connectionMgr, clients, unifiProtect, reolink, kenik, mobotix, axis, yale, simulators, mqttExplorer, auth, isSecure, ffmpegRtsp, sipServer, pagingManager, openweather, objectDetection, airplayClient, manualSnapCache, reqIsSecure, requireAdmin, requirePermission, requireInstallerMode,
  };
  for (const register of ROUTE_GROUPS) register(router, ctx);

  return router;
}

module.exports = createApiRoutes;
module.exports.dedupeVirtualDevices = dedupeVirtualDevices;
