'use strict';

const platformStatus = require('./platform-status');
const { readConfigCached, writeConfigFile } = require('./config-file-cache');

/**
 * Heating curves (krzywa grzewcza) — weather-compensated flow temperature.
 * Each curve turns an outdoor temperature (any store key — OpenWeather by
 * default, or a real outdoor sensor) into a flow-temperature setpoint, and
 * optionally pushes it to any controllable °C setpoint (a boiler / heat
 * pump flow setpoint, a virtual sensor Loxone reads, …) via the normal
 * sensorRegistry.sendCommand() path. Flows can use the value directly too:
 * it's a regular device (`heatingcurve/<id>`).
 *
 * config.heatingCurves.curves[]:
 *   { id, name, outdoorKey?, room?, slope?, shift?, minFlow?, maxFlow?,
 *     targetDevice?, targetPath? }
 *   outdoorKey  store key of the outdoor temperature (default
 *               'openweather/weather/temperature')
 *   room        desired room temperature, °C (default 20)
 *   slope       curve slope / Neigung / nachylenie (default 1.4, 0.2–3.5)
 *   shift       parallel shift / Niveau / przesunięcie, K (default 0)
 *   minFlow/maxFlow  clamp of the result, °C (default 20 / 75)
 *   targetDevice + targetPath  optional controllable sensor to write to
 *
 * Slope, shift and room are also controllable on the device itself
 * (dashboard, flows, Loxone, API); those writes are saved back to
 * config.json so they survive a restart.
 */

const DEFAULTS = { outdoorKey: 'openweather/weather/temperature', room: 20, slope: 1.4, shift: 0, minFlow: 20, maxFlow: 75 };

const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v));

// Viessmann's published heating-curve formula (the de-facto standard most
// controllers follow): DAR = outdoor − room, and
// flow = room + shift − slope · DAR · (1.4347 + 0.021·DAR + 247.9e-6·DAR²)
function flowTemperature(outdoor, { room, slope, shift, minFlow, maxFlow }) {
  const dar = outdoor - room;
  const flow = room + shift - slope * dar * (1.4347 + 0.021 * dar + 247.9e-6 * dar * dar);
  return Math.min(maxFlow, Math.max(minFlow, flow));
}

function normalizeCurve(c) {
  return {
    id: String(c.id),
    name: c.name || c.id,
    outdoorKey: c.outdoorKey || DEFAULTS.outdoorKey,
    room: num(c.room, DEFAULTS.room),
    slope: num(c.slope, DEFAULTS.slope),
    shift: num(c.shift, DEFAULTS.shift),
    minFlow: num(c.minFlow, DEFAULTS.minFlow),
    maxFlow: num(c.maxFlow, DEFAULTS.maxFlow),
    targetDevice: c.targetDevice || '',
    targetPath: c.targetPath || '',
  };
}

const PARAMS = {
  slope: { name: 'Slope', min: 0.2, max: 3.5 },
  shift: { name: 'Shift', unit: 'K', min: -15, max: 40 },
  room:  { name: 'Room setpoint', unit: '°C', min: 10, max: 30 },
};

class HeatingCurveClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._curves   = (config.heatingCurves?.curves || []).filter((c) => c?.id).map(normalizeCurve);
    this._lastSent = new Map(); // curve id → last value written to the target
    this._saveTimer = null;
    this._onChange = this._onChange.bind(this);
  }

  async start() {
    if (!this._curves.length) return;
    for (const c of this._curves) this._registerDevice(c);
    this._store.on('change', this._onChange);
    for (const c of this._curves) this._compute(c);
    platformStatus.set('heatingCurve', true);
    console.log(`[HeatingCurve] Started — ${this._curves.length} curve(s)`);
  }

  stop() {
    this._store.off('change', this._onChange);
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveCurves(); }
  }

  _registerDevice(c) {
    const key = `heatingcurve/${c.id}`;
    this._registry.registerDevice({
      key, label: c.name, type: 'heatingcurve', icon: '🌡️', homekit: [],
      sensors: [
        { path: 'flowTemperature', name: 'Flow temperature', type: 'number', unit: '°C' },
        { path: 'outdoorTemperature', name: 'Outdoor temperature', type: 'number', unit: '°C' },
        ...Object.entries(PARAMS).map(([path, p]) => ({
          path, name: p.name, type: 'range', unit: p.unit || '', min: p.min, max: p.max,
          controllable: true, capabilityId: path, writeCmd: 'set',
        })),
      ],
      _writeCapability: (capId, command, args = []) => this._setParam(c, capId, args[0]),
    });
    for (const path of Object.keys(PARAMS)) this._store.update(`${key}/${path}`, c[path]);
  }

  _onChange({ key }) {
    for (const c of this._curves) if (key === c.outdoorKey) this._compute(c);
  }

  _compute(c) {
    // No reading yet must not count as 0 °C (Number(null) === 0) — that would
    // push a full-winter flow temperature to the boiler at every startup.
    const raw = this._store.get(c.outdoorKey);
    const outdoor = raw == null || raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(outdoor)) return;
    const key = `heatingcurve/${c.id}`;
    const flow = Math.round(flowTemperature(outdoor, c) * 10) / 10;
    this._store.update(`${key}/outdoorTemperature`, outdoor);
    this._store.update(`${key}/flowTemperature`, flow);
    this._push(c, flow);
  }

  // Write to the target in 0.5 °C steps so a jittery outdoor reading doesn't
  // hammer a boiler's API (or its EEPROM) with every tenth of a degree.
  _push(c, flow) {
    if (!c.targetDevice || !c.targetPath) return;
    const value = Math.round(flow * 2) / 2;
    if (this._lastSent.get(c.id) === value) return;
    this._lastSent.set(c.id, value);
    Promise.resolve(this._registry.sendCommand(c.targetDevice, c.targetPath, value))
      .then(() => console.log(`[HeatingCurve] ${c.name}: ${c.targetDevice}/${c.targetPath} → ${value} °C`))
      .catch((err) => {
        this._lastSent.delete(c.id); // retry on the next change
        console.warn(`[HeatingCurve] ${c.name}: write to ${c.targetDevice}/${c.targetPath} failed: ${err.message}`);
      });
  }

  _setParam(c, param, raw) {
    const p = PARAMS[param];
    const v = Number(raw);
    if (!p || !Number.isFinite(v)) throw new Error(`Invalid ${param}`);
    c[param] = Math.min(p.max, Math.max(p.min, v));
    this._store.update(`heatingcurve/${c.id}/${param}`, c[param]);
    this._compute(c);
    // Debounced: a dashboard slider drag would otherwise rewrite config.json
    // on every step.
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveCurves(), 2000);
  }

  _saveCurves() {
    this._saveTimer = null;
    try {
      const current = readConfigCached();
      const curves = (current.heatingCurves?.curves || []).map((saved) => {
        const live = this._curves.find((c) => c.id === String(saved.id));
        return live ? { ...saved, slope: live.slope, shift: live.shift, room: live.room } : saved;
      });
      writeConfigFile({ ...current, heatingCurves: { ...current.heatingCurves, curves } });
    } catch (err) {
      console.warn(`[HeatingCurve] Saving to config.json failed: ${err.message}`);
    }
  }
}

module.exports = HeatingCurveClient;
module.exports.flowTemperature = flowTemperature;
module.exports.normalizeCurve = normalizeCurve;
