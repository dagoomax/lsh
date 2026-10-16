const fs = require('fs');
const path = require('path');
const hap = require('hap-nodejs');
const { generateSetupUri } = require('./homekit-uri');
const { CameraDelegate, buildStreamingOptions, buildRecordingOptions } = require('./homekit-camera');

const {
  Accessory,
  Bridge,
  CameraController,
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

// Duplicated (not imported) from object-detection.js's identical helper —
// that module hard-requires @tensorflow/tfjs et al. at load time, and
// homekit-bridge.js is loaded via tryRequire; pulling it in here would mean
// a missing optional TF dependency silently disables all of HomeKit, not
// just object detection.
function slugifyCamName(name) {
  return (name || 'camera').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'camera';
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val ?? min));
}

function setInfo(accessory, manufacturer, model, serial) {
  accessory.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, manufacturer)
    .setCharacteristic(Characteristic.Model, model)
    .setCharacteristic(Characteristic.SerialNumber, String(serial).slice(-64)); // HAP: max 64 characters
}

// ── Multi-bridge pool (HAP's own hard cap: 149 bridged accessories) ───────
//
// HAP-NodeJS enforces Apple's actual HomeKit limit itself — Accessory.js's
// addBridgedAccessory() throws "Cannot Bridge more than 149 Accessories"
// once a single Bridge hits it (150 total including the bridge itself, the
// spec's real ceiling). There's no way around a second, independently-paired
// Bridge once a home exceeds that — HomeKit has no concept of one bridge
// "continuing" onto another, so an overflow bridge is a genuinely separate
// accessory the user has to add in the Home app a second time.
//
// The first bridge keeps its exact pre-existing identity (UUID, name,
// serial, username, port, setupID) so this change is invisible to anyone
// already paired — only homes with >149 bridged accessories ever see a
// second bridge appear at all.
const MAX_ACCESSORIES_PER_BRIDGE = 149;

// Derives a stable-but-distinct MAC-formatted username for an overflow
// bridge by incrementing the base username's last byte — HAP-NodeJS keys
// each bridge's persisted pairing/AccessoryInfo by this string, so it must
// both look like a MAC (documented format, e.g. "CC:22:3D:E3:CE:F6") and
// stay identical across restarts, or every restart would force a re-pair.
function deriveUsername(base, index) {
  const bytes = String(base || 'CC:22:3D:E3:CE:F6').split(':').map((h) => parseInt(h, 16) || 0);
  bytes[5] = (bytes[5] + index) & 0xff;
  return bytes.map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

// Same stability requirement as deriveUsername, for the 4-char setup code
// embedded in the QR/manual-pairing URI (see homekit-uri.js) — hashed
// rather than incremented since it isn't numeric/ordered like a MAC byte.
function deriveSetupID(base, index) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const hash = require('crypto').createHash('sha1').update(`${base || 'HEJX'}-${index}`).digest();
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[hash[i] % chars.length];
  return id;
}

class BridgePool {
  constructor(homekitConfig) {
    this.config = homekitConfig;
    this.bridges = [];
    this._addBridge();
  }

  _addBridge() {
    const index = this.bridges.length; // 0 = primary, unchanged identity
    const baseName = this.config.name || 'Victron Energy'; // config.homekit.name overrides the bridge's HomeKit display name
    const name = index === 0 ? baseName : `${baseName} ${index + 1}`;
    const bridge = new Bridge(name, makeUUID(index === 0 ? 'bridge' : `bridge-${index + 1}`));
    setInfo(bridge, 'Victron Energy', 'Cerbo GX Dashboard', index === 0 ? 'VICTRON-001' : `VICTRON-00${index + 1}`);
    bridge._count = 0;

    const port = (this.config.port || 47128) + index;
    const username = index === 0 ? this.config.username : deriveUsername(this.config.username, index);
    const setupID = index === 0
      ? (this.config.setupID || 'HEJX')
      : deriveSetupID(this.config.setupID, index);
    // setupID must go through publish()'s own `info` object — hap-nodejs's
    // Accessory.publish() only honors info.setupID (falling back to
    // whatever's already persisted on disk, or a random one, otherwise); a
    // plain `bridge._setupID = ...` assignment beforehand is silently
    // overwritten during publish() and does nothing, confirmed live (the
    // primary bridge's printed Setup URI didn't match its configured
    // setupID until this was fixed to pass it here instead).
    // config.homekit.advertiser: 'ciao' (hap-nodejs default) | 'bonjour-hap' |
    // 'avahi' | 'resolved'. Use 'avahi' on Linux hosts already running
    // avahi-daemon — ciao's own responder stays silent on a box with two
    // interfaces on the same subnet (wired + Wi-Fi). config.homekit.bind
    // (interface names / IPs) limits which interfaces the HAP server uses.
    const { advertiser, bind } = this.config;
    bridge.publish({
      username, pincode: this.config.pin, port, setupID, category: Categories.BRIDGE,
      ...(advertiser ? { advertiser } : {}),
      ...(bind ? { bind } : {}),
    });

    const uri = generateSetupUri(this.config.pin, setupID);
    console.log(`[HomeKit] Bridge${index > 0 ? ` ${index + 1}` : ''} on port ${port}  PIN: ${this.config.pin}`);
    console.log(`[HomeKit] Setup URI: ${uri}`);

    this.bridges.push(bridge);
    return bridge;
  }

  // Appends to whichever bridge currently has room, creating (and
  // immediately publishing) a new one on demand — including well after
  // startup, since several callers here add accessories asynchronously as
  // devices/cameras are discovered later (see the various *-discovered
  // event handlers below). HAP-NodeJS supports adding bridged accessories
  // to an already-published Bridge, which this file already relied on for
  // those late-discovery paths before this pool existed.
  // `release` (optional) undoes what building the accessory hooked up — its
  // store listeners — and runs when it's removed again.
  add(accessory, key, release) {
    if (key && this.byKey?.has(key)) { release?.(); return } // already bridged
    let bridge = this.bridges[this.bridges.length - 1];
    if (bridge._count >= MAX_ACCESSORIES_PER_BRIDGE) bridge = this._addBridge();
    bridge.addBridgedAccessory(accessory);
    bridge._count++;
    if (key) (this.byKey ||= new Map()).set(key, { accessory, bridge, release });
  }

  // Take a bridged accessory out again (HomeKit exclusions, applied live)
  remove(key) {
    const e = this.byKey?.get(key);
    if (!e) return false;
    try { e.bridge.removeBridgedAccessory(e.accessory) } catch (err) { console.warn(`[HomeKit] Remove ${key}: ${err.message}`) }
    e.release?.();
    e.bridge._count--;
    this.byKey.delete(key);
    return true;
  }

  has(key) { return !!this.byKey?.has(key) }

  // Publishes an accessory on its own instead of bridging it — used for
  // HomeKit Secure Video cameras: the Home app only offers "Recording
  // Options" for a camera paired as a standalone accessory, never for one
  // behind a bridge. It's paired separately (same PIN as the bridge, its
  // own setup URI). Identity (username/setupID) is derived from `key` so
  // it stays the same across restarts — HAP-NodeJS keys the persisted
  // pairing by username — and the port from a per-pool counter offset well
  // clear of the bridges' own ports.
  publishStandalone(accessory, key, category) {
    const hash = require('crypto').createHash('sha1').update(`standalone-${key}`).digest();
    const base = String(this.config.username || 'CC:22:3D:E3:CE:F6').split(':');
    const username = [base[0], base[1], base[2], ...[0, 1, 2].map((i) => hash[i].toString(16).padStart(2, '0'))]
      .join(':').toUpperCase();
    const setupID = deriveSetupID(this.config.setupID, `standalone-${key}`);
    this._standaloneCount = (this._standaloneCount || 0) + 1;
    const port = (this.config.port || 47128) + 100 + this._standaloneCount;
    const { advertiser, bind } = this.config;
    accessory.publish({
      username, pincode: this.config.pin, port, setupID, category,
      ...(advertiser ? { advertiser } : {}),
      ...(bind ? { bind } : {}),
    });
    const uri = generateSetupUri(this.config.pin, setupID, category);
    console.log(`[HomeKit] Standalone accessory "${accessory.displayName}" on port ${port}  PIN: ${this.config.pin}  Setup URI: ${uri}`);
    return { username, port, uri };
  }
}

// Builds an accessory and returns [accessory, release]: release() removes the
// store listeners the build added (each add*Service below subscribes), so an
// accessory taken out of the bridge stops being updated and can be collected
// instead of staying behind for good. The builders are synchronous, so the
// listeners that appear while one runs are its own.
function buildTracked(store, build) {
  const before = new Set(store.listeners('change'));
  const release = (fns) => () => { for (const fn of fns) store.off('change', fn) };
  const added = () => store.listeners('change').filter((fn) => !before.has(fn));
  let accessory;
  try { accessory = build() } catch (err) { release(added())(); throw err }
  return [accessory, release(added())];
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
function addSwitchService(accessory, name, storePath, store, writeCallback, subtype) {
  const svc = accessory.addService(Service.Switch, name, subtype || storePath);

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
    .onGet(() => (store.get(storePath) === 1 || store.get(storePath) === true ? 1 : 0));

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      svc.getCharacteristic(Characteristic.LeakDetected).updateValue(value === 1 || value === true ? 1 : 0);
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
 * Adds a Lightbulb service driven by ONE dimmer sensor (room-grouped devices
 * such as Fibaro). The store path holds a 0..max brightness value (Fibaro
 * dimmers use 0–99). `writeCapability(capId, 'on'|'off')` toggles, and
 * `writeCapability(capId, 'set', [0..max])` sets brightness. `subtype` (capId)
 * keeps multiple lights unique on one accessory.
 */
function addSensorLightbulbService(accessory, name, statePath, capId, writeCapability, store, max = 99) {
  const svc  = accessory.addService(Service.Lightbulb, name, String(capId));
  const toHK  = (v) => clamp(Math.round((Number(v) || 0) * 100 / max), 0, 100); // device → HomeKit 0-100
  const toDev = (v) => clamp(Math.round(Number(v) * max / 100), 0, max);        // HomeKit → device 0-max

  svc.getCharacteristic(Characteristic.On)
    .onGet(() => (Number(store.get(statePath)) || 0) > 0)
    .onSet(async (v) => { await writeCapability(capId, v ? 'on' : 'off'); });

  svc.getCharacteristic(Characteristic.Brightness)
    .onGet(() => toHK(store.get(statePath)))
    .onSet(async (v) => { await writeCapability(capId, 'set', [toDev(v)]); });

  store.on('change', ({ key, value }) => {
    if (key !== statePath) return;
    svc.getCharacteristic(Characteristic.On).updateValue((Number(value) || 0) > 0);
    svc.getCharacteristic(Characteristic.Brightness).updateValue(toHK(value));
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
 * If tiltPath is provided, exposes a horizontal slat-tilt characteristic
 * (store value is "% open": 0=closed slats, 100=open) mapped to a 0–90° angle;
 * tiltWrite(pct) sends the tilt command.
 */
function addWindowCoveringService(accessory, name, storePath, store, writeCallback, levelPath, tiltPath, tiltWrite, stopWrite) {
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

  // Optional — only wired up when the caller passes stopWrite (a device that
  // actually has a stop command, e.g. an IR/RF blind with no position
  // feedback). Left off by default so this never risks misfiring on covers
  // that don't recognize a 'stop' command passed through their own
  // writeCallback (every other current cover-rw/somfy-cover user).
  if (stopWrite) {
    svc.getCharacteristic(Characteristic.HoldPosition)
      .onSet(async (v) => { if (v) await stopWrite(); });
    // The Home app never renders HoldPosition, so also expose Stop as a
    // momentary switch on the same accessory (and for Siri / automations).
    addMomentarySwitchService(accessory, `${name} Stop`, 'stop', stopWrite);
  }

  // Slat tilt: HomeKit uses a signed angle; map "% open" 0-100 → 0-90°.
  const toAngle = (pct) => clamp(Math.round((pct ?? 0) * 0.9), 0, 90);
  const toPct   = (ang) => clamp(Math.round(ang / 0.9), 0, 100);
  if (tiltPath) {
    // Seed a valid value before narrowing props (default is -90°, below our min).
    const initTilt = toAngle(store.get(tiltPath));
    svc.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle)
      .updateValue(initTilt)
      .setProps({ minValue: 0, maxValue: 90 })
      .onGet(() => toAngle(store.get(tiltPath)));

    svc.getCharacteristic(Characteristic.TargetHorizontalTiltAngle)
      .updateValue(initTilt)
      .setProps({ minValue: 0, maxValue: 90 })
      .onGet(() => toAngle(store.get(tiltPath)))
      .onSet(async (ang) => {
        if (!tiltWrite) return;
        const pct = toPct(ang);
        await tiltWrite(pct);
        store.update(tiltPath, pct);
      });
  }

  const update = () => {
    const pos = getPos();
    svc.getCharacteristic(Characteristic.CurrentPosition).updateValue(pos);
    svc.getCharacteristic(Characteristic.TargetPosition).updateValue(pos);
  };

  store.on('change', ({ key }) => {
    if (key === storePath || key === levelPath) update();
    if (tiltPath && key === tiltPath) {
      const ang = toAngle(store.get(tiltPath));
      svc.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle).updateValue(ang);
      svc.getCharacteristic(Characteristic.TargetHorizontalTiltAngle).updateValue(ang);
    }
  });

  return svc;
}

/**
 * Adds a momentary Switch: turning it on runs action() and springs back to
 * off after a second, like the scene switches in startHomekitBridge.
 */
function addMomentarySwitchService(accessory, name, subtype, action) {
  const svc = accessory.addService(Service.Switch, name, subtype);
  svc.getCharacteristic(Characteristic.On)
    .onGet(() => false)
    .onSet(async (v) => {
      if (!v) return;
      setTimeout(() => svc.getCharacteristic(Characteristic.On).updateValue(false), 1000);
      try {
        await action();
      } catch (err) {
        console.error(`[HomeKit] ${name} failed: ${err.message}`);
        throw new hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });
  return svc;
}

/**
 * Robot vacuum (Kärcher). HomeKit has no vacuum accessory type, so — as with
 * mower-rw — the main tile is a Fanv2: Active starts cleaning / sends the
 * robot back to base, RotationSpeed picks the suction level in equal steps
 * (4 levels → 25/50/75/100 %). Pause, Return to base and Find robot are
 * momentary switches; the Battery service reports charging state.
 */
function addVacuumServices(acc, device, store) {
  const key          = device.key;
  const cleaningPath = `${key}/cleaning`;
  const fanPath      = `${key}/fan`;
  const batteryPath  = `${key}/battery`;
  const statePath    = `${key}/state`;
  const has   = (p) => device.sensors.some((s) => s.path === p);
  const write = (capId, cmd, args) => device._writeCapability(capId, cmd, args);

  const svc = acc.addService(Service.Fanv2, device.label);
  svc.getCharacteristic(Characteristic.Active)
    .onGet(() => (store.get(cleaningPath) === 1 ? 1 : 0))
    .onSet(async (v) => {
      await write('cleaning', v === 1 ? 'start' : 'dock');
      store.update(cleaningPath, v === 1 ? 1 : 0);
    });

  const fan    = device.sensors.find((s) => s.path === 'fan');
  const levels = fan ? (fan.max ?? 3) - (fan.min ?? 0) + 1 : 0;
  const step   = levels ? 100 / levels : 0;
  const toSpeed = (idx) => Math.round((clamp(idx ?? 1, 0, levels - 1) + 1) * step);
  if (fan) {
    svc.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minStep: step })
      .onGet(() => toSpeed(store.get(fanPath)))
      .onSet(async (pct) => {
        if (!pct) return; // Home sends 0 together with Active=0 when switching off
        await write('fan', 'setFan', [clamp(Math.round(pct / step) - 1, 0, levels - 1)]);
      });
  }

  if (has('pause'))  addMomentarySwitchService(acc, `${device.label} Pause`, 'pause', () => write('pause', 'pause'));
  if (has('dock'))   addMomentarySwitchService(acc, `${device.label} Return to base`, 'dock', () => write('dock', 'dock'));
  if (has('locate')) addMomentarySwitchService(acc, `${device.label} Find`, 'locate', () => write('locate', 'locate'));

  const bat = has('battery') ? acc.addService(Service.Battery, `${device.label} Battery`) : null;
  const charging = () => (store.get(statePath) === 'Charging' ? 1 : 0);
  if (bat) {
    bat.getCharacteristic(Characteristic.BatteryLevel).onGet(() => clamp(store.get(batteryPath), 0, 100));
    bat.getCharacteristic(Characteristic.StatusLowBattery).onGet(() => ((store.get(batteryPath) ?? 100) < 20 ? 1 : 0));
    bat.getCharacteristic(Characteristic.ChargingState).onGet(charging);
  }

  store.on('change', ({ key: k, value }) => {
    if (k === cleaningPath) svc.getCharacteristic(Characteristic.Active).updateValue(value === 1 ? 1 : 0);
    if (fan && k === fanPath) svc.getCharacteristic(Characteristic.RotationSpeed).updateValue(toSpeed(value));
    if (bat && k === batteryPath) {
      bat.getCharacteristic(Characteristic.BatteryLevel).updateValue(clamp(value, 0, 100));
      bat.getCharacteristic(Characteristic.StatusLowBattery).updateValue(value < 20 ? 1 : 0);
    }
    if (bat && k === statePath) bat.getCharacteristic(Characteristic.ChargingState).updateValue(charging());
  });
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
 * MC6 thermostat: Current/Target temperature = temperature/setpoint, Target
 * state Off/Heat/Cool = onoff + mode (HomeKit can only switch on/off; the MC6
 * mode itself is left as set on the device), plus relative humidity.
 */
function addMc6ThermostatService(accessory, name, deviceKey, store, writeCapability) {
  const svc = accessory.addService(Service.Thermostat, name);
  const C = Characteristic;
  const tempPath = `${deviceKey}/temperature`;
  const setPath  = `${deviceKey}/setpoint`;
  const modePath = `${deviceKey}/mode`;
  const onPath   = `${deviceKey}/onoff`;
  const humPath  = `${deviceKey}/humidity`;

  const hkState = () => {
    if (!store.get(onPath)) return 0;
    return store.get(modePath) === 'cool' ? 2 : 1;
  };
  const hkCurrent = () => {
    if (!store.get(onPath)) return 0;
    const t = store.get(tempPath), sp = store.get(setPath);
    const mode = store.get(modePath);
    if (mode === 'cool') return t > sp ? 2 : 0;
    if (mode === 'heat') return t < sp ? 1 : 0;
    return 0;
  };

  svc.getCharacteristic(C.CurrentHeatingCoolingState).onGet(hkCurrent);
  svc.getCharacteristic(C.TargetHeatingCoolingState)
    .setProps({ validValues: [0, 1, 2] })
    .onGet(hkState)
    .onSet(async (v) => {
      if (!writeCapability) return;
      await writeCapability('onoff', v === 0 ? 'off' : 'on', []);
      store.update(onPath, v === 0 ? 0 : 1);
    });
  svc.getCharacteristic(C.CurrentTemperature)
    .setProps({ minValue: -20, maxValue: 60 })
    .onGet(() => clamp(store.get(tempPath) ?? 20, -20, 60));
  svc.getCharacteristic(C.TargetTemperature)
    .setProps({ minValue: 5, maxValue: 35, minStep: 0.5 })
    .onGet(() => clamp(store.get(setPath) ?? 20, 5, 35))
    .onSet(async (v) => {
      if (writeCapability) await writeCapability('setpoint', 'settemp', [v]);
    });
  svc.getCharacteristic(C.TemperatureDisplayUnits).onGet(() => 0).onSet(() => {});
  svc.getCharacteristic(C.CurrentRelativeHumidity)
    .onGet(() => clamp(store.get(humPath) ?? 0, 0, 100));

  store.on('change', ({ key, value }) => {
    if (key === tempPath) {
      svc.getCharacteristic(C.CurrentTemperature).updateValue(clamp(value, -20, 60));
      svc.getCharacteristic(C.CurrentHeatingCoolingState).updateValue(hkCurrent());
    }
    if (key === setPath) {
      svc.getCharacteristic(C.TargetTemperature).updateValue(clamp(value, 5, 35));
      svc.getCharacteristic(C.CurrentHeatingCoolingState).updateValue(hkCurrent());
    }
    if (key === onPath || key === modePath) {
      svc.getCharacteristic(C.TargetHeatingCoolingState).updateValue(hkState());
      svc.getCharacteristic(C.CurrentHeatingCoolingState).updateValue(hkCurrent());
    }
    if (key === humPath) svc.getCharacteristic(C.CurrentRelativeHumidity).updateValue(clamp(value, 0, 100));
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

/**
 * Adds an AirQualitySensor service with optional PM2.5, PM10, and VOC densities.
 * Store paths: deviceKey/airQuality (AQI index), /fineDustLevel (PM2.5 µg/m³),
 *   /dustLevel (PM10 µg/m³), /tvocLevel (VOC µg/m³)
 */
function addAirQualityService(accessory, name, deviceKey, store) {
  const svc = accessory.addService(Service.AirQualitySensor, name);

  const aqiPath  = `${deviceKey}/airQuality`;
  const pm25Path = `${deviceKey}/fineDustLevel`;
  const pm10Path = `${deviceKey}/dustLevel`;
  const vocPath  = `${deviceKey}/tvocLevel`;

  function aqiToHK(v) {
    const n = Number(v) || 0;
    if (n <= 50)  return 1; // EXCELLENT
    if (n <= 100) return 2; // GOOD
    if (n <= 150) return 3; // FAIR
    if (n <= 200) return 4; // INFERIOR
    return n > 0 ? 5 : 0;  // POOR / UNKNOWN
  }

  svc.getCharacteristic(Characteristic.AirQuality)
    .onGet(() => aqiToHK(store.get(aqiPath)));

  svc.addOptionalCharacteristic(Characteristic.PM2_5Density);
  svc.getCharacteristic(Characteristic.PM2_5Density)
    .onGet(() => Math.max(0, Number(store.get(pm25Path)) || 0));

  svc.addOptionalCharacteristic(Characteristic.PM10Density);
  svc.getCharacteristic(Characteristic.PM10Density)
    .onGet(() => Math.max(0, Number(store.get(pm10Path)) || 0));

  svc.addOptionalCharacteristic(Characteristic.VOCDensity);
  svc.getCharacteristic(Characteristic.VOCDensity)
    .onGet(() => Math.max(0, Number(store.get(vocPath)) || 0));

  store.on('change', ({ key, value }) => {
    if (key === aqiPath)  svc.getCharacteristic(Characteristic.AirQuality).updateValue(aqiToHK(value));
    if (key === pm25Path) svc.getCharacteristic(Characteristic.PM2_5Density).updateValue(Math.max(0, Number(value) || 0));
    if (key === pm10Path) svc.getCharacteristic(Characteristic.PM10Density).updateValue(Math.max(0, Number(value) || 0));
    if (key === vocPath)  svc.getCharacteristic(Characteristic.VOCDensity).updateValue(Math.max(0, Number(value) || 0));
  });

  return svc;
}

/**
 * Adds a CarbonDioxideSensor service.
 * store value: CO₂ level in ppm. Detected threshold: 1000 ppm (ASHRAE 62.1).
 */
function addCO2SensorService(accessory, name, storePath, store) {
  const svc = accessory.addService(Service.CarbonDioxideSensor, name);

  svc.getCharacteristic(Characteristic.CarbonDioxideDetected)
    .onGet(() => (Number(store.get(storePath)) || 0) > 1000 ? 1 : 0);

  svc.getCharacteristic(Characteristic.CarbonDioxideLevel)
    .onGet(() => Math.max(0, Number(store.get(storePath)) || 0));

  store.on('change', ({ key, value }) => {
    if (key === storePath) {
      const ppm = Math.max(0, Number(value) || 0);
      svc.getCharacteristic(Characteristic.CarbonDioxideDetected).updateValue(ppm > 1000 ? 1 : 0);
      svc.getCharacteristic(Characteristic.CarbonDioxideLevel).updateValue(ppm);
    }
  });

  return svc;
}

// ── Device accessory builders ──────────────────────────────────────────────

/**
 * Spa accessory (SmartTub): heat-only Thermostat (water temp / set temp /
 * heater state) + subtyped Switch services for jet pumps and lights.
 */
function addSpaServices(acc, device, store) {
  const key        = device.key;
  const tempPath   = `${key}/water_temp`;
  const setPath    = `${key}/set_temp`;
  const heaterPath = `${key}/heater`;

  const svc = acc.addService(Service.Thermostat, device.label);
  svc.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    .onGet(() => (store.get(heaterPath) === 1 ? 1 : 0));
  svc.getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .setProps({ validValues: [1] }) // a spa only heats
    .onGet(() => 1)
    .onSet(() => {});
  svc.getCharacteristic(Characteristic.CurrentTemperature)
    .setProps({ minValue: 0, maxValue: 60 })
    .onGet(() => clamp(store.get(tempPath) ?? 36, 0, 60));
  svc.getCharacteristic(Characteristic.TargetTemperature)
    .setProps({ minValue: 15, maxValue: 40, minStep: 0.5 })
    .onGet(() => clamp(store.get(setPath) ?? 36, 15, 40))
    .onSet(async (v) => {
      try {
        await device._writeCapability('setTemp', 'setTemperature', [v]);
        store.update(setPath, v);
      } catch (err) {
        console.error(`[HomeKit] Spa set temp failed: ${err.message}`);
        throw new hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });
  svc.getCharacteristic(Characteristic.TemperatureDisplayUnits).onGet(() => 0).onSet(() => {});

  store.on('change', ({ key: k, value }) => {
    if (k === tempPath)   svc.getCharacteristic(Characteristic.CurrentTemperature).updateValue(clamp(value, 0, 60));
    if (k === setPath)    svc.getCharacteristic(Characteristic.TargetTemperature).updateValue(clamp(value, 15, 40));
    if (k === heaterPath) svc.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(value === 1 ? 1 : 0);
  });

  // Jet pumps, blower and light zones as individual switches (subtyped)
  const toggles = (device.sensors || []).filter(
    (x) => x.controllable && (x.path.startsWith('pump_') || x.path.startsWith('light_')));
  for (const x of toggles) {
    const p  = `${key}/${x.path}`;
    const sw = acc.addService(Service.Switch, `${device.label} ${x.name || x.path}`, x.path);
    sw.getCharacteristic(Characteristic.On)
      .onGet(() => store.get(p) === 1)
      .onSet(async (v) => {
        try {
          await device._writeCapability(x.capabilityId, v ? 'on' : 'off');
          store.update(p, v ? 1 : 0);
        } catch (err) {
          console.error(`[HomeKit] Spa ${x.path} failed: ${err.message}`);
          throw new hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
    store.on('change', ({ key: k, value }) => {
      if (k === p) sw.getCharacteristic(Characteristic.On).updateValue(value === 1);
    });
  }
}

/**
 * Appliance (LG ThinQ fridge, AC, …): services from the sensors' own tags —
 *   homekit 'setpoint'  writable temperature → Thermostat (Cool only for a
 *                       fridge / freezer; current = the matching current-
 *                       temperature reading of the same part, else the setpoint)
 *   homekit 'switch'    on/off setting → Switch
 *   homekit 'contact'   a door: value `contactOpen` ('OPEN') → ContactSensor open
 * Each service is named after the part ("Lodówka Freezer").
 */
function addApplianceServices(acc, device, store) {
  const cooling = /refrigerator|freezer|wine/i.test(device.kind || '');
  for (const sn of device.sensors.filter((x) => x.homekit === 'setpoint')) {
    const setPath = `${device.key}/${sn.path}`;
    const cur = sn.hkCurrent ? `${device.key}/${sn.hkCurrent}` : setPath;
    const min = sn.min ?? 0, max = sn.max ?? 30, step = sn.step || 0.5;
    const svc = acc.addService(Service.Thermostat, `${device.label} ${sn.hkName || sn.label}`, sn.path);
    const mode = cooling ? 2 : 3; // COOL / AUTO — a setpoint, no mode switching here
    svc.getCharacteristic(Characteristic.CurrentHeatingCoolingState).onGet(() => (cooling ? 2 : 0));
    // the value first, then the narrower range — HAP checks the current (default) value against new props
    const thcs = svc.getCharacteristic(Characteristic.TargetHeatingCoolingState);
    thcs.value = mode;
    thcs.setProps({ validValues: [mode] }).onGet(() => mode).onSet(() => {});
    const ct = svc.getCharacteristic(Characteristic.CurrentTemperature);
    ct.value = Number(store.get(cur) ?? store.get(setPath) ?? min);
    ct.setProps({ minValue: Math.min(-40, min), maxValue: Math.max(60, max) })
      .onGet(() => Number(store.get(cur) ?? store.get(setPath) ?? min));
    const tt = svc.getCharacteristic(Characteristic.TargetTemperature);
    tt.value = clamp(Number(store.get(setPath) ?? min), min, max);
    tt.setProps({ minValue: min, maxValue: max, minStep: step })
      .onGet(() => clamp(Number(store.get(setPath) ?? min), min, max))
      .onSet(async (v) => {
        try { await device._writeCapability(sn.capabilityId, sn.writeCmd, [v]); store.update(setPath, v) }
        catch (err) {
          console.error(`[HomeKit] ${device.label} ${sn.path}: ${err.message}`);
          throw new hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
    svc.getCharacteristic(Characteristic.TemperatureDisplayUnits).onGet(() => 0).onSet(() => {});
    store.on('change', ({ key: k, value }) => {
      if (k === setPath) svc.getCharacteristic(Characteristic.TargetTemperature).updateValue(clamp(Number(value), min, max));
      if (k === cur) svc.getCharacteristic(Characteristic.CurrentTemperature).updateValue(Number(value));
    });
  }
  for (const sn of device.sensors.filter((x) => x.homekit === 'switch' && x.controllable)) {
    const p = `${device.key}/${sn.path}`;
    addSwitchService(acc, `${device.label} ${sn.hkName || sn.label}`, p, store, (command) => device._writeCapability(sn.capabilityId, command), sn.path);
  }
  for (const sn of device.sensors.filter((x) => x.homekit === 'contact')) {
    const p = `${device.key}/${sn.path}`;
    const svc = acc.addService(Service.ContactSensor, `${device.label} ${sn.hkName || sn.label}`, sn.path);
    const state = (v) => (String(v) === String(sn.contactOpen ?? 1) ? 1 : 0); // 1 = open
    svc.getCharacteristic(Characteristic.ContactSensorState).onGet(() => state(store.get(p)));
    store.on('change', ({ key: k, value }) => { if (k === p) svc.getCharacteristic(Characteristic.ContactSensorState).updateValue(state(value)) });
  }
}

function buildDeviceAccessory(device, store) {
  const acc = new Accessory(device.label, makeUUID(device.key));
  const manufacturer = device.type === 'smartthings' ? 'Samsung SmartThings' : device.type === 'lgthinq' ? 'LG' : 'Victron Energy';
  setInfo(acc, manufacturer, device.model || device.label, device.key);

  // device.homekit can list the same tag more than once (e.g. a 2-relay
  // Shelly's ['switch-rw', 'switch-rw', ...]) — one entry per sensor, not
  // one per distinct type. Dedupe here; each block below finds/filters its
  // own matching sensors from device.sensors, so running twice would only
  // ever re-process the same first match (or, for switch-rw specifically,
  // crash HAP with a duplicate Service UUID).
  for (const hkType of new Set(device.homekit)) {
    if (hkType === 'spa') {
      addSpaServices(acc, device, store);
    }

    if (hkType === 'appliance') {
      addApplianceServices(acc, device, store);
    }

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
      const switches = device.sensors.filter((s) => s.homekit === 'switch-rw');
      if (switches.length && device._writeCapability) {
        // One device can carry several switches (e.g. a multi-relay Shelly)
        // — each needs its own name and a unique subtype (its store path
        // already is one) or HAP rejects the second Service outright.
        switches.forEach((s) => {
          const writeCallback = (command) => device._writeCapability(s.capabilityId, command);
          const name = switches.length > 1 ? `${device.label} ${s.label || s.path}` : device.label;
          const storePath = `${device.key}/${s.path}`;
          addSwitchService(acc, name, storePath, store, writeCallback, storePath);
        });
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
      // Presence-only marker (see src/broadlink-client.js) — opts this
      // specific device into the HoldPosition/Stop characteristic above,
      // without affecting any other cover-rw integration that doesn't have
      // one (Dirigera, Homey, Tradfri, SmartThings, Matter — none currently
      // handle a 'stop' command on their windowShade capability).
      const stop   = device.sensors.find(s => s.path === 'stop');
      if (s && device._writeCapability) {
        addWindowCoveringService(acc, device.label, `${device.key}/${s.path}`, store,
          (cmd, args = []) => device._writeCapability('windowShade', cmd, args),
          level ? `${device.key}/${level.path}` : null,
          null, null,
          stop ? () => device._writeCapability('windowShade', 'stop') : null);
      }
    }

    if (hkType === 'somfy-cover') {
      // Somfy covers expose switch/level (+ tilt on io venetian blinds). Map to
      // a WindowCovering: position via the position capability, tilt via
      // orientation. `level.writeCmd` is the device's setPosition/setClosure.
      const level = device.sensors.find(s => s.path === 'level');
      const tilt  = device.sensors.find(s => s.path === 'tilt');
      if (device._writeCapability) {
        addWindowCoveringService(acc, device.label, `${device.key}/switch`, store,
          (cmd, args = []) => cmd === 'setLevel'
            ? device._writeCapability('position', level.writeCmd, args)
            : device._writeCapability('toggle', cmd === 'open' ? 'on' : 'off'),
          level ? `${device.key}/${level.path}` : null,
          tilt  ? `${device.key}/${tilt.path}` : null,
          tilt  ? (pct) => device._writeCapability('orientation', 'setOrientation', [pct]) : null);
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

    if (hkType === 'mower-rw') {
      // HomeKit has no native robot-mower accessory type, so impersonate one
      // with Fanv2 (the same trick used for fan-rw / most vacuum-robot HomeKit
      // bridges) — Active toggles mow start/stop, shown as an on/off tile.
      const s = device.sensors.find(s => s.path === 'mow');
      if (s && device._writeCapability) {
        addFanService(acc, device.label, `${device.key}/${s.path}`, store,
          (cmd) => device._writeCapability('mow', cmd));
      }
    }

    if (hkType === 'vacuum-rw') {
      if (device._writeCapability) addVacuumServices(acc, device, store);
    }

    if (hkType === 'mc6-thermostat') {
      if (device._writeCapability) {
        addMc6ThermostatService(acc, device.label, device.key, store, device._writeCapability);
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

    if (hkType === 'air-quality') {
      addAirQualityService(acc, `${device.label} Air Quality`, device.key, store);
    }

    if (hkType === 'co2-sensor') {
      const s = device.sensors.find((s) => s.path === 'carbonDioxide');
      if (s) addCO2SensorService(acc, `${device.label} CO₂`, `${device.key}/${s.path}`, store);
    }
  }

  return acc;
}

// Room-grouped devices (Fibaro) expose each dimmer sensor as its OWN standalone
// Lightbulb accessory rather than a service on a shared room accessory.
function dimmerSensors(device) {
  return (device.sensors || []).filter(
    (s) => s.controllable && s.homekit && typeof s.homekit === 'object' && s.homekit.service === 'Lightbulb',
  );
}

function buildDimmerAccessory(device, sensor, store) {
  const name = sensor.name || device.label;
  const path = `${device.key}/${sensor.path}`;
  const acc  = new Accessory(name, makeUUID(`dimmer-${path}`));
  acc.category = Categories.LIGHTBULB;
  const manufacturer = device.type === 'fibaro' ? 'Fibaro' : 'LSH';
  setInfo(acc, manufacturer, name, `${device.type}-${sensor.capabilityId}`);
  addSensorLightbulbService(acc, name, path, sensor.capabilityId, device._writeCapability, store, sensor.max || 99);
  return acc;
}

// ── Camera accessory builder ───────────────────────────────────────────────

function addCameraToBridge(cam, pool, store) {
  pool.cameras?.set(cam.name, { cam, store });
  if (pool.excluded?.('camera', cam.name) || pool.has(`camera:${cam.name}`)) return;
  const acc = new Accessory(cam.name, makeUUID(`camera-${cam.name}`));
  acc.category = Categories.CAMERA;
  setInfo(acc, 'Camera', cam.name, `CAM-${cam.name}`);

  const delegate = new CameraDelegate(cam);
  const controllerOptions = {
    cameraStreamCount: 2,
    delegate,
    streamingOptions: buildStreamingOptions(!!cam.twoWayAudio),
  };

  // HomeKit Secure Video: opt-in per camera (cam.hksv: true). Also needs
  // iCloud+ with "Home Video Recording" enabled and an active Home Hub —
  // neither of which this server can verify; without them the Home app
  // simply won't offer to set up recording for this camera.
  if (cam.hksv) {
    controllerOptions.recording = { options: buildRecordingOptions(), delegate };
    controllerOptions.sensors = { motion: true };
  }

  const controller = new CameraController(controllerOptions);
  delegate.controller = controller;

  acc.configureController(controller);
  // HKSV cameras must be standalone (see BridgePool.publishStandalone);
  // cam.standalone forces it for any camera (also better streaming).
  if (cam.hksv || cam.standalone) {
    // Standalone accessories are published once (exclusion takes effect on restart)
    if ((pool.standaloneDone ||= new Set()).has(cam.name)) return;
    pool.standaloneDone.add(cam.name);
    pool.publishStandalone(acc, `camera-${cam.name}`, Categories.CAMERA);
  } else pool.add(acc, `camera:${cam.name}`);
  const streamType = cam.url ? 'snapshot+stream' : 'snapshot';
  console.log(`[HomeKit] Camera: ${cam.name} (${streamType})${cam.hksv ? ' +HKSV' : ''}`);

  // Recording only starts once HomeKit sees the built-in Motion sensor
  // trip. Drive it from object-detection.js's per-camera aggregate
  // "objectdetect/<slug>/any/detected" key (see its _anyActive tracking) —
  // matched by cam.motionSource (defaults to cam.name) against the
  // objectDetection.cameras[].name that watches the same physical feed.
  if (cam.hksv && store) {
    const motionSlug = slugifyCamName(cam.motionSource || cam.name);
    const motionKey  = `objectdetect/${motionSlug}/any/detected`;
    store.on('change', ({ key, value }) => {
      if (key === motionKey) {
        controller.motionService?.updateCharacteristic(Characteristic.MotionDetected, value === 1);
      }
    });
  }
}

// ── Main bridge factory ────────────────────────────────────────────────────

function startHomekitBridge(config, store, relayController, sensorRegistry, { unifiProtect, loxoneClient, automation, karcher } = {}) {
  // Give hap-nodejs its own folder inside persist/. Without this it falls back
  // to node-persist's default "./persist" — the shared LSH state dir — and
  // node-persist crashes on ANY subdirectory there (EISDIR on scan), e.g.
  // persist/plan-decor. One-time migration moves existing pairing files over.
  const persistRoot = path.join(__dirname, '..', 'persist');
  const hapDir = process.env.LSH_HAP_DIR || path.join(persistRoot, 'homekit'); // override: tests
  if (!fs.existsSync(hapDir)) {
    fs.mkdirSync(hapDir, { recursive: true });
    for (const f of fs.readdirSync(persistRoot)) {
      if (/^(AccessoryInfo|IdentifierCache)\./.test(f)) {
        fs.renameSync(path.join(persistRoot, f), path.join(hapDir, f));
      }
    }
  }
  hap.HAPStorage.setCustomStoragePath(hapDir);

  const pool = new BridgePool(config.homekit);

  // ── Exclusions: LSH devices / types / cameras / scenes / relays kept out of
  // HomeKit (config.homekit.exclude = { devices: [deviceKey], types: [type],
  // cameras: [name], scenes: [sceneId], relays: [index] }). applyExclude()
  // re-reads them at runtime: excluded accessories are removed from the
  // published bridge, re-included ones added back — no restart.
  const norm = (e = {}) => ({
    devices: new Set((e.devices || []).map(String)), types: new Set((e.types || []).map(String)),
    cameras: new Set((e.cameras || []).map(String)), scenes: new Set((e.scenes || []).map(String)), relays: new Set((e.relays || []).map(String)),
  });
  let exclude = norm(config.homekit?.exclude);
  pool.cameras = new Map();
  pool.excluded = (kind, id, type) => {
    if (kind === 'device') return exclude.devices.has(String(id)) || (type != null && exclude.types.has(String(type)));
    return exclude[`${kind}s`]?.has(String(id)) || false;
  };
  const adders = []; // (re)add everything that's allowed and missing

  // ── Relay switches (from config) ──────────────────────────
  const addRelay = (relay) => {
    if (pool.excluded('relay', relay.index) || pool.has(`relay:${relay.index}`)) return;
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

    const onChange = ({ key, value }) => {
      if (key === `system/0/Relay/${relay.index}/State`) {
        switchSvc.getCharacteristic(Characteristic.On).updateValue(value === 1);
      }
    };
    store.on('change', onChange);

    pool.add(acc, `relay:${relay.index}`, () => store.off('change', onChange));
    console.log(`[HomeKit] Relay switch: ${relay.name}`);
  };
  for (const relay of config.relays) addRelay(relay);
  adders.push(() => { for (const relay of config.relays) addRelay(relay) });

  // ── Camera accessories ────────────────────────────────────
  for (const cam of config.cameras ?? []) {
    if (cam.name) {
      // Manual cameras with only an RTSP url (no vendor snapshot API) get a
      // direct in-process grabFrame, matching the fetchSnapshot pattern
      // every other camera client uses (Reolink/Mobotix/Axis/Loxone/UniFi
      // Protect) — going through the HTTP snapshotUrl instead would hit
      // this server's own auth middleware with no session to satisfy it.
      if (cam.url && !cam.snapshotUrl && !cam.mjpegUrl) {
        cam.fetchSnapshot = () =>
          require('./rtsp-snapshot').grabFrame(cam.url, config.ffmpegRtsp?.ffmpegPath || 'ffmpeg');
      }
      try { addCameraToBridge(cam, pool, store); } catch (err) {
        console.error(`[HomeKit] Camera failed (${cam.name}): ${err.message}`);
      }
    }
  }

  // UniFi Protect cameras may not be discovered yet — add them when ready
  if (unifiProtect) {
    for (const cam of unifiProtect.getCameras()) {
      try { addCameraToBridge(cam, pool, store); } catch (err) {
        console.error(`[HomeKit] UniFi camera failed (${cam.name}): ${err.message}`);
      }
    }
    unifiProtect.on('cameras-discovered', (cameras) => {
      for (const cam of cameras) {
        try { addCameraToBridge(cam, pool, store); } catch (err) {
          console.error(`[HomeKit] UniFi camera failed (${cam.name}): ${err.message}`);
        }
      }
    });
  }

  // Kärcher robot maps as snapshot-only cameras, once the cloud login is done.
  if (karcher?.ready) {
    karcher.ready.then(() => {
      for (const cam of karcher.getHomekitCameras()) {
        try { addCameraToBridge(cam, pool, store); } catch (err) {
          console.error(`[HomeKit] Kärcher map camera failed (${cam.name}): ${err.message}`);
        }
      }
    });
  }

  // Loxone VideoIntercom cameras are discovered asynchronously after structure download
  if (loxoneClient) {
    loxoneClient.on('cameras-discovered', (cameras) => {
      for (const cam of cameras) {
        try { addCameraToBridge(cam, pool, store); } catch (err) {
          console.error(`[HomeKit] Loxone camera failed (${cam.name}): ${err.message}`);
        }
      }
    });
  }

  // ── Sensor accessories (auto-discovered from MQTT) ────────
  if (sensorRegistry) {
    // Bridge a device: each dimmer sensor (room-grouped Fibaro) becomes its own
    // standalone Lightbulb accessory; a device-level homekit type still bridges
    // as a single accessory (SmartThings / Loxone / etc.).
    const bridgeDevice = (device, added) => {
      if (pool.excluded('device', device.key, device.type)) return;
      for (const s of dimmerSensors(device)) {
        if (pool.has(`device:${device.key}#${s.path}`)) continue;
        const [acc, release] = buildTracked(store, () => buildDimmerAccessory(device, s, store));
        pool.add(acc, `device:${device.key}#${s.path}`, release);
        console.log(`[HomeKit] Light${added ? ' added' : ''}: ${s.name || device.label}`);
      }
      if (device.homekit && device.homekit.length > 0 && !pool.has(`device:${device.key}`)) {
        const [acc, release] = buildTracked(store, () => buildDeviceAccessory(device, store));
        pool.add(acc, `device:${device.key}`, release);
        console.log(`[HomeKit] Sensor${added ? ' added' : ''}: ${device.label} (${device.homekit.join(', ')})`);
      }
    };
    adders.push(() => { for (const device of sensorRegistry.getDevices()) bridgeDevice(device, true) });
    pool.devicesForHomekit = () => sensorRegistry.getDevices().filter((d) => (d.homekit && d.homekit.length) || dimmerSensors(d).length);

    // Devices discovered before HomeKit started
    for (const device of sensorRegistry.getDevices()) bridgeDevice(device, false);

    // Devices discovered after HomeKit started
    sensorRegistry.on('device-discovered', (device) => {
      try {
        bridgeDevice(device, true);
      } catch (err) {
        console.error(`[HomeKit] Failed to add ${device.label}:`, err.message);
      }
    });
  }

  // ── Scene switches (LSH automation scenes as momentary switches) ──────────
  if (automation?.scenes?.length) {
    const addScene = (scene) => {
      if (pool.excluded('scene', scene.id) || pool.has(`scene:${scene.id}`)) return;
      const name = `${scene.name}`;
      const acc  = new Accessory(name, makeUUID(`scene-${scene.id}`));
      acc.category = Categories.SWITCH;
      setInfo(acc, 'LSH Scene', name, `SCENE-${scene.id}`);
      const svc = acc.addService(Service.Switch, name);
      svc.getCharacteristic(Characteristic.On)
        .onGet(() => false) // momentary — always reads off
        .onSet(async (v) => {
          if (!v) return;
          try {
            await automation.runScene(scene.id);
          } catch (err) {
            console.error(`[HomeKit] Scene "${name}" failed: ${err.message}`);
          }
          // spring back to off so it behaves like a button
          setTimeout(() => svc.getCharacteristic(Characteristic.On).updateValue(false), 1000);
        });
      pool.add(acc, `scene:${scene.id}`);
      console.log(`[HomeKit] Scene switch: ${name}`);
    };
    for (const scene of automation.scenes) addScene(scene);
    adders.push(() => { for (const scene of automation.scenes || []) addScene(scene) });
  }
  pool.scenes = () => automation?.scenes || [];
  pool.relays = () => config.relays || [];

  pool.applyExclude = (next) => {
    exclude = norm(next);
    let removed = 0;
    for (const key of [...(pool.byKey?.keys() || [])]) {
      const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      const id = kind === 'device' ? rest.split('#')[0] : rest;
      const dev = kind === 'device' ? sensorRegistry?.getDevices().find((d) => d.key === id) : null;
      if (pool.excluded(kind, id, dev?.type)) { pool.remove(key); removed++ }
    }
    const before = pool.byKey?.size || 0;
    for (const add of adders) { try { add() } catch (err) { console.error(`[HomeKit] Re-add failed: ${err.message}`) } }
    for (const { cam, store: st } of pool.cameras.values()) { try { addCameraToBridge(cam, pool, st) } catch (err) { console.error(`[HomeKit] Camera re-add failed: ${err.message}`) } }
    const added = (pool.byKey?.size || 0) - before;
    console.log(`[HomeKit] Exclusions applied — ${removed} removed, ${added} added`);
    return { removed, added };
  };

  // Publishing happens inside BridgePool as each bridge is created (the
  // first one at construction, above; any overflow ones on demand from
  // pool.add()) rather than once at the end here — see BridgePool's own
  // comment for why that's safe with HAP-NodeJS.
  return pool;
}

module.exports = startHomekitBridge;
module.exports.buildDeviceAccessory = buildDeviceAccessory; // for tests
