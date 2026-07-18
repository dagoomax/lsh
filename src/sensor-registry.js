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
      const v = String(icon).trim().slice(0, 8);
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

  addDecor(floor, emoji, x = 0.5, y = 0.5) {
    if (!['cellar', 'floor1', 'floor2'].includes(floor)) throw new Error('Bad floor');
    const e = String(emoji || '').trim().slice(0, 8);
    if (!e) throw new Error('Emoji required');
    const decor = { ...this.getDecor() };
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      emoji: e,
      x: Math.min(1, Math.max(0, Number(x) || 0.5)),
      y: Math.min(1, Math.max(0, Number(y) || 0.5)),
    };
    decor[floor] = [...(decor[floor] || []), item];
    return this._saveDecor(decor);
  }

  moveDecor(id, x, y) {
    const decor = { ...this.getDecor() };
    for (const f of Object.keys(decor)) {
      decor[f] = decor[f].map((it) => it.id === id
        ? { ...it, x: Math.min(1, Math.max(0, Number(x) || 0)), y: Math.min(1, Math.max(0, Number(y) || 0)) }
        : it);
    }
    return this._saveDecor(decor);
  }

  removeDecor(id) {
    const decor = { ...this.getDecor() };
    for (const f of Object.keys(decor)) decor[f] = decor[f].filter((it) => it.id !== id);
    return this._saveDecor(decor);
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
        readings[sensor.path] = { ...sensor, value };
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
    if (sensor.type === 'color') {
      // value = { hue: 0-100, saturation: 0-100 }
      return device._writeCapability(sensor.capabilityId, 'setColor', [value]);
    }
    // toggle: normalize string 'on'/'off'/'1'/'0' and boolean/number values
    const on = value === true || value === 1 || value === 'on' || value === '1' || value === 'true';
    const command = on ? sensor.writeOn : sensor.writeOff;
    return device._writeCapability(sensor.capabilityId, command);
  }
}

module.exports = SensorRegistry;
