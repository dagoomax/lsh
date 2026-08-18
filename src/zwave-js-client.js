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
    }
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
