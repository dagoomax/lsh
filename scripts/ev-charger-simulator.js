#!/usr/bin/env node
'use strict';

// Fake OCPP 1.6-J charge point — "Mercedes-EQ G 580" (electric G-Wagen) home
// wallbox — for developing/demoing src/ocpp-server.js without real hardware.
// Connects to LSH's OCPP Central System and reports a realistic-looking
// charging session on a loop; also honors RemoteStartTransaction /
// RemoteStopTransaction / SetChargingProfile sent from the dashboard.
//
// Run: node scripts/ev-charger-simulator.js
// Requires config.ocpp.enabled = true in LSH's config.json first.
// Env vars: OCPP_URL (default ws://localhost:9000/ocpp/gwagen),
//           EV_SIM_TARGET_KWH (default 20 — energy per simulated session).

const WebSocket = require('ws');

const OCPP_URL   = process.env.OCPP_URL || 'ws://localhost:9000/ocpp/gwagen';
const TARGET_KWH = Number(process.env.EV_SIM_TARGET_KWH) || 20;

// AC onboard charger (3-phase ~16A). Power is a realistic instantaneous
// figure; wall-clock is compressed via TIME_SCALE so a full session is
// watchable (~45s) instead of the ~2h it'd realistically take — power and
// energy stay physically consistent with each other, just on a fast clock.
const POWER_KW_BASE = 11;
const TICK_MS        = 2000;
const TIME_SCALE     = 150; // 1 tick (2s real) ≈ 5 min simulated
const IDLE_MS         = 8000;
const PREPARING_MS    = 3000;
const FINISHING_MS    = 6000;

let seq = 0;
let ws = null;
let state = 'idle'; // idle → preparing → charging → finishing → (loop)
let sessionEnergyKWh = 0;
let sessionTargetKWh = TARGET_KWH;
let ampLimit = null; // set via SetChargingProfile, caps POWER_KW_BASE
let tickTimer = null;
let phaseTimer = null;

function log(...args) { console.log(`[EV-Sim]`, ...args); }

function currentPowerKW() {
  if (state !== 'charging') return 0;
  const progress = sessionTargetKWh > 0 ? sessionEnergyKWh / sessionTargetKWh : 0;
  let kw = POWER_KW_BASE;
  if (progress > 0.85) kw = POWER_KW_BASE * (1 - (progress - 0.85) / 0.15 * 0.75); // taper to ~25%
  kw += (Math.random() - 0.5) * 0.4; // jitter
  if (ampLimit != null) kw = Math.min(kw, (ampLimit * 230) / 1000);
  return Math.max(0.1, kw);
}

// ── OCPP-J framing ──────────────────────────────────────────────────────

function call(action, payload) {
  return new Promise((resolve) => {
    const id = String(++seq);
    const handler = (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg[1] === id && msg[0] !== 2) { ws.off('message', handler); resolve(msg[2]); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify([2, id, action, payload]));
  });
}

function reply(uniqueId, payload) { ws.send(JSON.stringify([3, uniqueId, payload])); }

function onCentralSystemCall(uniqueId, action, payload) {
  log(`← ${action} from LSH`, payload);
  switch (action) {
    case 'RemoteStartTransaction':
      reply(uniqueId, { status: 'Accepted' });
      if (state === 'idle') { clearTimeout(phaseTimer); startPreparing(); }
      break;
    case 'RemoteStopTransaction':
      reply(uniqueId, { status: 'Accepted' });
      if (state === 'charging') { clearTimeout(phaseTimer); startFinishing(); }
      break;
    case 'SetChargingProfile': {
      const period = payload?.csChargingProfiles?.chargingSchedule?.chargingSchedulePeriod?.[0];
      if (period?.limit != null) ampLimit = Number(period.limit);
      reply(uniqueId, { status: 'Accepted' });
      break;
    }
    default:
      reply(uniqueId, {});
  }
}

// ── Session state machine ────────────────────────────────────────────────

function startIdle() {
  state = 'idle';
  log('Available — waiting to plug in');
  call('StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' });
  phaseTimer = setTimeout(startPreparing, IDLE_MS);
}

function startPreparing() {
  state = 'preparing';
  log('Preparing — car plugged in');
  call('StatusNotification', { connectorId: 1, status: 'Preparing', errorCode: 'NoError' });
  phaseTimer = setTimeout(startCharging, PREPARING_MS);
}

async function startCharging() {
  state = 'charging';
  sessionEnergyKWh = 0;
  sessionTargetKWh = TARGET_KWH * (0.75 + Math.random() * 0.5); // vary each session
  ampLimit = null;
  log(`Charging — target ${sessionTargetKWh.toFixed(1)} kWh`);
  await call('Authorize', { idTag: 'GWAGEN' });
  const res = await call('StartTransaction', {
    connectorId: 1, idTag: 'GWAGEN', meterStart: 0, timestamp: new Date().toISOString(),
  });
  const transactionId = res?.transactionId ?? Math.floor(Math.random() * 100000);
  await call('StatusNotification', { connectorId: 1, status: 'Charging', errorCode: 'NoError' });
  tick(transactionId);
}

function tick(transactionId) {
  if (state !== 'charging') return;
  const kw = currentPowerKW();
  sessionEnergyKWh += kw * (TIME_SCALE / 3600) * (TICK_MS / 1000);

  call('MeterValues', {
    connectorId: 1, transactionId,
    meterValue: [{
      timestamp: new Date().toISOString(),
      sampledValue: [
        { value: (kw * 1000).toFixed(0), measurand: 'Power.Active.Import', unit: 'W' },
        { value: sessionEnergyKWh.toFixed(3), measurand: 'Energy.Active.Import.Register', unit: 'kWh' },
      ],
    }],
  });
  log(`Charging — ${kw.toFixed(2)} kW, ${sessionEnergyKWh.toFixed(2)} / ${sessionTargetKWh.toFixed(1)} kWh`);

  if (sessionEnergyKWh >= sessionTargetKWh) {
    startFinishing(transactionId);
    return;
  }
  phaseTimer = setTimeout(() => tick(transactionId), TICK_MS);
}

async function startFinishing(transactionId) {
  state = 'finishing';
  log('Finishing — session complete');
  await call('StopTransaction', {
    transactionId: transactionId ?? 0, meterStop: Math.round(sessionEnergyKWh * 1000),
    timestamp: new Date().toISOString(), reason: 'Local',
  });
  await call('StatusNotification', { connectorId: 1, status: 'Finishing', errorCode: 'NoError' });
  phaseTimer = setTimeout(startIdle, FINISHING_MS);
}

// ── Connection lifecycle ─────────────────────────────────────────────────

function connect() {
  log(`Connecting to ${OCPP_URL} ...`);
  ws = new WebSocket(OCPP_URL, ['ocpp1.6']);

  ws.on('open', async () => {
    log('Connected');
    const boot = await call('BootNotification', {
      chargePointVendor: 'Mercedes-EQ', chargePointModel: 'G 580 (car simulator)',
      firmwareVersion: '1.0.0-sim',
    });
    log('BootNotification →', boot);
    startIdle();
    heartbeat();
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg[0] === 2) onCentralSystemCall(msg[1], msg[2], msg[3] || {});
  });

  ws.on('close', () => {
    log('Disconnected — reconnecting in 5s');
    clearTimeout(phaseTimer); clearTimeout(tickTimer);
    setTimeout(connect, 5000);
  });
  ws.on('error', (err) => log('Connection error:', err.message));
}

function heartbeat() {
  tickTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) call('Heartbeat', {});
  }, 60000);
}

connect();
