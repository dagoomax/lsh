'use strict';

const fs              = require('fs');
const net             = require('net');
const path            = require('path');
const mqtt            = require('mqtt');
const platformStatus  = require('./platform-status');

const MODE  = { 1: 'cool', 2: 'heat', 3: 'fan_only', 4: 'dry' };
const FAN   = { 1: 'high', 2: 'medium', 3: 'low', 4: 'auto' };

const SCHEDULES_FILE = path.join(__dirname, '..', 'persist', 'mc6-schedules.json');

// Two transports, chosen per device:
//   MQTT       — devices with just a `mac`: JSON over updData/<MAC> on mc6.broker.
//   Modbus TCP — devices with a `host` (the thermostat unlocked into
//                "wifi modbus tcp" mode). Holding registers, FC03 read /
//                FC16 write, verified against a real unit at 192.168.0.101:
//                  0 room temp ×10   1 floor temp ×10   2 humidity %
//                  61 on/off (1=on)  62 mode (MODE)     63 fan (FAN)
//                  64 setpoint ×10
//                The unit silently drops about every other request sent
//                back to back, so every request is paced and retried.
const MB = { ROOM: 0, FLOOR: 1, HUMI: 2, ONOFF: 61, MODE: 62, FAN: 63, SETPOINT: 64 };
const MB_GAP_MS     = 300;
const MB_TIMEOUT_MS = 1500;
const MB_TRIES      = 4;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class MC6Client {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._client   = null;
    this._devices  = {}; // mac → deviceKey
    this._modbus   = {}; // mac → device config (Modbus TCP devices only)
    this._mbOk     = {}; // mac → last poll succeeded (undefined until the first poll)
    this._mbTimers = [];
    this._mqttOk   = false;

    this._schedules         = {}; // mac → { countdown: {offAt, action}|null, daily: [entry] }
    this._countdownTimeouts = {}; // mac → Timeout handle (not persisted)
    this._checkInterval     = null;
  }

  async start() {
    const cfg = this._config.mc6 || {};
    const devices = cfg.devices ?? [];
    if (!devices.length) throw new Error('No MC6 devices configured');

    const mqttDevices   = devices.filter(d => !d.host);
    const modbusDevices = devices.filter(d => d.host);
    if (mqttDevices.length && !cfg.broker) throw new Error('mc6.broker is required for MQTT devices');

    platformStatus.set('mc6', false);
    for (const dev of modbusDevices) this._startModbus(dev);
    if (mqttDevices.length) await this._startMqtt(cfg, mqttDevices);

    this._loadSchedules();
    this._checkInterval = setInterval(() => this._checkDailySchedules(), 30000);
  }

  _register(dev, mac, extraSensors = []) {
    const deviceKey = `mc6/${mac}`;
    const label     = dev.name || `MC6 ${mac.slice(-4)}`;
    this._devices[mac] = deviceKey;

    this._registry.registerDevice({
      key:   deviceKey,
      type:  'mc6',
      label,
      icon:  '🌡',
      color: 'orange',
      sensors: [
        { path: 'temperature', name: 'Temperature', unit: '°C', format: 'number', homekit: 'temperature' },
        ...extraSensors,
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
      homekit: ['mc6-thermostat'],
      _writeCapability: (capId, command, args) =>
        this._sendCommand(mac, capId, command, args),
    });
    return { deviceKey, label };
  }

  _updateStatus() {
    platformStatus.set('mc6', this._mqttOk || Object.values(this._mbOk).some(Boolean));
  }

  _startMqtt(cfg, devices) {
    return new Promise((resolve, reject) => {
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
          const mac = dev.mac.toUpperCase().replace(/[^A-F0-9]/g, '');
          const { label } = this._register(dev, mac);

          this._client.subscribe(`updData/${mac}`, err => {
            if (err) console.error(`[MC6] Subscribe failed for ${mac}: ${err.message}`);
            else console.log(`[MC6] Subscribed: ${label} (${mac})`);
          });
        }

        this._mqttOk = true;
        this._updateStatus();
        resolve();
      });

      this._client.on('message', (topic, payload) => this._onMessage(topic, payload));
      this._client.on('error', err => { clearTimeout(timer); console.error(`[MC6] ${err.message}`); reject(err); });
    });
  }

  stop() {
    if (this._client) this._client.end();
    if (this._checkInterval) clearInterval(this._checkInterval);
    for (const t of this._mbTimers) clearInterval(t);
    for (const t of Object.values(this._countdownTimeouts)) clearTimeout(t);
    console.log('[MC6] Stopped');
  }

  // ── Modbus TCP ──────────────────────────────────────────────────────────

  _startModbus(dev) {
    // mac is optional for Modbus devices — it only keys the device (and its
    // timers/schedules); fall back to the host so config can omit it.
    const mac = (dev.mac || dev.host).toUpperCase().replace(/[^A-F0-9]/g, '');
    this._modbus[mac] = dev;
    this._mbOk[mac]   = undefined;
    const { label } = this._register(dev, mac, [
      { path: 'floor_temperature', name: 'Floor temperature', unit: '°C', format: 'number' },
    ]);
    console.log(`[MC6] Modbus TCP: ${label} (${dev.host}:${dev.port || 502})`);

    const poll = () => this._pollModbus(mac).catch(() => {});
    poll();
    this._mbTimers.push(setInterval(poll, Math.max(dev.pollInterval || 10, 5) * 1000));
  }

  // Opens one connection, runs fn(req) and closes it. req(pdu) resolves with
  // the response PDU, retrying timeouts (see MB_* above).
  async _mbSession(dev, fn) {
    const sock = net.connect(dev.port || 502, dev.host);
    let rx = Buffer.alloc(0), pending = null, txId = 0;

    sock.on('data', chunk => {
      rx = Buffer.concat([rx, chunk]);
      while (rx.length >= 6) {
        const total = 6 + rx.readUInt16BE(4);
        if (rx.length < total) break;
        const frame = rx.subarray(0, total);
        rx = rx.subarray(total);
        if (pending && frame.readUInt16BE(0) === pending.id) {
          const p = pending; pending = null; p.resolve(frame.subarray(7));
        }
      }
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
      sock.once('connect', () => { clearTimeout(t); resolve(); });
      sock.once('error', err => { clearTimeout(t); reject(err); });
    });
    sock.on('error', () => {});

    const once = (pdu) => new Promise((resolve, reject) => {
      const id = txId = (txId + 1) & 0xFFFF;
      const frame = Buffer.alloc(7 + pdu.length);
      frame.writeUInt16BE(id, 0);
      frame.writeUInt16BE(0, 2);
      frame.writeUInt16BE(1 + pdu.length, 4);
      frame.writeUInt8(dev.unitId ?? 1, 6);
      pdu.copy(frame, 7);
      const timer = setTimeout(() => { pending = null; reject(new Error('response timeout')); }, MB_TIMEOUT_MS);
      pending = { id, resolve: (r) => { clearTimeout(timer); resolve(r); } };
      sock.write(frame);
    });

    const req = async (pdu) => {
      let lastErr;
      for (let i = 0; i < MB_TRIES; i++) {
        try {
          const res = await once(pdu);
          await sleep(MB_GAP_MS);
          if (res[0] & 0x80) throw Object.assign(new Error(`Modbus exception ${res[1]}`), { fatal: true });
          return res;
        } catch (err) {
          if (err.fatal) throw err;
          lastErr = err;
          await sleep(MB_GAP_MS);
        }
      }
      throw lastErr;
    };

    try { return await fn(req); } finally { sock.destroy(); }
  }

  async _mbRead(req, addr, count) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(0x03, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(count, 3);
    const res = await req(pdu);
    return Array.from({ length: count }, (_, i) => res.readInt16BE(2 + i * 2));
  }

  async _mbWrite(mac, addr, value) {
    const pdu = Buffer.alloc(8);
    pdu.writeUInt8(0x10, 0);
    pdu.writeUInt16BE(addr, 1);
    pdu.writeUInt16BE(1, 3);
    pdu.writeUInt8(2, 5);
    pdu.writeInt16BE(value, 6);
    await this._mbSession(this._modbus[mac], req => req(pdu));
  }

  async _pollModbus(mac) {
    const dev = this._modbus[mac];
    const key = this._devices[mac];
    try {
      const [sensors, state] = await this._mbSession(dev, async req => [
        await this._mbRead(req, MB.ROOM, 3),
        await this._mbRead(req, MB.ONOFF, 4),
      ]);
      this._store.update(`${key}/temperature`,       sensors[0] / 10);
      this._store.update(`${key}/floor_temperature`, sensors[1] / 10);
      this._store.update(`${key}/humidity`,          sensors[2]);
      this._store.update(`${key}/onoff`,             state[0] === 1 ? 1 : 0);
      this._store.update(`${key}/mode`,              MODE[state[1]] ?? `mode_${state[1]}`);
      this._store.update(`${key}/fan`,               FAN[state[2]]  ?? `fan_${state[2]}`);
      this._store.update(`${key}/setpoint`,          state[3] / 10);
      if (this._mbOk[mac] !== true) console.log(`[MC6] Modbus ${dev.host} OK`);
      this._mbOk[mac] = true;
    } catch (err) {
      // Log on the transition only (undefined = first poll), not every retry cycle
      if (this._mbOk[mac] !== false) console.error(`[MC6] Modbus ${dev.host} poll failed: ${err.message}`);
      this._mbOk[mac] = false;
    }
    this._updateStatus();
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
    if (this._modbus[mac]) return this._sendModbusCommand(mac, capId, command, args);

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

  async _sendModbusCommand(mac, capId, command, args) {
    const key = this._devices[mac];
    if (capId === 'setpoint') {
      const temp = parseFloat(args?.[0] ?? command);
      if (!Number.isFinite(temp)) throw new Error('setpoint must be a number');
      await this._mbWrite(mac, MB.SETPOINT, Math.round(temp * 10));
      this._store.update(`${key}/setpoint`, Math.round(temp * 10) / 10);
    } else if (capId === 'onoff') {
      const on = command === 'on' || command === true;
      await this._mbWrite(mac, MB.ONOFF, on ? 1 : 0);
      this._store.update(`${key}/onoff`, on ? 1 : 0);
    } else {
      return;
    }
    console.log(`[MC6] Modbus command → ${this._modbus[mac].host}: ${capId}=${args?.[0] ?? command}`);
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
