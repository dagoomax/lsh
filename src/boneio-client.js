'use strict';

/**
 * BoneIO integration — discovers entities via Home Assistant MQTT auto-discovery
 * (homeassistant/<component>/boneio_<board>_<entity>/config, retained) and tracks
 * live state via boneIO/<board>/<type>/<id>/state topics.
 *
 * All entities belonging to the same board are grouped into a single dashboard device.
 * Registration is debounced 500 ms so sensors/relays accumulate before the device
 * is registered in the sensor registry.
 */

const mqtt           = require('mqtt');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

// Home Assistant device_class → HomeKit type
const DC_TO_HK = {
  motion:   'motion',
  door:     'contact',
  window:   'contact',
  opening:  'contact',
  smoke:    'smoke',
  moisture: 'leak',
  gas:      'co',
};

// Home Assistant device_class / unit → sensor format
function resolveFormat(component, deviceClass, unit) {
  if (component === 'switch') return { format: 'on-off', homekit: 'switch-rw' };
  if (component === 'binary_sensor') {
    return { format: 'on-off', homekit: DC_TO_HK[deviceClass] || null };
  }
  // sensor
  const u = (unit || '').toLowerCase();
  if (deviceClass === 'temperature' || u === '°c' || u === '°f') return { format: 'temperature', homekit: 'temperature' };
  if (deviceClass === 'humidity'    || (u === '%' && deviceClass === 'humidity')) return { format: 'percent', homekit: 'humidity' };
  if (deviceClass === 'illuminance')               return { format: 'number',  homekit: 'lux' };
  if (deviceClass === 'power')                     return { format: 'power',   homekit: null };
  if (deviceClass === 'energy')                    return { format: 'energy',  homekit: null };
  if (deviceClass === 'battery')                   return { format: 'percent', homekit: 'battery-level' };
  if (deviceClass === 'carbon_dioxide')            return { format: 'co2',     homekit: 'co2-sensor' };
  if (deviceClass === 'volatile_organic_compounds') return { format: 'voc',    homekit: 'air-quality' };
  if (deviceClass === 'pm25')                      return { format: 'pm25',    homekit: 'air-quality' };
  if (deviceClass === 'pm10')                      return { format: 'pm10',    homekit: 'air-quality' };
  if (deviceClass === 'aqi')                       return { format: 'aqi',     homekit: 'air-quality' };
  return { format: 'number', homekit: null };
}

class BoneIOClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this._cfg      = config;
    this.store     = store;
    this.registry  = sensorRegistry;
    this.client    = null;

    // boardId → { key, label, sensors[], homekit[], commands: Map<path→cmdTopic> }
    this._boards   = new Map();
    // stateTopic → { boardId, path, component, payload_on, payload_off }
    this._topicMap = new Map();
    // boardId → debounce timer handle
    this._timers   = new Map();
  }

  start() {
    const cfg  = this._cfg.boneio || {};
    const host = cfg.host || this._cfg.mqtt?.host || 'localhost';
    const port = cfg.port || this._cfg.mqtt?.port || 1883;
    const url  = `mqtt://${host}:${port}`;

    console.log(`[BoneIO] Connecting to ${url}`);
    this.client = mqtt.connect(url, {
      clientId:        `lsh-boneio-${process.pid}`,
      connectTimeout:  10000,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      platformStatus.set('boneio', true);
      console.log('[BoneIO] Connected — subscribing to discovery + state topics');
      // Retained discovery messages arrive immediately after subscribe
      this.client.subscribe('homeassistant/+/+/config', { qos: 0 });
      this.client.subscribe('boneIO/#',                  { qos: 0 });
    });

    this.client.on('message', (topic, payload) => this._onMessage(topic, payload));

    this.client.on('error',   err => console.error('[BoneIO] MQTT error:', err.message));
    this.client.on('offline', () => {
      platformStatus.set('boneio', false);
      console.log('[BoneIO] Offline');
    });
    this.client.on('close', () => platformStatus.set('boneio', false));
  }

  stop() {
    for (const t of this._timers.values()) clearTimeout(t);
    if (this.client) this.client.end(true);
    platformStatus.set('boneio', false);
  }

  // ── Message dispatch ─────────────────────────────────────────────────

  _onMessage(topic, payload) {
    if (topic.startsWith('homeassistant/') && topic.endsWith('/config')) {
      this._onDiscovery(topic, payload);
    } else if (topic.startsWith('boneIO/')) {
      this._onState(topic, payload);
    }
  }

  // ── HA MQTT discovery ────────────────────────────────────────────────

  _onDiscovery(topic, payload) {
    // homeassistant/<component>/<entity_id>/config
    const parts     = topic.split('/');
    const component = parts[1];
    const entityId  = parts[2];

    // Only BoneIO entities
    if (!entityId.toLowerCase().startsWith('boneio')) return;

    // Supported components
    if (!['switch', 'binary_sensor', 'sensor'].includes(component)) return;

    let cfg;
    try { cfg = JSON.parse(payload.toString()); }
    catch { return; }

    const stateTopic = cfg.state_topic;
    if (!stateTopic || !stateTopic.startsWith('boneIO/')) return;

    // boneIO/<board>/<type>/<name>/state
    const tp = stateTopic.split('/');
    const boardId    = tp[1];
    const entityType = tp[2];
    const entityName = tp[3];
    if (!boardId || !entityType || !entityName) return;

    const path = `${entityType}_${entityName}`;
    if (this._topicMap.has(stateTopic)) return; // already known

    const { device_class, unit_of_measurement, command_topic, payload_on = 'ON', payload_off = 'OFF' } = cfg;
    const { format, homekit } = resolveFormat(component, device_class, unit_of_measurement);

    const sensor = {
      path,
      name:   cfg.name || entityName,
      format,
      ...(homekit  ? { homekit }                             : {}),
      ...(unit_of_measurement ? { unit: unit_of_measurement } : {}),
      ...(command_topic ? {
        controllable: true,
        type:         'toggle',
        writeOn:      payload_on,
        writeOff:     payload_off,
        capabilityId: path,
      } : {}),
    };

    // Register in topic map for state updates
    this._topicMap.set(stateTopic, { boardId, path, component, payload_on, payload_off });

    // Accumulate per board
    if (!this._boards.has(boardId)) {
      const dev = cfg.device || {};
      this._boards.set(boardId, {
        key:      `boneio/${boardId}`,
        label:    dev.name || `BoneIO ${boardId}`,
        sensors:  [],
        homekit:  [],
        commands: new Map(),
      });
    }

    const board = this._boards.get(boardId);
    if (!board.sensors.find(s => s.path === path)) {
      board.sensors.push(sensor);
      if (homekit && !board.homekit.includes(homekit)) board.homekit.push(homekit);
      if (command_topic) board.commands.set(path, command_topic);
    }

    // Debounce registration — flush 500 ms after the last discovery for this board
    if (this._timers.has(boardId)) clearTimeout(this._timers.get(boardId));
    this._timers.set(boardId, setTimeout(() => {
      this._timers.delete(boardId);
      this._registerBoard(boardId);
    }, 500));
  }

  _registerBoard(boardId) {
    const board = this._boards.get(boardId);
    if (!board || this.registry.devices.has(board.key)) return;

    const commands = board.commands; // capture reference for closure
    const client   = this;

    const device = {
      key:      board.key,
      label:    board.label,
      type:     'boneio',
      icon:     '🦴',
      color:    'blue',
      sensors:  [...board.sensors],
      homekit:  [...board.homekit],
      _writeCapability: (capId, command) => {
        const topic = commands.get(capId);
        if (topic && client.client) client.client.publish(topic, command);
      },
    };

    this.registry.registerDevice(device);
    console.log(`[BoneIO] Board registered: ${board.label} — ${board.sensors.length} entit${board.sensors.length === 1 ? 'y' : 'ies'}`);
  }

  // ── State updates ────────────────────────────────────────────────────

  _onState(topic, payload) {
    // Board online/offline: boneIO/<board>/status
    if (topic.endsWith('/status')) {
      if (payload.toString().trim() === 'online') platformStatus.set('boneio', true);
      return;
    }

    const entry = this._topicMap.get(topic);
    if (!entry) return;

    const { boardId, path, component, payload_on, payload_off } = entry;
    const raw = payload.toString().trim();
    let value;

    if (component === 'sensor') {
      // BoneIO sends either a plain number or JSON object: { "temp": 21.5 }
      try {
        const parsed = JSON.parse(raw);
        value = typeof parsed === 'number'
          ? parsed
          : Object.values(parsed).find(v => typeof v === 'number');
      } catch {
        value = parseFloat(raw);
      }
      if (value == null || isNaN(value)) return;
    } else {
      if      (raw === payload_on)  value = 1;
      else if (raw === payload_off) value = 0;
      else return;
    }

    this.store.update(`boneio/${boardId}/${path}`, value);
  }
}

module.exports = BoneIOClient;
