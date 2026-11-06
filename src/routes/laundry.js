'use strict';

// Laundry REST routes (mirrors core-go/laundry_api.go). Guest endpoints live
// under /api/order/laundry/* (the public /api/order/ prefix in auth.js covers
// them); staff endpoints under /api/laundry/*.

const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const laundry = require('../laundry');
const { resolveLicense } = require('../license');
const n8n = require('../n8n').shared();

const hotelLicensed = (config) => resolveLicense(config).limits.hotel === true;
const clip = (v, n) => [...String(v ?? '').trim()].slice(0, n).join('');
const fail = (res, status, error) => res.status(status).json({ success: false, error });

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;
  const notify = (level, msg) => { try { ctx.clients?.automation?.notify(level, msg, 'laundry'); } catch { /* best-effort */ } };

  // ── Public guest endpoints ─────────────────────────────────────────────
  router.get('/order/laundry/menu', (req, res) => {
    const config = readConfigFile();
    const m = laundry.menuPublic(config);
    m.enabled = m.enabled && hotelLicensed(config);
    if (!m.enabled) return fail(res, 404, 'Laundry service is not available');
    res.json({ success: true, data: m });
  });

  router.post('/order/laundry/place', (req, res) => {
    const config = readConfigFile();
    const l = config.laundry || {};
    if (l.enabled !== true || !hotelLicensed(config)) return fail(res, 404, 'Laundry service is not available');
    const express = req.body?.express === true && laundry.expressOn(l);
    const { lines, subtotal, surcharge, total } = laundry.priceItems(l, req.body?.items, express);
    if (!lines.length) return fail(res, 400, 'Your laundry list is empty');
    const room = clip(req.body?.room, 20);
    if (!room) return fail(res, 400, 'Please enter your room number');
    const rooms = laundry.roomsOf(config);
    if (rooms.length && !rooms.includes(room)) return fail(res, 400, 'We don’t recognise that room number');
    const slots = laundry.slotsOf(l);
    const pickup = slots.includes(req.body?.pickup) ? req.body.pickup : slots[0];
    const now = Date.now();
    const order = {
      id: laundry.orderId(), at: now, room, items: lines, express, subtotal, surcharge, total,
      currency: laundry.currencyOf(config), pickup, note: clip(req.body?.note, 500),
      payment: 'room', paid: false, status: 'requested',
      history: [{ status: 'requested', at: now }], dueAt: laundry.dueAt(l, express, now),
    };
    try { laundry.saveOrders([order, ...laundry.loadOrders()]); }
    catch (err) { return fail(res, 500, err.message); }
    const n = lines.reduce((a, b) => a + b.qty, 0);
    notify('info', `Laundry — room ${room}: ${n} item(s), ${express ? 'EXPRESS' : 'standard'}, pickup: ${pickup}`);
    n8n.emit('laundry.order', order);
    res.json({ success: true, data: order });
  });

  // Progress for the guest's tracker. The id is unguessable and the reply
  // leaves out the room and the note.
  router.get('/order/laundry/status/:id', (req, res) => {
    const o = laundry.loadOrders().find((x) => x.id === req.params.id);
    if (!o) return fail(res, 404, 'No such order');
    const { id, at, status, history, dueAt, express, items, total, currency, pickup } = o;
    res.json({ success: true, data: { id, at, status, history, dueAt, express, items, total, currency, pickup } });
  });

  // ── Admin endpoints ────────────────────────────────────────────────────
  router.get('/laundry', requireAdmin, (req, res) => {
    const config = readConfigFile();
    res.json({ success: true, data: { laundry: config.laundry || {}, roomServiceRooms: config.roomService?.rooms || [], hideHotelServices: config.hideHotelServices === true } });
  });

  router.get('/laundry/orders', requireAdmin, (req, res) => {
    res.json({ success: true, data: laundry.loadOrders() });
  });

  // Any status may be set, so staff can undo a mis-tap. The turnaround clock
  // restarts at collection.
  router.post('/laundry/orders/:id/status', requireAdmin, (req, res) => {
    const status = req.body?.status;
    if (!laundry.STATUSES.includes(status)) return fail(res, 400, 'Unknown status');
    const orders = laundry.loadOrders();
    const o = orders.find((x) => x.id === req.params.id);
    if (!o) return fail(res, 404, 'No such order');
    if (o.status === status) return res.json({ success: true, data: o });
    const now = Date.now();
    o.status = status;
    o.history = [...(o.history || []), { status, at: now }];
    if (status === 'collected') {
      o.dueAt = laundry.dueAt(readConfigFile().laundry || {}, o.express === true, now);
      o.overdueN8n = false;
    }
    try { laundry.saveOrders(orders); } catch (err) { return fail(res, 500, err.message); }
    n8n.emit('laundry.status', o);
    res.json({ success: true, data: o });
  });

  // Removes one order, or every delivered and cancelled one with id=finished. An
  // open order can't be deleted: cancel it first, so nobody loses track of
  // clothes by accident.
  router.delete('/laundry/orders/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const orders = laundry.loadOrders();
    if (orders.some((o) => o.id === id && laundry.isOpen(o))) return fail(res, 409, 'Cancel the order before deleting it');
    const kept = orders.filter((o) => laundry.isOpen(o) || (id !== 'finished' && o.id !== id));
    try { laundry.saveOrders(kept); } catch (err) { return fail(res, 500, err.message); }
    res.json({ success: true });
  });

  router.post('/settings/laundry', requireAdmin, (req, res) => {
    try { writeConfigFile({ ...readConfigFile(), laundry: req.body?.laundry || {} }); }
    catch (err) { return fail(res, 500, err.message); }
    res.json({ success: true });
  });
};
