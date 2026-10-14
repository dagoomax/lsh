'use strict';

// Anker SOLIX — official local Modbus TCP (the protocol Anker's own Home
// Assistant integration uses, github.com/anker-charging/ha-anker-solix-official,
// MIT). Turn it on in the Anker app: device → Settings → Three-Party Control
// Settings → Modbus TCP (note the IP shown there). Port 502, unit id 1.
//
// Register maps: src/anker-solix-maps.json, converted from that integration's
// YAML configs — Solarbank Max / Max AC, Solarbank 4 E5000 Pro, XE / XE AC,
// Smart Meter Gen 2, Smart Plug Gen 2. The model is recognised from the
// product code inside the serial number (characters 4–6 or 4–7).
//
// One LSH device per unit, `anker/<sn>`, its sensors built from the map:
// battery SOC, PV / load / grid import & export / AC output power, battery
// charging & discharging (one signed register split in two), lifetime
// energy, status; meter phases; plug power and switch. Controls: operating
// mode (0 self-consumption, 1 time-of-use, 3 third-party control, 4 custom,
// 5 socket overlay, 6 smart, 7 dynamic pricing), battery power setpoint
// (signed: negative charges, positive discharges — only acts in mode 3),
// charge / discharge-limit / backup-reserve SOC, plug on/off.
//
// config.ankerSolix = { devices: [{ host, port = 502, unitId = 1, name? }], pollInterval = 10 }
// Tested against scripts/anker-solix-simulator.js (test/anker-solix.test.js) —
// not yet against a real unit.

const PollingClient = require('./polling-client');
const MAPS = require('./anker-solix-maps.json');
const ModbusTcp = require('./modbus-tcp');

const TIMEOUT_MS = 5000;
const MAX_REGS = 120;
const SKIP = new Set(['device_model', 'device_sn', 'device_sw_version', 'meter_model', 'meter_sn', 'meter_sw_version', 'hardware_version', 'firmware_version', 'ems_mode_mask', 'parallel_capability_mask', 'meter_type']);
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const label = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/\bsoc\b/gi, 'SOC').replace(/\bpv\b/gi, 'PV').replace(/\bac\b/gi, 'AC');

// ── Decoding ────────────────────────────────────────────────────────────────
function decode(r, regs) {
  const t = r.data_type;
  if (t === 'STRING') return Buffer.from(regs.flatMap((w) => [w >> 8, w & 0xff])).toString('utf8').replace(/\0/g, '').trim();
  if (t === 'VERSION') return regs.map((w) => `${w >> 8}.${w & 0xff}`).join('.');
  let v;
  if (t === 'UINT16') v = regs[0];
  else if (t === 'INT16') v = regs[0] >= 0x8000 ? regs[0] - 0x10000 : regs[0];
  else if (t === 'UINT32') v = regs[0] * 0x10000 + regs[1];
  else if (t === 'INT32') { v = regs[0] * 0x10000 + regs[1]; if (v >= 0x80000000) v -= 0x100000000 }
  else return null;
  const g = Number(r.gain) || 1;
  v = g === 1 ? v : Math.round((v / g) * 1000) / 1000;
  if (r.power_split_mode === 'positive_only') v = v > 0 ? v : 0;
  if (r.power_split_mode === 'negative_only') v = v < 0 ? -v : 0;
  if (r.value_mapping) return r.value_mapping[String(v)] ?? String(v);
  return v;
}

const regType = (tpl, address) => (tpl.holding.some(([a, b]) => address >= a && address <= b) ? 3 : 4);

// Product code from the serial number: 16 chars → 4–6, 17 chars → 4–7
function productCode(sn) {
  const s = String(sn || '').trim();
  return s.length === 16 ? s.slice(3, 6) : s.length === 17 ? s.slice(3, 7) : null;
}

function templateFor(sn) {
  const code = productCode(sn);
  for (const t of MAPS.templates) if (code && t.codes[code]) return { tpl: t, model: t.codes[code] };
  return null;
}

// LSH sensors + write handlers for a template
function buildDevice(tpl) {
  const sensors = [];
  for (const [k, r] of Object.entries(tpl.reads)) {
    if (SKIP.has(k) || tpl.writes[k]) continue;
    if (r.value_mapping) sensors.push({ path: camel(k), label: label(k), type: 'label' });
    else sensors.push({ path: camel(k), label: label(k), format: 'number', ...(r.unit && r.unit !== '/' ? { unit: r.unit } : {}), ...(k === 'battery_soc' ? { homekit: 'battery-level' } : {}) });
  }
  const w = tpl.writes;
  if (w.operating_mode) {
    const opts = Object.entries(w.operating_mode.options).map(([n, s]) => `${n} ${s.replace(/_/g, ' ')}`).join(', ');
    sensors.push({ path: 'operatingMode', label: 'Operating mode', controllable: true, type: 'range', min: 0, max: 7, step: 1, writeCmd: 'set', capabilityId: 'operating_mode', hint: opts });
  }
  if (w.battery_power_setpoint) {
    const max = Number(w.battery_power_setpoint.max_value) || 10000;
    sensors.push({ path: 'batteryPowerSetpoint', label: 'Battery power setpoint (− charge, + discharge)', unit: 'W', controllable: true, type: 'range', min: -max, max, step: 10, writeCmd: 'set', capabilityId: 'battery_power_setpoint', hint: 'acts in operating mode 3 (third-party control)' });
  }
  for (const k of ['charging_limit_soc', 'discharge_limit_soc', 'backup_reserve_soc']) {
    if (w[k]) sensors.push({ path: camel(k), label: label(k), unit: '%', controllable: true, type: 'range', min: w[k].min_value ?? 0, max: w[k].max_value ?? 100, step: 1, writeCmd: 'set', capabilityId: k });
  }
  if (w.power_switch) sensors.push({ path: 'switch', label: 'Power', format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'power_switch', homekit: 'switch-rw' });
  return sensors;
}

class AnkerSolixClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'ankerSolix', logTag: 'Anker SOLIX' });
    this.cfg = config.ankerSolix || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.units = []; // { host, mb, tpl, sn, key, setpoint }
  }

  async start() {
    const devs = Array.isArray(this.cfg.devices) ? this.cfg.devices.filter((d) => d?.host) : [];
    if (!devs.length) throw new Error('config.ankerSolix.devices needs at least one { host }');
    this.units = devs.map((d) => {
      const [h, p] = String(d.host).split(':');
      return { conf: d, host: h, mb: new ModbusTcp({ host: h, port: Number(d.port || p) || 502, unitId: Number(d.unitId ?? 1), timeout: TIMEOUT_MS }), tpl: null };
    });
    await this.startPolling(Math.max(3, Number(this.cfg.pollInterval) || 10) * 1000);
  }

  stop() { super.stop(); for (const u of this.units) u.mb.close() }

  // Which map fits: read the serial number registers each template uses
  async _identify(u) {
    const tried = new Set();
    for (const t of MAPS.templates) {
      const r = t.reads[t.snKey];
      const sig = `${r.address}/${r.count}`;
      if (tried.has(sig)) continue;
      tried.add(sig);
      let sn;
      try { sn = decode(r, await u.mb.readRegs(regType(t, r.address), r.address, r.count)) } catch { continue }
      if (!sn) continue;
      const hit = templateFor(sn);
      if (hit) return { ...hit, sn };
    }
    throw new Error(`${u.host}: not a supported Anker SOLIX device (or Modbus TCP is off in the Anker app)`);
  }

  async _pollImpl() {
    let ok = 0; const errs = [];
    for (const u of this.units) {
      try { await this._pollUnit(u); ok++ } catch (err) { errs.push(err.message); u.mb.close() }
    }
    if (!ok) throw new Error(errs.join('; '));
    if (errs.length) console.warn(`[Anker SOLIX] ${errs.join('; ')}`);
  }

  async _pollUnit(u) {
    if (!u.tpl) {
      const id = await this._identify(u);
      u.tpl = id.tpl; u.sn = id.sn.replace(/[^A-Za-z0-9_-]/g, ''); u.key = `anker/${u.sn}`;
      this.registry.registerDevice({
        key: u.key, label: u.conf.name || id.model, type: 'ankerSolix', icon: id.tpl.writes.power_switch ? '🔌' : id.tpl.reads.battery_soc ? '🔋' : '⚡',
        homekit: id.tpl.reads.battery_soc ? ['battery-level'] : id.tpl.writes.power_switch ? ['switch-rw'] : [],
        ankerModel: id.model, sensors: buildDevice(id.tpl),
        _writeCapability: (cap, cmd, args) => this.write(u, cap, cmd, args),
      });
      console.log(`[Anker SOLIX] ${u.host}: ${id.model} (${u.sn})`);
    }
    // Batch reads, then decode every mapped value
    const regs = new Map();
    for (const [fc, list] of [[4, u.tpl.input], [3, u.tpl.holding]]) {
      for (const [a, b] of list) {
        for (let s = a; s <= b; s += MAX_REGS) {
          const n = Math.min(MAX_REGS, b - s + 1);
          try { (await u.mb.readRegs(fc, s, n)).forEach((v, i) => regs.set(s + i, v)) }
          catch (err) { if (typeof err.code !== 'number') throw err } // Modbus exception = range not implemented on this firmware
        }
      }
    }
    const val = (r) => { const w = []; for (let i = 0; i < (r.count || 1); i++) { if (!regs.has(r.address + i)) return null; w.push(regs.get(r.address + i)) } return decode(r, w) };
    for (const [k, r] of Object.entries(u.tpl.reads)) {
      if (SKIP.has(k)) continue;
      const v = val(r);
      if (v !== null && v !== undefined) this.store.update(`${u.key}/${camel(k)}`, v);
    }
    const w = u.tpl.writes;
    for (const k of ['operating_mode', 'charging_limit_soc', 'discharge_limit_soc', 'backup_reserve_soc']) {
      if (w[k] && regs.has(w[k].address)) this.store.update(`${u.key}/${camel(k)}`, regs.get(w[k].address));
    }
    if (w.power_switch) { const s = u.tpl.reads[w.power_switch.read_entity_key]; const v = s && val({ ...s, value_mapping: undefined }); if (v !== null) this.store.update(`${u.key}/switch`, v ? 1 : 0) }
    // Anker's map marks the setpoint never_read_device (reads don't reflect it) — then only what LSH last
    // wrote is known, so nothing is published after a restart rather than a made-up 0
    const sp = w.battery_power_setpoint;
    if (sp) {
      const v = sp.never_read_device ? u.setpoint : val({ address: sp.address, count: 2, data_type: 'INT32' });
      if (v !== null && v !== undefined) this.store.update(`${u.key}/batteryPowerSetpoint`, v);
    }
  }

  async write(u, cap, cmd, args = []) {
    const w = u.tpl?.writes || {};
    if (cap === 'power_switch') {
      await u.mb.writeReg(w.power_switch.address, cmd === 'on' ? 1 : 0);
      this.store.update(`${u.key}/switch`, cmd === 'on' ? 1 : 0);
    } else if (cap === 'operating_mode') {
      const v = Math.round(Number(args[0]));
      if (!(String(v) in w.operating_mode.options)) throw new Error(`Anker: operating mode must be one of ${Object.keys(w.operating_mode.options).join(', ')}`);
      await u.mb.writeReg(w.operating_mode.address, v);
      this.store.update(`${u.key}/operatingMode`, v);
    } else if (cap === 'battery_power_setpoint') {
      const max = Number(w.battery_power_setpoint.max_value) || 10000;
      const v = Math.round(Number(args[0]));
      if (!Number.isFinite(v) || Math.abs(v) > max) throw new Error(`Anker: setpoint must be within ±${max} W`);
      const raw = v < 0 ? v + 0x100000000 : v;
      await u.mb.writeRegs(w.battery_power_setpoint.address, [(raw >>> 16) & 0xffff, raw & 0xffff]);
      u.setpoint = v;
      this.store.update(`${u.key}/batteryPowerSetpoint`, v);
    } else if (w[cap] && w[cap].min_value !== undefined) {
      const v = Math.round(Number(args[0]));
      if (!Number.isFinite(v) || v < w[cap].min_value || v > w[cap].max_value) throw new Error(`Anker: ${cap} must be ${w[cap].min_value}–${w[cap].max_value}`);
      await u.mb.writeReg(w[cap].address, v);
      this.store.update(`${u.key}/${camel(cap)}`, v);
    } else throw new Error(`Anker: ${u.key} has no control ${cap}`);
  }
}

module.exports = AnkerSolixClient;
module.exports.decode = decode;
module.exports.productCode = productCode;
module.exports.ModbusTcp = ModbusTcp;
