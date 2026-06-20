'use strict';

const mqtt           = require('mqtt');
const platformStatus = require('./platform-status');

const HISTORY_MAX = 100; // messages kept per topic

class MqttExplorer {
  constructor(config) {
    this._config  = config;
    this._topics  = new Map(); // topic → { value, ts, count, history }
    this._subs    = new Set(['#']);
    this._client  = null;
    this._io      = null;
    this._msgRate = 0;      // messages in current second
    this._rateTs  = 0;
    this._ratePub = 0;      // last published rate
  }

  setIo(io) { this._io = io; }

  start() {
    const { host, port = 1883 } = this._config.mqtt;
    const url = `mqtt://${host}:${port}`;
    console.log('[MQTT Explorer] Connecting to ' + url);

    this._client = mqtt.connect(url, {
      clientId:        `explorer-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 10000,
      connectTimeout:  10000,
    });

    this._client.on('connect', () => {
      console.log('[MQTT Explorer] Connected — subscribing to #');
      for (const sub of this._subs) this._client.subscribe(sub);
      platformStatus.set('mqtt-explorer', true);
      this._io?.emit('mqtt-explorer-status', { connected: true });
    });

    this._client.on('close', () => {
      platformStatus.set('mqtt-explorer', false);
      this._io?.emit('mqtt-explorer-status', { connected: false });
    });

    this._client.on('error', err => {
      console.error('[MQTT Explorer] Error: ' + err.message);
    });

    this._client.on('message', (topic, payload) => {
      const value = payload.toString();
      const ts    = Date.now();

      const isNew = !this._topics.has(topic);
      if (isNew) {
        this._topics.set(topic, { value, ts, count: 0, history: [] });
      }
      const entry     = this._topics.get(topic);
      entry.value     = value;
      entry.ts        = ts;
      entry.count    += 1;
      entry.history.push({ payload: value, ts });
      if (entry.history.length > HISTORY_MAX) entry.history.shift();

      // Track message rate
      const sec = Math.floor(ts / 1000);
      if (sec !== this._rateTs) { this._msgRate = 0; this._rateTs = sec; }
      this._msgRate++;

      this._io?.emit('mqtt-explorer-msg', {
        topic, payload: value, ts,
        count: entry.count, isNew,
      });
    });
  }

  // ── Public API used by api-routes ──────────────────────────────────────

  getTopics() {
    const out = [];
    for (const [topic, d] of this._topics) {
      out.push({ topic, value: d.value, ts: d.ts, count: d.count });
    }
    return out;
  }

  getHistory(topic) {
    return this._topics.get(topic)?.history || [];
  }

  publish(topic, payload, retain = false) {
    if (!this._client?.connected) throw new Error('Not connected');
    return new Promise((resolve, reject) => {
      this._client.publish(topic, String(payload), { retain }, err =>
        err ? reject(err) : resolve()
      );
    });
  }

  subscribe(pattern) {
    this._subs.add(pattern);
    if (this._client?.connected) this._client.subscribe(pattern);
  }

  clear() {
    this._topics.clear();
    this._io?.emit('mqtt-explorer-clear');
  }

  get connected() { return !!this._client?.connected; }
  get topicCount() { return this._topics.size; }
  get msgRate()    { return this._msgRate; }
}

module.exports = MqttExplorer;
