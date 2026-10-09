'use strict';

const WebSocket        = require('ws');
const platformStatus   = require('./platform-status');

/**
 * Z-Wave JS client — connects to a Z-Wave JS Server instance (the WebSocket
 * JSON-RPC server bundled with Z-Wave JS UI / zwave-js-server), NOT the
 * Z-Way/RaZberry REST API that `zway-client.js` already covers. Distinct
 * backend software, distinct protocol — see that file for the other one.
 *
 * On connect the server replies to `start_listening` with a full snapshot
 * of every node and its current values, so discovery needs no per-node
 * polling. After that, `event`/`value updated` pushes keep the store live.
 */

const RECONNECT_MS = 5000;

// Z-Wave CommandClass ids we understand → how to turn a value into an LSH
// sensor descriptor. Anything else falls back to a generic read-only sensor
// (same "don't drop it, just don't specialise it" behaviour as Domatiq's
// catch-all raw sensor).
const CC = {
  SWITCH_BINARY:     37,
  SWITCH_MULTILEVEL: 38,
  SENSOR_BINARY:     48,
  METER:             50,
  SENSOR_MULTILEVEL: 49,
  THERMOSTAT_SETPOINT: 67,
  DOOR_LOCK:         98,
  BATTERY:           128,
  NOTIFICATION:      113,
};

// SENSOR_MULTILEVEL's numeric `property` (the Z-Wave "sensor type" scale
// index) → unit/name/homekit-bridge. Uncommon ones fall through to a plain
// number sensor with whatever unit the server reports.
const MULTILEVEL_KIND = {
  1:  { name: 'Temperature', unit: '°C', homekit: 'temperature' },
  3:  { name: 'Illuminance', unit: 'lux' },
  4:  { name: 'Power',       unit: 'W' },
  5:  { name: 'Humidity',    unit: '%' },
  27: { name: 'Ultraviolet', unit: 'UV' },
};

class ZwaveJsClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._ws       = null;
    this._timer    = null;
    this._msgId    = 0;
    this._pending  = new Map(); // messageId → {resolve, reject}
    this._nodes    = new Map(); // nodeId → { key, valueMap: Map(valueKey → path) }
    this.homeId    = null;
    this.connected = false;
    // Inclusion / exclusion in progress (wiring emulator → Pair & save)
    this.pairing   = { phase: 'idle' };
  }

  async start() {
    const cfg = this._config.zwaveJs;
    if (!cfg?.host) return;
    console.log(`[Z-Wave JS] Starting — ${cfg.host}:${cfg.port || 3000}`);
    platformStatus.set('zwaveJs', false);
    this._connect();
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
    this._ws?.removeAllListeners();
    this._ws?.close();
    this._ws = null;
  }

  // ── Connection ──────────────────────────────────────────────────────────

  _connect() {
    const cfg = this._config.zwaveJs;
    const url = `ws://${cfg.host}:${cfg.port || 3000}`;
    const ws  = new WebSocket(url);
    this._ws  = ws;

    ws.on('open', () => console.log(`[Z-Wave JS] Connected — ${url}`));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      this._onMessage(msg).catch((err) => console.error(`[Z-Wave JS] Message error: ${err.message}`));
    });

    ws.on('error', (err) => console.error(`[Z-Wave JS] Socket error: ${err.message}`));

    ws.on('close', () => {
      platformStatus.set('zwaveJs', false);
      this.connected = false;
      if (!['idle', 'done', 'excluded', 'failed'].includes(this.pairing.phase)) this.pairing = { ...this.pairing, phase: 'failed', error: 'Connection to Z-Wave JS closed' };
      for (const { reject } of this._pending.values()) reject(new Error('Connection closed'));
      this._pending.clear();
      if (this._ws === ws) this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._connect(), RECONNECT_MS);
  }

  async _onMessage(msg) {
    // The very first push after connecting is a `{type:"version", ...}`
    // handshake — kick off discovery once we see it.
    if (msg.type === 'version') {
      // Inclusion options need API schema ≥ 8; ask for the newest we know of
      if (msg.maxSchemaVersion >= 8) await this._call('set_api_schema', { schemaVersion: Math.min(msg.maxSchemaVersion, 35) }).catch(() => {});
      if (msg.homeId) this.homeId = msg.homeId;
      await this._call('start_listening').then((res) => this._onSnapshot(res?.state));
      return;
    }
    if (msg.type === 'result') {
      const waiter = this._pending.get(msg.messageId);
      if (!waiter) return;
      this._pending.delete(msg.messageId);
      if (msg.success) waiter.resolve(msg.result);
      else waiter.reject(new Error(msg.errorCode || 'Z-Wave JS command failed'));
      return;
    }
    if (msg.type === 'event' && msg.event?.source === 'node') {
      this._onNodeEvent(msg.event);
      if (msg.event.event === 'interview completed') this._onInterviewed(msg.event.nodeId);
    }
    if (msg.type === 'event' && msg.event?.source === 'controller') this._onControllerEvent(msg.event);
  }

  _call(command, args = {}) {
    const messageId = `lsh-${++this._msgId}`;
    return new Promise((resolve, reject) => {
      this._pending.set(messageId, { resolve, reject });
      this._ws.send(JSON.stringify({ command, messageId, ...args }));
    });
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  _onSnapshot(state) {
    if (state?.controller?.homeId) this.homeId = state.controller.homeId;
    this.connected = true;
    const nodes = state?.nodes || [];
    for (const node of nodes) this._registerNode(node);
    platformStatus.set('zwaveJs', true);
    console.log(`[Z-Wave JS] Discovered ${nodes.length} node(s)`);
  }

  _registerNode(node) {
    if (node.isControllerNode) return; // the stick itself, not a device
    const values = node.values || [];
    const sensors = [];
    const valueMap = new Map(); // "commandClass-endpoint-property" → sensor path

    for (const v of values) {
      const desc = this._sensorDescriptor(node, v);
      if (!desc) continue;
      sensors.push(desc.sensor);
      valueMap.set(valueKey(v), desc.sensor.path);
      if (desc.value !== undefined) this._store.update(`zwaveJs/node_${node.nodeId}/${desc.sensor.path}`, desc.value);
    }
    if (!sensors.length) return;

    const key = `zwaveJs/node_${node.nodeId}`;
    this._nodes.set(node.nodeId, { key, valueMap });

    const homekit = sensors.some((s) => s.homekit === 'temperature') ? ['temperature'] : [];
    this._registry.registerDevice({
      key,
      label: node.name || node.deviceConfig?.description || `Node ${node.nodeId}`,
      type: 'zwaveJs',
      homekit,
      sensors,
      _writeCapability: (capId, command, args = []) => this._command(node.nodeId, capId, command, args),
    });
  }

  _sensorDescriptor(node, v) {
    const propName = v.propertyName || v.property;
    const path = sanitize(`${ccName(v.commandClass)}_${v.endpoint || 0}_${propName}`);
    const name = v.metadata?.label || String(propName);
    const value = v.value;
    const capabilityId = valueKey(v);

    switch (v.commandClass) {
      case CC.SWITCH_BINARY:
        if (v.property !== 'currentValue' && v.property !== 'targetValue') return null;
        if (v.property === 'targetValue') return null; // report currentValue only, write via targetValue
        return { sensor: { path, name, type: 'boolean', format: 'on-off', controllable: true,
          capabilityId: valueKey({ ...v, property: 'targetValue' }), writeOn: true, writeOff: false },
          value: !!value };

      case CC.SWITCH_MULTILEVEL:
        if (v.property !== 'currentValue') return null;
        return { sensor: { path, name, type: 'range', controllable: true,
          capabilityId: valueKey({ ...v, property: 'targetValue' }), writeCmd: 'exact',
          min: v.metadata?.min ?? 0, max: v.metadata?.max ?? 99 },
          value: typeof value === 'number' ? value : 0 };

      case CC.SENSOR_BINARY:
        return { sensor: { path, name, type: 'boolean', format: 'on-off' }, value: !!value };

      case CC.SENSOR_MULTILEVEL: {
        const kind = MULTILEVEL_KIND[v.property] || {};
        return { sensor: { path, name: kind.name || name, type: 'number',
          unit: kind.unit || v.metadata?.unit || '', precision: 1,
          ...(kind.homekit ? { homekit: kind.homekit } : {}) },
          value: typeof value === 'number' ? value : null };
      }

      case CC.METER:
        return { sensor: { path, name, type: 'number', unit: v.metadata?.unit || 'kWh', precision: 2 },
          value: typeof value === 'number' ? value : null };

      case CC.THERMOSTAT_SETPOINT:
        if (v.property !== 'setpoint') return null;
        return { sensor: { path, name: name || 'Setpoint', type: 'range', unit: '°C', controllable: true,
          capabilityId, writeCmd: 'exact', min: v.metadata?.min ?? 5, max: v.metadata?.max ?? 40 },
          value: typeof value === 'number' ? value : null };

      case CC.DOOR_LOCK:
        if (v.property !== 'currentMode') return null;
        return { sensor: { path, name: 'Lock', type: 'boolean', format: 'on-off', controllable: true,
          capabilityId: valueKey({ ...v, property: 'targetMode' }), writeOn: 255 /* Secured */, writeOff: 0 /* Unsecured */ },
          value: value === 255 };

      case CC.BATTERY:
        if (v.property !== 'level') return null;
        return { sensor: { path, name: 'Battery', type: 'number', unit: '%', precision: 0 },
          value: typeof value === 'number' ? value : null };

      case CC.NOTIFICATION:
        return { sensor: { path, name, type: 'number', precision: 0 },
          value: typeof value === 'number' ? value : null };

      default:
        if (typeof value !== 'number' && typeof value !== 'boolean') return null;
        return { sensor: { path, name, type: typeof value === 'boolean' ? 'boolean' : 'number',
          ...(typeof value === 'boolean' ? { format: 'on-off' } : { unit: v.metadata?.unit || '', precision: 1 }) },
          value };
    }
  }

  // ── Inclusion / exclusion ───────────────────────────────────────────────
  // Used by the wiring emulator's "Pair & save". secure: S2/S0 as the device
  // supports (zwave-js "Default" strategy) — S2 asks for the 5-digit PIN from
  // the device's DSK label, which comes in through submitPin().

  async startInclusion({ secure = true } = {}) {
    if (!this.connected) throw new Error('Z-Wave JS is not connected');
    this.pairing = { phase: 'including', secure, startedAt: Date.now() };
    const ok = await this._call('controller.begin_inclusion', { options: { strategy: secure ? 0 : 2 } });
    if (ok === false || ok?.success === false) { this.pairing = { phase: 'failed', error: 'The controller refused to start inclusion (busy?)' }; }
    return this.pairing;
  }

  async startExclusion() {
    if (!this.connected) throw new Error('Z-Wave JS is not connected');
    this.pairing = { phase: 'excluding', startedAt: Date.now() };
    await this._call('controller.begin_exclusion');
    return this.pairing;
  }

  async stopPairing() {
    const phase = this.pairing.phase;
    if (phase === 'including' || phase === 'grant' || phase === 'dsk') await this._call('controller.stop_inclusion').catch(() => {});
    if (phase === 'excluding') await this._call('controller.stop_exclusion').catch(() => {});
    this.pairing = { phase: 'idle' };
    return this.pairing;
  }

  async submitPin(pin) {
    if (this.pairing.phase !== 'dsk') throw new Error('No PIN is being asked for');
    if (!/^\d{5}$/.test(String(pin))) throw new Error('The PIN is the first 5 digits of the DSK on the device label');
    this.pairing = { ...this.pairing, phase: 'including' };
    await this._call('controller.validate_dsk_and_enter_pin', { pin: String(pin) });
    return this.pairing;
  }

  getPairing() {
    return { ...this.pairing, homeId: this.homeId };
  }

  _onControllerEvent(evt) {
    const e = evt.event;
    if (e === 'grant security classes') {
      // Grant what the device asks for (it only asks for what it supports)
      const req = evt.requested || {};
      this.pairing = { ...this.pairing, phase: 'grant', requested: req.securityClasses };
      this._call('controller.grant_security_classes', { inclusionGrant: { securityClasses: req.securityClasses || [], clientSideAuth: false } })
        .then(() => { if (this.pairing.phase === 'grant') this.pairing = { ...this.pairing, phase: 'including' } })
        .catch((err) => { this.pairing = { ...this.pairing, phase: 'failed', error: err.message } });
    } else if (e === 'validate dsk and enter pin') {
      this.pairing = { ...this.pairing, phase: 'dsk', dsk: evt.dsk };
    } else if (e === 'node added') {
      const n = evt.node || {};
      this.pairing = { ...this.pairing, phase: 'interviewing', node: nodeInfo(n), lowSecurity: !!evt.result?.lowSecurity };
      console.log(`[Z-Wave JS] Node ${n.nodeId} added — interviewing`);
    } else if (e === 'inclusion failed') {
      this.pairing = { ...this.pairing, phase: 'failed', error: 'Inclusion failed — reset the device (or exclude it first) and try again' };
    } else if (e === 'inclusion stopped' || e === 'inclusion aborted') {
      if (this.pairing.phase === 'including' || this.pairing.phase === 'grant' || this.pairing.phase === 'dsk') this.pairing = { ...this.pairing, phase: 'failed', error: 'Inclusion stopped before a device joined' };
    } else if (e === 'node removed') {
      const n = evt.node || {};
      if (this.pairing.phase === 'excluding') this.pairing = { phase: 'excluded', node: nodeInfo(n) };
      this._nodes.delete(n.nodeId);
    } else if (e === 'exclusion failed') {
      this.pairing = { phase: 'failed', error: 'Exclusion failed' };
    } else if (e === 'exclusion stopped') {
      if (this.pairing.phase === 'excluding') this.pairing = { phase: 'failed', error: 'Exclusion stopped before a device left' };
    }
  }

  // Once the interview is done the node knows its values — register it
  async _onInterviewed(nodeId) {
    let node = null;
    try { node = await this._call('node.get_state', { nodeId }) } catch {}
    node = node?.state || node
    if (node?.nodeId) {
      this._registerNode(node);
      if (this.pairing.node?.nodeId === nodeId) this.pairing = { ...this.pairing, phase: 'done', node: nodeInfo(node), deviceKey: `zwaveJs/node_${nodeId}` };
    } else if (this.pairing.node?.nodeId === nodeId) {
      this.pairing = { ...this.pairing, phase: 'done', deviceKey: `zwaveJs/node_${nodeId}` };
    }
  }

  _onNodeEvent(evt) {
    if (evt.event !== 'value updated' && evt.event !== 'value notification') return;
    const node = this._nodes.get(evt.nodeId);
    if (!node) return;
    const args = evt.args || {};
    const path = node.valueMap.get(valueKey(args));
    if (!path) return;

    let value = args.newValue ?? args.value;
    if (args.commandClass === CC.SWITCH_BINARY) value = !!value;
    if (args.commandClass === CC.DOOR_LOCK && args.property === 'currentMode') value = value === 255;
    if (typeof value !== 'number' && typeof value !== 'boolean') return;

    this._store.update(`${node.key}/${path}`, value);
  }

  // ── Commands ────────────────────────────────────────────────────────────

  async _command(nodeId, capabilityId, command, args) {
    // sendCommand()'s two call shapes (sensor-registry.js): range/setpoint
    // sensors go through writeCmd='exact' with the value in args[0]; boolean
    // toggle sensors (switch/lock) pass writeOn/writeOff directly as
    // `command` with no args at all.
    const value = command === 'exact' ? args[0] : command;
    const [commandClass, endpoint, property] = capabilityId.split('|');

    await this._call('node.set_value', {
      nodeId,
      valueId: { commandClass: Number(commandClass), endpoint: Number(endpoint), property },
      value,
    });
  }
}

// What identifies a node for real: its id in this network plus what it reports
function nodeInfo(n) {
  const hex = (v, w = 4) => (v == null ? null : `0x${Number(v).toString(16).padStart(w, '0')}`);
  return {
    nodeId: n.nodeId,
    manufacturerId: hex(n.manufacturerId), productType: hex(n.productType), productId: hex(n.productId),
    manufacturer: n.deviceConfig?.manufacturer || null, label: n.deviceConfig?.label || n.label || null,
    description: n.deviceConfig?.description || null, firmware: n.firmwareVersion || null,
    security: n.highestSecurityClass ?? null, dsk: n.dsk || null,
  };
}

function valueKey(v) {
  return `${v.commandClass}|${v.endpoint || 0}|${v.property}`;
}

function ccName(commandClass) {
  const entry = Object.entries(CC).find(([, id]) => id === commandClass);
  return entry ? entry[0].toLowerCase() : `cc${commandClass}`;
}

function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = ZwaveJsClient;
