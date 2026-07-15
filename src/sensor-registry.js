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
  }

  // Persist a user customization and apply it to the live descriptor.
  // Empty-string fields clear the override for that field.
  setOverride(deviceKey, { room, icon, label } = {}) {
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

    if (Object.keys(o).length) this.overrides[deviceKey] = o;
    else delete this.overrides[deviceKey];
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(this.overrides, null, 2));

    this.emit('devices-changed');
    return device;
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
