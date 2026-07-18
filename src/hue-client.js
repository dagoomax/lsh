'use strict';

const http           = require('http');
const platformStatus = require('./platform-status');

// Philips Hue via the local bridge (CLIP v1 REST API — supported by every
// bridge generation). Lights, plugs and Zigbee sensors are auto-discovered and
// polled every pollInterval seconds. The three v1 sensors a Hue motion sensor
// exposes (ZLLPresence / ZLLTemperature / ZLLLightLevel) share a Zigbee MAC in
// their uniqueid and are grouped into one dashboard device.
//
// Pairing: press the bridge link button, then run `node scripts/hue-auth.js
// <bridge-ip>` once and paste the printed username here.
//
// config.hue = { host: '192.168.1.x', username: '...', pollInterval: 5 }

// Hue scales ↔ LSH conventions (0-100, Kelvin, °C — SmartThings compat)
const briToPct  = (bri) => Math.round((bri / 254) * 100);
const pctToBri  = (pct) => Math.max(1, Math.round((pct / 100) * 254));
const hueToPct  = (h)   => Math.round(h / 655.35);
const pctToHue  = (pct) => Math.round(pct * 655.35);
const satToPct  = (s)   => Math.round((s / 254) * 100);
const pctToSat  = (pct) => Math.round((pct / 100) * 254);
const miredToK  = (ct)  => Math.round(1e6 / ct);
const kToMired  = (k)   => Math.min(500, Math.max(153, Math.round(1e6 / k)));
const luxOf     = (ll)  => Math.round(10 ** ((ll - 1) / 10000));

class HueClient {
  constructor(config, store, sensorRegistry) {
    this._cfg      = config.hue || {};
    this._store    = store;
    this._registry = sensorRegistry;
    this._timer    = null;
    this._known    = new Set();   // registered device keys
  }

  async start() {
    if (!this._cfg.host || !this._cfg.username) {
      console.log('[Hue] No host/username configured');
      return;
    }
    await this._poll();
    const ms = Math.max(2, this._cfg.pollInterval || 5) * 1000;
    this._timer = setInterval(() => this._poll().catch(() => {}), ms);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    platformStatus.set('hue', false);
  }

  // ── Poll ─────────────────────────────────────────────────────────────────

  async _poll() {
    let lights, sensors;
    try {
      [lights, sensors] = await Promise.all([this._req('GET', '/lights'), this._req('GET', '/sensors')]);
      platformStatus.set('hue', true);
    } catch (err) {
      platformStatus.set('hue', false);
      console.error(`[Hue] Poll failed: ${err.message}`);
      return;
    }

    for (const [id, light] of Object.entries(lights)) this._applyLight(id, light);
    this._applySensors(sensors);
  }

  // ── Lights & plugs ───────────────────────────────────────────────────────

  _applyLight(id, light) {
    const key    = `hue/light-${id}`;
    const state  = light.state || {};
    const isPlug = /plug/i.test(light.type || '');

    if (!this._known.has(key)) {
      this._known.add(key);
      const sensors = [{
        path: 'switch', name: 'Power', format: 'on-off',
        controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off',
        capabilityId: 'switch', homekit: isPlug ? 'switch-rw' : 'light-rw',
      }];
      if ('bri' in state) sensors.push({ path: 'level', name: 'Brightness', format: 'percent' });
      if ('ct'  in state) sensors.push({ path: 'colorTemperature', name: 'Color Temp', format: 'number' });
      if ('hue' in state) {
        sensors.push({ path: 'hue',        name: 'Hue',        format: 'number', hidden: true });
        sensors.push({ path: 'saturation', name: 'Saturation', format: 'number', hidden: true });
      }
      this._registry.registerDevice({
        key,
        label: light.name || `Hue ${id}`,
        type:  'hue',
        icon:  isPlug ? '🔌' : '💡',
        color: 'blue',
        sensors,
        homekit: [isPlug ? 'switch-rw' : 'light-rw'],
        _writeCapability: (capId, command, args = []) => this._writeLight(id, capId, command, args),
      });
      console.log(`[Hue] Registered light: ${light.name} (${light.type})`);
    }

    this._store.update(`${key}/switch`, state.on && state.reachable !== false ? 1 : 0);
    if ('bri' in state) this._store.update(`${key}/level`, briToPct(state.bri));
    if ('ct'  in state) this._store.update(`${key}/colorTemperature`, miredToK(state.ct));
    if ('hue' in state) this._store.update(`${key}/hue`, hueToPct(state.hue));
    if ('sat' in state) this._store.update(`${key}/saturation`, satToPct(state.sat));
  }

  async _writeLight(id, capId, command, args) {
    const body = {};
    if (capId === 'switch') {
      body.on = command === 'on';
    } else if (capId === 'switchLevel') {
      body.bri = pctToBri(args[0] ?? 0);
      body.on  = (args[0] ?? 0) > 0;
    } else if (capId === 'colorControl') {
      const { hue, saturation } = args[0] || {};
      if (hue        != null) body.hue = pctToHue(hue);
      if (saturation != null) body.sat = pctToSat(saturation);
    } else if (capId === 'colorTemperature') {
      body.ct = kToMired(args[0] || 2700);
    }
    if (!Object.keys(body).length) return;
    try { await this._req('PUT', `/lights/${id}/state`, body); }
    catch (err) { console.error(`[Hue] Write failed for light ${id}: ${err.message}`); }
  }

  // ── Zigbee sensors (motion trio, dimmer switches) ────────────────────────

  _applySensors(sensors) {
    // group by Zigbee MAC (uniqueid before the endpoint suffix)
    const groups = new Map();
    for (const s of Object.values(sensors)) {
      if (!s.uniqueid || !s.type?.startsWith('ZLL')) continue;
      const mac = s.uniqueid.split('-')[0];
      if (!groups.has(mac)) groups.set(mac, []);
      groups.get(mac).push(s);
    }

    for (const [mac, parts] of groups) {
      const key      = `hue/sensor-${mac.replace(/:/g, '')}`;
      const presence = parts.find((s) => s.type === 'ZLLPresence');
      const temp     = parts.find((s) => s.type === 'ZLLTemperature');
      const level    = parts.find((s) => s.type === 'ZLLLightLevel');
      const button   = parts.find((s) => s.type === 'ZLLSwitch');

      if (!this._known.has(key)) {
        this._known.add(key);
        const sens = [];
        if (presence) sens.push({ path: 'motion', name: 'Motion', format: 'on-off', homekit: 'motion' });
        if (temp)     sens.push({ path: 'temperature', name: 'Temperature', format: 'temperature', unit: '°C', homekit: 'temperature' });
        if (level)    sens.push({ path: 'lux', name: 'Lux', format: 'number', unit: 'lx' });
        if (button)   sens.push({ path: 'action', name: 'Action', format: 'number' });
        sens.push({ path: 'battery', name: 'Battery', format: 'percent', homekit: 'battery-level' });

        this._registry.registerDevice({
          key,
          label: (presence || button || parts[0]).name,
          type:  'hue',
          icon:  button ? '🔘' : '👁',
          color: 'blue',
          sensors: sens,
          homekit: sens.map((s) => s.homekit).filter(Boolean),
        });
        console.log(`[Hue] Registered sensor: ${(presence || button || parts[0]).name}`);
      }

      if (presence) this._store.update(`${key}/motion`, presence.state?.presence ? 1 : 0);
      if (temp && temp.state?.temperature != null) this._store.update(`${key}/temperature`, temp.state.temperature / 100);
      if (level && level.state?.lightlevel != null) this._store.update(`${key}/lux`, luxOf(level.state.lightlevel));
      if (button && button.state?.buttonevent != null) this._store.update(`${key}/action`, button.state.buttonevent);
      const batt = (presence || temp || button || {}).config?.battery;
      if (batt != null) this._store.update(`${key}/battery`, batt);
    }
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  _req(method, path, body) {
    const data = body ? JSON.stringify(body) : null;
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: this._cfg.host,
        port:     this._cfg.port || 80,
        path:     `/api/${this._cfg.username}${path}`,
        method,
        timeout:  8000,
        headers:  data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      }, (res) => {
        let out = '';
        res.on('data', (c) => out += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(out);
            const err = Array.isArray(j) && j.find((e) => e.error);
            if (err) return reject(new Error(err.error.description || 'Hue error'));
            resolve(j);
          } catch { reject(new Error('Non-JSON response from bridge')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end(data);
    });
  }
}

module.exports = HueClient;
