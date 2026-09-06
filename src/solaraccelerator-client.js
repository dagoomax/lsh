'use strict';

/**
 * Solar Accelerator Connect gateway client (Deye-family hybrid inverters).
 *
 * The SA Connect gateway is an ESP32 on the local network that speaks Modbus
 * RTU to the inverter and exposes a flat HTTP snapshot — no cloud, no API
 * key. Wire format, register map, and retry/tolerance behavior are ported
 * from https://github.com/aLAN-LDZ/solaraccelerator_connect_ha (a Home
 * Assistant custom_component for this same gateway), not guessed — register
 * addresses/bit masks there are stated as confirmed against real hardware
 * (a Deye SUN-12K-SG04LP3).
 *
 * Untested against a real gateway from this codebase — ported faithfully
 * from that reference implementation's documented wire protocol, but nobody
 * has run this specific file against real hardware yet.
 */

const platformStatus = require('./platform-status');

const GATEWAY_USERNAME       = 'admin';
const API_STATUS             = '/api/status';
const API_READINGS           = '/api/inverter/readings';
const API_MODBUS_WRITE       = '/api/modbus/write';

const DEFAULT_POLL_INTERVAL_MS = 5000;
const MIN_POLL_INTERVAL_MS     = 500;
const STATUS_INTERVAL_MS       = 60_000;
const REQUEST_TIMEOUT_MS       = 5000;
const REQUEST_RETRIES          = 1;    // reads only — a lost write must never be retried blind
const RETRY_BACKOFF_MS         = 300;
// Consecutive failed poll CYCLES tolerated before the whole device goes
// offline — the gateway is an ESP32 on Wi-Fi, a dropped request every so
// often is normal, not a real outage.
const UPDATE_FAILURE_TOLERANCE = 3;
// Consecutive polls missing a given key before THAT sensor is treated as
// stale — the gateway silently omits keys from failed Modbus blocks, so one
// gap is normal and shouldn't blank a value that's still true seconds later.
const MISSING_TOLERANCE        = 3;
const WRITE_TIMEOUT_MS         = 12_000;
const WRITE_POLL_INTERVAL_MS   = 400;

// ── Catalog: gateway key → display metadata ─────────────────────────────────
// Ported from catalog.py's CATALOG + NAMES_PL. English names/units follow
// that project's own convention for these Deye Modbus inverters; Polish
// names are its own translations, kept verbatim since this codebase already
// supports per-user language (config.language).
const UNIT = {
  power:   { unit: 'W',   sensorType: 'power',      format: 'number' },
  voltage: { unit: 'V',   sensorType: 'sensor',      format: 'number' },
  current: { unit: 'A',   sensorType: 'sensor',      format: 'number' },
  temp:    { unit: '°C',  sensorType: 'temperature', format: 'temperature' },
  energy:  { unit: 'kWh', sensorType: 'energy',      format: 'energy' },
  freq:    { unit: 'Hz',  sensorType: 'sensor',      format: 'number' },
  percent: { unit: '%',   sensorType: 'sensor',      format: 'percent' },
  ah:      { unit: 'Ah',  sensorType: 'sensor',      format: 'number' },
};

function m(en, pl, kind, opts = {}) {
  return { en, pl, ...(kind ? UNIT[kind] : { format: 'string' }), ...opts };
}

// inverter_status is a bitmask of power sources, not a plain enum — hence
// the gaps and repeated values (e.g. 0x1 and 0x3 both mean "Inverter").
const DEVICE_RELAY = {
  0x0: 'Off', 0x1: 'Inverter', 0x3: 'Inverter', 0x4: 'Grid', 0x6: 'Grid',
  0x5: 'Inverter-Grid', 0x7: 'Inverter-Grid', 0x8: 'Generator', 0x9: 'Inverter-Gen',
  0xB: 'Inverter-Gen', 0xC: 'Grid-Generator', 0xE: 'Grid-Generator',
  0xD: 'Inv-Grid-Gen', 0xF: 'Inv-Grid-Gen',
};
const DEVICE_STATE = { 0: 'Standby', 1: 'Self-test', 2: 'Normal', 3: 'Alarm', 4: 'Fault' };

const STATE_LABELS_PL = {
  Off: 'Wyłączony', Inverter: 'Falownik', Grid: 'Sieć', 'Inverter-Grid': 'Falownik + sieć',
  Generator: 'Generator', 'Inverter-Gen': 'Falownik + generator', 'Grid-Generator': 'Sieć + generator',
  'Inv-Grid-Gen': 'Falownik + sieć + generator',
  Standby: 'Czuwanie', 'Self-test': 'Autotest', Normal: 'Praca normalna', Alarm: 'Alarm', Fault: 'Awaria',
};

const CATALOG = {
  pv1_power: m('PV1 Power', 'Moc PV string 1', 'power'),
  pv2_power: m('PV2 Power', 'Moc PV string 2', 'power'),
  pv3_power: m('PV3 Power', 'Moc PV string 3', 'power'),
  pv4_power: m('PV4 Power', 'Moc PV string 4', 'power'),
  pv1_voltage: m('PV1 Voltage', 'Napięcie PV string 1', 'voltage'),
  pv1_current: m('PV1 Current', 'Prąd PV string 1', 'current'),
  pv2_voltage: m('PV2 Voltage', 'Napięcie PV string 2', 'voltage'),
  pv2_current: m('PV2 Current', 'Prąd PV string 2', 'current'),
  pv3_voltage: m('PV3 Voltage', 'Napięcie PV string 3', 'voltage'),
  pv3_current: m('PV3 Current', 'Prąd PV string 3', 'current'),
  pv4_voltage: m('PV4 Voltage', 'Napięcie PV string 4', 'voltage'),
  pv4_current: m('PV4 Current', 'Prąd PV string 4', 'current'),

  battery_temp: m('Battery Temperature', 'Temperatura baterii', 'temp'),
  battery_voltage: m('Battery Voltage', 'Napięcie baterii', 'voltage'),
  battery_soc: m('Battery', 'Naładowanie baterii', 'percent'),
  battery2_soc: m('Battery 2', 'Naładowanie baterii 2', 'percent'),
  battery_power: m('Battery Power', 'Moc baterii', 'power'),
  battery_current: m('Battery Current', 'Prąd baterii', 'current'),
  battery_corrected_capacity: m('Battery Corrected Capacity', 'Pojemność baterii (skorygowana)', 'ah'),
  battery2_voltage: m('Battery 2 Voltage', 'Napięcie baterii 2', 'voltage'),
  battery2_current: m('Battery 2 Current', 'Prąd baterii 2', 'current'),
  battery2_power: m('Battery 2 Power', 'Moc baterii 2', 'power'),
  battery2_temperature: m('Battery 2 Temperature', 'Temperatura baterii 2', 'temp'),
  battery_soh: m('Battery SOH', 'Kondycja baterii', 'percent'),

  grid_l1_voltage: m('Grid L1 Voltage', 'Napięcie sieci L1', 'voltage'),
  grid_l2_voltage: m('Grid L2 Voltage', 'Napięcie sieci L2', 'voltage'),
  grid_l3_voltage: m('Grid L3 Voltage', 'Napięcie sieci L3', 'voltage'),
  grid_frequency: m('Grid Frequency', 'Częstotliwość sieci', 'freq'),
  grid_power_factor: m('Grid Power Factor', 'Współczynnik mocy', 'percent'),
  grid_l1_power: m('Grid L1 Power', 'Moc sieci L1', 'power'),
  grid_l2_power: m('Grid L2 Power', 'Moc sieci L2', 'power'),
  grid_l3_power: m('Grid L3 Power', 'Moc sieci L3', 'power'),
  grid_power: m('Grid Power', 'Moc sieci', 'power'),
  grid_ct_power_l1: m('Internal CT1 Power', 'Moc CT L1', 'power'),
  grid_ct_power_l2: m('Internal CT2 Power', 'Moc CT L2', 'power'),
  grid_ct_power_l3: m('Internal CT3 Power', 'Moc CT L3', 'power'),
  internal_ct_power: m('Internal Power', 'Moc CT wewnętrznego', 'power'),
  internal_ct_l1_current: m('Internal CT1 Current', 'Prąd CT wewnętrznego L1', 'current'),
  internal_ct_l2_current: m('Internal CT2 Current', 'Prąd CT wewnętrznego L2', 'current'),
  internal_ct_l3_current: m('Internal CT3 Current', 'Prąd CT wewnętrznego L3', 'current'),
  external_ct_l1_current: m('External CT1 Current', 'Prąd CT zewnętrznego L1', 'current'),
  external_ct_l2_current: m('External CT2 Current', 'Prąd CT zewnętrznego L2', 'current'),
  external_ct_l3_current: m('External CT3 Current', 'Prąd CT zewnętrznego L3', 'current'),
  external_ct_l1_power: m('External CT1 Power', 'Moc CT zewnętrznego L1', 'power'),
  external_ct_l2_power: m('External CT2 Power', 'Moc CT zewnętrznego L2', 'power'),
  external_ct_l3_power: m('External CT3 Power', 'Moc CT zewnętrznego L3', 'power'),
  external_ct_power: m('External Power', 'Moc CT zewnętrznego', 'power'),

  inverter_voltage_l1: m('Output L1 Voltage', 'Napięcie falownika L1', 'voltage'),
  inverter_voltage_l2: m('Output L2 Voltage', 'Napięcie falownika L2', 'voltage'),
  inverter_voltage_l3: m('Output L3 Voltage', 'Napięcie falownika L3', 'voltage'),
  inverter_current_l1: m('Output L1 Current', 'Prąd falownika L1', 'current'),
  inverter_current_l2: m('Output L2 Current', 'Prąd falownika L2', 'current'),
  inverter_current_l3: m('Output L3 Current', 'Prąd falownika L3', 'current'),
  output_l1_power: m('Output L1 Power', 'Moc wyjściowa L1', 'power'),
  output_l2_power: m('Output L2 Power', 'Moc wyjściowa L2', 'power'),
  output_l3_power: m('Output L3 Power', 'Moc wyjściowa L3', 'power'),
  inverter_power: m('Power', 'Moc falownika', 'power'),
  output_frequency: m('Output Frequency', 'Częstotliwość wyjściowa', 'freq'),
  inverter_status: m('Device Relay', 'Stan falownika', null, { enumMap: DEVICE_RELAY }),

  load_ups_l1_power: m('Load UPS L1 Power', 'Moc UPS L1', 'power'),
  load_ups_l2_power: m('Load UPS L2 Power', 'Moc UPS L2', 'power'),
  load_ups_l3_power: m('Load UPS L3 Power', 'Moc UPS L3', 'power'),
  load_ups_power: m('Load UPS Power', 'Moc UPS', 'power'),
  load_l1_voltage: m('Load L1 Voltage', 'Napięcie obciążenia L1', 'voltage'),
  load_l2_voltage: m('Load L2 Voltage', 'Napięcie obciążenia L2', 'voltage'),
  load_l3_voltage: m('Load L3 Voltage', 'Napięcie obciążenia L3', 'voltage'),
  load_power_l1: m('Load L1 Power', 'Moc obciążenia L1', 'power'),
  load_power_l2: m('Load L2 Power', 'Moc obciążenia L2', 'power'),
  load_power_l3: m('Load L3 Power', 'Moc obciążenia L3', 'power'),
  load_power: m('Load Power', 'Moc obciążenia', 'power'),
  load_frequency: m('Load Frequency', 'Częstotliwość obciążenia', 'freq'),

  dc_transformer_temp: m('DC Temperature', 'Temperatura transformatora DC', 'temp'),
  radiator_temp: m('Temperature', 'Temperatura radiatora', 'temp'),

  day_battery_charge: m('Today Battery Charge', 'Dzienne ładowanie baterii', 'energy'),
  day_battery_discharge: m('Today Battery Discharge', 'Dzienne rozładowanie baterii', 'energy'),
  total_battery_charge: m('Total Battery Charge', 'Całkowite ładowanie baterii', 'energy'),
  total_battery_discharge: m('Total Battery Discharge', 'Całkowite rozładowanie baterii', 'energy'),
  day_grid_import: m('Today Energy Import', 'Dzienny pobór z sieci', 'energy'),
  day_grid_export: m('Today Energy Export', 'Dzienne oddanie do sieci', 'energy'),
  total_energy_bought: m('Total Energy Import', 'Całkowity pobór z sieci', 'energy'),
  total_energy_sold: m('Total Energy Export', 'Całkowite oddanie do sieci', 'energy'),
  day_load_energy: m('Today Load Consumption', 'Dzienne zużycie', 'energy'),
  total_consumption: m('Total Load Consumption', 'Całkowite zużycie', 'energy'),
  day_pv_energy: m('Today Production', 'Dzienna produkcja PV', 'energy'),
  total_pv_generation: m('Total Production', 'Całkowita produkcja PV', 'energy'),
  daily_generator_production: m('Generator Energy - today', 'Dzienna produkcja generatora', 'energy'),
  total_generator_production: m('Generator Energy', 'Całkowita produkcja generatora', 'energy'),

  running_status: m('Device State', 'Stan pracy', null, { enumMap: DEVICE_STATE }),
};

// ── Heuristic for keys not in CATALOG (mirrors catalog.py's _heuristic()) ──
// so a metric the gateway adds later (new firmware, different inverter
// model) still shows up immediately, just without a hand-picked name.
const ENERGY_PREFIXES = ['day_', 'daily_', 'total_'];
const SUFFIX_RULES = [
  ['_power_factor', 'percent'], ['_frequency', 'freq'], ['_voltage', 'voltage'],
  ['_current', 'current'], ['_temperature', 'temp'], ['_temp', 'temp'],
  ['_soc', 'percent'], ['_soh', 'percent'], ['_energy', 'energy'], ['_power', 'power'],
];
function humanize(key) {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function describeKey(key) {
  if (CATALOG[key]) return CATALOG[key];
  const diagnostic = key.startsWith('set_');
  const base = diagnostic ? key.slice(4) : key;
  const name = humanize(key);
  if (ENERGY_PREFIXES.some((p) => base.startsWith(p))) return m(name, name, 'energy', { diagnostic });
  for (const [suffix, kind] of SUFFIX_RULES) {
    if (base.endsWith(suffix)) return m(name, name, kind, { diagnostic });
  }
  return m(name, name, null, { diagnostic });
}

// ── Writable controls: gateway key → Modbus register + how to encode a write.
// Ported from control.py. Register addresses/bit masks are stated there as
// confirmed against a real Deye SUN-12K-SG04LP3 — a more powerful inverter
// may need wider min/max, but the addresses themselves are hardware fact,
// not a guess.
const NUM_PROGRAMS = 6;
const REG_PROGRAM_TIME     = 148; // 148-153, u16 = HHMM (600 = 06:00)
const REG_PROGRAM_POWER    = 154; // 154-159, u16 = W
const REG_PROGRAM_SOC      = 166; // 166-171, u16 = %
const REG_PROGRAM_CHARGING = 172; // 172-177, bitfield (bit0 Grid, bit1 Generator, bit5 Sell)
const REG_WORK_MODE = 142;
const REG_EXPORT_SURPLUS_POWER = 143;
const REG_MAX_CHARGE_CURRENT = 108;
const REG_MAX_DISCHARGE_CURRENT = 109;
const REG_GEN_CONFIG = 178; // bitfield (bit4 = grid peak shaving)
const REG_GRID_PEAK_SHAVING_POWER = 191;
const REG_PV_POWER = 340;

const MASK_CHARGING = 0b0000_0011;
const MASK_GRID_PEAK_SHAVING = 0b0001_0000;

const MAX_POWER_W = 12000;
const MAX_CURRENT_A = 240;

const WORK_MODE_OPTIONS = { 0: 'Selling First', 1: 'Zero Export To Load', 2: 'Zero Export To CT' };
const CHARGING_OPTIONS  = { 0: 'Disabled', 1: 'Grid', 2: 'Generator', 3: 'Both' };

function buildControls() {
  const controls = [
    { key: 'set_work_mode', register: REG_WORK_MODE, kind: 'enum', options: WORK_MODE_OPTIONS },
    { key: 'set_max_charge_current', register: REG_MAX_CHARGE_CURRENT, kind: 'number', min: 0, max: MAX_CURRENT_A },
    { key: 'set_max_discharge_current', register: REG_MAX_DISCHARGE_CURRENT, kind: 'number', min: 0, max: MAX_CURRENT_A },
    { key: 'set_pv_power', register: REG_PV_POWER, kind: 'number', min: 0, max: MAX_POWER_W },
    { key: 'set_export_surplus_power', register: REG_EXPORT_SURPLUS_POWER, kind: 'number', min: 0, max: MAX_POWER_W },
    { key: 'set_grid_peak_shaving_power', register: REG_GRID_PEAK_SHAVING_POWER, kind: 'number', min: 0, max: MAX_POWER_W },
    // Synthetic — not its own readings key. Current value and the other three
    // switches sharing REG_GEN_CONFIG all live in `set_gen_config`'s raw
    // integer; this decodes/writes just bit4 of it via read-modify-write.
    { key: 'grid_peak_shaving', register: REG_GEN_CONFIG, kind: 'bit-switch', sourceKey: 'set_gen_config', bitMask: MASK_GRID_PEAK_SHAVING },
  ];
  for (let n = 1; n <= NUM_PROGRAMS; n++) {
    const i = n - 1;
    controls.push(
      { key: `set_program_time_${n}`, register: REG_PROGRAM_TIME + i, kind: 'hhmm' },
      { key: `set_program_power_${n}`, register: REG_PROGRAM_POWER + i, kind: 'number', min: 0, max: MAX_POWER_W },
      { key: `set_program_soc_${n}`, register: REG_PROGRAM_SOC + i, kind: 'number', min: 0, max: 100 },
      { key: `set_program_charging_${n}`, register: REG_PROGRAM_CHARGING + i, kind: 'enum-bitfield', bitMask: MASK_CHARGING, options: CHARGING_OPTIONS },
    );
  }
  return controls;
}
const CONTROLS = buildControls();
const CONTROLS_BY_KEY = new Map(CONTROLS.map((c) => [c.key, c]));

/** Read-modify-write a bitfield register, per control.py's apply_bit_mask(). */
function applyBitMask(current, value, mask) {
  return ((current & ~mask) | (value & mask)) & 0xFFFF;
}

function hhmmToText(v) {
  const n = Number(v) || 0;
  const h = Math.floor(n / 100), min = n % 100;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
function textToHhmm(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!match) throw new Error(`Expected "HH:MM", got "${text}"`);
  const h = Number(match[1]), min = Number(match[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time "${text}"`);
  return h * 100 + min;
}

class SolarAcceleratorClient {
  constructor(config, store, sensorRegistry) {
    this.config = config.solaraccelerator || {};
    this.store = store;
    this.sensorRegistry = sensorRegistry;
    this.pollTimer = null;
    this.statusDueAt = 0;
    this.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    this._missing = new Map();      // key -> consecutive misses
    this._registeredKeys = new Set();
    this._consecutiveFailures = 0;
    this._writeQueue = Promise.resolve(); // gateway handles one write at a time
    this._lang = sensorRegistry?.language || 'en';
  }

  async start() {
    const { host } = this.config;
    if (!host) throw new Error('solaraccelerator.host missing in config.json');
    this.deviceKey = `solaraccelerator/${host.replace(/\./g, '_')}`;

    const status = await this._get(API_STATUS);
    if (status.mode !== 'STA') throw new Error(`Gateway at ${host} is in ${status.mode || '?'} mode — finish its setup wizard first`);
    if (!status.firmware_version) throw new Error(`No response from a real SA Connect gateway at ${host}`);
    console.log(`[SolarAccelerator] Gateway ${host} firmware ${status.firmware_version}`);

    this.device = {
      key: this.deviceKey,
      type: 'solaraccelerator',
      label: this.config.label || 'Solar Accelerator',
      icon: '☀️',
      color: 'orange',
      sensors: [],
      _writeCapability: (key, command, args = []) => this._writeCommand(key, command, args),
    };
    this.sensorRegistry.registerDevice(this.device);

    await this._poll();
    platformStatus.set('solaraccelerator', true);
    this._schedulePoll();
    console.log(`[SolarAccelerator] Started — polling every ${this.pollIntervalMs / 1000}s`);
  }

  stop() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  _schedulePoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this._poll().then(
      () => { this._consecutiveFailures = 0; platformStatus.set('solaraccelerator', true); this._schedulePoll(); },
      (err) => {
        this._consecutiveFailures++;
        if (this._consecutiveFailures >= UPDATE_FAILURE_TOLERANCE) {
          console.error(`[SolarAccelerator] Poll failed ${this._consecutiveFailures}x: ${err.message}`);
          platformStatus.set('solaraccelerator', false);
        }
        this._schedulePoll();
      },
    ), this.pollIntervalMs);
  }

  async _poll() {
    const readings = await this._get(API_READINGS);
    const items = readings.items || [];
    const seen = new Set();

    for (const { key, value } of items) {
      if (!key) continue;
      seen.add(key);
      this._missing.delete(key);
      this._rawByKey = this._rawByKey || new Map();
      this._rawByKey.set(key, value);

      if (!this._registeredKeys.has(key)) {
        this._registeredKeys.add(key);
        this._registerSensor(key);
      }
      this.store.update(`${this.deviceKey}/${key}`, this._decode(key, value));
    }

    // Synthetic total across all PV strings — the gateway only ever reports
    // per-string power (pv1_power..pv4_power), so this is the one store key
    // with real history a "Solar" trend chart/energy-source picker can use;
    // summing on every read (e.g. in getGrouped()) would give that number no
    // history of its own.
    const pvKeys = ['pv1_power', 'pv2_power', 'pv3_power', 'pv4_power'].filter((k) => seen.has(k));
    if (pvKeys.length) {
      const total = pvKeys.reduce((sum, k) => sum + (Number(this._rawByKey.get(k)) || 0), 0);
      if (!this._registeredKeys.has('pv_total_power')) {
        this._registeredKeys.add('pv_total_power');
        this.device.sensors.push({
          path: 'pv_total_power',
          name: this._lang === 'pl' ? 'Moc PV (łącznie)' : 'PV Total Power',
          label: this._lang === 'pl' ? 'Moc PV (łącznie)' : 'PV Total Power',
          sensorType: 'power', format: 'number', unit: 'W',
        });
      }
      this.store.update(`${this.deviceKey}/pv_total_power`, total);
    }

    // Keys that used to report but didn't this cycle — only blank them out
    // after MISSING_TOLERANCE consecutive gaps (see the constant's comment).
    for (const key of this._registeredKeys) {
      if (seen.has(key)) continue;
      const misses = (this._missing.get(key) || 0) + 1;
      this._missing.set(key, misses);
      if (misses === MISSING_TOLERANCE) this.store.update(`${this.deviceKey}/${key}`, null);
    }

    // The synthetic grid_peak_shaving switch has no readings key of its own —
    // its value lives in set_gen_config's raw bits, decoded on every poll.
    const genConfig = this._rawByKey?.get('set_gen_config');
    if (genConfig != null) {
      if (!this._registeredKeys.has('grid_peak_shaving')) {
        this._registeredKeys.add('grid_peak_shaving');
        this._registerControlOnlySensor('grid_peak_shaving');
      }
      this.store.update(`${this.deviceKey}/grid_peak_shaving`, (Number(genConfig) & MASK_GRID_PEAK_SHAVING) ? 1 : 0);
    }

    const raw = readings.poll_interval_ms;
    if (raw != null) {
      const seconds = Math.max(MIN_POLL_INTERVAL_MS, Number(raw)) ;
      if (Number.isFinite(seconds) && seconds !== this.pollIntervalMs) this.pollIntervalMs = seconds;
    }
  }

  _label(key, def) {
    return this._lang === 'pl' ? def.pl : def.en;
  }

  _registerSensor(key) {
    const def = describeKey(key);
    const label = this._label(key, def);
    const sensor = {
      path: key,
      name: label,
      label,
      sensorType: def.sensorType || 'sensor',
      format: def.format,
      raw: def.format === 'string',
      diagnostic: !!def.diagnostic,
    };
    if (def.unit) sensor.unit = def.unit;

    const control = CONTROLS_BY_KEY.get(key);
    if (control && control.kind !== 'bit-switch') this._makeControllable(sensor, control);

    this.device.sensors.push(sensor);
  }

  // grid_peak_shaving has no readings key of its own (see _poll) but is still
  // a real control, so it gets a sensor entry without going through
  // _registerSensor's key-description lookup.
  _registerControlOnlySensor(key) {
    const control = CONTROLS_BY_KEY.get(key);
    const label = this._lang === 'pl' ? 'Peak shaving z sieci' : 'Grid Peak Shaving';
    const sensor = { path: key, name: label, label, sensorType: 'switch', format: 'on-off', raw: false };
    this._makeControllable(sensor, control);
    this.device.sensors.push(sensor);
  }

  _makeControllable(sensor, control) {
    sensor.controllable = true;
    sensor.capabilityId = control.key;
    if (control.kind === 'number') {
      sensor.type = 'range';
      sensor.min = control.min;
      sensor.max = control.max;
    } else if (control.kind === 'hhmm') {
      sensor.type = 'text'; // "HH:MM"
    } else if (control.kind === 'enum' || control.kind === 'enum-bitfield') {
      sensor.type = 'text'; // one of control.options's string values
    } else if (control.kind === 'bit-switch') {
      sensor.type = 'toggle';
      sensor.writeOn = 'on';
      sensor.writeOff = 'off';
    }
  }

  // Turns a raw gateway value into what gets stored/displayed.
  _decode(key, value) {
    const def = describeKey(key);
    if (def.enumMap) {
      const label = def.enumMap[value] ?? String(value);
      return this._lang === 'pl' ? (STATE_LABELS_PL[label] || label) : label;
    }
    const control = CONTROLS_BY_KEY.get(key);
    if (control?.kind === 'enum-bitfield') {
      const decoded = Number(value) & control.bitMask;
      return control.options[decoded] ?? String(decoded);
    }
    if (control?.kind === 'enum') {
      return control.options[value] ?? String(value);
    }
    if (control?.kind === 'hhmm') return hhmmToText(value);
    return value;
  }

  // ── Writes ───────────────────────────────────────────────
  // Queued: the gateway itself only handles one Modbus write transaction at
  // a time and answers a second with 409 — queuing here means a dashboard
  // double-click or two Flow writes in the same second just wait their turn
  // instead of one of them erroring.
  async _writeCommand(key, command, args = []) {
    const run = () => this._doWrite(key, command, args);
    const result = this._writeQueue.then(run, run);
    this._writeQueue = result.catch(() => {});
    return result;
  }

  async _doWrite(key, command, args) {
    if (key === 'grid_peak_shaving') {
      const current = this._rawByKey?.get('set_gen_config');
      if (current == null) throw new Error('grid_peak_shaving: current register value unknown yet — refusing to guess it');
      const bitValue = (command === 'on') ? MASK_GRID_PEAK_SHAVING : 0;
      const next = applyBitMask(Number(current), bitValue, MASK_GRID_PEAK_SHAVING);
      return this._writeRegister(REG_GEN_CONFIG, next);
    }

    const control = CONTROLS_BY_KEY.get(key);
    if (!control) throw new Error(`Unknown control "${key}"`);

    if (control.kind === 'number') {
      const value = Number(args[0]);
      if (!Number.isFinite(value)) throw new Error(`${key}: expected a number, got "${args[0]}"`);
      return this._writeRegister(control.register, Math.round(Math.min(control.max, Math.max(control.min, value))));
    }
    if (control.kind === 'hhmm') {
      return this._writeRegister(control.register, textToHhmm(args[0]));
    }
    if (control.kind === 'enum') {
      const value = this._resolveEnumValue(control.options, args[0]);
      return this._writeRegister(control.register, value);
    }
    if (control.kind === 'enum-bitfield') {
      const value = this._resolveEnumValue(control.options, args[0]);
      const current = this._rawByKey?.get(control.key);
      if (current == null) throw new Error(`${key}: current register value unknown yet — refusing to guess it`);
      const next = applyBitMask(Number(current), value, control.bitMask);
      return this._writeRegister(control.register, next);
    }
    throw new Error(`${key}: unsupported control kind "${control.kind}"`);
  }

  _resolveEnumValue(options, input) {
    if (typeof input === 'number' || /^\d+$/.test(String(input))) return Number(input);
    const entry = Object.entries(options).find(([, label]) => label.toLowerCase() === String(input).trim().toLowerCase());
    if (!entry) throw new Error(`"${input}" isn't one of: ${Object.values(options).join(', ')}`);
    return Number(entry[0]);
  }

  /**
   * POST the write, then poll GET until the gateway confirms it against a
   * read-back of the real register — Deye can accept a write and revert it
   * moments later, so "the POST returned 200" is not the same as "it stuck".
   */
  async _writeRegister(register, value) {
    await this._post(API_MODBUS_WRITE, { reg: String(register), value: String(value), fc: '16' });

    const deadline = Date.now() + WRITE_TIMEOUT_MS;
    for (;;) {
      await new Promise((r) => setTimeout(r, WRITE_POLL_INTERVAL_MS));
      const status = await this._get(API_MODBUS_WRITE, { retries: REQUEST_RETRIES });
      if (status.state === 'done') return status.read_back != null ? Number(status.read_back) : value;
      if (status.state === 'error') throw new Error(status.error || `register ${register} write failed`);
      if (Date.now() > deadline) throw new Error(`register ${register}: no confirmation within ${WRITE_TIMEOUT_MS / 1000}s`);
    }
  }

  // ── HTTP ─────────────────────────────────────────────────
  async _get(path, { retries = REQUEST_RETRIES } = {}) {
    let attempt = 0;
    for (;;) {
      try { return await this._request('GET', path); }
      catch (err) {
        if (attempt >= retries || err.permanent) throw err;
        attempt++;
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      }
    }
  }

  async _post(path, params) {
    return this._request('POST', path, params);
  }

  async _request(method, path, params) {
    const { host, port, password } = this.config;
    const url = new URL(`http://${host}${port ? `:${port}` : ''}${path}`);
    if (method === 'GET' && params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const headers = {};
    if (password) headers.Authorization = 'Basic ' + Buffer.from(`${GATEWAY_USERNAME}:${password}`).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'POST' && params ? new URLSearchParams(params) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401) { const e = new Error(`${path}: gateway requires the portal password`); e.permanent = true; throw e; }
      if (res.status >= 400 && res.status !== 503) {
        const detail = await res.text().catch(() => '');
        const e = new Error(`${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
        e.permanent = true;
        throw e;
      }
      if (res.status === 503) throw new Error(`${path}: gateway temporarily out of memory for a response`);
      const len = res.headers.get('content-length');
      if (len === '0') return {};
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`${path}: timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = SolarAcceleratorClient;
