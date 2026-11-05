#!/usr/bin/env node
'use strict';

// =============================================================================
//  DEMO: Grenton vCLU  ⟷  LSH  ⟷  Klima (Tuya)   — all local, no hardware
//
//  Chain exercised end to end:
//    [vCLU] --HTTP--> LSH REST route (src/routes/devices.js)
//                       --> SensorRegistry.sendCommand
//                       --> TuyaClient._write
//                       --> fake Tuya cloud (scripts/tuya-simulator.js)
//                       --> device state changes, mirror read reflects it
//
//  The "Grenton vCLU" is emulated by makeCluCalls() below: it makes exactly the
//  HTTP calls the real CLU Lua (HttpRequest object) makes — POST .../command to
//  control, GET .../devices/<key> to mirror. Run:   node scripts/grenton-vclu-demo.js
// =============================================================================

const express = require('express');
const { startSimulator } = require('./tuya-simulator');
const TuyaClient = require('../src/tuya-client');
const SensorRegistry = require('../src/sensor-registry');
const registerDevicesRoute = require('../src/routes/devices');

const KEY = 'tuya/bf0sim0klima';

// Minimal store: what SensorRegistry.getDeviceReadings and TuyaClient need.
function makeStore() {
  const m = new Map(), ts = new Map();
  return {
    get: (k) => m.get(k),
    getTimestamp: (k) => ts.get(k) || null,
    set(k, v) { m.set(k, v); ts.set(k, Date.now()); },
    update(k, v) { m.set(k, v); ts.set(k, Date.now()); },
    on() {}, emit() {},
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) fake Tuya cloud with our klima (+ the simulator's other demo devices)
  const sim = await startSimulator({ port: 0 });
  console.log(`Tuya cloud (sim) on ${sim.url}`);

  // 2) real LSH spine: store + registry + Tuya client pointed at the sim
  const store = makeStore();
  const registry = new SensorRegistry(store, 'pl');
  const config = { tuya: {
    accessId: 'sim-id', accessSecret: 'sim-secret', uid: 'eu1700000000sim',
    mode: 'cloud', baseUrl: sim.url, pollInterval: 5,
  } };
  const tuya = new TuyaClient(config, store, registry);
  await tuya.start();
  await sleep(300); // let the cloud refresh + registration settle

  const dev = registry.getDeviceReadings(KEY);
  if (!dev) { console.error('Klima did not register — aborting'); process.exit(1); }
  console.log(`\nLSH registered "${dev.label}" as ${KEY} (kind: ${dev.kind || 'n/a'})`);
  console.log('Controllable sensors:',
    dev.sensors.filter((s) => s.controllable).map((s) => `${s.path}${s.range ? ' ' + JSON.stringify(s.range) : ''}`).join(', '));

  // 3) real LSH REST route on a throwaway HTTP server (requireAdmin stubbed open)
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerDevicesRoute(router, { requireAdmin: (req, res, next) => next(), sensorRegistry: registry });
  app.use('/api', router);
  const srv = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  console.log(`LSH REST on ${base}\n`);

  // 4) the "Grenton vCLU" — exactly the HTTP the CLU Lua (HttpRequest) issues
  const control = async (sensor, value) => {
    const r = await fetch(`${base}/api/device/${KEY}/command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer <LSH_TOKEN>' },
      body: JSON.stringify({ sensor, value }),
    });
    const j = await r.json();
    console.log(`[vCLU] POST command ${sensor}=${JSON.stringify(value)} -> ${r.status} ${JSON.stringify(j)}`);
    return j;
  };
  const mirror = async () => {
    const r = await fetch(`${base}/api/devices/${KEY}`, { headers: { Authorization: 'Bearer <LSH_TOKEN>' } });
    const d = (await r.json()).data.readings;
    const g = (p) => d[p] && d[p].value;
    console.log(`[vCLU] mirror: power=${g('switch')} set=${g('heatingSetpoint')}°C cur=${g('temperature')}°C mode=${g('thermostatMode')}`);
  };

  console.log('--- stan początkowy (mirror) ---'); await mirror();
  console.log('\n--- vCLU steruje klimą ---');
  await control('switch', true);              await sleep(150);
  await control('heatingSetpoint', 23);       await sleep(150);
  await control('thermostatMode', 'hot');     await sleep(150);
  await control('thermostatMode', 'frost');   // zły tryb -> walidacja zakresu
  await sleep(150);
  console.log('\n--- stan po sterowaniu (mirror) ---'); await mirror();

  console.log('\n--- sprawdzenie w symulatorze (DP klimy) ---');
  console.log(JSON.stringify(sim.state['bf0sim0klima']));

  srv.close(); await sim.close(); process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
