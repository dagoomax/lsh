const mqtt           = require('mqtt');
const EventEmitter   = require('events');
const platformStatus = require('./platform-status');

// Map entity type → sensor descriptor fields
const TYPE_META = {
  switch:      { sensorType: 'boolean', controllable: true,  homekitType: 'switch-rw' },
  light:       { sensorType: 'boolean', controllable: true,  homekitType: 'light-rw'  },
  temperature: { sensorType: 'float',   controllable: false, homekitType: 'temperature', unit: '°C' },
  humidity:    { sensorType: 'float',   controllable: false, homekitType: 'humidity',    unit: '%'  },
  number:      { sensorType: 'float',   controllable: false, homekitType: null           },
  boolean:     { sensorType: 'boolean', controllable: false, homekitType: null           },
};

function parsePayload(raw, entity) {
  const str = raw.toString().trim();
  const on  = entity.payloadOn  || 'ON';
  const off = entity.payloadOff || 'OFF';
  const type = entity.type || 'number';

  if (type === 'switch' || type === 'light' || type === 'boolean') {
    if (str === on)  return true;
    if (str === off) return false;
    return str === '1' || str.toLowerCase() === 'true';
  }
  const num = parseFloat(str);
  return isNaN(num) ? str : num;
}

class SmartBobClient extends EventEmitter {
  constructor(config, store, sensorRegistry) {
    super();
    this._cfg      = config.smartbob;
    this._reg      = sensorRegistry;
    this._client   = null;
    this._topicMap = new Map(); // stateTopic → entity
  }

  start() {
    const cfg      = this._cfg;
    const entities = cfg.entities || [];
    if (!entities.length) {
      console.warn('[SmartBob] No entities configured');
      return;
    }

    const host = cfg.host || 'localhost';
    const port = cfg.port || 1883;
    const url  = `mqtt://${host}:${port}`;

    const connOpts = {
      clientId:        `lsh-smartbob-${process.pid}`,
      connectTimeout:  10000,
      reconnectPeriod: 5000,
    };
    if (cfg.username) { connOpts.username = cfg.username; connOpts.password = cfg.password || ''; }

    console.log(`[SmartBob] Connecting to ${url}`);
    this._client = mqtt.connect(url, connOpts);

    this._client.on('connect', () => {
      console.log('[SmartBob] Connected');
      platformStatus.set('smartbob', true);
      this._registerDevice(entities);
      entities.forEach(e => {
        if (e.stateTopic) {
          this._topicMap.set(e.stateTopic, e);
          this._client.subscribe(e.stateTopic, err => {
            if (err) console.error(`[SmartBob] Subscribe ${e.stateTopic} failed: ${err.message}`);
          });
        }
      });
    });

    this._client.on('message', (topic, payload) => {
      const entity = this._topicMap.get(topic);
      if (!entity) return;
      const value = parsePayload(payload, entity);
      this._reg.update('smartbob/' + (cfg.name || host), { [entity.stateTopic]: value });
    });

    this._client.on('error',   err => console.error(`[SmartBob] ${err.message}`));
    this._client.on('offline', ()  => { console.warn('[SmartBob] Offline'); platformStatus.set('smartbob', false); });
    this._client.on('reconnect', () => console.log('[SmartBob] Reconnecting…'));
  }

  _registerDevice(entities) {
    const cfg     = this._cfg;
    const host    = cfg.host || 'localhost';
    const devKey  = 'smartbob/' + (cfg.name || host);

    const sensors = entities.map(e => {
      const meta = TYPE_META[e.type] || TYPE_META.number;
      return {
        path:         e.stateTopic,
        name:         e.name || e.stateTopic,
        type:         meta.sensorType,
        unit:         e.unit || meta.unit,
        controllable: !!(e.commandTopic),
        homekitType:  e.homekitType || meta.homekitType || null,
      };
    });

    this._reg.register({
      key:    devKey,
      label:  cfg.name || 'SmartBob',
      icon:   'smartbob',
      color:  '#2d7fc1',
      sensors,
      sendCommand: (stateTopic, value) => {
        const entity = (cfg.entities || []).find(e => e.stateTopic === stateTopic);
        if (!entity?.commandTopic || !this._client) return;
        const on  = entity.payloadOn  || 'ON';
        const off = entity.payloadOff || 'OFF';
        let payload;
        if (entity.type === 'switch' || entity.type === 'light' || entity.type === 'boolean') {
          payload = value ? on : off;
        } else {
          payload = String(value);
        }
        this._client.publish(entity.commandTopic, payload, { retain: false });
      },
    });
  }
}

module.exports = SmartBobClient;
