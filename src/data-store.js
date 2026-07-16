const { EventEmitter } = require('events');
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// History ring buffer: per-key [timestamp, value] points for numeric/boolean
// values. Points closer together than MIN_INTERVAL update the last point in
// place, so RAM stays bounded even for fast-changing keys (~6h at 30 s).
const HISTORY_MAX_POINTS   = 720;
const HISTORY_MIN_INTERVAL = 30_000; // ms

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

  startPersistence() {
    this.loadPersisted();
    this._persistTimer = setInterval(() => this.persistSync(), PERSIST_INTERVAL);
    // pm2 stop/restart sends SIGINT — save before anyone calls process.exit.
    // Registered first (store is created before HomeKit), synchronous, no exit
    // here: HAP or pm2's kill timeout finishes the shutdown.
    const save = () => {
      const size = this.persistSync();
      if (size) console.log(`[Store] Saved on shutdown (${(size / 1024).toFixed(0)} kB)`);
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
  }

  getHistory(key) {
    return this.history.get(key) || [];
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
