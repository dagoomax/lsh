'use strict';

// hydrop systems hydropmeter — an optical reader clipped onto an analog water
// meter, reporting over Wi-Fi to the hydrop cloud (servers in Germany). LSH
// reads it through the official hydrop REST API (api.hydrop-systems.com,
// OpenAPI 1.0.6 at /openapi.json). The device has no local API.
//
//   GET /sensors/all/newest            → {sensors: [{deviceID, records: [{meterValue (m³), timestamp (s)}]}]}
//   GET /sensors/ID/<id or name>/status → {status: green|yellow|red|grey, status_timestamp}
//   GET /rate_limit_status              → {limit, remaining, reset_time}
//   header  apikey: <key from the hydrop app / account settings>
//
// Quota: a shared daily allowance per API key (400 requests in the API's own
// example), reset at 00:00 UTC; 429 once used up. The meter sends at least
// every five minutes, so the default pollInterval is 300 s (min 240) — 288
// readings a day plus an hourly status per meter.
//
// One device per meter, `hydrop/<deviceID>`: meter reading (m³), flow
// (L/min, from the change between two readings), water used today (L, since
// local midnight), status, time of the last reading.
//
// config.hydrop = { apiKey, pollInterval = 300 (s) }   (apiBase overrides for tests)
// Tested against scripts/hydrop-simulator.js (test/hydrop.test.js) — not yet
// against a real meter.

const PollingClient = require('./polling-client');

const TIMEOUT_MS = 20000;
const STATUS_EVERY_MS = 60 * 60 * 1000;
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meter';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` };

class HydropClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'hydrop', logTag: 'hydrop' });
    this.cfg = config.hydrop || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.api = (this.cfg.apiBase || 'https://api.hydrop-systems.com').replace(/\/+$/, '');
    this.meters = new Map(); // deviceID → { id, key, last: {value, ts}, statusAt }
    this._quotaAt = 0;
  }

  async start() {
    if (!this.cfg.apiKey) throw new Error('config.hydrop needs apiKey (hydrop app → account → API key)');
    await this.startPolling(Math.max(240, Number(this.cfg.pollInterval) || 300) * 1000);
  }

  async _call(p) {
    const res = await fetch(`${this.api}${p}`, { headers: { apikey: this.cfg.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if ([400, 401, 403, 422].includes(res.status)) throw new Error('hydrop: API key not accepted — check it in the hydrop app');
    if (res.status === 429) throw new Error('hydrop: daily API quota used up — it resets at 00:00 UTC; raise pollInterval');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`hydrop ${p}: HTTP ${res.status}`);
    return res.json();
  }

  async _pollImpl() {
    const r = await this._call('/sensors/all/newest');
    const sensors = Array.isArray(r?.sensors) ? r.sensors : null;
    if (!sensors) throw new Error('hydrop: no meter readings on this account yet');
    for (const s of sensors) {
      const rec = s?.records?.[0];
      if (!s?.deviceID || !rec || !Number.isFinite(Number(rec.meterValue))) continue;
      const m = this._meter(s.deviceID);
      this._publish(m, Number(rec.meterValue), Number(rec.timestamp));
      if (Date.now() - m.statusAt > STATUS_EVERY_MS) {
        m.statusAt = Date.now();
        const st = await this._call(`/sensors/ID/${encodeURIComponent(s.deviceID)}/status`).catch(() => null);
        if (st?.status) this.store.update(`${m.key}/status`, st.status);
      }
    }
    if (Date.now() - this._quotaAt > STATUS_EVERY_MS) {
      this._quotaAt = Date.now();
      const q = await this._call('/rate_limit_status').catch(() => null);
      if (q && Number.isFinite(q.remaining)) for (const m of this.meters.values()) this.store.update(`${m.key}/quota`, q.remaining);
    }
  }

  _meter(id) {
    let m = this.meters.get(id);
    if (m) return m;
    m = { id, key: `hydrop/${slug(id)}`, last: null, statusAt: 0 };
    this.meters.set(id, m);
    this.registry.registerDevice({
      key: m.key, type: 'hydrop', label: id, model: 'hydrop hydropmeter', icon: '💧', category: 'water',
      sensors: [
        { path: 'meter', label: 'Meter reading', unit: 'm³', format: 'number' },
        { path: 'flow', label: 'Flow', unit: 'L/min', format: 'number' },
        { path: 'today', label: 'Used today', unit: 'L', format: 'number' },
        { path: 'status', label: 'Status', type: 'label' },
        { path: 'lastReading', label: 'Last reading', type: 'label' },
        { path: 'quota', label: 'API calls left today', format: 'number' },
        { path: 'dayStart', label: 'Meter at midnight', unit: 'm³', hidden: true },
        { path: 'day', label: 'Day', type: 'label', hidden: true },
      ],
    });
    console.log(`[hydrop] Meter ${id} (${m.key})`);
    return m;
  }

  _publish(m, value, ts) {
    const put = (p, v) => this.store.update(`${m.key}/${p}`, v);
    put('meter', value);
    if (Number.isFinite(ts)) put('lastReading', new Date(ts * 1000).toISOString());
    // flow from the change since the previous reading (a new one at least every 5 min)
    if (m.last && Number.isFinite(ts) && ts > m.last.ts) {
      const lpm = ((value - m.last.value) * 1000) / ((ts - m.last.ts) / 60);
      put('flow', Math.max(0, Math.round(lpm * 100) / 100));
    }
    if (!m.last || ts !== m.last.ts) m.last = { value, ts };
    // today's use: the reading at local midnight survives a restart via the store
    const day = today();
    let start = Number(this.store.get(`${m.key}/dayStart`));
    if (this.store.get(`${m.key}/day`) !== day || !Number.isFinite(start) || start > value) {
      start = value; put('day', day); put('dayStart', start);
    }
    put('today', Math.round((value - start) * 1000 * 10) / 10);
  }
}

module.exports = HydropClient;
