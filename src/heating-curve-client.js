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
 *     roomKeys?, roomFactor?, targetDevice?, targetPath? }
 *   outdoorKey  store key of the outdoor temperature (default
 *               'openweather/weather/temperature')
 *   room        desired room temperature, °C (default 20)
 *   slope       curve slope / Neigung / nachylenie (default 1.4, 0.2–3.5)
 *   shift       parallel shift / Niveau / przesunięcie, K (default 0)
 *   minFlow/maxFlow  clamp of the result, °C (default 20 / 75)
 *   roomKeys    optional store keys of room temperatures; their average
 *               corrects the flow: + roomFactor K per K the rooms are below
 *               `room`, − when above (room influence / Raumeinfluss)
 *   roomFactor  K of flow per K of room deviation (default 3, 0 = off)
 *   targetDevice + targetPath  optional controllable sensor to write to
 *
 * Slope, shift and room are also controllable on the device itself
 * (dashboard, flows, Loxone, API); those writes are saved back to
 * config.json so they survive a restart.
 */

const DEFAULTS = { outdoorKey: 'openweather/weather/temperature', room: 20, slope: 1.4, shift: 0, minFlow: 20, maxFlow: 75, roomFactor: 3 };

const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v));

// Viessmann's published heating-curve formula (the de-facto standard most
// controllers follow): DAR = outdoor − room, and
// flow = room + shift − slope · DAR · (1.4347 + 0.021·DAR + 247.9e-6·DAR²),
// plus the room correction when a measured room temperature is given.
function flowTemperature(outdoor, { room, slope, shift, minFlow, maxFlow, roomFactor = 0 }, roomActual) {
  const dar = outdoor - room;
  let flow = room + shift - slope * dar * (1.4347 + 0.021 * dar + 247.9e-6 * dar * dar);
  if (Number.isFinite(roomActual)) flow += roomFactor * (room - roomActual);
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
    roomKeys: (Array.isArray(c.roomKeys) ? c.roomKeys : []).filter(Boolean).map(String),
    roomFactor: num(c.roomFactor, DEFAULTS.roomFactor),
    targetDevice: c.targetDevice || '',
    targetPath: c.targetPath || '',
  };
}

const PARAMS = {
  slope: { name: 'Slope', min: 0.2, max: 3.5 },
  shift: { name: 'Shift', unit: 'K', min: -15, max: 40 },
  room:  { name: 'Room setpoint', unit: '°C', min: 10, max: 30 },
  roomFactor: { name: 'Room influence', unit: 'K/K', min: 0, max: 10 },
};

const numeric = (raw) => (raw == null || raw === '' ? NaN : Number(raw));

// The room sources of a curve as [{ k: store key, n: device name, v: value,
// s?: 1 }] — `s` marks a source that is a setpoint rather than a measurement
// (it still counts in the average, but the tile shows it apart).
function roomReadings(keys, store, registry) {
  const devices = new Map((registry?.getDevices?.() || []).map((d) => [d.key, d]));
  return keys.map((k) => {
    const cut = k.lastIndexOf('/');
    const device = devices.get(k.slice(0, cut));
    const path = k.slice(cut + 1);
    const r = { k, n: device?.label || device?.name || k.slice(0, cut), v: numeric(store.get(k)) };
    if (/setpoint|target/i.test(path)) r.s = 1;
    return r;
  });
}

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
      key, label: c.name, type: 'heatingcurve', icon: '🌡️', homekit: ['temperature'],
      minFlow: c.minFlow, maxFlow: c.maxFlow, // the dashboard tile draws the curve with them
      sensors: [
        { path: 'flowTemperature', name: 'Flow temperature', type: 'number', unit: '°C', homekit: 'temperature', hkName: 'Flow' },
        { path: 'outdoorTemperature', name: 'Outdoor temperature', type: 'number', unit: '°C', homekit: 'temperature', hkName: 'Outdoor' },
        ...(c.roomKeys.length ? [
          { path: 'roomTemperature', name: 'Room temperature', type: 'number', unit: '°C', homekit: 'temperature', hkName: 'Rooms' },
          // every room source with its name, for the dashboard tile (JSON, not shown as a reading)
          { path: 'roomReadings', name: 'Room readings', type: 'text', hidden: true },
        ] : []),
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
    for (const c of this._curves) if (key === c.outdoorKey || c.roomKeys.includes(key)) this._compute(c);
  }

  _compute(c) {
    // No reading yet must not count as 0 °C (Number(null) === 0) — that would
    // push a full-winter flow temperature to the boiler at every startup.
    const outdoor = numeric(this._store.get(c.outdoorKey));
    if (!Number.isFinite(outdoor)) return;
    const key = `heatingcurve/${c.id}`;
    const readings = roomReadings(c.roomKeys, this._store, this._registry);
    const rooms = readings.map((r) => r.v).filter(Number.isFinite);
    const roomActual = rooms.length ? Math.round(rooms.reduce((a, b) => a + b, 0) / rooms.length * 10) / 10 : NaN;
    const flow = Math.round(flowTemperature(outdoor, c, roomActual) * 10) / 10;
    this._store.update(`${key}/outdoorTemperature`, outdoor);
    if (Number.isFinite(roomActual)) this._store.update(`${key}/roomTemperature`, roomActual);
    if (c.roomKeys.length) {
      const json = JSON.stringify(readings.map((r) => ({ ...r, v: Number.isFinite(r.v) ? r.v : null })));
      if (json !== this._store.get(`${key}/roomReadings`)) this._store.update(`${key}/roomReadings`, json);
    }
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
        return live ? { ...saved, slope: live.slope, shift: live.shift, room: live.room, roomFactor: live.roomFactor } : saved;
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
module.exports.roomReadings = roomReadings;
