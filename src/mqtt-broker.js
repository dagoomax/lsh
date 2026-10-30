'use strict';

// Built-in MQTT broker (Aedes) — so ESP/Arduino boards, Button+, Tasmota,
// Shelly MQTT, Zigbee2MQTT and LSH's own MQTT clients have a broker even
// without a Cerbo GX or a separate Mosquitto.
//
//   config.mqttBroker = { enabled: true, port: 1883, host: '0.0.0.0', username: '', password: '' }
//
// With a username set every client must log in with it (LSH's own clients do,
// via src/mqtt-target.js); without one the broker is open on the LAN, like a
// default Mosquitto. Retained messages and subscriptions live in memory.

const net = require('net');
const platformStatus = require('./platform-status');

class MqttBroker {
  constructor(config) {
    this._cfg = config.mqttBroker || {};
    this._aedes = null;
    this._server = null;
    this._listening = false;
    this._error = null;
    this._messages = 0;
    this._startedAt = null;
  }

  start() {
    const port = this._cfg.port === 0 ? 0 : Number(this._cfg.port) || 1883; // 0 = any free port (tests)
    const host = this._cfg.host || '0.0.0.0';
    let createAedes;
    try { createAedes = require('aedes'); }
    catch { this._error = 'aedes package missing (npm install aedes)'; console.error(`[MQTT Broker] ${this._error}`); return Promise.resolve(false); }
    platformStatus.set('mqttBroker', false);

    const aedes = createAedes({ id: 'lsh-broker' });
    this._aedes = aedes;
    const user = String(this._cfg.username || '');
    const pass = String(this._cfg.password || '');
    if (user) {
      aedes.authenticate = (client, username, password, done) => {
        const ok = username === user && (password ? password.toString() : '') === pass;
        if (!ok) console.warn(`[MQTT Broker] Rejected login from ${client?.id || '?'} (${client?.conn?.remoteAddress || '?'})`);
        done(null, ok);
      };
    }
    aedes.on('publish', (packet, client) => { if (client) this._messages++; });
    aedes.on('client', (c) => console.log(`[MQTT Broker] Client connected: ${c.id} (${c.conn?.remoteAddress || 'local'})`));
    aedes.on('clientDisconnect', (c) => console.log(`[MQTT Broker] Client disconnected: ${c.id}`));
    aedes.on('clientError', (c, err) => { if (err?.code !== 'ECONNRESET') console.warn(`[MQTT Broker] ${c?.id || '?'}: ${err.message}`); });

    return new Promise((resolve) => {
      const server = net.createServer(aedes.handle);
      this._server = server;
      server.once('error', (err) => {
        this._error = err.code === 'EADDRINUSE' ? `port ${port} is already in use (another broker running?)` : err.message;
        console.error(`[MQTT Broker] Not started: ${this._error}`);
        platformStatus.set('mqttBroker', false);
        resolve(false);
      });
      server.listen(port, host, () => {
        this._listening = true;
        this.port = server.address().port;
        this._startedAt = Date.now();
        this._error = null;
        platformStatus.set('mqttBroker', true);
        console.log(`[MQTT Broker] Listening on mqtt://${host}:${this.port}${user ? ' (login required)' : ' (no login)'}`);
        resolve(true);
      });
    });
  }

  stop() {
    platformStatus.set('mqttBroker', false);
    try { this._server?.close(); } catch { /* closed */ }
    try { this._aedes?.close(); } catch { /* closed */ }
    this._listening = false;
  }

  status() {
    const clients = this._aedes ? Object.values(this._aedes.clients || {}).map((c) => ({
      id: c.id, address: c.conn?.remoteAddress || null,
    })) : [];
    return {
      enabled: !!this._cfg.enabled, listening: this._listening, error: this._error,
      port: this.port || Number(this._cfg.port) || 1883, auth: !!this._cfg.username,
      clients, messages: this._messages, since: this._startedAt,
    };
  }
}

module.exports = MqttBroker;
