'use strict';

const platformStatus = require('./platform-status');

// Native Grenton-vCLU bridge.
//
// Exposes every Tuya air-conditioner LSH has as Grenton-style objects
//   grenton/AC_<id>_PWR    power        switch       read + write
//   grenton/AC_<id>_SET    setpoint °C  range        read + write
//   grenton/AC_<id>_MODE   mode index   range (0..n) read + write
//   grenton/AC_<id>_TMP    current °C   temperature  read only
// two-way, entirely in-process. It reads each AC's state from the Tuya device
// in the shared SensorRegistry and writes back through sensorRegistry.sendCommand,
// so it replaces the external scripts/grenton-vclu-sim.js (which spoke the GATE
// HTTP protocol and bridged over the LSH REST API with a bearer token) together
// with its grenton-klima-autosync watcher: no extra process, no REST round-trip,
// no token, and a newly-added AC is picked up on the next poll tick with no
// module restart.
//
// Because it reads and commands devices owned by the Tuya module (not ones it
// registered itself), it must run in the server process — its integrations.js
// entry carries `expose`, which keeps it in-process (a forked module worker
// can neither see another module's devices nor command them).
//
// config.grentonVclu = { enabled: true, pollInterval: 3 }

class GrentonVcluClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._acs      = new Map(); // tuya id → { id, label, setpoint, modes, modeRw }
    this._timer    = null;
  }

  async start() {
    const cfg = this._config.grentonVclu || {};
    if (!cfg.enabled) { console.log('[GrentonVclu] Disabled'); return; }
    this._interval = Math.max(2, Number(cfg.pollInterval) || 3) * 1000;

    this._sync();                 // discover ACs present now + register their objects
    try {
      await this._poll();         // first state read
      platformStatus.set('grentonVclu', true);
    } catch (err) {
      platformStatus.set('grentonVclu', false);
      console.error(`[GrentonVclu] First poll failed: ${err.message}`);
    }
    this._timer = setInterval(() => {
      try { this._sync(); } catch (err) { console.error(`[GrentonVclu] Sync failed: ${err.message}`); }
      this._poll().then(
        () => platformStatus.set('grentonVclu', true),
        (err) => { platformStatus.set('grentonVclu', false); console.error(`[GrentonVclu] Poll failed: ${err.message}`); },
      );
    }, this._interval);
    console.log(`[GrentonVclu] Started — ${this._acs.size} AC(s), every ${this._interval / 1000}s`);
  }

  stop() { if (this._timer) clearInterval(this._timer); }

  // ── Discovery ──────────────────────────────────────────────────────────────
  // An AC is a Tuya device with BOTH a controllable `heatingSetpoint` and a
  // controllable `switch`. A bare thermostatic radiator head (TRV) has the
  // setpoint but no power switch, so it's left out — same heuristic the old
  // grenton-klima-sync script used.
  _discover() {
    const out = [];
    for (const d of this._registry.getDevices()) {
      if (!d.key || !d.key.startsWith('tuya/')) continue;
      const byPath = {};
      for (const s of d.sensors || []) byPath[s.path] = s;
      if (byPath.heatingSetpoint?.controllable && byPath.switch?.controllable) {
        out.push({
          id:       d.key.slice('tuya/'.length),
          label:    d.label || d.key,
          setpoint: byPath.heatingSetpoint,
          modes:    Array.isArray(byPath.thermostatMode?.range) ? byPath.thermostatMode.range : [],
          modeRw:   !!byPath.thermostatMode?.controllable,
        });
      }
    }
    return out;
  }

  _sync() {
    for (const ac of this._discover()) {
      const known = this._acs.get(ac.id);
      if (known) { known.modes = ac.modes; known.modeRw = ac.modeRw; continue; } // mode list can change
      this._acs.set(ac.id, ac);
      this._register(ac);
    }
  }

  _register(ac) {
    const base = `grenton/AC_${ac.id}`;
    const sp   = ac.setpoint || {};
    const tuya = `tuya/${ac.id}`;

    this._registry.registerDevice({
      key: `${base}_PWR`, label: `${ac.label} zasilanie`, type: 'grenton', icon: '❄️',
      sensors: [{ path: 'switch', name: 'Power', format: 'on-off', sensorType: 'switch',
        controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
        capabilityId: 'switch', homekit: 'switch-rw' }],
      homekit: ['switch-rw'],
      _writeCapability: (capId, command) =>
        this._registry.sendCommand(tuya, 'switch', command === 'on'),
    });

    // Setpoint and mode ride a numeric range control. The displayed number is
    // the real value: °C for SET, the 0-based mode index for MODE.
    this._registry.registerDevice({
      key: `${base}_SET`, label: `${ac.label} nastawa`, type: 'grenton', icon: '🎚️',
      sensors: [{ path: 'level', name: 'Setpoint', unit: '°C', format: 'number', sensorType: 'sensor',
        controllable: true, type: 'range', capabilityId: 'level', writeCmd: 'setLevel',
        min: sp.min ?? 16, max: sp.max ?? 31, step: sp.step ?? 1 }],
      _writeCapability: (capId, command, args) =>
        this._registry.sendCommand(tuya, 'heatingSetpoint', Math.round(Number(args?.[0]) || 0)),
    });

    this._registry.registerDevice({
      key: `${base}_MODE`, label: `${ac.label} tryb`, type: 'grenton', icon: '🔁',
      sensors: [{ path: 'level', name: 'Mode', format: 'number', sensorType: 'sensor',
        controllable: ac.modeRw, type: 'range', capabilityId: 'level', writeCmd: 'setLevel',
        min: 0, max: Math.max(0, ac.modes.length - 1), step: 1 }],
      _writeCapability: (capId, command, args) => {
        const modes = this._acs.get(ac.id)?.modes || ac.modes;
        if (!modes.length) throw new Error('AC has no selectable modes');
        const i = Math.max(0, Math.min(modes.length - 1, Math.round(Number(args?.[0]) || 0)));
        return this._registry.sendCommand(tuya, 'thermostatMode', modes[i]);
      },
    });

    this._registry.registerDevice({
      key: `${base}_TMP`, label: `${ac.label} temperatura`, type: 'grenton', icon: '🌡️',
      sensors: [{ path: 'value', name: 'Temperature', sensorType: 'temperature', unit: '°C', homekit: 'temperature' }],
      homekit: ['temperature'],
    });

    console.log(`[GrentonVclu] ${ac.label} → ${base}_{PWR,SET,MODE,TMP}`
      + (ac.modes.length ? ` modes=[${ac.modes.join(', ')}]` : ' (no mode enum)'));
  }

  // ── State: Tuya reading → Grenton object ────────────────────────────────────
  async _poll() {
    for (const [id, ac] of this._acs) {
      const readings = this._registry.getDeviceReadings(`tuya/${id}`)?.readings;
      if (!readings) continue;
      const base = `grenton/AC_${id}`;

      const pwr = readings.switch;
      if (pwr) this._store.set(`${base}_PWR/switch`, pwr.value === true || pwr.value === 1 || pwr.value === 'on');

      const set = readings.heatingSetpoint;
      if (set) this._store.set(`${base}_SET/level`, Number(set.value) || 0);

      const mode = readings.thermostatMode;
      if (mode && ac.modes.length) {
        this._store.set(`${base}_MODE/level`, Math.max(0, ac.modes.indexOf(String(mode.value))));
      }

      const tmp = readings.temperature;
      if (tmp) this._store.set(`${base}_TMP/value`, Number(tmp.value) || 0);
    }
  }
}

module.exports = GrentonVcluClient;
