const { EventEmitter } = require('events');
const MqttClient     = require('./mqtt-client');
const VrmClient      = require('./vrm-client');
const platformStatus = require('./platform-status');

const FALLBACK_DELAY_MS  = 15000; // wait before switching to cloud after MQTT drops
const RETRY_MQTT_DELAY_MS = 60000; // how often to log MQTT reconnect attempts

class ConnectionManager extends EventEmitter {
  constructor(config, store) {
    super();
    this.config  = config;
    this.store   = store;
    this.mqtt    = null;
    this.vrm     = null;
    this.source  = null; // 'mqtt' | 'vrm' | null
    this._fallbackTimer = null;
    this._mqttEverConnected = false;
  }

  // ── Public ────────────────────────────────────────────────

  async start() {
    const hasMqtt = !!(this.config.mqtt?.host);
    const hasVrm  = this._hasVrmCredentials();

    if (hasMqtt) {
      await this._startMqtt();
    } else if (hasVrm) {
      await this._startVrm('No MQTT host configured');
    } else {
      console.warn('[Connection] No data source configured — running without live Victron data.');
    }
  }

  _hasVrmCredentials() {
    const v = this.config.vrm;
    return !!(v?.apiToken || (v?.email && v?.password));
  }

  getActiveClient() {
    if (this.source === 'mqtt') return this.mqtt;
    if (this.source === 'vrm')  return this.vrm;
    return null;
  }

  getStatus() {
    return {
      source:  this.source,
      mqtt: {
        configured: !!(this.config.mqtt?.host),
        connected:  this.mqtt?.connected || false,
        host:       this.config.mqtt?.host || null,
      },
      vrm: {
        configured: !!(this.config.vrm?.email && this.config.vrm?.installationId),
        connected:  this.vrm?.connected || false,
      },
    };
  }

  // ── MQTT ──────────────────────────────────────────────────

  async _startMqtt() {
    this.mqtt = new MqttClient(this.config, this.store);

    this.mqtt.on('connected', () => {
      this._mqttEverConnected = true;
      clearTimeout(this._fallbackTimer);
      platformStatus.set('victron-mqtt', true);

      if (this.source === 'vrm') {
        console.log('[Connection] MQTT back online — stopping VRM cloud polling');
        this.vrm?.stop();
        this.vrm = null;
        platformStatus.set('victron-vrm', false);
      }

      this._setSource('mqtt');
    });

    this.mqtt.on('disconnected', () => {
      platformStatus.set('victron-mqtt', false);
      if (this.source !== 'mqtt') return;
      const delay = FALLBACK_DELAY_MS / 1000;
      console.log(`[Connection] MQTT dropped — switching to VRM cloud in ${delay}s…`);
      this._fallbackTimer = setTimeout(() => this._startVrm('MQTT offline'), FALLBACK_DELAY_MS);
    });

    try {
      await this.mqtt.start();
    } catch (err) {
      console.warn(`[Connection] MQTT unreachable: ${err.message}`);
      await this._startVrm('MQTT unreachable');
    }
  }

  // ── VRM ───────────────────────────────────────────────────

  async _startVrm(reason) {
    if (this.vrm?.connected) return; // already running

    if (!this._hasVrmCredentials()) {
      console.warn(`[Connection] ${reason} — VRM not configured, running offline.`);
      this._setSource(null);
      return;
    }

    console.log(`[Connection] ${reason} → connecting via VRM cloud…`);
    try {
      this.vrm = new VrmClient(this.config, this.store);
      await this.vrm.start();
      platformStatus.set('victron-vrm', true);
      this._setSource('vrm');
    } catch (err) {
      console.error(`[Connection] VRM cloud failed: ${err.message}`);
      platformStatus.set('victron-vrm', false);
      this._setSource(null);
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  _setSource(source) {
    if (this.source === source) return;
    const prev = this.source;
    this.source = source;

    const label = source === 'mqtt' ? 'MQTT (local)'
                : source === 'vrm'  ? 'VRM Cloud'
                : 'none';
    console.log(`[Connection] Source: ${prev || 'none'} → ${label}`);
    this.emit('source-changed', source);
  }
}

module.exports = ConnectionManager;
