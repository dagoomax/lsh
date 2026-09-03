'use strict';

// Generic OCPP 1.6-J Central System — unlike every other client in this repo,
// charge points dial *into* LSH rather than LSH polling them, so this is a
// listener (same shape as the Grenton GATE HTTP listener), not a poller.
// Implements the OCPP 1.6 core profile subset needed for a home charger:
// BootNotification/Heartbeat/StatusNotification/MeterValues/Authorize/
// StartTransaction/StopTransaction inbound, and RemoteStartTransaction/
// RemoteStopTransaction/SetChargingProfile outbound. Any charger that speaks
// standard OCPP 1.6-J should work, regardless of brand.
//
// Point your charger's Central System URL at ws://<lsh-host>:<port>/ocpp/<id>
// (the <id> segment becomes the device key `ocpp/<id>` — use the charger's
// serial number or any short slug).

const WebSocket       = require('ws');
const platformStatus  = require('./platform-status');

const CALL        = 2;
const CALL_RESULT = 3;
const CALL_ERROR  = 4;

const CALL_TIMEOUT_MS = 10000;

// StatusNotification.status → our normalized status sensor value.
const STATUS_MAP = {
  Available: 'available', Preparing: 'connected', Charging: 'charging',
  SuspendedEV: 'connected', SuspendedEVSE: 'connected', Finishing: 'complete',
  Reserved: 'connected', Unavailable: 'error', Faulted: 'error',
};

class OcppServer {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._chargers = new Map(); // chargePointId → { ws, deviceKey, pending: Map, transactionId, callSeq }
  }

  async start() {
    const cfg = this._config.ocpp;
    if (!cfg?.enabled) return;

    const port = cfg.port || 9000;
    this._wss = new WebSocket.Server({
      port,
      handleProtocols: (protocols) => (protocols.includes('ocpp1.6') ? 'ocpp1.6' : false),
    });

    this._wss.on('connection', (ws, req) => this._onConnection(ws, req));
    this._wss.on('error', (err) => console.error(`[OCPP] Server error: ${err.message}`));

    await new Promise((resolve) => this._wss.once('listening', resolve));
    console.log(`[OCPP] Central System listening on ws://0.0.0.0:${port}/ocpp/<chargePointId>`);
    platformStatus.set('ocpp', true);
  }

  stop() {
    if (this._wss) this._wss.close();
  }

  // ── Connection lifecycle ───────────────────────────────────────────────

  _onConnection(ws, req) {
    const path = (req.url || '').split('?')[0];
    const chargePointId = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
    if (!chargePointId) { ws.close(1008, 'Missing charge point id in URL'); return; }

    const conn = this._chargers.get(chargePointId) || {
      deviceKey: `ocpp/${chargePointId}`, pending: new Map(), callSeq: 0, transactionId: null,
    };
    conn.ws = ws;
    this._chargers.set(chargePointId, conn);

    console.log(`[OCPP] Charge point connected: ${chargePointId}`);

    ws.on('message', (raw) => this._onMessage(chargePointId, conn, raw));
    ws.on('close', () => console.log(`[OCPP] Charge point disconnected: ${chargePointId}`));
    ws.on('error', (err) => console.error(`[OCPP] Connection error (${chargePointId}): ${err.message}`));
  }

  _onMessage(chargePointId, conn, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!Array.isArray(msg)) return;

    const [type] = msg;
    if (type === CALL) {
      const [, uniqueId, action, payload] = msg;
      this._handleCall(chargePointId, conn, uniqueId, action, payload || {});
    } else if (type === CALL_RESULT || type === CALL_ERROR) {
      const [, uniqueId, payloadOrError] = msg;
      const p = conn.pending.get(uniqueId);
      if (!p) return;
      conn.pending.delete(uniqueId);
      if (type === CALL_RESULT) p.resolve(payloadOrError);
      else p.reject(new Error(`OCPP CallError from ${chargePointId}: ${msg.slice(2).join(' ')}`));
    }
  }

  // ── Inbound Calls (charge point → us) ────────────────────────────────

  _handleCall(chargePointId, conn, uniqueId, action, payload) {
    const deviceKey = conn.deviceKey;

    switch (action) {
      case 'BootNotification':
        this._ensureDevice(chargePointId, conn, payload);
        this._reply(conn, uniqueId, { status: 'Accepted', currentTime: new Date().toISOString(), interval: 300 });
        break;

      case 'Heartbeat':
        this._reply(conn, uniqueId, { currentTime: new Date().toISOString() });
        break;

      case 'StatusNotification': {
        this._ensureDevice(chargePointId, conn);
        const status = STATUS_MAP[payload.status] || 'unknown';
        this._store.set(`${deviceKey}/status`, status);
        this._store.set(`${deviceKey}/charging`, status === 'charging');
        this._reply(conn, uniqueId, {});
        break;
      }

      case 'MeterValues': {
        this._ensureDevice(chargePointId, conn);
        for (const mv of payload.meterValue || []) {
          for (const sv of mv.sampledValue || []) {
            const value = Number(sv.value);
            if (!Number.isFinite(value)) continue;
            if (sv.measurand === 'Power.Active.Import') {
              const watts = sv.unit === 'kW' ? value * 1000 : value;
              this._store.set(`${deviceKey}/power`, watts);
            } else if (sv.measurand === 'Energy.Active.Import.Register' || sv.measurand == null) {
              const kwh = sv.unit === 'Wh' ? value / 1000 : value;
              this._store.set(`${deviceKey}/energy`, kwh);
            }
          }
        }
        this._reply(conn, uniqueId, {});
        break;
      }

      case 'Authorize':
        this._reply(conn, uniqueId, { idTagInfo: { status: 'Accepted' } });
        break;

      case 'StartTransaction': {
        this._ensureDevice(chargePointId, conn);
        conn.transactionId = Math.floor(Date.now() / 1000) % 1000000;
        this._store.set(`${deviceKey}/charging`, true);
        this._store.set(`${deviceKey}/status`, 'charging');
        this._reply(conn, uniqueId, { transactionId: conn.transactionId, idTagInfo: { status: 'Accepted' } });
        break;
      }

      case 'StopTransaction': {
        this._ensureDevice(chargePointId, conn);
        if (payload.meterStop != null) this._store.set(`${deviceKey}/energy`, Number(payload.meterStop) / 1000);
        this._store.set(`${deviceKey}/charging`, false);
        this._store.set(`${deviceKey}/status`, 'complete');
        this._reply(conn, uniqueId, { idTagInfo: { status: 'Accepted' } });
        break;
      }

      default:
        this._replyError(conn, uniqueId, 'NotSupported', `Action ${action} not implemented`);
    }
  }

  // Registers the device on first contact (Boot/Status/whichever call arrives first).
  _ensureDevice(chargePointId, conn, bootPayload) {
    if (this._registry.getDevices().some((d) => d.key === conn.deviceKey)) return;

    const label = bootPayload
      ? [bootPayload.chargePointVendor, bootPayload.chargePointModel].filter(Boolean).join(' ') || chargePointId
      : chargePointId;

    const device = {
      key:      conn.deviceKey,
      label:    label || `OCPP ${chargePointId}`,
      type:     'ocpp',
      category: 'ev-charger',
      sensors: [
        { path: 'power',  label: 'Power',  sensorType: 'power',  unit: 'W' },
        { path: 'energy', label: 'Energy', sensorType: 'energy', unit: 'kWh' },
        { path: 'status', label: 'Status', sensorType: 'sensor' },
        {
          path: 'charging', label: 'Charging', sensorType: 'switch', format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: 'on', writeOff: 'off',
          capabilityId: 'charging', homekit: 'switch-rw',
        },
        {
          path: 'currentLimit', label: 'Charge current', sensorType: 'dimmer', unit: 'A',
          controllable: true, type: 'range',
          writeCmd: 'setCurrent', capabilityId: 'currentLimit',
          min: 6, max: 32, rangeFormat: 'raw',
        },
      ],
      homekit: ['switch-rw'],
      _writeCapability: async (capId, command, args = []) =>
        this._send(chargePointId, capId, command, args),
    };

    this._registry.registerDevice(device);
    console.log(`[OCPP] Registered ${device.label} (${conn.deviceKey})`);
  }

  // ── Outbound Calls (us → charge point) ───────────────────────────────

  async _send(chargePointId, capId, command, args) {
    const conn = this._chargers.get(chargePointId);
    if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Charge point ${chargePointId} is not connected`);
    }

    if (capId === 'charging') {
      if (command === 'on') {
        await this._call(conn, 'RemoteStartTransaction', { connectorId: 1, idTag: 'LSH' });
      } else {
        if (conn.transactionId == null) return; // nothing to stop
        await this._call(conn, 'RemoteStopTransaction', { transactionId: conn.transactionId });
      }
    } else if (capId === 'currentLimit') {
      const amp = Math.round(Number(args[0]));
      await this._call(conn, 'SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: {
          chargingProfileId: 1,
          stackLevel: 0,
          chargingProfilePurpose: 'TxDefaultProfile',
          chargingProfileKind: 'Absolute',
          chargingSchedule: {
            chargingRateUnit: 'A',
            chargingSchedulePeriod: [{ startPeriod: 0, limit: amp }],
          },
        },
      });
    }
  }

  _call(conn, action, payload) {
    const uniqueId = String(++conn.callSeq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(uniqueId);
        reject(new Error(`OCPP call ${action} timed out`));
      }, CALL_TIMEOUT_MS);
      conn.pending.set(uniqueId, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
      conn.ws.send(JSON.stringify([CALL, uniqueId, action, payload]));
    });
  }

  _reply(conn, uniqueId, payload) {
    conn.ws.send(JSON.stringify([CALL_RESULT, uniqueId, payload]));
  }

  _replyError(conn, uniqueId, code, description) {
    conn.ws.send(JSON.stringify([CALL_ERROR, uniqueId, code, description, {}]));
  }
}

module.exports = OcppServer;
