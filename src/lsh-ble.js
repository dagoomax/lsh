// SPDX-License-Identifier: GPL-3.0-or-later
// Derived from esphome-victron_ble, Copyright Fabian Schmidt, GPL-3.0
// (https://github.com/Fabian-Schmidt/esphome-victron_ble). This file is
// distributed under the same license; see that repository's LICENSE.
'use strict';

// Victron BLE "Instant Readout" — decoder for the encrypted Bluetooth
// advertisements Victron devices broadcast (SmartShunt, SmartSolar, Orion,
// MultiPlus, …). Ported from Fabian Schmidt's esphome-victron_ble
// (github.com/Fabian-Schmidt/esphome-victron_ble, components/victron_ble):
// record layouts from victron_ble.h, value scaling and "not available"
// sentinels from sensor/victron_sensor.h, text tables from
// text_sensor/victron_text_sensor.cpp. Pure functions — the Bluetooth side
// is lsh-ble-client.js.
//
// Advertisement = Victron manufacturer data (company id 0x02E1), after the
// company id:
//   [0] 0x10 product advertisement  [1] record length  [2..3] product id (LE)
//   [4] record type  [5..6] data counter (LE)  [7] bindkey byte 0
//   [8..] AES-128-CTR encrypted record; key = bindkey, counter block =
//         [counter lsb, counter msb, 0 × 14]
// The decrypted record is a little-endian bit stream of fixed-width fields.

const crypto = require('crypto');

const VICTRON_MANUFACTURER_ID = 0x02e1;
const HEADER_LEN = 8;

// ── Field types: [bits, signed, scale, na (raw bits), offset] ───────────────
const T = {
  u8:       [8, false],
  u16:      [16, false],
  u32:      [32, false],
  s16_001:  [16, true, 0.01, 0x7fff],       // vic_16bit_0_01
  s16_001n: [16, true, 0.01, null],         // vic_16bit_0_01_noNAN (0x7FFF → 0)
  u16_001:  [16, false, 0.01, 0xffff],      // vic_16bit_0_01_positive (V or kWh)
  s16_01:   [16, true, 0.1, 0x7fff],        // vic_16bit_0_1
  u16_01:   [16, false, 0.1, 0xffff],       // vic_16bit_0_1_positive
  s16_1:    [16, true, 1, 0x7fff],          // vic_16bit_1
  u16_1:    [16, false, 1, 0xffff],         // vic_16bit_1_positive (W, VA, min)
  u15_001:  [15, false, 0.01, 0x7fff],
  u14_001:  [14, false, 0.01, 0x3fff],
  u13_001:  [13, false, 0.01, 0x1fff],
  u12_001:  [12, false, 0.01, 0xfff],
  u11_01:   [11, false, 0.1, 0x7ff],
  u10_01:   [10, false, 0.1, 0x3ff],        // SOC, 0.1 %
  u9_01:    [9, false, 0.1, 0x1ff],
  s22_0001: [22, true, 0.001, 0x3fffff],    // current, mA
  neg20_01: [20, false, -0.1, 0xfffff],     // consumed Ah (stored positive)
  s19_1:    [19, true, 1, 0x3ffff],
  u7_1:     [7, false, 1, 0x7f],
  temp7:    [7, false, 1, 0x7f, -40],       // °C = raw − 40
  cell7:    [7, false, 0.01, 0x7f, 2.6],    // V = raw × 0.01 + 2.60
  bits:     null,                           // [bits, false] given inline
}

// ── Record layouts (field order = bit order) ────────────────────────────────
const RECORDS = {
  0x01: ['solar_charger', [
    ['deviceState', 'u8'], ['chargerError', 'u8'], ['batteryVoltage', 's16_001'], ['batteryCurrent', 's16_01'],
    ['yieldToday', 'u16_001'], ['pvPower', 'u16_1'], ['loadCurrent', 'u9_01'],
  ]],
  0x02: ['battery_monitor', [
    ['timeToGo', 'u16_1'], ['batteryVoltage', 's16_001'], ['alarmReason', 'u16'], ['aux', 'u16'],
    ['auxInputType', 2], ['batteryCurrent', 's22_0001'], ['consumedAh', 'neg20_01'], ['soc', 'u10_01'],
  ]],
  0x03: ['inverter', [
    ['deviceState', 'u8'], ['alarmReason', 'u16'], ['batteryVoltage', 's16_001'], ['acApparentPower', 'u16_1'],
    ['acVoltage', 'u15_001'], ['acCurrent', 'u11_01'],
  ]],
  0x04: ['dcdc_converter', [
    ['deviceState', 'u8'], ['chargerError', 'u8'], ['inputVoltage', 'u16_001'], ['outputVoltage', 's16_001n'], ['offReason', 'u32'],
  ]],
  0x05: ['smart_lithium', [
    ['bmsFlags', 'u32'], ['error', 'u16'], ['cell1', 'cell7'], ['cell2', 'cell7'], ['cell3', 'cell7'], ['cell4', 'cell7'],
    ['cell5', 'cell7'], ['cell6', 'cell7'], ['cell7', 'cell7'], ['cell8', 'cell7'],
    ['batteryVoltage', 'u12_001'], ['balancerStatus', 4], ['batteryTemperature', 'temp7'],
  ]],
  0x06: ['inverter_rs', [
    ['deviceState', 'u8'], ['chargerError', 'u8'], ['batteryVoltage', 's16_001'], ['batteryCurrent', 's16_01'],
    ['pvPower', 'u16_1'], ['yieldToday', 'u16_001'], ['acOutPower', 's16_1'],
  ]],
  0x08: ['ac_charger', [
    ['deviceState', 'u8'], ['chargerError', 'u8'],
    ['batteryVoltage', 'u13_001'], ['batteryCurrent', 'u11_01'],
    ['batteryVoltage2', 'u13_001'], ['batteryCurrent2', 'u11_01'],
    ['batteryVoltage3', 'u13_001'], ['batteryCurrent3', 'u11_01'],
    ['temperature', 'temp7'], ['acCurrent', 'u9_01'],
  ]],
  0x09: ['smart_battery_protect', [
    ['deviceState', 'u8'], ['outputState', 'u8'], ['errorCode', 'u8'], ['alarmReason', 'u16'], ['warningReason', 'u16'],
    ['inputVoltage', 's16_001'], ['outputVoltage', 'u16_001'], ['offReason', 'u32'],
  ]],
  0x0a: ['lynx_bms', [
    ['error', 'u8'], ['timeToGo', 'u16_1'], ['batteryVoltage', 's16_001'], ['batteryCurrent', 's16_01'],
    ['ioStatus', 'u16'], ['warningsAlarms', 18], ['soc', 'u10_01'], ['consumedAh', 'neg20_01'], ['temperature', 'temp7'],
  ]],
  0x0b: ['multi_rs', [
    ['deviceState', 'u8'], ['chargerError', 'u8'], ['batteryCurrent', 's16_01'], ['batteryVoltage', 'u14_001'],
    ['activeAcIn', 2], ['activeAcInPower', 's16_1'], ['acOutPower', 's16_1'], ['pvPower', 'u16_1'], ['yieldToday', 'u16_001'],
  ]],
  0x0c: ['ve_bus', [
    ['deviceState', 'u8'], ['veBusError', 'u8'], ['batteryCurrent', 's16_01'], ['batteryVoltage', 'u14_001'],
    ['activeAcIn', 2], ['activeAcInPower', 's19_1'], ['acOutPower', 's19_1'], ['alarm', 2],
    ['batteryTemperature', 'temp7'], ['soc', 'u7_1'],
  ]],
  0x0d: ['dc_energy_meter', [
    ['monitorMode', 's16_1'], ['batteryVoltage', 's16_001'], ['alarmReason', 'u16'], ['aux', 'u16'],
    ['auxInputType', 2], ['batteryCurrent', 's22_0001'],
  ]],
  0x0f: ['orion_xs', [
    ['deviceState', 'u8'], ['chargerError', 'u8'], ['outputVoltage', 'u16_001'], ['outputCurrent', 'u16_01'],
    ['inputVoltage', 'u16_001'], ['inputCurrent', 'u16_01'], ['offReason', 'u32'],
  ]],
}

// ── Text tables ─────────────────────────────────────────────────────────────
const DEVICE_STATE = {
  0x00: 'Off', 0x01: 'Low power', 0x02: 'Fault', 0x03: 'Bulk', 0x04: 'Absorption', 0x05: 'Float', 0x06: 'Storage',
  0x07: 'Equalize (manual)', 0x08: 'Pass Thru', 0x09: 'Inverting', 0x0a: 'Assisting', 0x0b: 'Power supply',
  0xf4: 'Sustain', 0xf5: 'Starting-up', 0xf6: 'Repeated absorption', 0xf7: 'Auto equalize / Recondition',
  0xf8: 'BatterySafe', 0xf9: 'Load detect', 0xfa: 'Blocked', 0xfb: 'Test', 0xfc: 'External Control',
}
const CHARGER_ERROR = {
  1: 'Err 1 - Battery temperature too high', 2: 'Err 2 - Battery voltage too high',
  3: 'Err 3 - Remote temperature sensor failure', 4: 'Err 4 - Remote temperature sensor failure',
  5: 'Err 5 - Remote temperature sensor failure', 6: 'Err 6 - Remote battery voltage sense failure',
  7: 'Err 7 - Remote battery voltage sense failure', 8: 'Err 8 - Remote battery voltage sense failure',
  11: 'Err 11 - Battery high ripple voltage', 14: 'Err 14 - Battery temperature too low',
  17: 'Err 17 - Charger temperature too high', 18: 'Err 18 - Charger over current', 19: 'Err 19 - Charger current polarity reversed',
  20: 'Err 20 - Bulk time limit exceeded', 21: 'Err 21 - Current sensor issue', 22: 'Err 22 - Internal temperature sensor failure',
  23: 'Err 23 - Internal temperature sensor failure', 24: 'Err 24 - Fan failure', 26: 'Err 26 - Terminals overheated',
  27: 'Err 27 - Charger short circuit', 28: 'Err 28 - Power stage issue', 29: 'Err 29 - Over-Charge protection',
  33: 'Err 33 - PV over-voltage', 34: 'Err 34 - PV over-current', 35: 'Err 35 - PV over-power',
  38: 'Err 38 - Input shutdown (excessive battery voltage)', 39: 'Err 39 - Input shutdown (current flow during off mode)',
  40: 'Err 40 - PV input failed to shutdown', 41: 'Err 41 - Inverter shutdown (PV isolation)', 42: 'Err 42 - Inverter shutdown (PV isolation)',
  43: 'Err 43 - Inverter shutdown (ground fault)', 50: 'Err 50 - Inverter overload', 51: 'Err 51 - Inverter temperature too high',
  52: 'Err 52 - Inverter peak current', 53: 'Err 53 - Inverter output voltage', 54: 'Err 54 - Inverter output voltage',
  55: 'Err 55 - Inverter self test failed', 56: 'Err 56 - Inverter self test failed', 57: 'Err 57 - Inverter AC voltage on output',
  58: 'Err 58 - Inverter self test failed', 65: 'Information 65 - Communication warning', 66: 'Information 66 - Incompatible device',
  67: 'Err 67 - BMS connection lost', 68: 'Err 68 - Network misconfigured', 69: 'Err 69 - Network misconfigured',
  70: 'Err 70 - Network misconfigured', 71: 'Err 71 - Network misconfigured',
  80: 'Err 80 - PV input shutdown', 81: 'Err 81 - PV input shutdown', 82: 'Err 82 - PV input shutdown', 83: 'Err 83 - PV input shutdown',
  84: 'Err 84 - PV input shutdown', 85: 'Err 85 - PV input shutdown', 86: 'Err 86 - PV input shutdown', 87: 'Err 87 - PV input shutdown',
  114: 'Err 114 - CPU temperature too high', 116: 'Err 116 - Factory calibration data lost', 117: 'Err 117 - Invalid/incompatible firmware',
  119: 'Err 119 - Settings data lost', 121: 'Err 121 - Tester fail', 200: 'Err 200 - Internal DC voltage error',
  201: 'Err 201 - Internal DC voltage error', 202: 'Err 202 - PV residual current sensor self-test failure',
  203: 'Err 203 - Internal supply voltage error', 205: 'Err 205 - Internal supply voltage error',
  212: 'Err 212 - Internal supply voltage error', 215: 'Err 215 - Internal supply voltage error',
}
const ALARM_BITS = [
  'Low Voltage', 'High Voltage', 'Low SOC', 'Low Starter Voltage', 'High Starter Voltage', 'Low Temperature',
  'High Temperature', 'Mid Voltage', 'Overload', 'DC-ripple', 'Low V AC out', 'High V AC out', 'Short Circuit',
  'BMS Lockout', 'Unknown alarm (0x4000)', 'Unknown alarm (0x8000)',
]
const OFF_REASON_BITS = [
  'No input power', 'Switched off (power switch)', 'Switched off (device mode register)', 'Remote input',
  'Protection active', 'Paygo', 'BMS', 'Engine shutdown detection', 'Analysing input voltage', 'Battery temperature too low',
]
const AC_IN = ['AC in 1', 'AC in 2', 'Not connected', 'Unknown']
const ALARM_NOTIFICATION = ['', 'Warning', 'Alarm']
// Smart BatteryProtect output state. The C++ component maps this field to the
// VE.Direct DC-output-status register (1 = Auto, 4 = On), but a real SBP with
// its output on (in = out voltage) reports 1 — the mapping below is the one
// verified against that capture (keshavdv/victron-ble test vectors).
const OUTPUT_STATE = { 0: 'Shutdown', 1: 'On', 4: 'Off' }
const BALANCER = ['Unknown', 'Balanced', 'Balancing', 'Imbalance']

const flags = (v, names) => names.filter((_, i) => v & (1 << i)).join(', ')
const deviceStateText = (v) => (v === 0xff ? 'Not available' : DEVICE_STATE[v] || `Unknown (0x${v.toString(16)})`)
const errorText = (v) => (v === 0 ? 'No error' : v === 0xff ? 'Not available' : CHARGER_ERROR[v] || `Err ${v}`)

// ── Bit reader ──────────────────────────────────────────────────────────────
function readFields(buf, layout) {
  const out = {}
  let bit = 0
  for (const [name, spec] of layout) {
    const [bits, signed, scale, na, offset] = typeof spec === 'number' ? [spec, false] : T[spec]
    let raw = 0n
    for (let i = 0; i < bits; i++, bit++) {
      const byte = buf[bit >> 3]
      if (byte === undefined) { out[name] = null; raw = null; break }
      if ((byte >> (bit & 7)) & 1) raw |= 1n << BigInt(i)
    }
    if (raw === null) break // record shorter than this device type's layout
    raw = Number(raw)
    if (scale === undefined) { out[name] = raw; continue }
    if (na !== null && na !== undefined && raw === na) { out[name] = null; continue }
    let v = raw
    if (signed && raw >= 2 ** (bits - 1)) v = raw - 2 ** bits
    if (na === null && signed && raw === 0x7fff) v = 0 // noNAN variant
    out[name] = round(v * scale + (offset || 0))
  }
  return out
}

const round = (v) => Math.round(v * 10000) / 10000

function decrypt(encrypted, bindkey, counter) {
  const iv = Buffer.alloc(16)
  iv.writeUInt16LE(counter, 0)
  const decipher = crypto.createDecipheriv('aes-128-ctr', bindkey, iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

// Parse one advertisement. `data` = manufacturer data after the 0x02E1
// company id; `bindkeyHex` = the device's 32-hex-char encryption key.
// Returns { kind, recordType, productId, counter, fields, values } or
// { error } — never throws on malformed input.
function parseAdvertisement(data, bindkeyHex) {
  if (!Buffer.isBuffer(data) || data.length <= HEADER_LEN) return { error: 'too short' }
  if (data[0] !== 0x10) return { error: 'not a product advertisement' }
  const recordType = data[4]
  const rec = RECORDS[recordType]
  if (!rec) return { error: `unsupported record type 0x${recordType.toString(16)}` }
  const key = Buffer.from(String(bindkeyHex || ''), 'hex')
  if (key.length !== 16) return { error: 'bindkey must be 32 hex characters' }
  if (data[7] !== key[0]) return { error: `bindkey mismatch (device expects a key starting ${data[7].toString(16).padStart(2, '0')})` }
  const counter = data.readUInt16LE(5)
  const fields = readFields(decrypt(data.subarray(HEADER_LEN), key, counter), rec[1])
  return { kind: rec[0], recordType, productId: data.readUInt16LE(2), counter, fields, values: toValues(rec[0], fields) }
}

const mul = (a, b) => (a == null || b == null ? null : round(a * b))

// Fields → the catalogue's TYPE names (what LSH stores and shows).
function toValues(kind, f) {
  const v = {}
  const set = (k, x) => { if (x !== undefined) v[k] = x }
  set('BATTERY_VOLTAGE', f.batteryVoltage)
  set('BATTERY_CURRENT', f.batteryCurrent)
  if ('batteryVoltage' in f && 'batteryCurrent' in f) set('BATTERY_POWER', mul(f.batteryVoltage, f.batteryCurrent))
  set('STATE_OF_CHARGE', f.soc)
  set('CONSUMED_AH', f.consumedAh)
  set('TIME_TO_GO', f.timeToGo)
  set('PV_POWER', f.pvPower)
  set('YIELD_TODAY', f.yieldToday)
  set('LOAD_CURRENT', f.loadCurrent)
  if ('loadCurrent' in f) set('LOAD_POWER', mul(f.loadCurrent, f.batteryVoltage))
  set('AC_APPARENT_POWER', f.acApparentPower)
  set('AC_VOLTAGE', f.acVoltage)
  set('AC_CURRENT', f.acCurrent)
  set('AC_OUT_POWER', f.acOutPower)
  set('ACTIVE_AC_IN_POWER', f.activeAcInPower)
  set('INPUT_VOLTAGE', f.inputVoltage)
  set('OUTPUT_VOLTAGE', f.outputVoltage)
  set('INPUT_CURRENT', f.inputCurrent)
  set('OUTPUT_CURRENT', f.outputCurrent)
  if ('inputCurrent' in f) set('INPUT_POWER', mul(f.inputCurrent, f.inputVoltage))
  if ('outputCurrent' in f) set('OUTPUT_POWER', mul(f.outputCurrent, f.outputVoltage))
  set('TEMPERATURE', 'temperature' in f ? f.temperature : f.batteryTemperature)
  for (let i = 1; i <= 8; i++) set(`CELL${i}`, f[`cell${i}`])
  if ('balancerStatus' in f) set('BALANCER_STATUS', f.balancerStatus === 0xf ? null : f.balancerStatus)
  set('BATTERY_VOLTAGE_2', f.batteryVoltage2)
  set('BATTERY_CURRENT_2', f.batteryCurrent2)
  set('BATTERY_VOLTAGE_3', f.batteryVoltage3)
  set('BATTERY_CURRENT_3', f.batteryCurrent3)
  // Battery monitor / DC energy meter: one 16-bit aux field, meaning set by
  // aux_input_type (0 starter/aux voltage, 1 mid-point voltage, 2 temperature).
  if ('auxInputType' in f) {
    const a = f.aux
    if (f.auxInputType === 0) v.AUX_VOLTAGE = a === 0x7fff ? null : round((a >= 0x8000 ? a - 0x10000 : a) * 0.01)
    if (f.auxInputType === 1) v.MID_VOLTAGE = a === 0xffff ? null : round(a * 0.01)
    if (f.auxInputType === 2) v.TEMPERATURE = a === 0xffff ? null : round(a * 0.01 - 273.15)
  }
  // Text + binary
  if ('deviceState' in f) v.DEVICE_STATE_TEXT = deviceStateText(f.deviceState)
  if ('chargerError' in f) v.CHARGER_ERROR_TEXT = errorText(f.chargerError)
  if ('errorCode' in f) v.ERROR_CODE_TEXT = errorText(f.errorCode)
  if ('alarmReason' in f) {
    v.ALARM_REASON_TEXT = f.alarmReason ? flags(f.alarmReason, ALARM_BITS) : 'No alarm'
    v.ALARM_ACTIVE = f.alarmReason ? 1 : 0
  }
  if ('warningReason' in f) v.WARNING_REASON_TEXT = f.warningReason ? flags(f.warningReason, ALARM_BITS) : 'No warning'
  if ('offReason' in f) v.OFF_REASON_TEXT = f.offReason ? flags(f.offReason, OFF_REASON_BITS) : ''
  if ('activeAcIn' in f) v.ACTIVE_AC_IN_TEXT = AC_IN[f.activeAcIn]
  if (kind === 've_bus' && 'alarm' in f) { v.ALARM_TEXT = ALARM_NOTIFICATION[f.alarm] || ''; v.ALARM_ACTIVE = f.alarm ? 1 : 0 }
  if ('outputState' in f) v.OUTPUT_STATE_TEXT = OUTPUT_STATE[f.outputState] ?? `Unknown (${f.outputState})`
  if ('balancerStatus' in f) v.BALANCER_TEXT = BALANCER[f.balancerStatus] || 'Unknown'
  return v
}

// ── Display catalogue: what LSH registers per device kind ───────────────────
// TYPE → [label, unit, precision]
const SENSORS = {
  STATE_OF_CHARGE: ['State of charge', '%', 1], BATTERY_VOLTAGE: ['Battery voltage', 'V', 2],
  BATTERY_CURRENT: ['Battery current', 'A', 2], BATTERY_POWER: ['Battery power', 'W', 0],
  CONSUMED_AH: ['Consumed', 'Ah', 1], TIME_TO_GO: ['Time to go', 'min', 0],
  AUX_VOLTAGE: ['Starter voltage', 'V', 2], MID_VOLTAGE: ['Mid-point voltage', 'V', 2], TEMPERATURE: ['Temperature', '°C', 1],
  PV_POWER: ['PV power', 'W', 0], YIELD_TODAY: ['Yield today', 'kWh', 2],
  LOAD_CURRENT: ['Load current', 'A', 1], LOAD_POWER: ['Load power', 'W', 0],
  AC_APPARENT_POWER: ['AC apparent power', 'VA', 0], AC_VOLTAGE: ['AC voltage', 'V', 1], AC_CURRENT: ['AC current', 'A', 1],
  AC_OUT_POWER: ['AC out power', 'W', 0], ACTIVE_AC_IN_POWER: ['AC in power', 'W', 0],
  INPUT_VOLTAGE: ['Input voltage', 'V', 2], OUTPUT_VOLTAGE: ['Output voltage', 'V', 2],
  INPUT_CURRENT: ['Input current', 'A', 1], OUTPUT_CURRENT: ['Output current', 'A', 1],
  INPUT_POWER: ['Input power', 'W', 0], OUTPUT_POWER: ['Output power', 'W', 0],
  BATTERY_VOLTAGE_2: ['Output 2 voltage', 'V', 2], BATTERY_CURRENT_2: ['Output 2 current', 'A', 1],
  BATTERY_VOLTAGE_3: ['Output 3 voltage', 'V', 2], BATTERY_CURRENT_3: ['Output 3 current', 'A', 1],
  CELL1: ['Cell 1', 'V', 2], CELL2: ['Cell 2', 'V', 2], CELL3: ['Cell 3', 'V', 2], CELL4: ['Cell 4', 'V', 2],
  CELL5: ['Cell 5', 'V', 2], CELL6: ['Cell 6', 'V', 2], CELL7: ['Cell 7', 'V', 2], CELL8: ['Cell 8', 'V', 2],
}
const TEXTS = {
  DEVICE_STATE_TEXT: 'State', CHARGER_ERROR_TEXT: 'Error', ERROR_CODE_TEXT: 'Error', ALARM_REASON_TEXT: 'Alarm',
  WARNING_REASON_TEXT: 'Warning', OFF_REASON_TEXT: 'Off reason', ACTIVE_AC_IN_TEXT: 'Active AC input',
  ALARM_TEXT: 'Alarm', OUTPUT_STATE_TEXT: 'Output', BALANCER_TEXT: 'Balancer',
}

const KINDS = {
  solar_charger: { label: 'Solar charger', icon: '☀️' },
  battery_monitor: { label: 'Battery monitor', icon: '🔋' },
  inverter: { label: 'Inverter', icon: '🔌' },
  dcdc_converter: { label: 'DC/DC converter', icon: '🔁' },
  smart_lithium: { label: 'Smart Lithium', icon: '🔋' },
  inverter_rs: { label: 'Inverter RS', icon: '🔌' },
  ac_charger: { label: 'AC charger', icon: '🔌' },
  smart_battery_protect: { label: 'Smart BatteryProtect', icon: '🛡️' },
  lynx_bms: { label: 'Lynx Smart BMS', icon: '🔋' },
  multi_rs: { label: 'Multi RS', icon: '⚡' },
  ve_bus: { label: 'VE.Bus', icon: '⚡' },
  dc_energy_meter: { label: 'DC energy meter', icon: '📟' },
  orion_xs: { label: 'Orion XS', icon: '🔁' },
}

// LSH sensor descriptors for a decoded advertisement's value set — only the
// values this device actually reports (aux depends on the shunt's setup).
function sensorsFor(values) {
  const out = []
  for (const [type, [label, unit, precision]] of Object.entries(SENSORS)) {
    if (type in values) out.push({ path: type.toLowerCase(), name: label, label, type: 'number', unit, precision, ...(type === 'STATE_OF_CHARGE' ? { homekit: 'battery' } : {}) })
  }
  for (const [type, label] of Object.entries(TEXTS)) {
    if (type in values) out.push({ path: type.toLowerCase(), name: label, label, type: 'label' })
  }
  if ('ALARM_ACTIVE' in values) out.push({ path: 'alarm_active', name: 'Alarm active', label: 'Alarm active', type: 'boolean' })
  return out
}

const normalizeMac = (m) => String(m || '').trim().toUpperCase().replace(/-/g, ':')

module.exports = {
  VICTRON_MANUFACTURER_ID, RECORDS, KINDS, SENSORS, TEXTS,
  parseAdvertisement, decrypt, readFields, toValues, sensorsFor, normalizeMac,
}
