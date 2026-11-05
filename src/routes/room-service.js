'use strict';

// Room service REST routes (mirrors core-go/roomservice_api.go). Mounted under
// /api. Guest endpoints live under /api/order/* (public — see PUBLIC_API in
// auth.js); staff/admin endpoints under /api/room-service/*. The menu is saved
// through POST /api/settings/room-service.

const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const rsvc = require('../room-service');
const { resolveLicense } = require('../license');

// Room service is a hotel-tier feature.
const hotelLicensed = (config) => resolveLicense(config).limits.hotel === true;

const BULLETS = '••••••••';
const masked = (s) => typeof s === 'string' && s.includes('•');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // License status (tier, limits, pricing) — mirrors core-go /api/license.
  router.get('/license', (req, res) => {
    const l = resolveLicense(readConfigFile());
    res.json({ success: true, data: { tier: l.tier, licensee: l.licensee, exp: l.exp, reason: l.reason, limits: l.limits, pricing: l.pricing } });
  });
  const notify = (level, msg) => { try { ctx.clients?.automation?.notify(level, msg, 'room-service'); } catch { /* best-effort */ } };

  // ── Public guest endpoints (/api/order/*) ──────────────────────────────
  router.get('/order/menu', (req, res) => {
    const config = readConfigFile();
    const m = rsvc.menuPublic(config);
    m.enabled = m.enabled && hotelLicensed(config);
    if (!m.enabled) return res.status(404).json({ success: false, error: 'Room service is not available' });
    res.json({ success: true, data: m });
  });

  router.post('/order/place', async (req, res) => {
    const config = readConfigFile();
    const rs = config.roomService || {};
    if (rs.enabled !== true || !hotelLicensed(config)) return res.status(404).json({ success: false, error: 'Room service is not available' });
    const { lines, total } = rsvc.priceItems(config, req.body?.items);
    if (!lines.length) return res.status(400).json({ success: false, error: 'Your order is empty' });
    const room = String(req.body?.room || '').trim();
    let payment = req.body?.payment === 'card' ? 'card' : 'room';
    if (payment === 'room' && rs.payToRoom === false) return res.status(400).json({ success: false, error: 'Charging to the room isn’t available — please pay now' });
    const currency = rs.currency || 'PLN';
    let paid = false;
    if (payment === 'card') {
      try {
        const okPaid = await rsvc.stripeVerify(rs.stripe?.secretKey, req.body?.paymentIntentId, total, currency);
        if (!okPaid) return res.status(402).json({ success: false, error: 'Payment not completed' });
        paid = true;
      } catch (err) { return res.status(502).json({ success: false, error: 'Couldn’t confirm the payment: ' + err.message }); }
    }
    const order = { id: rsvc.orderId(), at: Date.now(), room, items: lines, total, currency, note: String(req.body?.note || '').trim(), payment, paid, status: 'new', ackAt: 0 };
    try { rsvc.saveOrders([order, ...rsvc.loadOrders()]); }
    catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    const n = order.items.reduce((a, b) => a + b.qty, 0);
    notify('info', `Room service — ${room || 'guest'}: ${n} item(s), ${total.toFixed(2)} ${currency} (${payment === 'card' ? 'paid by card' : '→ room'})`);
    res.json({ success: true, data: order });
  });

  router.post('/order/pay', async (req, res) => {
    const config = readConfigFile();
    const rs = config.roomService || {};
    const st = rs.stripe || {};
    if (rs.enabled !== true || !hotelLicensed(config) || st.enabled !== true || !st.secretKey) return res.status(400).json({ success: false, error: 'Card payment isn’t enabled' });
    const { total } = rsvc.priceItems(config, req.body?.items);
    if (total <= 0) return res.status(400).json({ success: false, error: 'Your order is empty' });
    const currency = rs.currency || 'PLN';
    try {
      const pi = await rsvc.stripeCreateIntent(st.secretKey, total, currency, String(req.body?.room || ''));
      res.json({ success: true, data: { clientSecret: pi.client_secret, paymentIntentId: pi.id, publishableKey: st.publishableKey || '', amount: pi.amount, currency } });
    } catch (err) { res.status(502).json({ success: false, error: 'Payment setup failed: ' + err.message }); }
  });

  // ── Admin endpoints (/api/room-service/*) ──────────────────────────────
  router.get('/room-service', requireAdmin, (req, res) => {
    const config = readConfigFile();
    const rs = JSON.parse(JSON.stringify(config.roomService || {}));
    if (rs.stripe?.secretKey) rs.stripe.secretKey = BULLETS;
    res.json({ success: true, data: { roomService: rs, hideHotelServices: config.hideHotelServices === true } });
  });

  router.get('/room-service/orders', requireAdmin, (req, res) => {
    res.json({ success: true, data: rsvc.loadOrders() });
  });

  router.post('/room-service/orders/:id/ack', requireAdmin, (req, res) => {
    const orders = rsvc.loadOrders();
    const o = orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ success: false, error: 'No such order' });
    o.status = 'ack'; o.ackAt = Date.now();
    try { rsvc.saveOrders(orders); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    res.json({ success: true, data: o });
  });

  router.delete('/room-service/orders/:id', requireAdmin, (req, res) => {
    const kept = req.params.id === 'all' ? [] : rsvc.loadOrders().filter((x) => x.id !== req.params.id);
    try { rsvc.saveOrders(kept); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    res.json({ success: true });
  });

  router.post('/settings/room-service', requireAdmin, (req, res) => {
    const config = readConfigFile();
    const prev = config.roomService || {};
    const rs = req.body?.roomService || {};
    rs.stripe = rs.stripe || {};
    if (masked(rs.stripe.secretKey)) rs.stripe.secretKey = prev.stripe?.secretKey || '';
    const next = { ...config, roomService: rs };
    if (req.body?.hideHotelServices !== undefined) next.hideHotelServices = req.body.hideHotelServices === true;
    try { writeConfigFile(next); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    res.json({ success: true });
  });
};
