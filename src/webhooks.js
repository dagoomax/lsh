'use strict';

// Outgoing webhooks: POST device value changes to subscribers — the n8n
// "LSH Trigger" node (integrations/n8n-nodes-lsh) registers one when its
// workflow is activated and removes it when deactivated; anything else that
// takes a JSON webhook (Make, Zapier, Home Assistant, a script) works too.
//
// A subscription: { id, name, url, keys: ['shelly/*/power', 'airbnb/**'],
//   throttleSeconds, secret, enabled, createdAt, last: { at, status, error }, failures }
// keys are patterns over store keys "<device key>/<sensor path>": '*' matches
// within one segment, '**' any number of them.
//
// Changes are batched for 500 ms per subscription and signed:
//   X-LSH-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed by the secret>
// 20 failed deliveries in a row pause a subscription (enabled: false).
//
// Kept in persist/webhooks.json (mode 600 — it holds the secrets).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'persist', 'webhooks.json');
const MAX_SUBS = 50;
const MAX_FAILURES = 20;
const BATCH_MS = 500;
const MAX_BATCH = 200;

function pattern(p) {
  const re = String(p).trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`);
}

function validUrl(u) {
  try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : null; } catch { return null; }
}

class WebhookHub {
  constructor(store, sensorRegistry, { file = FILE, fetchImpl = (...a) => fetch(...a), batchMs = BATCH_MS } = {}) {
    this.store = store;
    this.registry = sensorRegistry;
    this.file = file;
    this.fetch = fetchImpl;
    this.batchMs = batchMs;
    this.subs = this._load();
    this.queues = new Map(); // id → { changes: [], timer }
    this.sentAt = new Map(); // `${id}|${key}` → ms, for throttleSeconds
    this.prev = new Map();
    this._compile();
    this._onChange = (e) => this._change(e);
    store?.on?.('change', this._onChange);
  }

  stop() { this.store?.off?.('change', this._onChange); for (const q of this.queues.values()) clearTimeout(q.timer); }

  _load() {
    try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.subs, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this._compile();
  }

  _compile() { this.matchers = new Map(this.subs.map((s) => [s.id, (s.keys || []).map(pattern)])); }

  // public view: no secret
  view(s) { const { secret, ...rest } = s; return { ...rest, hasSecret: !!secret }; }
  list() { return this.subs.map((s) => this.view(s)); }
  get(id) { return this.subs.find((s) => s.id === id) || null; }

  add({ name, url, keys, throttleSeconds, secret } = {}) {
    const u = validUrl(url);
    if (!u) throw new Error('url must be an http(s) address');
    const k = (Array.isArray(keys) ? keys : String(keys || '').split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 100);
    if (!k.length) throw new Error('keys: at least one device or pattern, e.g. "shelly/*/power" or "**" for everything');
    if (this.subs.length >= MAX_SUBS) throw new Error(`At most ${MAX_SUBS} webhooks`);
    const sub = {
      id: crypto.randomBytes(8).toString('hex'),
      name: String(name || 'Webhook').slice(0, 80),
      url: u, keys: k,
      throttleSeconds: Math.max(0, Math.min(3600, Number(throttleSeconds) || 0)),
      secret: secret && String(secret).length >= 16 ? String(secret).slice(0, 128) : crypto.randomBytes(24).toString('hex'),
      enabled: true, createdAt: new Date().toISOString(), failures: 0, last: null,
    };
    this.subs.push(sub);
    this._save();
    return sub;
  }

  update(id, patch = {}) {
    const s = this.get(id);
    if (!s) return null;
    if (patch.enabled != null) { s.enabled = !!patch.enabled; if (s.enabled) s.failures = 0; }
    if (patch.name != null) s.name = String(patch.name).slice(0, 80);
    if (patch.throttleSeconds != null) s.throttleSeconds = Math.max(0, Math.min(3600, Number(patch.throttleSeconds) || 0));
    this._save();
    return s;
  }

  remove(id) {
    const n = this.subs.length;
    this.subs = this.subs.filter((s) => s.id !== id);
    if (this.subs.length === n) return false;
    const q = this.queues.get(id); if (q) clearTimeout(q.timer);
    this.queues.delete(id);
    this._save();
    return true;
  }

  // "<device key>/<sensor path>" → the device and sensor (device keys hold slashes too)
  describe(key) {
    const devices = this.registry?.getDevices?.() || [];
    let device = null;
    for (const d of devices) if (key.startsWith(`${d.key}/`) && (!device || d.key.length > device.key.length)) device = d;
    if (!device) return { device: null, sensor: null };
    const p = key.slice(device.key.length + 1);
    const sensor = (device.sensors || []).find((x) => x.path === p) || null;
    return { device, sensor, path: p };
  }

  _change({ key, value, changed }) {
    // the store flags repeated primitives; objects are compared here
    if (changed === false || typeof key !== 'string' || !this.subs.length) return;
    const subs = this.subs.filter((s) => s.enabled && this.matchers.get(s.id)?.some((re) => re.test(key)));
    if (!subs.length) return;
    const seen = this.prev.get(key);
    const cur = value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
    if (seen !== undefined && seen.cur === cur) return;
    this.prev.set(key, { cur, value });
    const previous = seen ? seen.value : undefined;
    const now = Date.now();
    for (const s of subs) {
      if (s.throttleSeconds) {
        const k = `${s.id}|${key}`;
        if (now - (this.sentAt.get(k) || 0) < s.throttleSeconds * 1000) continue;
        this.sentAt.set(k, now);
      }
      this._queue(s, { key, value, previous: previous === undefined ? null : previous, at: new Date(now).toISOString() });
    }
  }

  _queue(s, change) {
    let q = this.queues.get(s.id);
    if (!q) { q = { changes: [], timer: null }; this.queues.set(s.id, q); }
    // newest value per key in one batch
    const i = q.changes.findIndex((c) => c.key === change.key);
    if (i >= 0) q.changes[i] = { ...change, previous: q.changes[i].previous }; else if (q.changes.length < MAX_BATCH) q.changes.push(change);
    if (!q.timer) q.timer = setTimeout(() => { q.timer = null; const changes = q.changes.splice(0); if (changes.length) this.deliver(s, 'change', changes).catch(() => {}); }, this.batchMs);
  }

  _enrich(c) {
    const { device, sensor, path: p } = this.describe(c.key);
    return {
      ...c,
      device: device ? device.key : null,
      deviceLabel: device ? device.label || device.key : null,
      room: device?.room || null,
      sensor: p || null,
      sensorLabel: sensor ? sensor.label || sensor.name || p : null,
      unit: sensor?.unit || null,
    };
  }

  body(event, changes, hub) {
    return JSON.stringify({ event, hub: hub || null, sentAt: new Date().toISOString(), changes: changes.map((c) => this._enrich(c)) });
  }

  static sign(secret, raw) { return `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`; }

  async deliver(s, event, changes) {
    const raw = this.body(event, changes, this.hubName);
    let status = 0, error = null;
    try {
      const r = await this.fetch(s.url, {
        method: 'POST', body: raw, signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'LSH-webhooks/1', 'X-LSH-Event': event, 'X-LSH-Webhook': s.id, 'X-LSH-Signature': WebhookHub.sign(s.secret, raw) },
      });
      status = r.status;
      if (!r.ok) error = `HTTP ${r.status}`;
    } catch (err) { error = err.name === 'TimeoutError' ? 'timed out' : err.message; }
    s.last = { at: new Date().toISOString(), status, error };
    if (error) {
      s.failures = (s.failures || 0) + 1;
      if (s.failures >= MAX_FAILURES && s.enabled) { s.enabled = false; console.warn(`[Webhooks] "${s.name}" paused after ${MAX_FAILURES} failed deliveries (${new URL(s.url).host}: ${error})`); }
    } else s.failures = 0;
    try { this._save(); } catch { /* keep delivering */ }
    return { ok: !error, status, error };
  }

  // a sample delivery with the current value of the first matching key
  async test(id) {
    const s = this.get(id);
    if (!s) return null;
    const re = this.matchers.get(s.id) || [];
    const devices = this.registry?.getDevices?.() || [];
    let sample = null;
    for (const d of devices) {
      for (const x of d.sensors || []) {
        const key = `${d.key}/${x.path}`;
        if (re.some((r) => r.test(key))) { const v = this.store?.get?.(key); sample = { key, value: v === undefined ? null : v, previous: null, at: new Date().toISOString() }; break; }
      }
      if (sample) break;
    }
    return this.deliver(s, 'test', [sample || { key: 'lsh/test', value: true, previous: null, at: new Date().toISOString() }]);
  }
}

let hub = null;
WebhookHub.shared = (store, registry) => (hub ||= new WebhookHub(store, registry));
WebhookHub.pattern = pattern;
module.exports = WebhookHub;
