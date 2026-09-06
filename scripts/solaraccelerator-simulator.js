#!/usr/bin/env node
'use strict';

// Fake Solar Accelerator Connect gateway (Deye-family hybrid inverter) — for
// developing/demoing src/solaraccelerator-client.js without real hardware.
// Implements the real gateway's HTTP API (/api/status, /api/inverter/readings,
// /api/modbus/write) closely enough for the actual client to discover, poll,
// and control it — same register map and bitfield semantics as control.py
// in https://github.com/aLAN-LDZ/solaraccelerator_connect_ha.
//
// Run: node scripts/solaraccelerator-simulator.js
// Then add it in Settings → Energy → Solar Accelerator (or directly in
// config.json): { "solaraccelerator": { "host": "localhost", "port": 8080 } }
//
// Env vars: SA_SIM_PORT (default 8080), SA_SIM_PASSWORD (optional — set to
//           test the portal-password path; unset means no auth, like a
//           gateway whose setup wizard was never given one).

const http = require('http');

const PORT     = Number(process.env.SA_SIM_PORT) || 8080;
const PASSWORD = process.env.SA_SIM_PASSWORD || null;

function log(...args) { console.log('[SolarAcceleratorSim]', ...args); }
function jitter(base, spreadPct = 0.06) { return base * (1 + (Math.random() - 0.5) * 2 * spreadPct); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ── Writable register map ───────────────────────────────────────────────
// 178 starts at the exact value control.py's own docstring cites as read off
// real hardware (seven bits set) — a real fixture, not a round guess, so a
// client bug that clobbers neighboring bits shows up immediately as those
// bits actually flipping in the simulator too, the same way it would on a
// real gateway.
const registers = {
  108: 100, 109: 100,           // max charge/discharge current (A)
  142: 0,                        // work_mode: 0 Selling First / 1 Zero Export To Load / 2 Zero Export To CT
  143: 0,                        // export_surplus_power limit (W)
  148: 600, 149: 1200, 150: 1800, 151: 2200, 152: 0, 153: 0,      // program times (HHMM)
  154: 3000, 155: 2000, 156: 0, 157: 0, 158: 0, 159: 0,           // program power (W)
  166: 90, 167: 60, 168: 30, 169: 0, 170: 0, 171: 0,              // program SOC (%)
  172: 1, 173: 0, 174: 0, 175: 0, 176: 0, 177: 0,                 // program charging (bitfield: bit0 Grid, bit1 Generator, bit5 Sell)
  178: 11052,                    // gen_config bitfield (bit4 = grid peak shaving) — real captured value
  191: 0,                        // grid_peak_shaving_power limit (W)
  340: 0,                        // pv_power limit (0 = unlimited)
};

// register -> readings key, mirroring control.py's CONTROLS list exactly.
const REGISTER_KEY = {
  108: 'set_max_charge_current', 109: 'set_max_discharge_current',
  142: 'set_work_mode', 143: 'set_export_surplus_power',
  178: 'set_gen_config', 191: 'set_grid_peak_shaving_power', 340: 'set_pv_power',
};
for (let n = 1; n <= 6; n++) {
  const i = n - 1;
  REGISTER_KEY[148 + i] = `set_program_time_${n}`;
  REGISTER_KEY[154 + i] = `set_program_power_${n}`;
  REGISTER_KEY[166 + i] = `set_program_soc_${n}`;
  REGISTER_KEY[172 + i] = `set_program_charging_${n}`;
}
const KEY_REGISTER = Object.fromEntries(Object.entries(REGISTER_KEY).map(([r, k]) => [k, Number(r)]));

// ── Simulated live inverter state ───────────────────────────────────────
// A simple but physically-consistent day/night cycle: PV follows a sine
// curve peaking at solar noon, battery charges off the surplus and
// discharges into the evening load, grid makes up whatever's left.
let batterySoc = 62;
let dayPvEnergy = 3.2, dayLoadEnergy = 2.1, dayGridImport = 0.6, dayGridExport = 0.9;
let totalPv = 4213.7, totalConsumption = 3890.2, totalBought = 1502.8, totalSold = 2004.1;
let totalCharge = 1876.4, totalDischarge = 1791.0;
const startedAt = Date.now();

function solarCurve() {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  if (hour < 6 || hour > 20) return 0;
  const x = ((hour - 6) / 14) * Math.PI; // 0..PI across daylight hours
  return Math.max(0, Math.sin(x));
}

function tick() {
  const sun = solarCurve();
  const pv1 = Math.round(jitter(sun * 3200));
  const pv2 = Math.round(jitter(sun * 2600));
  const pvTotal = pv1 + pv2;

  const load = Math.round(jitter(600 + (Math.random() < 0.08 ? 1400 : 0)));
  const surplus = pvTotal - load;

  // Battery: charge off surplus, discharge to cover a deficit — clamped and
  // slow-moving (a few tenths of a % per tick), not an instant jump.
  const socDelta = clamp(surplus / 8000, -0.4, 0.4);
  batterySoc = clamp(batterySoc + socDelta, 8, 100);
  const batteryPower = Math.round(clamp(-surplus, -3500, 3500)); // +charging, -discharging by this client's sign convention below

  const gridPower = Math.round(clamp(load - pvTotal - Math.max(0, -batteryPower), -6000, 6000));

  // Slowly accrue the energy counters so the Energy tab's history/lifetime
  // fields have something real to show, without needing a full day to pass.
  const hoursPerTick = 2 / 3600; // this tick fires every 2s
  dayPvEnergy += (pvTotal / 1000) * hoursPerTick;
  dayLoadEnergy += (load / 1000) * hoursPerTick;
  if (gridPower > 0) dayGridImport += (gridPower / 1000) * hoursPerTick; else dayGridExport += (-gridPower / 1000) * hoursPerTick;
  totalPv += (pvTotal / 1000) * hoursPerTick;
  totalConsumption += (load / 1000) * hoursPerTick;
  if (gridPower > 0) totalBought += (gridPower / 1000) * hoursPerTick; else totalSold += (-gridPower / 1000) * hoursPerTick;
  if (batteryPower > 0) totalCharge += (batteryPower / 1000) * hoursPerTick; else totalDischarge += (-batteryPower / 1000) * hoursPerTick;

  state.pv1 = pv1; state.pv2 = pv2;
  state.load = load;
  state.batteryPower = batteryPower;
  state.gridPower = gridPower;
}

const state = { pv1: 0, pv2: 0, load: 0, batteryPower: 0, gridPower: 0 };
setInterval(tick, 2000);
tick();

function readingsPayload() {
  const items = [
    { key: 'pv1_power', value: state.pv1 },
    { key: 'pv2_power', value: state.pv2 },
    { key: 'pv1_voltage', value: Math.round(jitter(370)) },
    { key: 'pv1_current', value: Math.round(jitter(state.pv1 / 3.7 || 0.1) * 10) / 10 },
    { key: 'pv2_voltage', value: Math.round(jitter(365)) },
    { key: 'pv2_current', value: Math.round(jitter(state.pv2 / 3.65 || 0.1) * 10) / 10 },

    { key: 'battery_soc', value: Math.round(batterySoc) },
    { key: 'battery_voltage', value: Math.round(jitter(51 + batterySoc / 40) * 10) / 10 },
    { key: 'battery_power', value: state.batteryPower },
    { key: 'battery_current', value: Math.round((state.batteryPower / 51) * 10) / 10 },
    { key: 'battery_temp', value: Math.round(jitter(26) * 10) / 10 },
    { key: 'battery_soh', value: 97 },

    { key: 'grid_l1_voltage', value: Math.round(jitter(231) * 10) / 10 },
    { key: 'grid_frequency', value: Math.round(jitter(50, 0.01) * 100) / 100 },
    { key: 'grid_power', value: state.gridPower },
    { key: 'grid_power_factor', value: 98 },

    { key: 'inverter_power', value: state.load },
    { key: 'output_frequency', value: 50 },
    { key: 'inverter_status', value: state.gridPower !== 0 ? 0x5 : 0x1 }, // Inverter-Grid vs Inverter-only
    { key: 'running_status', value: 2 }, // Normal

    { key: 'load_power', value: state.load },
    { key: 'radiator_temp', value: Math.round(jitter(34) * 10) / 10 },

    { key: 'day_pv_energy', value: Math.round(dayPvEnergy * 100) / 100 },
    { key: 'day_load_energy', value: Math.round(dayLoadEnergy * 100) / 100 },
    { key: 'day_grid_import', value: Math.round(dayGridImport * 100) / 100 },
    { key: 'day_grid_export', value: Math.round(dayGridExport * 100) / 100 },
    { key: 'total_pv_generation', value: Math.round(totalPv * 10) / 10 },
    { key: 'total_consumption', value: Math.round(totalConsumption * 10) / 10 },
    { key: 'total_energy_bought', value: Math.round(totalBought * 10) / 10 },
    { key: 'total_energy_sold', value: Math.round(totalSold * 10) / 10 },
    { key: 'total_battery_charge', value: Math.round(totalCharge * 10) / 10 },
    { key: 'total_battery_discharge', value: Math.round(totalDischarge * 10) / 10 },
  ];
  // Settings live in the same flat readings response on a real gateway too.
  for (const [key, reg] of Object.entries(KEY_REGISTER)) items.push({ key, value: registers[reg] });

  return { poll_interval_ms: 5000, items };
}

// ── Write handling ───────────────────────────────────────────────────────
// Real gateway shape: POST queues the write, GET polls for a verdict. Here
// it's applied instantly, but kept as two steps so the client's poll-until-
// done loop gets exercised the same way it would against real hardware.
let lastWrite = null;

function handleWrite(reg, value) {
  registers[reg] = value & 0xFFFF;
  lastWrite = { reg, value: registers[reg], state: 'done' };
  log(`register ${reg} (${REGISTER_KEY[reg] || '?'}) -> ${registers[reg]}`);
}

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function checkAuth(req) {
  if (!PASSWORD) return true;
  const header = req.headers.authorization || '';
  const expected = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64');
  return header === expected;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  if (!checkAuth(req)) { res.writeHead(401); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/status') {
    return sendJson(res, {
      mode: 'STA',
      firmware_version: '0.1.14',
      uptime_s: Math.floor((Date.now() - startedAt) / 1000),
      rssi: -52,
      modbus: { poll_interval_ms: 5000 },
    });
  }

  if (url.pathname === '/api/inverter/readings') return sendJson(res, readingsPayload());

  if (url.pathname === '/api/modbus/write') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const reg = Number(params.get('reg'));
      const value = Number(params.get('value'));
      if (!Number.isFinite(reg) || !Number.isFinite(value)) return sendJson(res, { error: 'bad reg/value' }, 400);
      handleWrite(reg, value);
      return sendJson(res, {});
    }
    if (req.method === 'GET') {
      if (!lastWrite) return sendJson(res, { state: 'error', error: 'no write in progress' });
      return sendJson(res, { state: 'done', read_back: lastWrite.value });
    }
  }

  if (url.pathname === '/api/ota/check') return sendJson(res, {});

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`[SolarAcceleratorSim] Port ${PORT} is already in use.`);
  else console.error(`[SolarAcceleratorSim] ${err.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  log(`Fake SA Connect gateway listening on http://localhost:${PORT}`);
  log(PASSWORD ? 'Portal password required (SA_SIM_PASSWORD set)' : 'No portal password');
  log(`Add to config.json: "solaraccelerator": { "host": "localhost", "port": ${PORT}${PASSWORD ? `, "password": "${PASSWORD}"` : ''} }`);
});
