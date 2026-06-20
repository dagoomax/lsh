const hap = require('hap-nodejs');
const { generateSetupUri } = require('./homekit-uri');

const {
  Accessory,
  Bridge,
  Characteristic,
  Service,
  Categories,
  HAPStatus,
  uuid,
} = hap;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeUUID(key) {
  return uuid.generate(`victron-${key}`);
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val ?? min));
}

function setInfo(accessory, manufacturer, model, serial) {
  accessory.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, manufacturer)
    .setCharacteristic(Characteristic.Model, model)
    .setCharacteristic(Characteristic.SerialNumber, serial);
}

// ── Per-service builders ──────────────────────────────────────────────────

/**
 * Adds a TemperatureSensor service.
 * storePath: full MQTT path like 'solarcharger/0/Temperature'
 */
function addTemperatureService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.TemperatureSensor, name);

  svc.getCharacteristic(Characteristic.CurrentTemperature)
    .setProps({ minValue: -100, maxValue: 100 })
    .onGet(() => clamp(store.get(storePath), -100, 100));

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.CurrentTemperature)
        .updateValue(clamp(value, -100, 100));
    }
  });

  return svc;
}

/**
 * Adds a HumiditySensor service (also used for tank level 0-100%).
 */
function addHumidityService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.HumiditySensor, name);

  svc.getCharacteristic(Characteristic.CurrentRelativeHumidity)
    .onGet(() => clamp(store.get(storePath), 0, 100));

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .updateValue(clamp(value, 0, 100));
    }
  });

  return svc;
}

/**
 * Adds a BatteryService (level + charging state + low battery).
 */
function addBatteryService(accessory, deviceKey, store) {
  const svc = accessory.addService(Service.Battery, 'Battery');

  const socPath       = `${deviceKey}/Soc`;
  const statePath     = `${deviceKey}/State`;
  const lowSocPath    = `${deviceKey}/Alarms/LowSoc`;

  // Battery level 0-100
  svc.getCharacteristic(Characteristic.BatteryLevel)
    .onGet(() => clamp(store.get(socPath), 0, 100));

  // ChargingState: 0=Not Charging, 1=Charging, 2=Not Chargeable
  svc.getCharacteristic(Characteristic.ChargingState)
    .onGet(() => {
      const state = store.get(statePath); // 0=idle,1=charging,2=discharging
      return state === 1 ? 1 : 0;
    });

  // StatusLowBattery: 0=Normal, 1=Low
  svc.getCharacteristic(Characteristic.StatusLowBattery)
    .onGet(() => (store.get(lowSocPath) === 1 ? 1 : 0));

  store.on('change', ({ key, value }) => {
    if (key === socPath)
      svc.getCharacteristic(Characteristic.BatteryLevel).updateValue(clamp(value, 0, 100));
    if (key === statePath)
      svc.getCharacteristic(Characteristic.ChargingState).updateValue(value === 1 ? 1 : 0);
    if (key === lowSocPath)
      svc.getCharacteristic(Characteristic.StatusLowBattery).updateValue(value === 1 ? 1 : 0);
  });

  return svc;
}

/**
 * Adds a Switch service with optional write-back via writeCallback(command).
 * storePath value: 1=on, 0=off
 */
function addSwitchService(accessory, name, storePath, store, writeCallback) {
  const svc = accessory.addService(Service.Switch, name);

  svc.getCharacteristic(Characteristic.On)
    .onGet(() => store.get(storePath) === 1)
    .onSet(async (value) => {
      if (!writeCallback) return;
      try {
        await writeCallback(value ? 'on' : 'off');
        store.update(storePath, value ? 1 : 0);
      } catch (err) {
        console.error(`[HomeKit] Switch set failed for ${name}:`, err.message);
        throw new hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.On).updateValue(value === 1);
    }
  });

  return svc;
}

/**
 * Adds a simple battery level service (0-100%) without charging state.
 * Used for external sensors that only expose a battery percentage.
 */
function addBatteryLevelService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.Battery, name);

  svc.getCharacteristic(Characteristic.BatteryLevel)
    .onGet(() => clamp(store.get(storePath), 0, 100));

  svc.getCharacteristic(Characteristic.StatusLowBattery)
    .onGet(() => (store.get(storePath) ?? 100) < 20 ? 1 : 0);

  svc.getCharacteristic(Characteristic.ChargingState)
    .onGet(() => 2); // 2 = Not Chargeable (external sensor)

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.BatteryLevel).updateValue(clamp(value, 0, 100));
      svc.getCharacteristic(Characteristic.StatusLowBattery).updateValue(value < 20 ? 1 : 0);
    }
  });

  return svc;
}

/**
 * Adds a MotionSensor service.
 * store value: 1=motion detected, 0=no motion
 */
function addMotionService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.MotionSensor, name);

  svc.getCharacteristic(Characteristic.MotionDetected)
    .onGet(() => store.get(storePath) === 1);

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.MotionDetected).updateValue(value === 1);
    }
  });

  return svc;
}

/**
 * Adds a SmokeSensor service.
 * store value: 1=smoke, 0=clear
 */
function addSmokeSensorService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.SmokeSensor, name);

  svc.getCharacteristic(Characteristic.SmokeDetected)
    .onGet(() => store.get(storePath) === 1 ? 1 : 0);

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.SmokeDetected).updateValue(value === 1 ? 1 : 0);
    }
  });

  return svc;
}

/**
 * Adds a CarbonMonoxideSensor service.
 * store value: 1=detected, 0=clear
 */
function addCOSensorService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.CarbonMonoxideSensor, name);

  svc.getCharacteristic(Characteristic.CarbonMonoxideDetected)
    .onGet(() => store.get(storePath) === 1 ? 1 : 0);

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.CarbonMonoxideDetected).updateValue(value === 1 ? 1 : 0);
    }
  });

  return svc;
}

/**
 * Adds a LeakSensor service.
 * store value: 1=leak, 0=dry
 */
function addLeakSensorService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.LeakSensor, name);

  svc.getCharacteristic(Characteristic.LeakDetected)
    .onGet(() => store.get(storePath) === 1 ? 1 : 0);

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.LeakDetected).updateValue(value === 1 ? 1 : 0);
    }
  });

  return svc;
}

/**
 * Adds an OccupancySensor service.
 * store value: 1=occupied/present, 0=unoccupied
 */
function addOccupancySensorService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.OccupancySensor, name);

  svc.getCharacteristic(Characteristic.OccupancyDetected)
    .onGet(() => store.get(storePath) === 1 ? 1 : 0);

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.OccupancyDetected).updateValue(value === 1 ? 1 : 0);
    }
  });

  return svc;
}

/**
 * Adds a ContactSensor service.
 * 0 = contact detected (closed/normal), 1 = contact not detected (open/alarm)
 */
function addContactService(accessory, name, storePath, store, activeOnValue = 1) {
  const svc = accessory.addService(Service.ContactSensor, name);

  svc.getCharacteristic(Characteristic.ContactSensorState)
    .onGet(() => {
      const v = store.get(storePath);
      // ContactSensorState: 0=CONTACT_DETECTED, 1=CONTACT_NOT_DETECTED
      return v === activeOnValue ? 1 : 0;
    });

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(value === activeOnValue ? 1 : 0);
    }
  });

  return svc;
}

// ── Device accessory builders ──────────────────────────────────────────────

function buildDeviceAccessory(device, store) {
  const acc = new Accessory(device.label, makeUUID(device.key));
  const manufacturer = device.type === 'smartthings' ? 'Samsung SmartThings' : 'Victron Energy';
  setInfo(acc, manufacturer, device.label, device.key);

  for (const hkType of device.homekit) {
    if (hkType === 'temperature') {
      const s = device.sensors.find((s) => s.homekit === 'temperature');
      if (s) addTemperatureService(acc, `${device.label} Temperature`, `${device.key}/${s.path}`, store);
    }

    if (hkType === 'humidity') {
      const s = device.sensors.find((s) => s.homekit === 'humidity');
      if (s) addHumidityService(acc, `${device.label} Humidity`, `${device.key}/${s.path}`, store);
    }

    if (hkType === 'tank') {
      const s = device.sensors.find((s) => s.homekit === 'tank-level');
      if (s) addHumidityService(acc, `${device.label} Level`, `${device.key}/${s.path}`, store);
    }

    if (hkType === 'battery') {
      addBatteryService(acc, device.key, store);
    }

    if (hkType === 'contact') {
      const s = device.sensors.find((s) => s.homekit === 'contact');
      if (s) addContactService(acc, device.label, `${device.key}/${s.path}`, store, 1);
    }

    if (hkType === 'switch-rw') {
      const s = device.sensors.find((s) => s.homekit === 'switch-rw');
      if (s && device._writeCapability) {
        const writeCallback = (command) => device._writeCapability(s.capabilityId, command);
        addSwitchService(acc, device.label, `${device.key}/${s.path}`, store, writeCallback);
      }
    }

    if (hkType === 'battery-level') {
      const s = device.sensors.find((s) => s.homekit === 'battery-level');
      if (s) addBatteryLevelService(acc, `${device.label} Battery`, `${device.key}/${s.path}`, store);
    }

    if (hkType === 'motion') {
      const s = device.sensors.find((s) => s.homekit === 'motion');
      if (s) addMotionService(acc, `${device.label} Motion`, `${device.key}/${s.path}`, store);
    }

    if (hkType === 'smoke') {
      const s = device.sensors.find((s) => s.homekit === 'smoke');
      if (s) addSmokeSensorService(acc, `${device.label} Smoke`, `${device.key}/${s.path}`, store);
    }

    if (hkType === 'co') {
      const s = device.sensors.find((s) => s.homekit === 'co');
      if (s) addCOSensorService(acc, `${device.label} CO`, `${device.key}/${s.path}`, store);
    }

    if (hkType === 'leak') {
      const s = device.sensors.find((s) => s.homekit === 'leak');
      if (s) addLeakSensorService(acc, `${device.label} Leak`, `${device.key}/${s.path}`, store);
    }

    if (hkType === 'occupancy') {
      const s = device.sensors.find((s) => s.homekit === 'occupancy');
      if (s) addOccupancySensorService(acc, `${device.label} Presence`, `${device.key}/${s.path}`, store);
    }
  }

  return acc;
}

// ── Main bridge factory ────────────────────────────────────────────────────

function startHomekitBridge(config, store, relayController, sensorRegistry) {
  const bridge = new Bridge('Victron Energy', makeUUID('bridge'));

  setInfo(bridge, 'Victron Energy', 'Cerbo GX Dashboard', 'VICTRON-001');

  // ── Relay switches (from config) ──────────────────────────
  for (const relay of config.relays) {
    const acc = new Accessory(relay.name, makeUUID(`relay-${relay.index}`));
    setInfo(acc, 'Victron Energy', 'GX Relay', `RELAY-${relay.index}`);

    const switchSvc = acc.addService(Service.Switch, relay.name);

    switchSvc.getCharacteristic(Characteristic.On)
      .onGet(() => relayController.getState(relay.index))
      .onSet(async (value) => {
        try {
          await relayController.setState(relay.index, value ? 1 : 0);
        } catch (err) {
          console.error(`[HomeKit] Relay ${relay.index} set failed:`, err.message);
        }
      });

    store.on('change', ({ key, value }) => {
      if (key === `system/0/Relay/${relay.index}/State`) {
        switchSvc.getCharacteristic(Characteristic.On).updateValue(value === 1);
      }
    });

    bridge.addBridgedAccessory(acc);
    console.log(`[HomeKit] Relay switch: ${relay.name}`);
  }

  // ── Sensor accessories (auto-discovered from MQTT) ────────
  if (sensorRegistry) {
    // Handle devices discovered before HomeKit started
    for (const device of sensorRegistry.getDevices()) {
      if (device.homekit.length > 0) {
        const acc = buildDeviceAccessory(device, store);
        bridge.addBridgedAccessory(acc);
        console.log(`[HomeKit] Sensor: ${device.label} (${device.homekit.join(', ')})`);
      }
    }

    // Handle devices discovered after HomeKit started
    sensorRegistry.on('device-discovered', (device) => {
      if (device.homekit.length === 0) return;
      try {
        const acc = buildDeviceAccessory(device, store);
        bridge.addBridgedAccessory(acc);
        console.log(`[HomeKit] Sensor added: ${device.label} (${device.homekit.join(', ')})`);
      } catch (err) {
        console.error(`[HomeKit] Failed to add ${device.label}:`, err.message);
      }
    });
  }

  // ── Publish ────────────────────────────────────────────────
  if (config.homekit.setupID) {
    bridge._setupID = config.homekit.setupID;
  }

  bridge.publish({
    username: config.homekit.username,
    pincode: config.homekit.pin,
    port: config.homekit.port,
    category: Categories.BRIDGE,
  });

  const uri = generateSetupUri(config.homekit.pin, config.homekit.setupID);
  console.log(`[HomeKit] Bridge on port ${config.homekit.port}  PIN: ${config.homekit.pin}`);
  console.log(`[HomeKit] Setup URI: ${uri}`);

  return bridge;
}

module.exports = startHomekitBridge;
