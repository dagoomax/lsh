'use strict';

const fs              = require('fs');
const path            = require('path');
const mqtt            = require('mqtt');
const platformStatus  = require('./platform-status');

const MODE  = { 1: 'cool', 2: 'heat', 3: 'fan_only', 4: 'dry' };
const FAN   = { 1: 'high', 2: 'medium', 3: 'low', 4: 'auto' };

const SCHEDULES_FILE = path.join(__dirname, '..', 'persist', 'mc6-schedules.json');

class MC6Client {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._client   = null;
    this._devices  = {}; // mac → deviceKey

    this._schedules         = {}; // mac → { countdown: {offAt, action}|null, daily: [entry] }
    this._countdownTimeouts = {}; // mac → Timeout handle (not persisted)
    this._checkInterval     = null;
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
                controllable: true, type: 'range', capabilityId: 'setpoint',
                min: 5, max: 35, step: 0.5, writeCmd: 'settemp' },
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
        this._loadSchedules();
        this._checkInterval = setInterval(() => this._checkDailySchedules(), 30000);
        resolve();
      });

      this._client.on('message', (topic, payload) => this._onMessage(topic, payload));
      this._client.on('error', err => { clearTimeout(timer); console.error(`[MC6] ${err.message}`); reject(err); });
    });
  }

  stop() {
    if (this._client) this._client.end();
    if (this._checkInterval) clearInterval(this._checkInterval);
    for (const t of Object.values(this._countdownTimeouts)) clearTimeout(t);
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

  // ── Timers & schedules ──────────────────────────────────────────────────
  // Two independent features, both restored from persist/mc6-schedules.json
  // on restart:
  //  - countdown: one-shot "turn on/off in N minutes" per device
  //  - daily:     recurring HH:MM on/off entries, optionally limited to
  //               specific weekdays (0=Sun..6=Sat; empty/null = every day)

  _loadSchedules() {
    try {
      this._schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    } catch {
      this._schedules = {};
    }
    for (const mac of Object.keys(this._schedules)) {
      if (!this._devices[mac]) continue; // device no longer configured
      const countdown = this._schedules[mac].countdown;
      if (countdown?.offAt) this._armCountdown(mac, countdown.offAt, countdown.action);
    }
  }

  _saveSchedules() {
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(this._schedules, null, 2));
  }

  _scheduleFor(mac) {
    if (!this._schedules[mac]) this._schedules[mac] = { countdown: null, daily: [] };
    return this._schedules[mac];
  }

  listSchedules(mac) {
    if (!this._devices[mac]) throw new Error(`Unknown MC6 device: ${mac}`);
    return this._scheduleFor(mac);
  }

  setCountdownTimer(mac, minutes, action = 'off') {
    if (!this._devices[mac]) throw new Error(`Unknown MC6 device: ${mac}`);
    if (!['on', 'off'].includes(action)) throw new Error("action must be 'on' or 'off'");
    if (!(minutes > 0)) throw new Error('minutes must be a positive number');

    const offAt = Date.now() + minutes * 60000;
    this._scheduleFor(mac).countdown = { offAt, action };
    this._saveSchedules();
    this._armCountdown(mac, offAt, action);
    return { offAt, action };
  }

  clearCountdownTimer(mac) {
    if (!this._devices[mac]) throw new Error(`Unknown MC6 device: ${mac}`);
    if (this._countdownTimeouts[mac]) {
      clearTimeout(this._countdownTimeouts[mac]);
      delete this._countdownTimeouts[mac];
    }
    this._scheduleFor(mac).countdown = null;
    this._saveSchedules();
  }

  _armCountdown(mac, offAt, action = 'off') {
    if (this._countdownTimeouts[mac]) clearTimeout(this._countdownTimeouts[mac]);

    const fire = () => {
      this._sendCommand(mac, 'onoff', action);
      delete this._countdownTimeouts[mac];
      if (this._schedules[mac]) {
        this._schedules[mac].countdown = null;
        this._saveSchedules();
      }
    };

    const ms = offAt - Date.now();
    if (ms <= 0) { fire(); return; }
    this._countdownTimeouts[mac] = setTimeout(fire, ms);
  }

  addDailySchedule(mac, { time, action = 'off', days = null, enabled = true }) {
    if (!this._devices[mac]) throw new Error(`Unknown MC6 device: ${mac}`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('time must be HH:MM (24h)');
    if (!['on', 'off'].includes(action)) throw new Error("action must be 'on' or 'off'");
    if (days != null && (!Array.isArray(days) || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)))
      throw new Error('days must be an array of integers 0 (Sun) – 6 (Sat)');

    const entry = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time,
      action,
      days:      days && days.length ? days : null,
      enabled:   !!enabled,
      lastFired: null,
    };
    this._scheduleFor(mac).daily.push(entry);
    this._saveSchedules();
    return entry;
  }

  removeDailySchedule(mac, id) {
    if (!this._devices[mac]) throw new Error(`Unknown MC6 device: ${mac}`);
    const sched  = this._scheduleFor(mac);
    const before = sched.daily.length;
    sched.daily  = sched.daily.filter(e => e.id !== id);
    if (sched.daily.length === before) return false;
    this._saveSchedules();
    return true;
  }

  _checkDailySchedules() {
    const now      = new Date();
    const hhmm     = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const weekday  = now.getDay(); // 0=Sun..6=Sat
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; // local date, must match hhmm's local clock
    let changed    = false;

    for (const [mac, sched] of Object.entries(this._schedules)) {
      if (!this._devices[mac]) continue;
      for (const entry of sched.daily) {
        if (!entry.enabled) continue;
        if (entry.time !== hhmm) continue;
        if (entry.days && !entry.days.includes(weekday)) continue;
        if (entry.lastFired === todayKey) continue; // already fired today

        entry.lastFired = todayKey;
        changed = true;
        this._sendCommand(mac, 'onoff', entry.action);
        console.log(`[MC6] Schedule fired: ${mac} → ${entry.action} at ${entry.time}`);
      }
    }

    if (changed) this._saveSchedules();
  }
}

module.exports = MC6Client;
