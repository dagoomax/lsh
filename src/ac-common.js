'use strict';

// Shared model for air conditioners (Daikin, Gree, Midea, MELCloud, Sensibo):
// one LSH device per indoor unit with the same paths and controls whatever
// the brand, so dashboards, automations, Loxone and HomeKit treat every AC
// alike.
//
//   power        on/off                      (toggle)
//   mode         0 auto, 1 cool, 2 dry, 3 fan, 4 heat   (range; modeName = text)
//   targetTemp   °C                          (range, brand limits)
//   fan          0 auto, 1 quiet, 2 low, 3 medium, 4 high, 5 turbo
//                (brands with fewer steps map to the nearest)
//   swing        vertical swing on/off       (toggle, when supported)
//   temperature  room °C, outdoorTemp, humidity  (when reported)
//   online
//
// HomeKit: a Thermostat (homekit-bridge.js 'thermostat') — it reads the
// SmartThings-style mirror paths thermostatMode / thermostatOperatingState /
// heatingSetpoint / coolingSetpoint kept here, and writes back through the
// thermostatMode / thermostat*Setpoint capabilities handled by acWriter().
//
// A client registers each unit with registerAc(), pushes readings with
// publishAc(), and implements set(patch) where patch is any of
// { power: bool, mode: 'auto'|'cool'|'dry'|'fan'|'heat', targetTemp: °C,
//   fan: 0–5, swing: bool }.

const MODES = ['auto', 'cool', 'dry', 'fan', 'heat'];
const FANS = ['auto', 'quiet', 'low', 'medium', 'high', 'turbo'];

function acSensors({ swing = true, outdoor = false, humidity = false, minTemp = 16, maxTemp = 30, step = 0.5 } = {}) {
  return [
    { path: 'power', label: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power' },
    { path: 'mode', label: 'Mode', controllable: true, type: 'range', min: 0, max: 4, step: 1, writeCmd: 'set', capabilityId: 'mode', hint: MODES.map((m, i) => `${i} ${m}`).join(', ') },
    { path: 'modeName', label: 'Mode', type: 'label', hidden: true },
    { path: 'targetTemp', label: 'Set temperature', unit: '°C', controllable: true, type: 'range', min: minTemp, max: maxTemp, step, writeCmd: 'set', capabilityId: 'targetTemp' },
    { path: 'temperature', label: 'Room temperature', unit: '°C', format: 'number' },
    ...(outdoor ? [{ path: 'outdoorTemp', label: 'Outdoor temperature', unit: '°C', format: 'number' }] : []),
    ...(humidity ? [{ path: 'humidity', label: 'Humidity', unit: '%', format: 'number' }] : []),
    { path: 'fan', label: 'Fan speed', controllable: true, type: 'range', min: 0, max: 5, step: 1, writeCmd: 'set', capabilityId: 'fan', hint: FANS.map((f, i) => `${i} ${f}`).join(', ') },
    ...(swing ? [{ path: 'swing', label: 'Swing', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'swing' }] : []),
    { path: 'online', label: 'Online', sensorType: 'connectivity', hidden: true },
    // HomeKit thermostat mirror
    { path: 'thermostatMode', label: 'Thermostat mode', type: 'label', hidden: true },
    { path: 'thermostatOperatingState', label: 'Operating state', type: 'label', hidden: true },
    { path: 'heatingSetpoint', label: 'Heating setpoint', unit: '°C', hidden: true },
    { path: 'coolingSetpoint', label: 'Cooling setpoint', unit: '°C', hidden: true },
  ];
}

// Register one AC. opts: { key, label, type, model?, features (acSensors opts), set(patch) }
function registerAc(registry, { key, label, type, model, features = {}, set }) {
  const f = { minTemp: 16, maxTemp: 30, step: 0.5, ...features };
  registry.registerDevice({
    key, label, type, category: 'climate', icon: '❄️', ...(model ? { model } : {}),
    sensors: acSensors(f), homekit: ['thermostat'],
    _writeCapability: async (cap, cmd, args = []) => set(acPatch(cap, cmd, args, f)),
  });
}

// capability write → patch (validated)
function acPatch(cap, cmd, args, f) {
  const a = args[0];
  const temp = () => {
    const v = Number(a);
    if (!Number.isFinite(v) || v < f.minTemp || v > f.maxTemp) throw new Error(`temperature must be ${f.minTemp}–${f.maxTemp} °C`);
    return Math.round(v / f.step) * f.step;
  };
  switch (cap) {
    case 'power': return { power: cmd === 'on' };
    case 'swing': return { swing: cmd === 'on' };
    case 'mode': {
      const m = typeof a === 'string' && MODES.includes(a) ? a : MODES[Math.round(Number(a))];
      if (!m) throw new Error(`mode is ${MODES.map((x, i) => `${i} ${x}`).join(', ')}`);
      return { mode: m };
    }
    case 'fan': {
      const n = typeof a === 'string' && FANS.includes(a) ? FANS.indexOf(a) : Math.round(Number(a));
      if (!(n >= 0 && n <= 5)) throw new Error(`fan is ${FANS.map((x, i) => `${i} ${x}`).join(', ')}`);
      return { fan: n };
    }
    case 'targetTemp': case 'thermostatCoolingSetpoint': case 'thermostatHeatingSetpoint':
      return { targetTemp: temp() };
    case 'thermostatMode':
      return a === 'off' ? { power: false } : { power: true, ...(MODES.includes(a) ? { mode: a } : {}) };
    default: throw new Error(`can't set ${cap}`);
  }
}

// Push a state ({ online, power, mode, targetTemp, temperature, outdoorTemp, humidity, fan, swing }) — missing fields are left alone
function publishAc(store, key, s) {
  const put = (k, v) => { if (v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v))) store.update(`${key}/${k}`, v) };
  const bool = (v) => (v === undefined || v === null ? undefined : v ? 1 : 0);
  put('online', bool(s.online));
  put('power', bool(s.power));
  if (s.mode !== undefined && MODES.includes(s.mode)) { put('mode', MODES.indexOf(s.mode)); put('modeName', s.mode) }
  put('targetTemp', s.targetTemp);
  put('temperature', s.temperature);
  put('outdoorTemp', s.outdoorTemp);
  put('humidity', s.humidity);
  put('fan', s.fan);
  put('swing', bool(s.swing));
  // HomeKit's Thermostat knows off / heat / cool / auto: dry counts as cool, fan-only as auto
  const power = s.power ?? (store.get(`${key}/power`) === 1);
  const mode = s.mode ?? store.get(`${key}/modeName`);
  if (s.power !== undefined || s.mode !== undefined) {
    put('thermostatMode', !power ? 'off' : mode === 'heat' ? 'heat' : mode === 'cool' || mode === 'dry' ? 'cool' : 'auto');
    put('thermostatOperatingState', !power ? 'idle' : mode === 'heat' ? 'heating' : mode === 'cool' || mode === 'dry' ? 'cooling' : mode === 'fan' ? 'fan only' : 'idle');
  }
  if (s.targetTemp !== undefined && s.targetTemp !== null) { put('heatingSetpoint', s.targetTemp); put('coolingSetpoint', s.targetTemp) }
}

// Index (0–5) of the LSH fan step nearest to one of a brand's steps, and back:
// steps = the brand's values for LSH fan 0–5 (auto first), e.g. [102, 20, 40, 60, 80, 100]
const fanFrom = (steps, v) => { const i = steps.indexOf(v); return i >= 0 ? i : undefined };
const fanTo = (steps, n) => steps[Math.max(0, Math.min(steps.length - 1, n))];

module.exports = { MODES, FANS, acSensors, registerAc, acPatch, publishAc, fanFrom, fanTo };
