'use strict';

// Settings — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const { generateSetupUri, generateSetupID } = require('../homekit-uri');
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { relayController, requireAdmin } = ctx;

  // ── Settings ─────────────────────────────────────────────
  router.get('/settings', (req, res) => {
    const cfg = readConfigFile();
    // Strip secrets from response for security
    const safe = JSON.parse(JSON.stringify(cfg));
    if (safe.vrm?.password) safe.vrm.password = '••••••••';
    if (safe.mongo?.uri) safe.mongo.uri = '••••••••'; // may embed credentials
    if (safe.vrm?.apiToken) safe.vrm.apiToken = '••••••••';
    if (safe.solaredge?.apiKey) safe.solaredge.apiKey = '••••••••';
    if (safe.smartthings?.token) safe.smartthings.token = '••••••••';
    if (safe.editPin) safe.editPin = '••••••••';
    if (safe.dashboardPin) safe.dashboardPin = '••••••••';
    if (safe.smartthings?.clientSecret) safe.smartthings.clientSecret = '••••••••';
    if (safe.smartthings?.webhookSecret) safe.smartthings.webhookSecret = '••••••••';
    if (safe.satel?.armCode) safe.satel.armCode = '••••••••';
    if (safe.unifi?.password) safe.unifi.password = '••••••••';
    if (safe.unifi?.apiKey) safe.unifi.apiKey = '••••••••';
    if (safe.googleCalendar?.clientSecret) safe.googleCalendar.clientSecret = '••••••••';
    // Defensive — these integrations have no write route in this file (config.json-only),
    // but redact anyway in case a secret ends up in one of these fields by hand-editing.
    if (safe.unifiAccess?.password) safe.unifiAccess.password = '••••••••';
    if (safe.unifiAccess?.apiKey) safe.unifiAccess.apiKey = '••••••••';
    if (safe.aqara?.token) safe.aqara.token = '••••••••';
    if (safe.ampio?.password) safe.ampio.password = '••••••••';
    if (safe.smarttub?.password) safe.smarttub.password = '••••••••';
    if (safe.zway?.password) safe.zway.password = '••••••••';
    if (safe.wirenboard?.password) safe.wirenboard.password = '••••••••';
    if (safe.kenik?.password) safe.kenik.password = '••••••••';
    if (safe.loxone?.password)  safe.loxone.password  = '••••••••';
    if (safe.dirigera?.token)   safe.dirigera.token   = '••••••••';
    if (safe.tradfri?.psk)      safe.tradfri.psk      = '••••••••';
    if (safe.sip?.password)     safe.sip.password     = '••••••••';
    if (safe.tradfri?.securityCode) safe.tradfri.securityCode = '••••••••';
    if (safe.homey?.token)          safe.homey.token          = '••••••••';
    if (safe.homeConnect?.clientSecret) safe.homeConnect.clientSecret = '••••••••';
    if (safe.miele?.clientSecret)   safe.miele.clientSecret   = '••••••••';
    if (safe.miele?.password)       safe.miele.password       = '••••••••';
    if (safe.fibaro?.password)      safe.fibaro.password      = '••••••••';
    if (safe.bayrol?.password)      safe.bayrol.password      = '••••••••';
    if (safe.somfy?.password)       safe.somfy.password       = '••••••••';
    if (safe.vicare?.password)      safe.vicare.password      = '••••••••';
    if (safe.thermomix?.password)   safe.thermomix.password   = '••••••••';
    if (safe.grenton?.token)        safe.grenton.token        = '••••••••';
    if (safe.suppla?.token)         safe.suppla.token         = '••••••••';
    if (Array.isArray(safe.reolink?.cameras)) safe.reolink.cameras.forEach((c) => { if (c.password) c.password = '••••••••'; });
    if (Array.isArray(safe.mobotix?.cameras)) safe.mobotix.cameras.forEach((c) => { if (c.password) c.password = '••••••••'; });
    if (Array.isArray(safe.axis?.cameras)) safe.axis.cameras.forEach((c) => { if (c.password) c.password = '••••••••'; });
    if (Array.isArray(safe.tedee?.devices)) safe.tedee.devices.forEach((d) => { if (d.apiToken) d.apiToken = '••••••••'; });
    if (safe.yale?.password)        safe.yale.password        = '••••••••';
    if (Array.isArray(safe.cameras)) safe.cameras.forEach((c) => { if (c.onvif?.password) c.onvif.password = '••••••••'; });
    if (safe.somfy?.token)          safe.somfy.token          = '••••••••';
    if (safe.loxoneOut?.password)   safe.loxoneOut.password   = '••••••••';
    if (safe.fibaroOut?.password)   safe.fibaroOut.password   = '••••••••';
    if (safe.auxair?.password)      safe.auxair.password      = '••••••••';
    if (Array.isArray(safe.lshBle?.devices)) safe.lshBle.devices.forEach((d) => { if (d.bindkey) d.bindkey = '••••••••'; });
    if (safe.dreame?.devices) {
      safe.dreame.devices = safe.dreame.devices.map(d =>
        d.token ? { ...d, token: '••••••••' } : d
      );
    }
    if (safe.roborock?.devices) {
      safe.roborock.devices = safe.roborock.devices.map(d =>
        d.token ? { ...d, token: '••••••••' } : d
      );
    }
    if (safe.roborock?.cloud?.password) safe.roborock.cloud.password = '••••••••';
    if (safe.karcher?.password) safe.karcher.password = '••••••••';
    if (safe.landroid?.password) safe.landroid.password = '••••••••';
    if (safe.sony?.psk) safe.sony.psk = '••••••••';
    if (safe.openweather?.apiKey) safe.openweather.apiKey = '••••••••';
    if (safe.airly?.apiKey) safe.airly.apiKey = '••••••••';
    if (safe.esphome?.devices) {
      safe.esphome.devices = safe.esphome.devices.map(d =>
        d.password ? { ...d, password: '••••••••' } : d
      );
    }
    if (safe.shelly?.devices) {
      safe.shelly.devices = safe.shelly.devices.map(d =>
        d.password ? { ...d, password: '••••••••' } : d
      );
    }
    delete safe.jwtSecret; // never expose JWT signing secret
    // Indicate whether LG tokens are persisted without exposing them
    if (safe.lgthinq) {
      const tokFile = path.join(__dirname, '..', '..', 'persist', 'lgthinq-tokens.json');
      try {
        const tok = JSON.parse(fs.readFileSync(tokFile, 'utf8'));
        safe.lgthinq.hasTokens  = !!tok.access_token;
        safe.lgthinq.userNumber = tok.user_number || '';
      } catch { safe.lgthinq.hasTokens = false; safe.lgthinq.userNumber = ''; }
      delete safe.lgthinq.username;
      delete safe.lgthinq.password;
    }
    res.json({ success: true, data: safe });
  });

  router.post('/settings', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const body = req.body;

    // Deep merge incoming fields
    const updated = {
      ...current,
      mqtt: { ...current.mqtt, ...body.mqtt },
      vrm: {
        ...current.vrm,
        ...body.vrm,
        // Don't overwrite secrets if placeholder was sent back
        password: (body.vrm?.password && !body.vrm.password.includes('•'))
          ? body.vrm.password
          : current.vrm?.password || '',
        apiToken: (body.vrm?.apiToken && !body.vrm.apiToken.includes('•'))
          ? body.vrm.apiToken
          : current.vrm?.apiToken || '',
      },
      solaredge: {
        siteId: body.solaredge?.siteId ?? current.solaredge?.siteId ?? '',
        apiKey: (body.solaredge?.apiKey && !body.solaredge.apiKey.includes('•'))
          ? body.solaredge.apiKey
          : current.solaredge?.apiKey ?? '',
      },
      smartthings: {
        token: (body.smartthings?.token && !body.smartthings.token.includes('•'))
          ? body.smartthings.token
          : current.smartthings?.token ?? '',
        clientId: body.smartthings?.clientId ?? current.smartthings?.clientId ?? '',
        clientSecret: (body.smartthings?.clientSecret && !body.smartthings.clientSecret.includes('•'))
          ? body.smartthings.clientSecret
          : current.smartthings?.clientSecret ?? '',
        deviceIds: body.smartthings?.deviceIds ?? current.smartthings?.deviceIds ?? [],
      },
      relays: body.relays || current.relays,
      server: { ...current.server, ...body.server },
      homekit: {
        ...current.homekit,
        ...body.homekit,
        // Regenerate setupID when PIN changes so QR code stays in sync
        setupID: (body.homekit?.pin && body.homekit.pin !== current.homekit?.pin)
          ? generateSetupID()
          : (body.homekit?.setupID || current.homekit?.setupID || generateSetupID()),
      },
    };

    try {
      writeConfigFile(updated);
      relayController.config.relays = updated.relays;
      res.json({ success: true, message: 'Settings saved. Restart the server to apply connection changes.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-mqtt', requireAdmin, async (req, res) => {
    const { host, port } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'host required' });

    const mqtt = require('mqtt');
    const client = mqtt.connect(`mqtt://${host}:${port || 1883}`, { connectTimeout: 5000 });

    const timeout = setTimeout(() => {
      client.end(true);
      res.json({ success: false, error: 'Connection timed out' });
    }, 6000);

    client.on('connect', () => {
      clearTimeout(timeout);
      client.end();
      res.json({ success: true, message: 'MQTT connection successful' });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end(true);
      res.json({ success: false, error: err.message });
    });
  });
};
