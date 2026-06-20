const mqtt = require('mqtt');
const { EventEmitter } = require('events');

class MqttClient extends EventEmitter {
  constructor(config, store) {
    super();
    this.config = config;
    this.store = store;
    this.client = null;
    this.keepaliveInterval = null;
    this.portalId = config.mqtt.portalId;
    this.connected = false;
    this._initialised = false; // true once first connect succeeds
  }

  start() {
    return new Promise((resolve, reject) => {
      const url = `mqtt://${this.config.mqtt.host}:${this.config.mqtt.port}`;
      console.log(`[MQTT] Connecting to ${url}...`);

      this.client = mqtt.connect(url, {
        connectTimeout: 10000,
        reconnectPeriod: 5000,
      });

      const timeout = setTimeout(() => {
        if (!this.connected) {
          reject(new Error(`MQTT timeout — cannot reach ${this.config.mqtt.host}`));
        }
      }, 15000);

      this.client.on('connect', () => {
        this.connected = true;
        clearTimeout(timeout);
        this.emit('connected');
        console.log('[MQTT] Connected');

        if (!this._initialised) {
          this._initialised = true;
          const setup = this.portalId
            ? Promise.resolve().then(() => this._subscribe())
            : this._discoverPortalId().then(() => this._subscribe());

          setup.then(resolve).catch(reject);
        } else {
          // Reconnecting after a drop — re-subscribe
          this._subscribe();
        }
      });

      this.client.on('message', (topic, payload) => this._handleMessage(topic, payload));

      this.client.on('error', (err) => {
        console.error('[MQTT] Error:', err.message);
        if (!this.connected && !this._initialised) {
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.client.on('offline', () => {
        if (this.connected) {
          this.connected = false;
          console.log('[MQTT] Went offline');
          this.emit('disconnected');
          if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
        }
      });

      this.client.on('close', () => {
        if (this.connected) {
          this.connected = false;
          console.log('[MQTT] Connection closed');
          this.emit('disconnected');
          if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
        }
      });
    });
  }

  _discoverPortalId() {
    return new Promise((resolve) => {
      console.log('[MQTT] Discovering portal ID...');
      this.client.subscribe('N/+/system/0/Serial');

      const handler = (topic) => {
        const match = topic.match(/^N\/([^/]+)\//);
        if (match) {
          this.portalId = match[1];
          console.log(`[MQTT] Portal ID: ${this.portalId}`);
          this.client.removeListener('message', handler);
          resolve();
        }
      };
      this.client.on('message', handler);
    });
  }

  _subscribe() {
    if (!this.portalId) return;
    const prefix = `N/${this.portalId}`;
    this.client.subscribe(`${prefix}/#`, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err);
      else console.log(`[MQTT] Subscribed to ${prefix}/#`);
    });
    this._startKeepalive();
  }

  _startKeepalive() {
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
    const topic = `R/${this.portalId}/keepalive`;
    this.client.publish(topic, '');
    this.keepaliveInterval = setInterval(() => {
      if (this.connected) this.client.publish(topic, '');
    }, 50000);
  }

  _handleMessage(topic, payload) {
    const prefix = `N/${this.portalId}/`;
    if (!topic.startsWith(prefix)) return;
    const path = topic.slice(prefix.length);
    try {
      const data = JSON.parse(payload.toString());
      if (data && data.value !== undefined) this.store.update(path, data.value);
    } catch { /* ignore */ }
  }

  writeRelay(relayIndex, state) {
    if (!this.connected || !this.portalId) return;
    const topic = `W/${this.portalId}/system/0/Relay/${relayIndex}/State`;
    this.client.publish(topic, JSON.stringify({ value: state ? 1 : 0 }));
    console.log(`[MQTT] Relay ${relayIndex} → ${state ? 'ON' : 'OFF'}`);
  }

  stop() {
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
    if (this.client) this.client.end(true);
  }
}

module.exports = MqttClient;
