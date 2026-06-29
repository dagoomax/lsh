'use strict';

const mqtt           = require('mqtt');
const platformStatus = require('./platform-status');

const MODE  = { 1: 'cool', 2: 'heat', 3: 'fan_only', 4: 'dry' };
const FAN   = { 1: 'high', 2: 'medium', 3: 'low', 4: 'auto' };

class MC6Client {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._client   = null;
    this._devices  = {}; // mac → deviceKey
  }

  async start() {
    const cfg = this._config.mc6;
    if (!cfg?.broker) throw new Error('mc6.broker is required');

    const devices = cfg.devices ?? [];
    if (!devices.length) throw new Error('No MC6 devices configured');

    await new Promise((resolve, reject) => {
      const url = `mqtt://${cfg.broker}:${cfg.port ?? 1883}`;
      console.log(`[MC6] Connecting to ${url}`);

      this._client = mqtt.connect(url, {
        username:       cfg.username || undefined,
        password:       cfg.password || undefined,
        connectTimeout: 10000,
        reconnectPeriod: 5000,
      });

      const timer = setTimeout(() => reject(new Error(`MC6 MQTT timeout — ${cfg.broker}`)), 15000);

      this._client.on('connect', () => {
        clearTimeout(timer);
        console.log('[MC6] MQTT connected');

        for (const dev of devices) {
          const mac        = dev.mac.toUpperCase().replace(/[^A-F0-9]/g, '');
          const deviceKey  = `mc6/${mac}`;
          const label      = dev.name || `MC6 ${mac.slice(-4)}`;

          this._devices[mac] = deviceKey;

          this._registry.registerDevice({
            key:   deviceKey,
            type:  'mc6',
            label,
            icon:  '🌡',
            color: 'orange',
            sensors: [
              { path: 'temperature', name: 'Temperature', unit: '°C', format: 'number', homekit: 'temperature' },
              { path: 'humidity',    name: 'Humidity',    unit: '%',  format: 'percent' },
              { path: 'setpoint',    name: 'Setpoint',    unit: '°C', format: 'number',
                controllable: true, type: 'number', capabilityId: 'setpoint',
                min: 5, max: 35, writeCmd: 'settemp' },
              { path: 'mode',   name: 'Mode',   format: 'string', raw: true },
              { path: 'fan',    name: 'Fan',    format: 'string', raw: true },
              { path: 'onoff',  name: 'On/Off', format: 'on-off',
                controllable: true, type: 'toggle', capabilityId: 'onoff',
                writeOn: 'on', writeOff: 'off' },
            ],
            homekit: ['temperature'],
            _writeCapability: (capId, command, args) =>
              this._sendCommand(mac, capId, command, args),
          });

          this._client.subscribe(`updData/${mac}`, err => {
            if (err) console.error(`[MC6] Subscribe failed for ${mac}: ${err.message}`);
            else console.log(`[MC6] Subscribed: ${label} (${mac})`);
          });
        }

        platformStatus.set('mc6', true);
        resolve();
      });

      this._client.on('message', (topic, payload) => this._onMessage(topic, payload));
      this._client.on('error', err => { clearTimeout(timer); console.error(`[MC6] ${err.message}`); reject(err); });
    });
  }

  stop() {
    if (this._client) this._client.end();
    console.log('[MC6] Stopped');
  }

  _onMessage(topic, payload) {
    try {
      const mac = topic.replace('updData/', '').toUpperCase();
      const deviceKey = this._devices[mac];
      if (!deviceKey) return;

      const d = JSON.parse(payload.toString());

      if (d.temp     !== undefined) this._store.update(`${deviceKey}/temperature`, d.temp / 10);
      if (d.settemp  !== undefined) this._store.update(`${deviceKey}/setpoint`,    d.settemp / 10);
      if (d.humi     !== undefined) this._store.update(`${deviceKey}/humidity`,    d.humi / 10);
      if (d.mode     !== undefined) this._store.update(`${deviceKey}/mode`,        MODE[d.mode] ?? `mode_${d.mode}`);
      if (d.fan      !== undefined) this._store.update(`${deviceKey}/fan`,         FAN[d.fan]   ?? `fan_${d.fan}`);
      if (d.onoff    !== undefined) this._store.update(`${deviceKey}/onoff`,       d.onoff === 1 ? 1 : 0);
    } catch (err) {
      console.error(`[MC6] Parse error: ${err.message}`);
    }
  }

  _sendCommand(mac, capId, command, args) {
    let payload;
    if (capId === 'setpoint') {
      const temp = Math.round(parseFloat(args?.[0] ?? command) * 10);
      payload = { settemp: temp };
    } else if (capId === 'onoff') {
      payload = { onoff: command === 'on' ? 1 : 2 };
    } else {
      return;
    }
    this._client.publish(mac, JSON.stringify(payload));
    console.log(`[MC6] Command → ${mac}: ${JSON.stringify(payload)}`);
  }
}

module.exports = MC6Client;
