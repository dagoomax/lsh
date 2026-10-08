'use strict';

// Modbus device emulator (src/modbus-emulator.js) — settings with live
// reload, status, templates and the store-key list for register sources.
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

const TABLES = ['holding', 'input', 'coil', 'discrete'];
const TYPES = ['u16', 'i16', 'u32', 'i32', 'f32', 'string', 'bool'];
const WIDTH = { u16: 1, i16: 1, bool: 1, u32: 2, i32: 2, f32: 2 };

function validate(body) {
  const errors = [];
  const ids = new Set();
  const devices = (Array.isArray(body.devices) ? body.devices : []).map((d, i) => {
    const name = String(d.name || `Device ${i + 1}`).trim();
    const where = `"${name}"`;
    let id = String(d.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `dev${i + 1}`;
    while (ids.has(id)) id += '-2';
    ids.add(id);
    const transport = d.transport === 'rtu' ? 'rtu' : 'tcp';
    const unitId = Number(d.unitId ?? 1);
    if (!(unitId >= 1 && unitId <= 247)) errors.push(`${where}: unit ID must be 1–247`);
    const out = { id, name, enabled: d.enabled !== false, transport, unitId, strict: !!d.strict, template: d.template || 'generic' };
    if (transport === 'tcp') {
      out.port = Number(d.port) || 1502;
      out.bindHost = String(d.bindHost || '0.0.0.0').trim();
      if (!(out.port >= 1 && out.port <= 65535)) errors.push(`${where}: port must be 1–65535`);
    } else {
      out.serialPort = String(d.serialPort || '').trim();
      out.baud = Number(d.baud) || 9600;
      out.parity = ['none', 'even', 'odd'].includes(d.parity) ? d.parity : 'none';
      if (!/^\/dev\/[\w./:+-]+$/.test(out.serialPort)) errors.push(`${where}: pick a serial port`);
    }
    const used = { holding: new Map(), input: new Map(), coil: new Map(), discrete: new Map() };
    out.registers = (Array.isArray(d.registers) ? d.registers : []).map((r, j) => {
      const reg = {
        table: TABLES.includes(r.table) ? r.table : 'holding',
        address: Number(r.address),
        type: TYPES.includes(r.type) ? r.type : 'u16',
        label: String(r.label || '').trim(),
      };
      if (['coil', 'discrete'].includes(reg.table)) reg.type = 'bool';
      if (reg.type === 'string') reg.length = Math.max(1, Math.min(64, Number(r.length) || 8));
      if (WIDTH[reg.type] === 2) reg.wordOrder = r.wordOrder === 'le' ? 'le' : 'be';
      const scale = Number(r.scale);
      if (scale && scale !== 1) reg.scale = scale;
      if (r.source) reg.source = String(r.source).trim();
      else if (r.value !== undefined && r.value !== '') reg.value = reg.type === 'string' ? String(r.value) : reg.type === 'bool' ? !!r.value && r.value !== 'false' && r.value !== '0' : Number(r.value);
      if (r.writable && reg.table !== 'input' && reg.table !== 'discrete') {
        reg.writable = true;
        if (r.command) reg.command = String(r.command).trim();
      }
      if (!(Number.isInteger(reg.address) && reg.address >= 0 && reg.address <= 65535)) errors.push(`${where} row ${j + 1}: address must be 0–65535`);
      const width = reg.type === 'string' ? reg.length : (WIDTH[reg.type] || 1);
      for (let a = reg.address; a < reg.address + width; a++) {
        if (used[reg.table].has(a)) errors.push(`${where}: ${reg.table} register ${a} is used by rows ${used[reg.table].get(a)} and ${j + 1}`);
        used[reg.table].set(a, j + 1);
      }
      if (reg.command && !/^.+\/[^/]+$/.test(reg.command)) errors.push(`${where} row ${j + 1}: write target must be <device key>/<sensor>`);
      return reg;
    });
    return out;
  });
  // Two TCP devices on one port would collide
  const ports = new Map();
  for (const d of devices.filter((x) => x.transport === 'tcp' && x.enabled)) {
    if (ports.has(d.port)) errors.push(`"${d.name}" and "${ports.get(d.port)}" both use port ${d.port}`);
    ports.set(d.port, d.name);
  }
  return { cfg: { enabled: !!body.enabled, devices }, errors };
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store, sensorRegistry } = ctx;

  router.get('/modbus-emu/status', requireAdmin, (req, res) => {
    res.json({ success: true, data: clients.modbusEmu ? clients.modbusEmu.getStatus() : [] });
  });

  router.get('/modbus-emu/templates', requireAdmin, (req, res) => {
    let T;
    try { T = require('../modbus-emulator').TEMPLATES } catch { return res.status(409).json({ success: false, needsModule: true, error: 'The modbus-emulator module is not installed' }) }
    res.json({ success: true, data: T });
  });

  // Store keys usable as register sources, with their current values
  router.get('/modbus-emu/sources', requireAdmin, (req, res) => {
    const out = [];
    for (const d of sensorRegistry ? sensorRegistry.getAllReadings() : []) {
      for (const [path, r] of Object.entries(d.readings || {})) {
        if (typeof r.value === 'number' || typeof r.value === 'boolean') out.push({ key: `${d.key}/${path}`, label: `${d.label} · ${r.label || path}`, value: r.value, unit: r.unit || '', controllable: !!r.controllable });
      }
    }
    res.json({ success: true, data: out });
  });

  router.get('/settings/modbus-emu', requireAdmin, (req, res) => {
    res.json({ success: true, data: readConfigFile().modbusEmu || { enabled: false, devices: [] } });
  });

  router.post('/settings/modbus-emu', requireAdmin, async (req, res) => {
    const { cfg, errors } = validate(req.body || {});
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' · ') });
    try {
      writeConfigFile({ ...readConfigFile(), modbusEmu: cfg });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }) }
    // Apply live — no LSH restart needed
    try {
      if (!clients.modbusEmu && cfg.enabled) {
        let Emu;
        try { Emu = require('../modbus-emulator') } catch {
          return res.json({ success: true, message: 'Saved. Install the modbus-emulator module (Settings → Integration Modules) to start it.' });
        }
        clients.modbusEmu = new Emu({ modbusEmu: cfg }, store, sensorRegistry);
        await clients.modbusEmu.start();
      } else if (clients.modbusEmu) {
        await clients.modbusEmu.reload(cfg);
      }
      const st = clients.modbusEmu ? clients.modbusEmu.getStatus() : [];
      const failed = st.filter((s) => s.error);
      res.json({ success: true, message: !cfg.enabled ? 'Saved — emulator stopped.' : failed.length ? `Saved, but ${failed.map((f) => `${f.name}: ${f.error}`).join(' · ')}` : `Saved — ${st.length} device(s) running.` });
    } catch (err) {
      res.json({ success: true, message: `Saved, but starting failed: ${err.message}` });
    }
  });
};
module.exports.validate = validate;
