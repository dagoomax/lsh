'use strict';

const platformStatus = require('./platform-status');

/**
 * Group ("master") thermostats — one thermostat that drives several real
 * zones at once. Setting its temperature fans the setpoint out to every
 * member (e.g. all tado heating zones); its current temperature is the
 * average of the members' room temperatures, and it reports "heating"
 * whenever any member is calling for heat.
 *
 * It owns no hardware: it reads member values from the store and writes to
 * the members through the normal sensorRegistry.sendCommand() path, so it
 * works with any controllable thermostat already in LSH (tado, Sensibo,
 * SmartThings, …). It must run in the server process (it touches other
 * modules' devices), which is why server.js constructs it inline.
 *
 * It registers as `homekit: ['thermostat']`, so the master shows up in the
 * Home app as a single thermostat alongside the individual zones.
 *
 * config.groupThermostats.thermostats[]:
 *   { id, name, members: ['tado/<home>-<zone>', …],
 *     min? = 5, max? = 25, step? = 0.5, icon? = '🔥' }
 *     members   store keys of the member devices; each must expose a
 *               controllable `targetTemp` sensor (and ideally `power`,
 *               `temperature`, `heatingPower`)
 */

const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class GroupThermostatClient {
  constructor(config, store, sensorRegistry) {
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._thermostats = [];
    this._onChange = this._onChange.bind(this);
  }

  async start() {
    const list = this._config.groupThermostats?.thermostats || [];
    if (!list.length) return;

    for (const raw of list) {
      const t = this._normalize(raw);
      if (!t) continue;
      this._thermostats.push(t);
      this._register(t);
      this._recompute(t); // seed from whatever the members already report
    }
    if (!this._thermostats.length) return;

    this._store.on('change', this._onChange);
    platformStatus.set('groupThermostats', true);
    console.log(`[GroupThermostat] Started — ${this._thermostats.length} master thermostat(s)`);
  }

  stop() {
    this._store.removeListener('change', this._onChange);
  }

  _normalize(c) {
    const members = (Array.isArray(c.members) ? c.members : []).filter(Boolean).map(String);
    if (!c.id || !members.length) return null;
    return {
      id: String(c.id),
      key: `groupthermostat/${c.id}`,
      name: c.name || c.id,
      members,
      min: num(c.min, 5),
      max: num(c.max, 25),
      step: num(c.step, 0.5),
      icon: c.icon || '🔥',
      // the master's own desired setpoint; seeded from the members in _recompute
      setpoint: num(c.setpoint, NaN),
      power: true,
    };
  }

  _register(t) {
    this._registry.registerDevice({
      key: t.key,
      label: t.name,
      type: 'groupthermostat',
      category: 'climate',
      icon: t.icon,
      model: 'Master thermostat',
      homekit: ['thermostat'],
      sensors: [
        { path: 'power', label: 'Heating', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power' },
        { path: 'targetTemp', label: 'Set temperature', unit: '°C', controllable: true, type: 'range', min: t.min, max: t.max, step: t.step, capabilityId: 'targetTemp', writeCmd: 'set' },
        { path: 'temperature', label: 'Room temperature', unit: '°C', format: 'number' },
        { path: 'heatingPower', label: 'Heating power', unit: '%', format: 'number' },
        { path: 'zones', label: 'Zones', unit: '', format: 'number' },
        { path: 'modeText', label: 'Mode', type: 'label' },
        // hidden paths the HomeKit Thermostat service reads/writes
        { path: 'thermostatMode', label: 'Thermostat mode', type: 'label', hidden: true },
        { path: 'thermostatOperatingState', label: 'Operating state', type: 'label', hidden: true },
        { path: 'heatingSetpoint', label: 'Heating setpoint', unit: '°C', hidden: true },
      ],
      _writeCapability: (cap, cmd, args = []) => this._write(t, cap, cmd, args),
    });
  }

  // Dispatch: dashboard sends `targetTemp`/`power`; HomeKit sends
  // `thermostatHeatingSetpoint` and `thermostatMode`.
  async _write(t, cap, cmd, args) {
    switch (cap) {
      case 'targetTemp':
      case 'thermostatHeatingSetpoint':
      case 'thermostatCoolingSetpoint':
        return this._setAll(t, num(args[0], NaN));
      case 'power':
        return this._setPower(t, cmd === 'on' || args[0] === true || args[0] === 'on');
      case 'thermostatMode':
        return this._setPower(t, args[0] !== 'off');
      default:
        return undefined;
    }
  }

  // Push one setpoint to every member, then reflect it on the master.
  async _setAll(t, value) {
    const v = clamp(Math.round(num(value, t.setpoint) * 10) / 10, t.min, t.max);
    if (!Number.isFinite(v)) throw new Error('temperature must be a number');
    const results = await Promise.allSettled(
      t.members.map((m) => this._registry.sendCommand(m, 'targetTemp', v)),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    t.setpoint = v;
    t.power = true;
    this._store.set(`${t.key}/targetTemp`, v);
    this._store.set(`${t.key}/heatingSetpoint`, v);
    this._recompute(t);
    if (failed.length === t.members.length) {
      throw new Error(`all ${failed.length} zone(s) rejected the setpoint: ${failed[0].reason?.message || failed[0].reason}`);
    }
    if (failed.length) console.warn(`[GroupThermostat] ${t.name}: ${failed.length}/${t.members.length} zone(s) rejected ${v} °C`);
    return v;
  }

  async _setPower(t, on) {
    const results = await Promise.allSettled(
      t.members.map((m) => this._registry.sendCommand(m, 'power', on ? 'on' : 'off')),
    );
    t.power = on;
    this._recompute(t);
    if (results.every((r) => r.status === 'rejected')) {
      throw new Error('all zones rejected the power change');
    }
    return on;
  }

  // Recompute the master's own readings from the members' live store values.
  _recompute(t) {
    const g = (member, path) => this._store.get(`${member}/${path}`);
    const temps = t.members.map((m) => Number(g(m, 'temperature'))).filter(Number.isFinite);
    const heats = t.members.map((m) => Number(g(m, 'heatingPower'))).filter(Number.isFinite);
    const sets = t.members.map((m) => Number(g(m, 'targetTemp'))).filter(Number.isFinite);

    // Seed the master setpoint once, from the members' average target.
    if (!Number.isFinite(t.setpoint) && sets.length) {
      t.setpoint = clamp(Math.round((sets.reduce((a, b) => a + b, 0) / sets.length) * 2) / 2, t.min, t.max);
    }

    const avgTemp = temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : undefined;
    const maxHeat = heats.length ? Math.max(...heats) : 0;
    const heating = maxHeat > 0;
    const powerOn = t.power;

    if (avgTemp != null) this._store.set(`${t.key}/temperature`, avgTemp);
    this._store.set(`${t.key}/heatingPower`, maxHeat);
    this._store.set(`${t.key}/zones`, t.members.length);
    if (Number.isFinite(t.setpoint)) {
      this._store.set(`${t.key}/targetTemp`, t.setpoint);
      this._store.set(`${t.key}/heatingSetpoint`, t.setpoint);
    }
    this._store.set(`${t.key}/power`, powerOn ? 1 : 0);
    this._store.set(`${t.key}/thermostatMode`, powerOn ? 'heat' : 'off');
    this._store.set(`${t.key}/thermostatOperatingState`, powerOn && heating ? 'heating' : 'idle');
    this._store.set(`${t.key}/modeText`, !powerOn ? 'Off' : heating ? 'Heating' : 'Idle');
  }

  // A member changed — refresh any master that contains it.
  _onChange({ key }) {
    if (typeof key !== 'string') return;
    const slash = key.lastIndexOf('/');
    if (slash < 0) return;
    const member = key.slice(0, slash);
    const path = key.slice(slash + 1);
    if (!['temperature', 'heatingPower', 'targetTemp', 'power'].includes(path)) return;
    for (const t of this._thermostats) {
      if (t.members.includes(member)) this._recompute(t);
    }
  }
}

module.exports = GroupThermostatClient;
