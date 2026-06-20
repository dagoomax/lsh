'use strict';

const http = require('http');

class ShellyClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._meta     = {}; // host → { gen, deviceKey }
    this._timer    = null;
  }

  async start() {
    const devices = this._config.shelly?.devices || [];
    if (!devices.length) return;

    for (const cfg of devices) {
      await this._initDevice(cfg).catch(err =>
        console.error(`[Shelly] Init failed for ${cfg.host}: ${err.message}`)
      );
    }

    this._timer = setInterval(() => this._pollAll(), 30000);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  // ── Device initialisation ──────────────────────────────────────────────

  async _initDevice(cfg) {
    const { host, name, username, password } = cfg;

    let info, gen, status;
    try {
      info   = await this._get(host, '/shelly', username, password);
      gen    = 1;
      status = await this._get(host, '/status', username, password);
    } catch {
      info   = await this._get(host, '/rpc/Shelly.GetDeviceInfo', username, password);
      gen    = 2;
      status = await this._get(host, '/rpc/Shelly.GetStatus', username, password);
    }

    const deviceKey = `shelly/${host.replace(/\./g, '_')}`;
    this._meta[host] = { gen, deviceKey, username, password };

    const sensors = gen === 1
      ? this._sensorsGen1(info, status)
      : this._sensorsGen2(status);

    const displayName = name || info.hostname || info.name || host;

    const device = {
      key:    deviceKey,
      label:  displayName,
      type:   'shelly',
      sensors,
      homekit: sensors.map(s => s.homekit).filter(Boolean),
      _writeCapability: async (capId, command, args = []) =>
        this._send(host, gen, capId, command, args, username, password),
    };

    this._registry.registerDevice(device);
    this._applyStatus(host, gen, status);
    console.log(`[Shelly] Registered ${displayName} (${host}, gen${gen})`);
  }

  // ── Sensor descriptors ─────────────────────────────────────────────────

  _sensorsGen1(info, status) {
    const sensors = [];
    const type    = (info.type || '').toUpperCase();

    (status.relays || []).forEach((_, i) => {
      const label = (status.relays.length > 1) ? `Switch ${i + 1}` : 'Switch';
      sensors.push({
        path: `relay_${i}`, label, format: 'on-off',
        controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off',
        capabilityId: `relay_${i}`, homekit: 'switch-rw',
      });
    });

    (status.lights || []).forEach((l, i) => {
      const sfx = (status.lights.length > 1) ? ` ${i + 1}` : '';
      sensors.push({
        path: `light_${i}_on`, label: `Light${sfx}`, format: 'on-off',
        controllable: true, type: 'toggle',
        writeOn: 'on', writeOff: 'off',
        capabilityId: `light_${i}`, homekit: 'switch-rw',
      });
      if (l.brightness !== undefined || type.includes('SHDM') || type.includes('SHRGBW')) {
        sensors.push({
          path: `light_${i}_brightness`, label: `Brightness${sfx}`, format: 'percent',
          controllable: true, type: 'range',
          writeCmd: 'setBrightness', capabilityId: `light_${i}`,
          min: 0, max: 100, rangeFormat: 'percent',
        });
      }
    });

    (status.meters || []).forEach((_, i) => {
      sensors.push({
        path: `power_${i}`,
        label: (status.meters.length > 1) ? `Power ${i + 1}` : 'Power',
        unit: 'W',
      });
    });

    if (status.emeters) {
      status.emeters.forEach((_, i) => {
        sensors.push({ path: `emeter_${i}_power`, label: `Power ${i + 1}`, unit: 'W' });
        sensors.push({ path: `emeter_${i}_reactive`, label: `Reactive ${i + 1}`, unit: 'VAR' });
      });
    }

    const s = status.sensor || {};
    if (status.tmp !== undefined)     sensors.push({ path: 'temperature', label: 'Temperature', unit: '°C', homekit: 'temperature' });
    if (s.temperature !== undefined)  sensors.push({ path: 'temperature', label: 'Temperature', unit: '°C', homekit: 'temperature' });
    if (status.hum !== undefined)     sensors.push({ path: 'humidity',    label: 'Humidity',    unit: '%',  homekit: 'humidity' });
    if (s.humidity !== undefined)     sensors.push({ path: 'humidity',    label: 'Humidity',    unit: '%',  homekit: 'humidity' });
    if (s.lux !== undefined)          sensors.push({ path: 'lux',         label: 'Illuminance', unit: 'lux' });
    if (s.state !== undefined)        sensors.push({ path: 'contact',     label: 'Contact',     format: 'on-off', homekit: 'contact' });
    if (s.motion !== undefined)       sensors.push({ path: 'motion',      label: 'Motion',      format: 'on-off', homekit: 'motion' });
    if (s.flood !== undefined)        sensors.push({ path: 'flood',       label: 'Flood',       format: 'on-off', homekit: 'leak' });
    if (s.smoke !== undefined)        sensors.push({ path: 'smoke',       label: 'Smoke',       format: 'alarm',  homekit: 'smoke' });
    if (status.bat !== undefined)     sensors.push({ path: 'battery',     label: 'Battery',     unit: '%',  homekit: 'battery-level' });

    return sensors;
  }

  _sensorsGen2(status) {
    const sensors = [];

    for (const [key, val] of Object.entries(status)) {
      const sw = key.match(/^(switch|light):(\d+)$/i);
      if (sw) {
        const [, comp, idx] = sw;
        const c   = comp.toLowerCase();
        const sfx = idx === '0' ? '' : ` ${parseInt(idx) + 1}`;
        sensors.push({
          path: `${c}_${idx}_on`, label: `${comp}${sfx}`, format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: 'on', writeOff: 'off',
          capabilityId: `${c}_${idx}`, homekit: 'switch-rw',
        });
        if (val.brightness !== undefined) {
          sensors.push({
            path: `${c}_${idx}_brightness`, label: `Brightness${sfx}`, format: 'percent',
            controllable: true, type: 'range',
            writeCmd: 'setBrightness', capabilityId: `${c}_${idx}`,
            min: 0, max: 100, rangeFormat: 'percent',
          });
        }
        if (val.apower !== undefined) {
          sensors.push({ path: `${c}_${idx}_power`, label: `Power${sfx}`, unit: 'W' });
        }
        continue;
      }

      const tm = key.match(/^temperature:(\d+)$/i);
      if (tm) {
        const sfx = tm[1] === '0' ? '' : ` ${parseInt(tm[1]) + 1}`;
        sensors.push({ path: `temp_${tm[1]}`, label: `Temperature${sfx}`, unit: '°C', homekit: 'temperature' });
        continue;
      }

      const hm = key.match(/^humidity:(\d+)$/i);
      if (hm) {
        const sfx = hm[1] === '0' ? '' : ` ${parseInt(hm[1]) + 1}`;
        sensors.push({ path: `hum_${hm[1]}`, label: `Humidity${sfx}`, unit: '%', homekit: 'humidity' });
        continue;
      }
    }

    return sensors;
  }

  // ── Store updates ──────────────────────────────────────────────────────

  _applyStatus(host, gen, status) {
    const { deviceKey } = this._meta[host];

    if (gen === 1) {
      (status.relays  || []).forEach((r, i) => this._store.set(`${deviceKey}/relay_${i}`, r.ison));
      (status.lights  || []).forEach((l, i) => {
        this._store.set(`${deviceKey}/light_${i}_on`, l.ison);
        if (l.brightness !== undefined) this._store.set(`${deviceKey}/light_${i}_brightness`, l.brightness);
      });
      (status.meters  || []).forEach((m, i) => this._store.set(`${deviceKey}/power_${i}`, m.power));
      (status.emeters || []).forEach((m, i) => {
        this._store.set(`${deviceKey}/emeter_${i}_power`,    m.power);
        this._store.set(`${deviceKey}/emeter_${i}_reactive`, m.reactive);
      });

      const tmp = status.tmp;
      if (tmp !== undefined) this._store.set(`${deviceKey}/temperature`, tmp.tC ?? tmp.value ?? tmp);
      const hum = status.hum;
      if (hum !== undefined) this._store.set(`${deviceKey}/humidity`, hum.value ?? hum);

      const s = status.sensor || {};
      if (s.temperature !== undefined) this._store.set(`${deviceKey}/temperature`, s.temperature);
      if (s.humidity    !== undefined) this._store.set(`${deviceKey}/humidity`,    s.humidity);
      if (s.lux         !== undefined) this._store.set(`${deviceKey}/lux`,         s.lux);
      if (s.state       !== undefined) this._store.set(`${deviceKey}/contact`,     s.state === 'open');
      if (s.motion      !== undefined) this._store.set(`${deviceKey}/motion`,      s.motion);
      if (s.flood       !== undefined) this._store.set(`${deviceKey}/flood`,       s.flood);
      if (s.smoke       !== undefined) this._store.set(`${deviceKey}/smoke`,       s.smoke);
      if (status.bat    !== undefined) this._store.set(`${deviceKey}/battery`,     status.bat.value ?? status.bat);
    } else {
      for (const [key, val] of Object.entries(status)) {
        const sw = key.match(/^(switch|light):(\d+)$/i);
        if (sw) {
          const [, comp, idx] = sw;
          const c = comp.toLowerCase();
          this._store.set(`${deviceKey}/${c}_${idx}_on`, val.output ?? val.on ?? false);
          if (val.brightness !== undefined) this._store.set(`${deviceKey}/${c}_${idx}_brightness`, val.brightness);
          if (val.apower     !== undefined) this._store.set(`${deviceKey}/${c}_${idx}_power`,      val.apower);
          continue;
        }
        const tm = key.match(/^temperature:(\d+)$/i);
        if (tm) { this._store.set(`${deviceKey}/temp_${tm[1]}`, val.tC ?? val.value); continue; }
        const hm = key.match(/^humidity:(\d+)$/i);
        if (hm) { this._store.set(`${deviceKey}/hum_${hm[1]}`,  val.rh  ?? val.value); continue; }
      }
    }
  }

  async _pollAll() {
    for (const [host, meta] of Object.entries(this._meta)) {
      try {
        const path   = meta.gen === 1 ? '/status' : '/rpc/Shelly.GetStatus';
        const status = await this._get(host, path, meta.username, meta.password);
        this._applyStatus(host, meta.gen, status);
      } catch (err) {
        console.error(`[Shelly] Poll failed for ${host}: ${err.message}`);
      }
    }
  }

  // ── Command dispatch ───────────────────────────────────────────────────

  async _send(host, gen, capId, command, args, user, pass) {
    // capId: "relay_0", "light_0", "switch_0"
    const m = capId.match(/^(relay|light|switch|cover)_(\d+)$/);
    if (!m) return;
    const [, comp, idx] = m;
    const i = parseInt(idx);

    if (gen === 1) {
      const endpoint = comp === 'relay' ? `/relay/${i}` : `/light/${i}`;
      if (command === 'on' || command === 'off') {
        await this._postForm(host, endpoint, `turn=${command}`, user, pass);
      } else if (command === 'setBrightness') {
        await this._postForm(host, `${endpoint}?brightness=${Math.round(args[0])}`, `brightness=${Math.round(args[0])}`, user, pass);
      }
    } else {
      const rpcComp = comp === 'relay' ? 'Switch' : comp.charAt(0).toUpperCase() + comp.slice(1);
      if (command === 'on' || command === 'off') {
        await this._postJson(host, `/rpc/${rpcComp}.Set`, { id: i, on: command === 'on' }, user, pass);
      } else if (command === 'setBrightness') {
        await this._postJson(host, '/rpc/Light.Set', { id: i, brightness: Math.round(args[0]) }, user, pass);
      }
    }
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────

  _get(host, path, user, pass) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (user) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass || ''}`).toString('base64');
      }
      const req = http.get({ hostname: host, port: 80, path, timeout: 5000, headers }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error(`Non-JSON response from ${host}${path}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${host}`)); });
    });
  }

  _postForm(host, path, body, user, pass) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) };
    if (user) headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass || ''}`).toString('base64');
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: host, port: 80, path, method: 'POST', timeout: 5000, headers }, res => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }

  _postJson(host, path, body, user, pass) {
    const json    = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) };
    if (user) headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass || ''}`).toString('base64');
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: host, port: 80, path, method: 'POST', timeout: 5000, headers }, res => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(json);
      req.end();
    });
  }
}

module.exports = ShellyClient;
