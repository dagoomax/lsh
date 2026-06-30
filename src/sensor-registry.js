const { EventEmitter } = require('events');
const { DEVICE_TYPES, KNOWN_SERVICES } = require('./device-definitions');

class SensorRegistry extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.devices = new Map(); // deviceKey → device descriptor
    this.setMaxListeners(100);

    store.on('change', ({ key }) => this._checkTopic(key));
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

    this.devices.set(deviceKey, device);
    console.log(`[Sensors] Discovered: ${device.label} (${deviceKey})`);
    this.emit('device-discovered', device);
  }

  registerDevice(device) {
    if (this.devices.has(device.key)) return;
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
