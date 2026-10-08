'use strict';

// SIP doorbell intercom — split out of src/api-routes.js; registered in order by createApiRoutes().
const { Router, raw } = require('express');
const http = require('http');

module.exports = function register(router, ctx) {
  const { clients, openweather, requireAdmin, sipServer } = ctx;

  // ── SIP doorbell intercom ─────────────────────────────────

  router.get('/sip/status', (req, res) => {
    if (!sipServer) return res.json({ success: true, data: { active: false, state: 'disabled' } });
    res.json({ success: true, data: sipServer.getState() });
  });

  router.post('/sip/answer', (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    res.json({ success: sipServer.answer() });
  });

  router.post('/sip/reject', (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    res.json({ success: sipServer.reject() });
  });

  router.post('/sip/hangup', (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    res.json({ success: sipServer.hangup() });
  });

  // Daily forecast for the dashboard's forecast strip — current conditions
  // are already reachable through the generic device/readings mechanism
  // (openweather/weather), but a multi-day array doesn't fit that scalar
  // per-sensor shape, so it gets its own small endpoint, same as /api/cameras
  // or /api/relays.
  router.get('/openweather/forecast', (req, res) => {
    if (!openweather) return res.status(503).json({ success: false, error: 'OpenWeatherMap not configured' });
    res.json({ success: true, data: openweather.getForecast() });
  });

  // Today's hourly PLN/kWh rate (TAURON dynamic tariff / PSE RCE index) —
  // same "own small endpoint" reasoning as the forecast above: the Energy
  // tab's solar-gain chart needs the whole day's curve, not just the one
  // current-price scalar the generic device/readings mechanism exposes.
  router.get('/tauron-tariff/hourly', (req, res) => {
    if (!clients.tauronTariff) return res.status(503).json({ success: false, error: 'Tauron tariff not configured' });
    res.json({ success: true, data: clients.tauronTariff.getHourly(), ...clients.tauronTariff.getCurrency() });
  });

  router.post('/sip/open-door', requireAdmin, async (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    try {
      await sipServer.openDoor();
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Live listen: proxies the audio bridge's local ffmpeg MP3 stream straight
  // through to the browser <audio> element — no buffering here, whatever
  // ffmpeg produces goes out as it arrives.
  router.get('/sip/listen', (req, res) => {
    const port = sipServer?.audioListenPort;
    if (!port) return res.status(503).json({ success: false, error: 'No active call with audio' });
    const upstream = http.get(`http://127.0.0.1:${port}/`, (up) => {
      res.set('Content-Type', 'audio/mpeg');
      up.pipe(res);
    });
    upstream.on('error', (err) => {
      if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
    });
    req.on('close', () => upstream.destroy());
  });

  // Live talk: the browser posts live MediaRecorder chunks here as they're
  // captured; each chunk is fed straight into the audio bridge's ffmpeg
  // stdin. No JSON — raw audio/webm body.
  router.post('/sip/talk', raw({ type: '*/*', limit: '256kb' }), (req, res) => {
    if (!sipServer) return res.status(503).json({ success: false, error: 'SIP server not enabled' });
    sipServer.writeTalkChunk(req.body);
    res.json({ success: true });
  });
};
