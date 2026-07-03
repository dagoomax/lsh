const { EventEmitter } = require('events');

// History ring buffer: per-key [timestamp, value] points for numeric/boolean
// values. Points closer together than MIN_INTERVAL update the last point in
// place, so RAM stays bounded even for fast-changing keys (~6h at 30 s).
const HISTORY_MAX_POINTS   = 720;
const HISTORY_MIN_INTERVAL = 30_000; // ms

class DataStore extends EventEmitter {
  constructor() {
    super();
    this.data = {};
    this.history = new Map(); // key → [[t, v], …]
    this.setMaxListeners(200);
  }

  update(key, value) {
    this.data[key] = { value, timestamp: Date.now() };
    this._record(key, value);
    this.emit('change', { key, value });
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
