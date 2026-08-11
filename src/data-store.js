const { EventEmitter } = require('events');
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { connectMongo } = require('./mongo');

const gzipAsync = promisify(zlib.gzip);

// Optional MongoDB persistence. When config.mongo.uri is set the snapshot
// (current values + history) is stored as a single document; the gzip file
// below is still written every cycle as a synchronous, shutdown-safe fallback.
const MONGO_COLLECTION = 'store';
const MONGO_DOC_ID     = 'snapshot';

// History ring buffer: per-key [timestamp, value] points for numeric/boolean
// values. Points closer together than MIN_INTERVAL update the last point in
// place, so RAM stays bounded even for fast-changing keys (~6h at 30 s).
const HISTORY_MAX_POINTS   = 720;
const HISTORY_MIN_INTERVAL = 30_000; // ms
const HISTORY_BUFFER_HOURS = (HISTORY_MAX_POINTS * HISTORY_MIN_INTERVAL) / 3600_000; // 6

// Long-range history (optional, requires Mongo): every point that lands in
// the ring buffer above is also queued here and flushed to its own
// collection in batches, so it survives past the 6h RAM window instead of
// being silently dropped when the ring buffer wraps. This is genuinely
// append-only time-series data — separate from MONGO_COLLECTION's periodic
// full-snapshot overwrite above, which never grows history depth on its own.
const MONGO_HISTORY_COLLECTION   = 'sensorHistory';
const HISTORY_FLUSH_INTERVAL     = 60_000; // ms — batch writes, don't hit Mongo per point
const HISTORY_QUERY_MAX_POINTS   = 2000;   // bucket-average down to this many points per chart
const HISTORY_RETENTION_DAYS_DEFAULT = 90;

// Bucket-average `points` ([t,v] pairs, must be t-sorted) down to at most
// `maxPoints` — same idea as the client-side downsampling historyChart.js
// already does, just applied before the payload leaves the server for wide
// ranges where the raw point count could otherwise be huge.
function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const bucketSize = points.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end   = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    const slice = points.slice(start, end);
    const t = slice[Math.floor(slice.length / 2)][0]; // midpoint timestamp reads better than mean-of-epoch
    const v = slice.reduce((sum, p) => sum + p[1], 0) / slice.length;
    out.push([t, v]);
  }
  return out;
}

// Persistence: sensor values + history survive restarts. Gzipped JSON in
// persist/ (≈1–2 MB), written every 5 min and synchronously on shutdown.
const PERSIST_FILE     = path.join(__dirname, '..', 'persist', 'store-data.json.gz');
const PERSIST_INTERVAL = 5 * 60_000;
const PERSIST_MAX_AGE  = 48 * 3600_000; // drop points older than 48 h on load

class DataStore extends EventEmitter {
  constructor() {
    super();
    this.data = {};
    this.history = new Map(); // key → [[t, v], …]
    this._persistTimer = null;
    this._db = null; // MongoDB handle when configured
    this._historyQueue = [];    // pending {key, t, v} docs awaiting the next flush
    this._historyFlushTimer = null;
    this._historyRetentionDays = HISTORY_RETENTION_DAYS_DEFAULT;
    this.setMaxListeners(200);
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  loadPersisted() {
    try {
      if (!fs.existsSync(PERSIST_FILE)) return;
      const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(PERSIST_FILE)).toString('utf8'));
      const cutoff = Date.now() - PERSIST_MAX_AGE;
      let points = 0;
      for (const [key, buf] of raw.history || []) {
        const pts = buf.filter((p) => p[0] >= cutoff);
        if (pts.length) { this.history.set(key, pts); points += pts.length; }
      }
      // Restore last-known values without emitting change events — integrations
      // will overwrite with live data as they come up
      for (const [key, entry] of Object.entries(raw.data || {})) {
        if (!(key in this.data)) this.data[key] = entry;
      }
      const age = raw.savedAt ? Math.round((Date.now() - raw.savedAt) / 60000) : '?';
      console.log(`[Store] Restored ${this.history.size} series / ${points} points (saved ${age} min ago)`);
    } catch (err) {
      console.error(`[Store] Restore failed: ${err.message}`);
    }
  }

  persistSync() {
    try {
      fs.mkdirSync(path.dirname(PERSIST_FILE), { recursive: true });
      const payload = JSON.stringify({
        savedAt: Date.now(),
        data:    this.data,
        history: [...this.history.entries()],
      });
      const gz = zlib.gzipSync(payload);
      fs.writeFileSync(PERSIST_FILE + '.tmp', gz);
      fs.renameSync(PERSIST_FILE + '.tmp', PERSIST_FILE); // atomic
      return gz.length;
    } catch (err) {
      console.error(`[Store] Persist failed: ${err.message}`);
      return 0;
    }
  }

  // Same as persistSync(), but off the main thread for gzip + disk I/O — used
  // by the periodic 5-min timer, where nothing needs the synchronous
  // shutdown-safety persistSync() exists for (SIGINT/SIGTERM keep using
  // persistSync() directly, unchanged). History/data can grow into the
  // multi-MB range over the app's lifetime, and gzipSync + writeFileSync of
  // that blocks every other request/socket tick in this single-process app
  // for however long that takes, every 5 minutes, forever.
  async persistAsync() {
    try {
      await fs.promises.mkdir(path.dirname(PERSIST_FILE), { recursive: true });
      const payload = JSON.stringify({
        savedAt: Date.now(),
        data:    this.data,
        history: [...this.history.entries()],
      });
      const gz = await gzipAsync(payload);
      await fs.promises.writeFile(PERSIST_FILE + '.tmp', gz);
      await fs.promises.rename(PERSIST_FILE + '.tmp', PERSIST_FILE); // atomic
      return gz.length;
    } catch (err) {
      console.error(`[Store] Persist failed: ${err.message}`);
      return 0;
    }
  }

  // ── MongoDB persistence (optional) ──────────────────────────────────────
  // Snapshot lives in one document. `data`/`history` are stored as [key, …]
  // arrays (not nested objects) so store keys containing dots never collide
  // with MongoDB's field-name rules.

  async loadFromMongo() {
    try {
      const doc = await this._db.collection(MONGO_COLLECTION).findOne({ _id: MONGO_DOC_ID });
      if (!doc) { console.log('[Store] Mongo has no snapshot yet — starting fresh'); return true; }
      const cutoff = Date.now() - PERSIST_MAX_AGE;
      let points = 0;
      for (const [key, buf] of doc.history || []) {
        const pts = buf.filter((p) => p[0] >= cutoff);
        if (pts.length) { this.history.set(key, pts); points += pts.length; }
      }
      for (const [key, entry] of doc.data || []) {
        if (!(key in this.data)) this.data[key] = entry;
      }
      const age = doc.savedAt ? Math.round((Date.now() - doc.savedAt) / 60000) : '?';
      console.log(`[Store] Restored from Mongo: ${this.history.size} series / ${points} points (saved ${age} min ago)`);
      return true;
    } catch (err) {
      console.error(`[Store] Mongo restore failed: ${err.message}`);
      return false;
    }
  }

  async persistMongo() {
    if (!this._db) return;
    await this._db.collection(MONGO_COLLECTION).replaceOne(
      { _id: MONGO_DOC_ID },
      {
        _id:     MONGO_DOC_ID,
        savedAt: Date.now(),
        data:    Object.entries(this.data),
        history: [...this.history.entries()],
      },
      { upsert: true },
    );
  }

  _persistAll() {
    this.persistAsync().catch(() => {}); // errors already logged inside persistAsync()
    if (this._db) {
      this.persistMongo().catch((err) => console.error(`[Store] Mongo persist failed: ${err.message}`));
    }
  }

  async startPersistence(mongoCfg) {
    // Prefer Mongo when configured and reachable; the gzip file is loaded only
    // as a fallback so a Mongo outage still restores the last local snapshot.
    let loaded = false;
    if (mongoCfg && mongoCfg.uri) {
      this._db = await connectMongo(mongoCfg);
      if (this._db) {
        loaded = await this.loadFromMongo();
        this._historyRetentionDays = Number(mongoCfg.historyRetentionDays) || HISTORY_RETENTION_DAYS_DEFAULT;
        this._ensureHistoryIndexes(this._historyRetentionDays)
          .catch((err) => console.error(`[Store] History index setup failed: ${err.message}`));
        this._historyFlushTimer = setInterval(() => this._flushHistoryQueue(), HISTORY_FLUSH_INTERVAL);
      }
    }
    if (!loaded) this.loadPersisted();

    this._persistTimer = setInterval(() => this._persistAll(), PERSIST_INTERVAL);
    // pm2 stop/restart sends SIGINT — save before anyone calls process.exit.
    // Registered first (store is created before HomeKit), synchronous, no exit
    // here: HAP or pm2's kill timeout finishes the shutdown. The gzip write is
    // synchronous and guaranteed; the Mongo flush is best-effort (may be cut
    // short by the kill timeout, but the 5-min interval already covered it).
    const save = () => {
      const size = this.persistSync();
      if (size) console.log(`[Store] Saved on shutdown (${(size / 1024).toFixed(0)} kB)`);
      if (this._db) {
        this.persistMongo().catch(() => {});
        this._flushHistoryQueue().catch(() => {});
      }
    };
    process.once('SIGINT', save);
    process.once('SIGTERM', save);
  }

  update(key, value) {
    this.data[key] = { value, timestamp: Date.now() };
    this._record(key, value);
    this.emit('change', { key, value });
  }

  // alias — several integration clients (and CLAUDE.md) write via store.set()
  set(key, value) {
    this.update(key, value);
  }

  _record(key, value) {
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    if (typeof v !== 'number' || !Number.isFinite(v)) return;

    const now = Date.now();
    let buf = this.history.get(key);
    if (!buf) { buf = []; this.history.set(key, buf); }

    const last = buf[buf.length - 1];
    if (last && now - last[0] < HISTORY_MIN_INTERVAL) {
      last[1] = v; // too soon — keep latest value on the existing point
      return;
    }
    buf.push([now, v]);
    if (buf.length > HISTORY_MAX_POINTS) buf.shift();
    if (this._db) this._historyQueue.push({ key, t: new Date(now), v });
  }

  getHistory(key) {
    return this.history.get(key) || [];
  }

  // ── Long-range history (optional, Mongo-backed) ─────────────────────────

  async _flushHistoryQueue() {
    if (!this._db || !this._historyQueue.length) return;
    const batch = this._historyQueue;
    this._historyQueue = [];
    try {
      await this._db.collection(MONGO_HISTORY_COLLECTION).insertMany(batch, { ordered: false });
    } catch (err) {
      console.error(`[Store] History flush failed (${batch.length} point(s) dropped): ${err.message}`);
    }
  }

  // Compound index for the {key, t range} query below, plus a TTL index that
  // prunes points older than the configured retention automatically. If the
  // TTL index already exists with a different retention (the config value
  // changed since it was first created), `collMod` updates it in place —
  // createIndex() alone would just throw IndexOptionsConflict.
  async _ensureHistoryIndexes(retentionDays) {
    const col = this._db.collection(MONGO_HISTORY_COLLECTION);
    const expireAfterSeconds = Math.round(retentionDays * 86400);
    try {
      await col.createIndex({ key: 1, t: 1 });
      await col.createIndex({ t: 1 }, { expireAfterSeconds });
    } catch (err) {
      if (err.codeName !== 'IndexOptionsConflict' && err.code !== 85) {
        console.error(`[Store] History index setup failed: ${err.message}`);
        return;
      }
      try {
        await this._db.command({
          collMod: MONGO_HISTORY_COLLECTION,
          index: { keyPattern: { t: 1 }, expireAfterSeconds },
        });
      } catch (modErr) {
        console.error(`[Store] History TTL update failed: ${modErr.message}`);
      }
    }
  }

  // Points beyond the in-memory ring buffer's ~6h window, read from Mongo.
  // Falls back to whatever's in RAM if Mongo isn't configured/reachable, so
  // callers never need to branch on availability themselves.
  async getHistoryRange(key, hours) {
    if (!this._db) return this.getHistory(key);
    try {
      const since = new Date(Date.now() - hours * 3600_000);
      const raw = await this._db.collection(MONGO_HISTORY_COLLECTION)
        .find({ key, t: { $gte: since } })
        .sort({ t: 1 })
        .project({ _id: 0, t: 1, v: 1 })
        .toArray();
      const points = raw.map((d) => [d.t.getTime(), d.v]);
      // The most recent ~60s may not be flushed to Mongo yet — top up with
      // whatever the in-memory buffer has past the last Mongo point so the
      // chart doesn't look stale right after switching to a longer range.
      const lastT  = points.length ? points[points.length - 1][0] : 0;
      const recent = (this.history.get(key) || []).filter((p) => p[0] > lastT);
      return downsample([...points, ...recent], HISTORY_QUERY_MAX_POINTS);
    } catch (err) {
      console.error(`[Store] History range query failed for "${key}": ${err.message}`);
      return this.getHistory(key);
    }
  }

  historyStatus() {
    return { mongoEnabled: !!this._db, retentionDays: this._historyRetentionDays, bufferHours: HISTORY_BUFFER_HOURS };
  }

  get(key) {
    return this.data[key]?.value ?? null;
  }

  getAll() {
    const result = {};
    for (const [k, v] of Object.entries(this.data)) {
      result[k] = v.value;
    }
    return result;
  }

  getGrouped() {
    const d = this.data;
    const v = (key) => d[key]?.value ?? null;

    return {
      battery: {
        soc: v('system/0/Dc/Battery/Soc'),
        voltage: v('system/0/Dc/Battery/Voltage'),
        current: v('system/0/Dc/Battery/Current'),
        power: v('system/0/Dc/Battery/Power'),
        state: v('system/0/Dc/Battery/BatteryState'),
        timeToGo: v('system/0/Dc/Battery/TimeToGo'),
      },
      solar: {
        power: v('system/0/Dc/Pv/Power'),
        current: v('system/0/Dc/Pv/Current'),
        dailyYield: v('system/0/PvChargerAggregated/Yield/User'),
      },
      grid: {
        power: v('system/0/Ac/Grid/L1/Power'),
        powerL2: v('system/0/Ac/Grid/L2/Power'),
        powerL3: v('system/0/Ac/Grid/L3/Power'),
        current: v('system/0/Ac/Grid/L1/Current'),
        voltage: v('system/0/Ac/Grid/L1/Voltage'),
        frequency: v('system/0/Ac/Grid/L1/Frequency'),
        connected: v('system/0/Ac/Grid/Available'),
      },
      acLoads: {
        power: v('system/0/Ac/Consumption/L1/Power'),
        powerL2: v('system/0/Ac/Consumption/L2/Power'),
        powerL3: v('system/0/Ac/Consumption/L3/Power'),
      },
      dcLoads: {
        power: v('system/0/Dc/System/Power'),
      },
      system: {
        state: v('system/0/SystemState/State'),
        serial: v('system/0/Serial'),
      },
      solaredge: {
        currentPower:   v('solaredge/currentPower'),
        gridPower:      v('solaredge/gridPower'),
        batteryPower:   v('solaredge/batteryPower'),
        loadPower:      v('solaredge/loadPower'),
        dailyEnergy:    v('solaredge/dailyEnergy'),
        lifetimeEnergy: v('solaredge/lifetimeEnergy'),
        batteryLevel:   v('solaredge/batteryLevel'),
      },
    };
  }
}

module.exports = DataStore;
