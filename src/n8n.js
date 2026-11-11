'use strict';

// n8n hotel automation bridge (Node side; mirrors core-go/n8n.go).
//
// LSH posts hotel domain events to n8n as signed JSON webhooks so a hotel can
// wire up workflows without touching the codebase. Each "hook" is one n8n
// Webhook-node URL (or the community n8n-nodes-lsh Trigger) subscribed to one
// or more event names. Deliveries are signed exactly like src/webhooks.js
// (X-LSH-Signature: sha256=HMAC-SHA256 of the raw body), so the existing LSH
// Trigger node's verification accepts them.
//
// config.n8n = {
//   enabled, hooks: [ { id, name, url, secret, events: [...], enabled } ],
//   escalateAfterMinutes: 15,   // unacked order → room-service.escalation
//   dailyReportAt: "08:00" }    // local time → hotel.daily-report
//
// Events: room-service.order | room-service.ack | room-service.escalation |
// laundry.order | laundry.status | laundry.overdue | laundry.checkout-open |
//         hotel.checkin | hotel.checkout | hotel.daily-report | test

const fs = require('fs');
const os = require('os');
const path = require('path');
const WebhookHub = require('./webhooks');
const { readConfigFile } = require('./routes/helpers');
const rsvc = require('./room-service');
const laundry = require('./laundry');

const PERSIST = path.join(__dirname, '..', 'persist');
const STATE_FILE = path.join(PERSIST, 'n8n-state.json');
const ROOMS_FILE = path.join(PERSIST, 'hotel-rooms.json');

const EVENTS = [
  'room-service.order', 'room-service.ack', 'room-service.escalation',
  'laundry.order', 'laundry.status', 'laundry.overdue', 'laundry.checkout-open',
  'hotel.checkin', 'hotel.checkout', 'hotel.daily-report',
];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// hookWants: exact name, "*"/"**" for everything, or a "prefix.*" family.
function hookWants(hook, event) {
  for (const raw of Array.isArray(hook.events) ? hook.events : []) {
    const name = String(raw).trim();
    if (name === event || name === '*' || name === '**') return true;
    if (name.endsWith('.*') && event.startsWith(name.slice(0, -1))) return true;
  }
  return false;
}

class N8n {
  constructor({ fetchImpl = (...a) => fetch(...a) } = {}) {
    this.fetch = fetchImpl;
    this.last = new Map(); // hook id → { at, status, error }
    this.timer = null;
    this.notify = null; // set by server: (level, msg, source) => {}
  }

  config() { try { return readConfigFile().n8n || {}; } catch { return {}; } }
  enabled() { return this.config().enabled === true; }
  hooks() { const h = this.config().hooks; return Array.isArray(h) ? h : []; }
  escalateAfterMs() { const m = Number(this.config().escalateAfterMinutes); return (m > 0 ? m : 15) * 60000; }

  dailyReportAt() {
    const v = String(this.config().dailyReportAt || '').trim();
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = +m[1], mm = +m[2];
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return { hh, mm };
  }

  siteName() { try { return readConfigFile().siteName || os.hostname(); } catch { return os.hostname() || 'LSH'; } }

  // ── delivery ──────────────────────────────────────────────────────────────

  emit(event, data) {
    if (!this.enabled()) return;
    for (const h of this.hooks()) {
      if (h.enabled === false || !h.url || !hookWants(h, event)) continue;
      this.deliver(h.id, String(h.url).trim(), h.secret || '', event, data).catch(() => {});
    }
  }

  async emitTo(id, event, data) {
    const h = this.hooks().find((x) => x.id === id);
    if (!h) return null;
    if (!h.url) return { at: Date.now(), status: 0, error: 'hook has no URL' };
    return this.deliver(h.id, String(h.url).trim(), h.secret || '', event, data);
  }

  async deliver(id, url, secret, event, data) {
    const raw = JSON.stringify({ event, hub: this.siteName(), sentAt: new Date().toISOString(), data });
    const result = { at: Date.now(), status: 0, error: null };
    try {
      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'LSH-n8n/1', 'X-LSH-Event': event };
      if (secret) headers['X-LSH-Signature'] = WebhookHub.sign(secret, raw);
      const r = await this.fetch(url, { method: 'POST', body: raw, headers, signal: AbortSignal.timeout(10_000) });
      result.status = r.status;
      if (!r.ok) result.error = `HTTP ${r.status}`;
    } catch (err) { result.error = err.name === 'TimeoutError' ? 'timed out' : err.message; }
    this.last.set(id, result);
    return result;
  }

  lastFor(id) { return this.last.get(id) || null; }

  // ── background loops ────────────────────────────────────────────────────────

  start() { if (!this.timer) this.timer = setInterval(() => this.tick(), 60_000); }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tick() {
    if (!this.enabled()) return;
    try { this.checkEscalations(); } catch { /* keep looping */ }
    try { this.checkLaundryOverdue(); } catch { /* keep looping */ }
    try { this.checkDailyReport(); } catch { /* keep looping */ }
  }

  checkEscalations() {
    const threshold = this.escalateAfterMs();
    const now = Date.now();
    const orders = rsvc.loadOrders();
    const pending = [];
    let changed = false;
    for (const o of orders) {
      if (o.status !== 'new' || o.escalatedN8n === true) continue;
      const age = now - Number(o.at || 0);
      if (age >= threshold) { o.escalatedN8n = true; changed = true; pending.push({ order: o, waiting: Math.floor(age / 60000) }); }
    }
    if (changed) rsvc.saveOrders(orders);
    for (const e of pending) {
      this.emit('room-service.escalation', { order: e.order, waitingMinutes: e.waiting });
      if (this.notify) this.notify('warning', `Room service unacknowledged ${e.waiting} min — room ${e.order.room || '?'}`, 'n8n');
    }
  }

  // laundry.overdue fires once per open order past its due time.
  checkLaundryOverdue() {
    const now = Date.now();
    const orders = laundry.loadOrders();
    const late = orders.filter((o) => laundry.isOpen(o) && o.overdueN8n !== true && now > Number(o.dueAt || 0));
    if (!late.length) return;
    for (const o of late) o.overdueN8n = true;
    laundry.saveOrders(orders);
    for (const o of late) {
      this.emit('laundry.overdue', o);
      if (this.notify) this.notify('warning', `Laundry overdue — room ${o.room}`, 'laundry');
    }
  }

  checkDailyReport() {
    const at = this.dailyReportAt();
    if (!at) return;
    const now = new Date();
    const today = laundry.localDay(now); // local, like dailyReportAt
    const st = readJson(STATE_FILE, {});
    if (st.lastReportDate === today) return;
    if (now.getHours() < at.hh || (now.getHours() === at.hh && now.getMinutes() < at.mm)) return;
    const report = this.buildDailyReport(today);
    writeJsonAtomic(STATE_FILE, { ...st, lastReportDate: today });
    this.emit('hotel.daily-report', report);
  }

  buildDailyReport(date) {
    const orders = rsvc.loadOrders();
    let count = 0, pending = 0;
    const revenue = {};
    const byRoom = new Map();
    for (const o of orders) {
      if (laundry.localDay(Number(o.at || 0)) !== date) continue;
      count++;
      if (o.status === 'new') pending++;
      const cur = o.currency || 'PLN';
      revenue[cur] = Math.round(((revenue[cur] || 0) + Number(o.total || 0)) * 100) / 100;
      const room = o.room || '—';
      byRoom.set(room, (byRoom.get(room) || 0) + 1);
    }
    return { date, orders: count, pendingAcks: pending, revenue, byRoom: [...byRoom].map(([room, orders]) => ({ room, orders })), laundry: laundry.dailySummary(date) };
  }

  // ── occupancy (check-in / check-out) ────────────────────────────────────────

  loadRooms() { const r = readJson(ROOMS_FILE, {}); return r && typeof r === 'object' ? r : {}; }
  saveRooms(rooms) { writeJsonAtomic(ROOMS_FILE, rooms); }
}

let shared = null;
N8n.shared = () => (shared ||= new N8n());
N8n.EVENTS = EVENTS;
N8n.hookWants = hookWants;
module.exports = N8n;
