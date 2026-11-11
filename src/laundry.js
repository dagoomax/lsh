'use strict';

// Laundry — a hotel guest-laundry service (Node side; mirrors
// core-go/laundry_api.go, where the feature and config.laundry are described).
// Guests order on the public /laundry page, the charge goes on the room bill,
// and staff move orders through STATUSES in Settings → Laundry.
//
// Orders persist to persist/laundry-orders.json, newest first.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const PAGE_HTML = require('./laundry-page');

const ORDERS_FILE = path.join(__dirname, '..', 'persist', 'laundry-orders.json');
const MAX_ORDERS = 500;
const STATUSES = ['requested', 'collected', 'cleaning', 'ready', 'delivered', 'cancelled'];
const DEFAULT_SLOTS = ['As soon as possible', 'Morning (8:00–10:00)', 'Afternoon (14:00–16:00)', 'Evening (18:00–20:00)'];

const isOpen = (o) => o.status !== 'delivered' && o.status !== 'cancelled';
const positiveOr = (v, def) => { const n = Number(v); return n > 0 ? n : def; };
const round2 = (n) => Math.round(n * 100) / 100;

function loadOrders() {
  try { const a = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); return Array.isArray(a) ? a : []; }
  catch { return []; }
}

// The cap drops the oldest finished orders first, so it can never lose track of
// clothes the hotel is still holding.
function trimOrders(orders) {
  let excess = orders.length - MAX_ORDERS;
  if (excess <= 0) return orders;
  const drop = new Set();
  for (let i = orders.length - 1; i >= 0 && excess > 0; i--) {
    if (!isOpen(orders[i])) { drop.add(i); excess--; }
  }
  return orders.filter((_, i) => !drop.has(i)).slice(0, MAX_ORDERS);
}

function saveOrders(orders) {
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  const tmp = ORDERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(trimOrders(orders), null, 2));
  fs.renameSync(tmp, ORDERS_FILE);
}

const currencyOf = (config) => config.laundry?.currency || config.roomService?.currency || 'PLN';
const expressOn = (l) => l.express !== false;
const surchargePct = (l) => positiveOr(l.expressSurchargePct, 0);

function slotsOf(l) {
  const list = (Array.isArray(l.pickupSlots) ? l.pickupSlots : []).map((s) => String(s).trim()).filter(Boolean);
  return list.length ? list : DEFAULT_SLOTS;
}

// The room list orders are checked against.
function roomsOf(config) {
  const own = config.laundry?.rooms;
  const list = Array.isArray(own) && own.length ? own : (config.roomService?.rooms || []);
  return list.map((r) => String(r).trim()).filter(Boolean);
}

// What the guest page needs: available items, no room list.
function menuPublic(config) {
  const l = config.laundry || {};
  return {
    enabled: l.enabled === true,
    title: String(l.title || ''),
    currency: currencyOf(config),
    standardHours: positiveOr(l.standardHours, 24),
    express: { enabled: expressOn(l), surchargePct: surchargePct(l), hours: positiveOr(l.expressHours, 4) },
    pickupSlots: slotsOf(l),
    items: (Array.isArray(l.items) ? l.items : [])
      .filter((i) => i && i.available !== false)
      .map((i) => ({ id: String(i.id || ''), category: String(i.category || ''), name: String(i.name || ''), desc: String(i.desc || ''), price: Number(i.price) || 0 })),
    hideHotelServices: config.hideHotelServices === true,
  };
}

// Validates a cart against the price list. The server never trusts a client-sent price.
function priceItems(l, cart, isExpress) {
  const byId = {};
  for (const i of (Array.isArray(l.items) ? l.items : [])) {
    if (i && i.available !== false) byId[String(i.id)] = i;
  }
  const lines = [];
  let subtotal = 0;
  for (const c of (Array.isArray(cart) ? cart : [])) {
    const id = String(c?.id ?? '');
    const qty = Math.trunc(Number(c?.qty));
    const m = Object.hasOwn(byId, id) ? byId[id] : null;
    if (!(qty >= 1 && qty <= 99) || !m) continue;
    const price = Number(m.price) || 0;
    subtotal += price * qty;
    lines.push({ id, name: String(m.name || ''), price, qty });
  }
  subtotal = round2(subtotal);
  const surcharge = isExpress ? Math.round(subtotal * surchargePct(l)) / 100 : 0;
  return { lines, subtotal, surcharge, total: round2(subtotal + surcharge) };
}

function dueAt(l, isExpress, from) {
  const hours = isExpress ? positiveOr(l.expressHours, 4) : positiveOr(l.standardHours, 24);
  return from + Math.trunc(hours * 3600000);
}

const orderId = () => 'l' + Date.now().toString(36) + crypto.randomBytes(5).toString('hex');

// The room's unfinished orders, for the checkout warning.
function openForRoom(room) {
  return loadOrders().filter((o) => isOpen(o) && o.room === room)
    .map((o) => ({ id: o.id, status: o.status, dueAt: o.dueAt, items: o.items, total: o.total }));
}

// The laundry part of hotel.daily-report: orders placed on the date (cancelled
// ones excluded) plus everything still open now.
// YYYY-MM-DD of a time in the server's time zone — a hotel's day is the local one.
function localDay(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dailySummary(date) {
  const orders = loadOrders();
  const placed = orders.filter((o) => o.status !== 'cancelled' && localDay(Number(o.at || 0)) === date);
  const revenue = {};
  for (const o of placed) revenue[o.currency] = round2((revenue[o.currency] || 0) + Number(o.total || 0));
  return { orders: placed.length, open: orders.filter(isOpen).length, revenue };
}

function pageRouter() {
  const router = express.Router();
  router.get(/.*/, (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.type('html').send(PAGE_HTML);
  });
  return router;
}

module.exports = { STATUSES, isOpen, loadOrders, saveOrders, trimOrders, menuPublic, priceItems, roomsOf, slotsOf, expressOn, dueAt, orderId, currencyOf, openForRoom, dailySummary, localDay, pageRouter, ORDERS_FILE };
