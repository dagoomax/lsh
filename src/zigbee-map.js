'use strict';

// Zigbee2MQTT device definitions (zigbee-herdsman-converters) → LSH sensors.
//
// A definition describes a device as "exposes": features with a property
// name (the key its converters read and write, e.g. state, brightness,
// temperature, state_l2), access bits (1 published, 2 settable, 4 gettable)
// and a type (binary / numeric / enum / text, grouped as light / switch /
// cover / lock / climate). buildModel() turns them into the same sensor
// paths and capability ids the other integrations use, so the dashboard,
// HomeKit and Loxone treat a Zigbee bulb like a Hue or Tuya one:
//
//   light    switch (1/0) · level % · colorTemperature K · hue/saturation 0-100 · color
//   switch   switch / switch_<endpoint> (1/0)
//   cover    windowShade (1 open) · level % (100 = open)
//   lock     lock (1 locked)
//   climate  heatingSetpoint · temperature · thermostatMode
//   readings temperature, humidity, battery, contact, occupancy, …
//
// model.read(payload) → [[path, value]] for a converted Zigbee message, and
// model.write(capId, command, args) → the converter payload ({ state: 'ON' },
// { brightness: 127 }, …) for a command. Pure — no herdsman here.

const ACCESS_STATE = 1;
const ACCESS_SET = 2;

// Known reading names → LSH path, display name and HomeKit service
const READINGS = {
  temperature:       { path: 'temperature', name: 'Temperature', unit: '°C', homekit: 'temperature', device: 'temperature' },
  local_temperature: { path: 'temperature', name: 'Temperature', unit: '°C', homekit: 'temperature', device: 'temperature' },
  humidity:          { path: 'humidity', name: 'Humidity', unit: '%', homekit: 'humidity', device: 'humidity' },
  battery:           { path: 'battery', name: 'Battery', unit: '%', homekit: 'battery-level', device: 'battery-level' },
  illuminance:       { path: 'illuminance', name: 'Illuminance', unit: 'lx', homekit: 'lux', device: 'lux' },
  illuminance_lux:   { path: 'illuminance', name: 'Illuminance', unit: 'lx', homekit: 'lux', device: 'lux' },
  pressure:          { path: 'pressure', name: 'Pressure', unit: 'hPa' },
  co2:               { path: 'co2', name: 'CO₂', unit: 'ppm' },
  voc:               { path: 'voc', name: 'VOC', unit: 'ppb' },
  pm25:              { path: 'pm25', name: 'PM2.5', unit: 'µg/m³' },
  formaldehyd:       { path: 'formaldehyde', name: 'Formaldehyde', unit: 'mg/m³' },
  power:             { path: 'power', name: 'Power', unit: 'W' },
  voltage:           { path: 'voltage', name: 'Voltage', unit: 'V' },
  current:           { path: 'current', name: 'Current', unit: 'A' },
  energy:            { path: 'energy', name: 'Energy', unit: 'kWh' },
  soil_moisture:     { path: 'soilMoisture', name: 'Soil moisture', unit: '%' },
};
// Binary readings: stored 1/0 by the feature's value_on — for contact that's
// "open" (Zigbee2MQTT's contact is true when closed, value_on false), so 1 = open
const BINARY = {
  contact:         { path: 'contact', name: 'Contact', homekit: 'contact', device: 'contact', contactOpen: 1 },
  occupancy:       { path: 'motion', name: 'Motion', homekit: 'motion', device: 'motion' },
  presence:        { path: 'presence', name: 'Presence', homekit: 'occupancy', device: 'occupancy' },
  water_leak:      { path: 'leak', name: 'Leak', homekit: 'leak', device: 'leak' },
  smoke:           { path: 'smoke', name: 'Smoke', homekit: 'smoke', device: 'smoke' },
  carbon_monoxide: { path: 'co', name: 'Carbon monoxide', homekit: 'co', device: 'co' },
  gas:             { path: 'gas', name: 'Gas' },
  vibration:       { path: 'vibration', name: 'Vibration' },
  tamper:          { path: 'tamper', name: 'Tamper' },
  battery_low:     { path: 'batteryLow', name: 'Battery low' },
};

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const has = (f, bit) => ((f?.access ?? 0) & bit) === bit;
const feature = (group, name) => (group.features || []).find((f) => f.name === name);

// Flatten nested composite exposes (a light's color_xy lives inside it)
function leaves(e) {
  if (!e.features || e.type === 'composite' || e.type === 'list') return [e];
  return e.features.flatMap(leaves);
}

function buildModel(exposes = []) {
  const sensors = [];
  const homekit = [];
  const readers = new Map();  // payload property → (value, payload) → [[path, value]]
  const writers = new Map();  // capabilityId → (command, args) → payload
  const used = new Set();     // paths taken
  let kind = 'sensor';

  const add = (sensor, hk) => {
    if (used.has(sensor.path)) return false;
    used.add(sensor.path);
    sensors.push(sensor);
    if (hk) homekit.push(hk);
    return true;
  };
  const onOff = (f) => (v) => (v === f.value_on ? 1 : v === f.value_off ? 0 : (v === true || v === 'ON' ? 1 : 0));

  // ── Lights ──
  const lights = exposes.filter((e) => e.type === 'light');
  lights.forEach((l, i) => {
    const sfx = i === 0 ? '' : `_${sanitize(l.endpoint || i + 1)}`;
    const state = feature(l, 'state');
    const bri = feature(l, 'brightness');
    const ct = feature(l, 'color_temp');
    const color = (l.features || []).find((f) => f.type === 'composite' && (f.name === 'color_hs' || f.name === 'color_xy'));
    if (!state) return;
    if (i === 0) kind = 'light';
    const sw = `switch${sfx}`;
    add({ path: sw, name: i === 0 ? 'Power' : `Power ${l.endpoint || i + 1}`, format: 'on-off', controllable: true, type: 'toggle',
      writeOn: 'on', writeOff: 'off', capabilityId: sw, ...(i === 0 ? { homekit: 'light-rw' } : {}) }, i === 0 ? 'light-rw' : null);
    readers.set(state.property, (v) => [[sw, onOff(state)(v)]]);
    writers.set(sw, (cmd) => ({ [state.property]: cmd === 'on' ? state.value_on : state.value_off }));
    if (bri && has(bri, ACCESS_STATE)) {
      const max = bri.value_max || 254;
      const lv = `level${sfx}`;
      add({ path: lv, name: 'Brightness', format: 'percent', unit: '%', min: 0, max: 100, step: 1,
        controllable: has(bri, ACCESS_SET), type: 'range', capabilityId: i === 0 ? 'switchLevel' : lv, writeCmd: 'setLevel' });
      readers.set(bri.property, (v) => (typeof v === 'number' ? [[lv, Math.round((v / max) * 100)]] : []));
      writers.set(i === 0 ? 'switchLevel' : lv, (cmd, [pct]) => {
        const p = clamp(Number(pct) || 0, 0, 100);
        if (p <= 0) return { [state.property]: state.value_off };
        return { [state.property]: state.value_on, [bri.property]: Math.max(1, Math.round((p / 100) * max)) };
      });
    }
    if (i === 0 && ct && has(ct, ACCESS_STATE)) {
      const minK = Math.round(1e6 / (ct.value_max || 500));
      const maxK = Math.round(1e6 / (ct.value_min || 150));
      add({ path: 'colorTemperature', name: 'Color Temp', format: 'number', unit: 'K', min: minK, max: maxK, step: 50,
        controllable: has(ct, ACCESS_SET), type: 'color-temp', capabilityId: 'colorTemperature', writeCmd: 'setColorTemperature' });
      readers.set(ct.property, (v) => (typeof v === 'number' && v > 0 ? [['colorTemperature', Math.round(1e6 / v)]] : []));
      writers.set('colorTemperature', (cmd, [k]) => ({ [state.property]: state.value_on,
        [ct.property]: clamp(Math.round(1e6 / (Number(k) || 4000)), ct.value_min || 150, ct.value_max || 500) }));
    }
    if (i === 0 && color) {
      add({ path: 'hue', name: 'Hue', format: 'number', hidden: true });
      add({ path: 'saturation', name: 'Saturation', format: 'number', hidden: true });
      add({ path: 'color', name: 'Color', format: 'color', controllable: true, type: 'color', capabilityId: 'colorControl' });
      // the color payload carries hue/saturation once the light is in hs mode
      readers.set(color.property, (v) => {
        const out = [];
        if (typeof v?.hue === 'number') out.push(['hue', Math.round(v.hue / 3.6)]);
        if (typeof v?.saturation === 'number') out.push(['saturation', Math.round(v.saturation)]);
        return out;
      });
      writers.set('colorControl', (cmd, [c = {}]) => ({ [state.property]: state.value_on,
        [color.property]: { hue: Math.round(clamp(Number(c.hue) || 0, 0, 100) * 3.6), saturation: clamp(Number(c.saturation ?? 100), 0, 100) } }));
    }
    for (const f of [state, bri, ct, color]) if (f) used.add(`prop:${f.property}`);
  });

  // ── Switches (plugs, relays, multi-gang) ──
  const switches = exposes.filter((e) => e.type === 'switch').map((s) => ({ s, state: feature(s, 'state') })).filter((x) => x.state);
  switches.forEach(({ s, state }, i) => {
    if (used.has(`prop:${state.property}`)) return;
    if (kind === 'sensor') kind = 'switch';
    const path = i === 0 && !used.has('switch') ? 'switch' : `switch_${sanitize(s.endpoint || i + 1)}`;
    add({ path, name: switches.length > 1 ? `Switch ${s.endpoint || i + 1}` : 'Power', format: 'on-off', controllable: has(state, ACCESS_SET),
      type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: path, homekit: 'switch-rw' }, 'switch-rw');
    readers.set(state.property, (v) => [[path, onOff(state)(v)]]);
    writers.set(path, (cmd) => ({ [state.property]: cmd === 'on' ? state.value_on : state.value_off }));
    used.add(`prop:${state.property}`);
  });

  // ── Covers ──
  const cover = exposes.find((e) => e.type === 'cover');
  if (cover) {
    kind = 'cover';
    const state = feature(cover, 'state');
    const pos = feature(cover, 'position');
    add({ path: 'windowShade', name: 'Open', format: 'on-off', controllable: true, type: 'toggle',
      writeOn: 'open', writeOff: 'close', capabilityId: 'windowShade', homekit: 'cover-rw' }, 'cover-rw');
    if (pos) add({ path: 'level', name: 'Position', format: 'percent', unit: '%', min: 0, max: 100, step: 1,
      controllable: has(pos, ACCESS_SET), type: 'range', capabilityId: 'windowShade', writeCmd: 'setLevel' });
    if (state) add({ path: 'stop', name: 'Stop', hidden: true });
    if (pos) readers.set(pos.property, (v) => (typeof v === 'number' ? [['level', v], ['windowShade', v > 0 ? 1 : 0]] : []));
    if (state) readers.set(state.property, (v) => (!pos && (v === 'OPEN' || v === 'CLOSE') ? [['windowShade', v === 'OPEN' ? 1 : 0]] : []));
    writers.set('windowShade', (cmd, [v] = []) => {
      if ((cmd === 'setLevel' || cmd === 'set') && pos) return { [pos.property]: clamp(Math.round(Number(v) || 0), 0, 100) };
      if (cmd === 'setLevel' || cmd === 'set') return { [state.property]: Number(v) >= 50 ? 'OPEN' : 'CLOSE' };
      return { [state?.property || 'state']: cmd === 'stop' ? 'STOP' : cmd === 'open' ? 'OPEN' : 'CLOSE' };
    });
    for (const f of [state, pos]) if (f) used.add(`prop:${f.property}`);
  }

  // ── Locks ──
  const lock = exposes.find((e) => e.type === 'lock');
  if (lock) {
    const state = feature(lock, 'state');
    if (state) {
      kind = 'lock';
      add({ path: 'lock', name: 'Lock', format: 'on-off', controllable: has(state, ACCESS_SET), type: 'toggle',
        writeOn: 'lock', writeOff: 'unlock', capabilityId: 'lock', homekit: 'lock-rw' }, 'lock-rw');
      readers.set(state.property, (v) => [['lock', v === state.value_on ? 1 : 0]]);
      writers.set('lock', (cmd) => ({ [state.property]: cmd === 'lock' ? state.value_on : state.value_off }));
      used.add(`prop:${state.property}`);
    }
  }

  // ── Thermostats ──
  const climate = exposes.find((e) => e.type === 'climate');
  if (climate) {
    const sp = feature(climate, 'occupied_heating_setpoint') || feature(climate, 'current_heating_setpoint');
    const temp = feature(climate, 'local_temperature');
    const mode = feature(climate, 'system_mode');
    const running = feature(climate, 'running_state');
    if (sp) {
      kind = 'thermostat';
      add({ path: 'heatingSetpoint', name: 'Setpoint', unit: '°C', format: 'number', type: 'range', controllable: has(sp, ACCESS_SET),
        min: sp.value_min ?? 5, max: sp.value_max ?? 30, step: sp.value_step || 0.5,
        capabilityId: 'thermostatHeatingSetpoint', writeCmd: 'setHeatingSetpoint' }, 'thermostat');
      readers.set(sp.property, (v) => (typeof v === 'number' ? [['heatingSetpoint', v]] : []));
      writers.set('thermostatHeatingSetpoint', (cmd, [v]) => ({ [sp.property]: clamp(Number(v), sp.value_min ?? 5, sp.value_max ?? 30) }));
      used.add(`prop:${sp.property}`);
    }
    if (temp) {
      add({ path: 'temperature', name: 'Temperature', unit: '°C', format: 'number', precision: 1, homekit: 'temperature' });
      readers.set(temp.property, (v) => (typeof v === 'number' ? [['temperature', v]] : []));
      used.add(`prop:${temp.property}`);
    }
    if (mode) {
      add({ path: 'thermostatMode', name: 'Mode', type: has(mode, ACCESS_SET) ? 'text' : 'label', controllable: has(mode, ACCESS_SET),
        capabilityId: 'thermostatMode', writeCmd: 'setThermostatMode', range: mode.values });
      readers.set(mode.property, (v) => [['thermostatMode', String(v)]]);
      writers.set('thermostatMode', (cmd, [v]) => {
        if (mode.values && !mode.values.includes(v)) throw new Error(`Mode must be one of ${mode.values.join(', ')}`);
        return { [mode.property]: v };
      });
      used.add(`prop:${mode.property}`);
    }
    if (running) {
      add({ path: 'thermostatOperatingState', name: 'Running', type: 'label' });
      readers.set(running.property, (v) => [['thermostatOperatingState', v === 'heat' ? 'heating' : v === 'cool' ? 'cooling' : 'idle']]);
      used.add(`prop:${running.property}`);
    }
  }

  // ── Everything else ──
  const rest = exposes.filter((e) => !['light', 'switch', 'cover', 'lock', 'climate'].includes(e.type)).flatMap(leaves);
  for (const f of rest) {
    if (!f.property || used.has(`prop:${f.property}`) || !has(f, ACCESS_STATE)) continue;
    if (f.category === 'config') continue; // device settings (sensitivity, LED…) — not readings
    if (f.type === 'composite' || f.type === 'list') continue;
    used.add(`prop:${f.property}`);
    const known = f.type === 'numeric' ? READINGS[f.name] : f.type === 'binary' ? BINARY[f.name] : null;
    const sfx = f.endpoint && !known ? '' : f.endpoint ? `_${sanitize(f.endpoint)}` : '';
    const path = sanitize((known?.path || f.property) + (known ? sfx : ''));
    if (used.has(path)) continue;
    const name = known?.name || f.label || f.name;

    if (f.type === 'binary') {
      const writable = has(f, ACCESS_SET);
      const ok = add({ path, name, format: 'on-off', ...(writable ? { controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: path } : {}),
        ...(known?.homekit && !sfx ? { homekit: known.homekit } : {}), ...(known?.contactOpen != null ? { contactOpen: known.contactOpen } : {}) },
      known?.device && !sfx ? known.device : null);
      if (!ok) continue;
      readers.set(f.property, (v) => [[path, v === f.value_on ? 1 : v === f.value_off ? 0 : (v ? 1 : 0)]]);
      if (writable) writers.set(path, (cmd) => ({ [f.property]: cmd === 'on' ? f.value_on : f.value_off }));
    } else if (f.type === 'numeric') {
      const writable = has(f, ACCESS_SET);
      const ok = add({ path, name, unit: known?.unit || f.unit || '', format: 'number', precision: Number.isInteger(f.value_step) ? 0 : 1,
        ...(writable ? { controllable: true, type: 'range', min: f.value_min ?? 0, max: f.value_max ?? 100, step: f.value_step || 1, capabilityId: path, writeCmd: 'set' } : {}),
        ...(known?.homekit && !sfx ? { homekit: known.homekit } : {}) },
      known?.device && !sfx ? (known.device === 'battery-level' ? 'battery-level' : known.device) : null);
      if (!ok) continue;
      readers.set(f.property, (v) => (typeof v === 'number' ? [[path, v]] : []));
      if (writable) writers.set(path, (cmd, [v]) => ({ [f.property]: Number(v) }));
    } else if (f.type === 'enum' || f.type === 'text') {
      const writable = has(f, ACCESS_SET);
      const ok = add({ path, name, type: writable ? 'text' : 'label', ...(f.values ? { range: f.values } : {}),
        ...(writable ? { controllable: true, capabilityId: path, writeCmd: 'set' } : {}) });
      if (!ok) continue;
      readers.set(f.property, (v) => (v == null ? [] : [[path, String(v)]]));
      if (writable) writers.set(path, (cmd, [v]) => {
        if (f.values && !f.values.includes(v)) throw new Error(`${name} must be one of ${f.values.join(', ')}`);
        return { [f.property]: v };
      });
    }
  }

  add({ path: 'linkquality', name: 'Link quality', unit: 'LQI', format: 'number', precision: 0 });
  readers.set('linkquality', (v) => (typeof v === 'number' ? [['linkquality', v]] : []));

  return {
    kind,
    sensors,
    homekit: [...new Set(homekit)],
    // converted message → store values
    read(payload) {
      const out = [];
      for (const [prop, v] of Object.entries(payload || {})) {
        const r = readers.get(prop);
        if (r) out.push(...r(v, payload));
      }
      return out;
    },
    write(capId, command, args = []) {
      const w = writers.get(capId);
      if (!w) throw new Error(`Zigbee: ${capId} is not settable`);
      return w(command, args);
    },
  };
}

const ICONS = { light: '💡', switch: '🔌', cover: '🪟', lock: '🔒', thermostat: '🌡️', sensor: '📡' };

module.exports = { buildModel, ICONS };
