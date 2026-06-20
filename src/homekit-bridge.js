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
 * Adds a Lightbulb service.
 * options: { hasLevel, hasColor, hasColorTemp }
 * Store paths: deviceKey/switch, /level, /hue (0-100), /saturation (0-100), /colorTemperature (K)
 */
function addLightbulbService(accessory, name, deviceKey, store, writeCapability, options = {}) {
  const svc = accessory.addService(Service.Lightbulb, name);

  const swPath    = `${deviceKey}/switch`;
  const levelPath = `${deviceKey}/level`;
  const huePath   = `${deviceKey}/hue`;
  const satPath   = `${deviceKey}/saturation`;
  const ctPath    = `${deviceKey}/colorTemperature`;

  svc.getCharacteristic(Characteristic.On)
    .onGet(() => store.get(swPath) === 1)
    .onSet(async (v) => {
      await writeCapability('switch', v ? 'on' : 'off');
      store.update(swPath, v ? 1 : 0);
    });

  if (options.hasLevel) {
    svc.getCharacteristic(Characteristic.Brightness)
      .onGet(() => clamp(store.get(levelPath), 0, 100))
      .onSet(async (v) => {
        await writeCapability('switchLevel', 'setLevel', [v]);
        store.update(levelPath, v);
      });
  }

  if (options.hasColor) {
    // SmartThings hue: 0-100 → HomeKit: 0-360
    svc.getCharacteristic(Characteristic.Hue)
      .onGet(() => clamp((store.get(huePath) ?? 0) * 3.6, 0, 360))
      .onSet(async (v) => {
        const stHue = Math.round(v / 3.6);
        const sat   = store.get(satPath) ?? 100;
        await writeCapability('colorControl', 'setColor', [{ hue: stHue, saturation: sat }]);
        store.update(huePath, stHue);
      });

    svc.getCharacteristic(Characteristic.Saturation)
      .onGet(() => clamp(store.get(satPath), 0, 100))
      .onSet(async (v) => {
        const hue = store.get(huePath) ?? 0;
        await writeCapability('colorControl', 'setColor', [{ hue, saturation: v }]);
        store.update(satPath, v);
      });
  }

  if (options.hasColorTemp) {
    // SmartThings: Kelvin → HomeKit: mired (1,000,000 / K), clamped 140–500
    svc.getCharacteristic(Characteristic.ColorTemperature)
      .setProps({ minValue: 140, maxValue: 500 })
      .onGet(() => {
        const k = store.get(ctPath) || 4000;
        return clamp(Math.round(1000000 / k), 140, 500);
      })
      .onSet(async (mireds) => {
        const k = Math.round(1000000 / mireds);
        await writeCapability('colorTemperature', 'setColorTemperature', [k]);
        store.update(ctPath, k);
      });
  }

  store.on('change', ({ key, value }) => {
    if (key === swPath)    svc.getCharacteristic(Characteristic.On).updateValue(value === 1);
    if (key === levelPath) svc.getCharacteristic(Characteristic.Brightness)?.updateValue(clamp(value, 0, 100));
    if (key === huePath)   svc.getCharacteristic(Characteristic.Hue)?.updateValue(clamp(value * 3.6, 0, 360));
    if (key === satPath)   svc.getCharacteristic(Characteristic.Saturation)?.updateValue(clamp(value, 0, 100));
    if (key === ctPath)    svc.getCharacteristic(Characteristic.ColorTemperature)?.updateValue(clamp(Math.round(1000000 / value), 140, 500));
  });

  return svc;
}

/**
 * Adds a LightSensor service.
 * storePath value: lux (0.0001–100000)
 */
function addLightSensorService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.LightSensor, name);

  svc.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
    .setProps({ minValue: 0.0001, maxValue: 100000 })
    .onGet(() => Math.max(0.0001, store.get(storePath) ?? 0.0001));

  store.on('change', ({ key, value }) => {
    if (key === storePath)
      svc.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
        .updateValue(Math.max(0.0001, value));
  });

  return svc;
}

/**
 * Adds a LockMechanism service.
 * store value: 0=unlocked, 1=locked
 */
function addLockService(accessory, name, storePath, store, writeCallback) {
  const svc = accessory.addService(Service.LockMechanism, name);

  // CurrentState: 0=unsecured, 1=secured, 2=jammed, 3=unknown
  svc.getCharacteristic(Characteristic.LockCurrentState)
    .onGet(() => store.get(storePath) === 1 ? 1 : 0);

  // TargetState: 0=unsecured, 1=secured
  svc.getCharacteristic(Characteristic.LockTargetState)
    .onGet(() => store.get(storePath) === 1 ? 1 : 0)
    .onSet(async (v) => {
      if (!writeCallback) return;
      await writeCallback(v === 1 ? 'lock' : 'unlock');
      store.update(storePath, v);
    });

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      const locked = value === 1 ? 1 : 0;
      svc.getCharacteristic(Characteristic.LockCurrentState).updateValue(locked);
      svc.getCharacteristic(Characteristic.LockTargetState).updateValue(locked);
    }
  });

  return svc;
}

/**
 * Adds a WindowCovering service.
 * store value: 0=closed, 1=open (binary) OR 0-100 (position %)
 * If levelPath is provided, uses that for position; otherwise binary.
 */
function addWindowCoveringService(accessory, name, storePath, store, writeCallback, levelPath) {
  const svc = accessory.addService(Service.WindowCovering, name);

  function getPos() {
    if (levelPath) return clamp(store.get(levelPath) ?? 0, 0, 100);
    return store.get(storePath) === 1 ? 100 : 0;
  }

  svc.getCharacteristic(Characteristic.CurrentPosition)
    .onGet(getPos);

  svc.getCharacteristic(Characteristic.TargetPosition)
    .onGet(getPos)
    .onSet(async (v) => {
      if (!writeCallback) return;
      if (levelPath) {
        await writeCallback('setLevel', [v]);
        store.update(levelPath, v);
      } else {
        const cmd = v >= 50 ? 'open' : 'close';
        await writeCallback(cmd);
        store.update(storePath, v >= 50 ? 1 : 0);
      }
    });

  svc.getCharacteristic(Characteristic.PositionState)
    .onGet(() => 2); // 2 = STOPPED

  const update = () => {
    const pos = getPos();
    svc.getCharacteristic(Characteristic.CurrentPosition).updateValue(pos);
    svc.getCharacteristic(Characteristic.TargetPosition).updateValue(pos);
  };

  store.on('change', ({ key }) => {
    if (key === storePath || key === levelPath) update();
  });

  return svc;
}

/**
 * Adds a GarageDoorOpener service.
 * store value: 0=closed, 1=open
 */
function addDoorService(accessory, name, storePath, store, writeCallback) {
  const svc = accessory.addService(Service.GarageDoorOpener, name);

  // CurrentDoorState: 0=open, 1=closed, 2=opening, 3=closing, 4=stopped
  svc.getCharacteristic(Characteristic.CurrentDoorState)
    .onGet(() => store.get(storePath) === 1 ? 0 : 1);

  // TargetDoorState: 0=open, 1=closed
  svc.getCharacteristic(Characteristic.TargetDoorState)
    .onGet(() => store.get(storePath) === 1 ? 0 : 1)
    .onSet(async (v) => {
      if (!writeCallback) return;
      await writeCallback(v === 0 ? 'open' : 'close');
      store.update(storePath, v === 0 ? 1 : 0);
    });

  svc.getCharacteristic(Characteristic.ObstructionDetected)
    .onGet(() => false);

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      const state = value === 1 ? 0 : 1; // 0=open, 1=closed
      svc.getCharacteristic(Characteristic.CurrentDoorState).updateValue(state);
      svc.getCharacteristic(Characteristic.TargetDoorState).updateValue(state);
    }
  });

  return svc;
}

/**
 * Adds a Fan service.
 * storePath: on/off (1/0). speedPath: 0-100 (optional).
 */
function addFanService(accessory, name, storePath, store, writeCallback, speedPath) {
  const svc = accessory.addService(Service.Fanv2, name);

  // Active: 0=inactive, 1=active
  svc.getCharacteristic(Characteristic.Active)
    .onGet(() => store.get(storePath) === 1 ? 1 : 0)
    .onSet(async (v) => {
      if (!writeCallback) return;
      await writeCallback(v === 1 ? 'on' : 'off');
      store.update(storePath, v === 1 ? 1 : 0);
    });

  if (speedPath) {
    svc.getCharacteristic(Characteristic.RotationSpeed)
      .onGet(() => clamp(store.get(speedPath) ?? 0, 0, 100))
      .onSet(async (v) => {
        if (!writeCallback) return;
        await writeCallback('setLevel', [v]);
        store.update(speedPath, v);
      });
  }

  store.on('change', ({ key, value }) => {
    if (key === storePath)  svc.getCharacteristic(Characteristic.Active).updateValue(value === 1 ? 1 : 0);
    if (key === speedPath)  svc.getCharacteristic(Characteristic.RotationSpeed)?.updateValue(clamp(value, 0, 100));
  });

  return svc;
}

/**
 * Adds a Thermostat service.
 * Supports SmartThings thermostat capabilities.
 * Store paths: deviceKey/thermostatMode (string), /thermostatOperatingState (string),
 *   /temperature (°C), /heatingSetpoint (°C), /coolingSetpoint (°C)
 */
function addThermostatService(accessory, name, deviceKey, store, writeCapability) {
  const svc = accessory.addService(Service.Thermostat, name);

  const modePath    = `${deviceKey}/thermostatMode`;
  const opStatePath = `${deviceKey}/thermostatOperatingState`;
  const tempPath    = `${deviceKey}/temperature`;
  const heatSetPath = `${deviceKey}/heatingSetpoint`;
  const coolSetPath = `${deviceKey}/coolingSetpoint`;

  function stModeToHK(mode) {
    if (mode === 'heat') return 1;
    if (mode === 'cool') return 2;
    if (mode === 'auto') return 3;
    return 0;
  }
  function hkModeToST(v) {
    if (v === 1) return 'heat';
    if (v === 2) return 'cool';
    if (v === 3) return 'auto';
    return 'off';
  }
  function stOpToHK(state) {
    if (state === 'heating') return 1;
    if (state === 'cooling') return 2;
    return 0;
  }

  svc.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    .onGet(() => stOpToHK(store.get(opStatePath)));

  svc.getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .onGet(() => stModeToHK(store.get(modePath)))
    .onSet(async (v) => {
      if (!writeCapability) return;
      const mode = hkModeToST(v);
      await writeCapability('thermostatMode', 'setThermostatMode', [mode]);
      store.update(modePath, mode);
    });

  svc.getCharacteristic(Characteristic.CurrentTemperature)
    .setProps({ minValue: -20, maxValue: 60 })
    .onGet(() => clamp(store.get(tempPath) ?? 20, -20, 60));

  svc.getCharacteristic(Characteristic.TargetTemperature)
    .setProps({ minValue: 4, maxValue: 38, minStep: 0.5 })
    .onGet(() => {
      const mode = store.get(modePath);
      if (mode === 'cool') return clamp(store.get(coolSetPath) ?? 24, 4, 38);
      return clamp(store.get(heatSetPath) ?? 20, 4, 38);
    })
    .onSet(async (v) => {
      if (!writeCapability) return;
      const mode = store.get(modePath);
      if (mode === 'cool') {
        await writeCapability('thermostatCoolingSetpoint', 'setCoolingSetpoint', [v]);
        store.update(coolSetPath, v);
      } else {
        await writeCapability('thermostatHeatingSetpoint', 'setHeatingSetpoint', [v]);
        store.update(heatSetPath, v);
      }
    });

  svc.getCharacteristic(Characteristic.TemperatureDisplayUnits)
    .onGet(() => 0)
    .onSet(() => {});

  svc.getCharacteristic(Characteristic.HeatingThresholdTemperature)
    .setProps({ minValue: 4, maxValue: 38, minStep: 0.5 })
    .onGet(() => clamp(store.get(heatSetPath) ?? 20, 4, 38))
    .onSet(async (v) => {
      if (!writeCapability) return;
      await writeCapability('thermostatHeatingSetpoint', 'setHeatingSetpoint', [v]);
      store.update(heatSetPath, v);
    });

  svc.getCharacteristic(Characteristic.CoolingThresholdTemperature)
    .setProps({ minValue: 10, maxValue: 35, minStep: 0.5 })
    .onGet(() => clamp(store.get(coolSetPath) ?? 24, 10, 35))
    .onSet(async (v) => {
      if (!writeCapability) return;
      await writeCapability('thermostatCoolingSetpoint', 'setCoolingSetpoint', [v]);
      store.update(coolSetPath, v);
    });

  store.on('change', ({ key, value }) => {
    if (key === opStatePath)
      svc.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(stOpToHK(value));
    if (key === modePath)
      svc.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(stModeToHK(value));
    if (key === tempPath)
      svc.getCharacteristic(Characteristic.CurrentTemperature).updateValue(clamp(value, -20, 60));
    if (key === heatSetPath) {
      svc.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(clamp(value, 4, 38));
      if (store.get(modePath) !== 'cool')
        svc.getCharacteristic(Characteristic.TargetTemperature).updateValue(clamp(value, 4, 38));
    }
    if (key === coolSetPath) {
      svc.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(clamp(value, 10, 35));
      if (store.get(modePath) === 'cool')
        svc.getCharacteristic(Characteristic.TargetTemperature).updateValue(clamp(value, 4, 38));
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

    if (hkType === 'light-rw') {
      const hasSwitchLevel = device.sensors.some(s => s.path === 'level');
      const hasColor       = device.sensors.some(s => s.path === 'hue');
      const hasColorTemp   = device.sensors.some(s => s.path === 'colorTemperature');
      if (device._writeCapability) {
        addLightbulbService(acc, device.label, device.key, store, device._writeCapability, {
          hasLevel:     hasSwitchLevel,
          hasColor,
          hasColorTemp,
        });
      }
    }

    if (hkType === 'lock-rw') {
      const s = device.sensors.find(s => s.path === 'lock');
      if (s && device._writeCapability) {
        addLockService(acc, device.label, `${device.key}/${s.path}`, store,
          (cmd) => device._writeCapability('lock', cmd));
      }
    }

    if (hkType === 'cover-rw') {
      const s      = device.sensors.find(s => s.path === 'windowShade');
      const level  = device.sensors.find(s => s.path === 'level');
      if (s && device._writeCapability) {
        addWindowCoveringService(acc, device.label, `${device.key}/${s.path}`, store,
          (cmd, args = []) => device._writeCapability('windowShade', cmd, args),
          level ? `${device.key}/${level.path}` : null);
      }
    }

    if (hkType === 'door-rw') {
      const s = device.sensors.find(s => s.path === 'door');
      if (s && device._writeCapability) {
        addDoorService(acc, device.label, `${device.key}/${s.path}`, store,
          (cmd) => device._writeCapability('doorControl', cmd));
      }
    }

    if (hkType === 'fan-rw') {
      const s     = device.sensors.find(s => s.path === 'switch');
      const speed = device.sensors.find(s => s.path === 'level');
      if (s && device._writeCapability) {
        addFanService(acc, device.label, `${device.key}/${s.path}`, store,
          (cmd, args = []) => {
            if (cmd === 'setLevel') return device._writeCapability('switchLevel', 'setLevel', args);
            return device._writeCapability('switch', cmd);
          },
          speed ? `${device.key}/${speed.path}` : null);
      }
    }

    if (hkType === 'thermostat') {
      if (device._writeCapability) {
        addThermostatService(acc, device.label, device.key, store, device._writeCapability);
      }
    }

    if (hkType === 'lux') {
      const s = device.sensors.find(s => s.path === 'illuminance');
      if (s) addLightSensorService(acc, `${device.label} Light`, `${device.key}/${s.path}`, store);
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
