const { EventEmitter } = require('events');
const fs   = require('fs');
const path = require('path');
const { DEVICE_TYPES, KNOWN_SERVICES } = require('./device-definitions');
const { translateDevice } = require('./server-i18n');

// User customizations (room / icon / label per device), edited from the
// dashboard and applied on top of whatever the integrations register.
const OVERRIDES_FILE = path.join(__dirname, '..', 'persist', 'device-overrides.json');

class SensorRegistry extends EventEmitter {
  constructor(store, language) {
    super();
    this.store = store;
    this.language = language || 'en';
    this.devices = new Map(); // deviceKey → device descriptor
    this.setMaxListeners(100);

    try { this.overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')); }
    catch { this.overrides = {}; }

    store.on('change', ({ key }) => this._checkTopic(key));
  }

  _applyOverride(device) {
    const o = this.overrides[device.key];
    if (!o) return;
    if (o.room) device.room = o.room;
    if (o.icon) device.customIcon = o.icon;
    if (o.label) { device._origLabel = device.label; device.label = o.label; }
    if (o.planX != null) device.planX = o.planX;
    if (o.planY != null) device.planY = o.planY;
    if (o.planFloor) device.planFloor = o.planFloor;
    if (o.camAngle != null) device.camAngle = o.camAngle;
    if (o.camFov   != null) device.camFov   = o.camFov;
    if (o.camRange != null) device.camRange = o.camRange;
  }

  // Persist a user customization and apply it to the live descriptor.
  // Empty-string fields clear the override for that field.
  setOverride(deviceKey, { room, icon, label, planX, planY, planFloor, camAngle, camFov, camRange } = {}) {
    const device = this.devices.get(deviceKey);
    if (!device) throw new Error(`Unknown device: ${deviceKey}`);

    const o = { ...(this.overrides[deviceKey] || {}) };
    if (room !== undefined) {
      const v = String(room).trim().slice(0, 40);
      if (v) { o.room = v; device.room = v; } else { delete o.room; delete device.room; }
    }
    if (icon !== undefined) {
      // emoji (max 8 chars) or a named SVG icon reference like "svg:chandelier"
      const t = String(icon).trim();
      const v = t.startsWith('svg:') ? t.slice(0, 24) : t.slice(0, 8);
      if (v) { o.icon = v; device.customIcon = v; } else { delete o.icon; delete device.customIcon; }
    }
    if (label !== undefined) {
      const v = String(label).trim().slice(0, 60);
      if (v) {
        if (device._origLabel == null) device._origLabel = device.label;
        o.label = v; device.label = v;
      } else {
        delete o.label;
        if (device._origLabel != null) { device.label = device._origLabel; delete device._origLabel; }
      }
    }

    if (planFloor !== undefined) {
      const v = String(planFloor);
      if (['cellar', 'floor1', 'floor2'].includes(v)) { o.planFloor = v; device.planFloor = v; }
      else { delete o.planFloor; delete device.planFloor; }
    }
    for (const [field, val] of [['planX', planX], ['planY', planY]]) {
      if (val === undefined) continue;
      const v = Number(val);
      if (Number.isFinite(v)) {
        o[field] = Math.min(1, Math.max(0, +v.toFixed(3)));
        device[field] = o[field];
      } else {
        delete o[field]; delete device[field];
      }
    }

    // Camera field-of-view on the home plan: viewing direction (deg, 0 = plan
    // north, clockwise), cone width (deg) and range (plan grid cells)
    for (const [field, val, lo, hi, dp] of [
      ['camAngle', camAngle, 0, 360, 1],
      ['camFov',   camFov,   20, 170, 0],
      ['camRange', camRange, 0.4, 15, 2],
    ]) {
      if (val === undefined) continue;
      const v = (val === '' || val === null) ? NaN : Number(val);
      if (Number.isFinite(v)) {
        o[field] = field === 'camAngle'
          ? +(((v % 360) + 360) % 360).toFixed(dp)
          : +Math.min(hi, Math.max(lo, v)).toFixed(dp);
        device[field] = o[field];
      } else {
        delete o[field]; delete device[field];
      }
    }

    if (Object.keys(o).length) this.overrides[deviceKey] = o;
    else delete this.overrides[deviceKey];
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(this.overrides, null, 2));

    this.emit('devices-changed');
    return device;
  }

  // Manual plan decorations (furniture emoji placed from the dashboard),
  // stored under the reserved "_decor" key: { <floor>: [{id, emoji, x, y}] }
  getDecor() {
    return this.overrides._decor || {};
  }

  _saveDecor(decor) {
    if (Object.values(decor).some((arr) => arr.length)) this.overrides._decor = decor;
    else delete this.overrides._decor;
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(this.overrides, null, 2));
    return this.getDecor();
  }

  // opts: { image, hideAuto } — image is an uploaded-picture URL used instead
  // of an emoji; hideAuto records the id of the generated room furniture this
  // item replaces (see hideAutoDecor)
  addDecor(floor, emoji, x = 0.5, y = 0.5, opts = {}) {
    if (!['cellar', 'floor1', 'floor2'].includes(floor)) throw new Error('Bad floor');
    const e = String(emoji || '').trim().slice(0, 8);
    const image = String(opts.image || '').trim().slice(0, 400);
    if (image && !/^(\/|https?:\/\/)/.test(image)) throw new Error('Bad image URL');
    if (!e && !image) throw new Error('Emoji or image required');
    const decor = { ...this.getDecor() };
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ...(image ? { image } : { emoji: e }),
      x: Math.min(1, Math.max(0, Number(x) || 0.5)),
      y: Math.min(1, Math.max(0, Number(y) || 0.5)),
    };
    if (opts.hideAuto) item.autoId = String(opts.hideAuto).slice(0, 120);
    decor[floor] = [...(decor[floor] || []), item];
    if (item.autoId) decor._hidden = [...new Set([...(decor._hidden || []), item.autoId])];
    return this._saveDecor(decor);
  }

  // Auto-generated room furniture can't be deleted from its deterministic
  // source, so hidden pieces are tracked by id under the "_hidden" key
  hideAutoDecor(autoId) {
    const id = String(autoId || '').trim().slice(0, 120);
    if (!id) throw new Error('id required');
    const decor = { ...this.getDecor() };
    decor._hidden = [...new Set([...(decor._hidden || []), id])];
    return this._saveDecor(decor);
  }

  moveDecor(id, x, y) {
    const decor = { ...this.getDecor() };
    for (const f of Object.keys(decor)) {
      if (f === '_hidden') continue;
      decor[f] = decor[f].map((it) => it.id === id
        ? { ...it, x: Math.min(1, Math.max(0, Number(x) || 0)), y: Math.min(1, Math.max(0, Number(y) || 0)) }
        : it);
    }
    return this._saveDecor(decor);
  }

  removeDecor(id) {
    const decor = { ...this.getDecor() };
    let removed = null;
    for (const f of Object.keys(decor)) {
      if (f === '_hidden') continue;
      removed = removed || decor[f].find((it) => it.id === id) || null;
      decor[f] = decor[f].filter((it) => it.id !== id);
    }
    // deleting a converted piece restores the generated one it replaced
    if (removed?.autoId && decor._hidden) decor._hidden = decor._hidden.filter((a) => a !== removed.autoId);
    this._deleteDecorImage(removed, decor);
    return this._saveDecor(decor);
  }

  // Uploaded furniture pictures live in persist/plan-decor/ — unlink the
  // backing file once no remaining decor item references it
  _deleteDecorImage(removed, decor) {
    const url = removed?.image || '';
    const m = url.match(/^\/api\/plan-decor\/img\/([a-z0-9-]+\.(?:png|jpg|webp|gif))$/);
    if (!m) return;
    const stillUsed = Object.entries(decor)
      .some(([f, arr]) => f !== '_hidden' && arr.some((it) => it.image === url));
    if (stillUsed) return;
    fs.unlink(path.join(__dirname, '..', 'persist', 'plan-decor', m[1]), () => {});
  }

  // Room metadata (icon) lives in the same overrides file under the
  // reserved "_rooms" key (device keys always contain a slash).
  getRoomMeta() {
    return this.overrides._rooms || {};
  }

  setRoomIcon(room, icon) {
    const name = String(room || '').trim().slice(0, 40);
    if (!name) throw new Error('Room name required');
    const rooms = (this.overrides._rooms = this.overrides._rooms || {});
    const v = String(icon || '').trim().slice(0, 8);
    if (v) rooms[name] = { icon: v };
    else delete rooms[name];
    if (!Object.keys(rooms).length) delete this.overrides._rooms;
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(this.overrides, null, 2));
    this.emit('rooms-changed');
    return this.getRoomMeta();
  }

  _checkTopic(topicPath) {
    const slashIdx = topicPath.indexOf('/');
    if (slashIdx === -1) return;

    const serviceType = topicPath.slice(0, slashIdx);
    if (!KNOWN_SERVICES.has(serviceType)) return;

    const rest = topicPath.slice(slashIdx + 1);
    const instanceEnd = rest.indexOf('/');
    const instance = instanceEnd === -1 ? rest : rest.slice(0, instanceEnd);
    if (!instance) return;

    const deviceKey = `${serviceType}/${instance}`;
    if (this.devices.has(deviceKey)) return;

    const def = DEVICE_TYPES[serviceType];
    const device = {
      key: deviceKey,
      type: serviceType,
      instance,
      label: `${def.label} ${parseInt(instance, 10) === 0 ? '' : instance}`.trim(),
      icon: def.icon,
      color: def.color,
      sensors: def.sensors,
      homekit: def.homekit,
    };

    translateDevice(device, this.language);
    this._applyOverride(device);
    this.devices.set(deviceKey, device);
    console.log(`[Sensors] Discovered: ${device.label} (${deviceKey})`);
    this.emit('device-discovered', device);
  }

  registerDevice(device) {
    if (this.devices.has(device.key)) return;
    translateDevice(device, this.language);
    this._applyOverride(device);
    this.devices.set(device.key, device);
    console.log(`[Sensors] Registered: ${device.label} (${device.key})`);
    this.emit('device-discovered', device);
  }

  getDevices() {
    return Array.from(this.devices.values());
  }

  getDeviceReadings(deviceKey) {
    const device = this.devices.get(deviceKey);
    if (!device) return null;

    const readings = {};
    for (const sensor of device.sensors) {
      const fullKey = `${deviceKey}/${sensor.path}`;
      const value = this.store.get(fullKey);
      if (value !== null) {
        readings[sensor.path] = { ...sensor, value, timestamp: this.store.getTimestamp(fullKey) };
      }
    }
    return { ...device, readings };
  }

  getAllReadings() {
    return this.getDevices().map((d) => this.getDeviceReadings(d.key));
  }

  async sendCommand(deviceKey, sensorPath, value) {
    const device = this.devices.get(deviceKey);
    if (!device || !device._writeCapability) throw new Error('Device not found or not writable');
    const sensor = device.sensors.find((s) => s.path === sensorPath);
    if (!sensor || !sensor.controllable) throw new Error('Sensor not controllable');

    if (sensor.type === 'range' || sensor.type === 'color-temp') {
      return device._writeCapability(sensor.capabilityId, sensor.writeCmd, [value]);
    }
    if (sensor.type === 'text') {
      // Arbitrary string value (e.g. a virtual text sensor fed by a script/
      // webhook) — same shape as 'range', just no numeric coercion.
      return device._writeCapability(sensor.capabilityId, sensor.writeCmd, [value]);
    }
    if (sensor.type === 'color') {
      // Dashboard sends { hue: 0-100, saturation: 0-100 }; Loxone (and other
      // Virtual-Output senders) send a scalar — a composite RGB number
      // (r + g*1000 + b*1000000, each 0-100) or an "h,s" / "r,g,b" string.
      const c = normalizeColor(value);
      if (!c) throw new Error('Invalid colour value');
      // A composite also carries brightness — drive the light's level too, so
      // one Loxone colour output controls both hue and dimming.
      if (c.level != null) {
        const lvl = device.sensors.find((s) => s.path === 'level' && s.controllable);
        if (lvl) {
          try { await device._writeCapability(lvl.capabilityId, lvl.writeCmd || 'setLevel', [c.level]); }
          catch { /* colour still applies even if brightness write fails */ }
        }
      }
      return device._writeCapability(sensor.capabilityId, 'setColor', [{ hue: c.hue, saturation: c.saturation }]);
    }
    // toggle: normalize string 'on'/'off'/'1'/'0' and boolean/number values
    const on = value === true || value === 1 || value === 'on' || value === '1' || value === 'true';
    const command = on ? sensor.writeOn : sensor.writeOff;
    return device._writeCapability(sensor.capabilityId, command);
  }
}

// ── Colour value normalisation (dashboard object, or Loxone/VO scalar) ───────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function rgbToHsv(r, g, b) { // 0-255 → { h:0-360, s:0-100, v:0-100 }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: (max ? d / max : 0) * 100, v: max * 100 };
}

// Returns { hue:0-100, saturation:0-100, level?:0-100 } or null.
function normalizeColor(value) {
  if (value && typeof value === 'object') {
    if (value.hue != null && value.saturation != null) {
      return { hue: clamp(Number(value.hue), 0, 100), saturation: clamp(Number(value.saturation), 0, 100) };
    }
    return null;
  }
  const str = String(value).trim();
  if (str.includes(',')) {
    const p = str.split(',').map(Number);
    if (p.length === 2 && p.every(Number.isFinite)) {
      return { hue: clamp(p[0], 0, 100), saturation: clamp(p[1], 0, 100) };
    }
    if (p.length === 3 && p.every(Number.isFinite)) { // r,g,b 0-255
      const { h, s, v } = rgbToHsv(p[0], p[1], p[2]);
      return { hue: Math.round(h / 3.6), saturation: Math.round(s), level: Math.round(v) };
    }
    return null;
  }
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0 || n > 100100100) return null;
  // Loxone RGB composite: value = r + g*1000 + b*1000000, each channel 0-100.
  const r = n % 1000, g = Math.floor(n / 1000) % 1000, b = Math.floor(n / 1000000);
  const { h, s, v } = rgbToHsv((r / 100) * 255, (g / 100) * 255, (b / 100) * 255);
  return { hue: Math.round(h / 3.6), saturation: Math.round(s), level: Math.round(v) };
}

SensorRegistry._normalizeColor = normalizeColor; // exported for tests

module.exports = SensorRegistry;
