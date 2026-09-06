/**
 * Matter bridge — exposes LSH devices to Matter controllers (Apple Home,
 * Google Home, Alexa, SmartThings, …) as a single bridged Matter node,
 * mirroring homekit-bridge.js's relationship to HAP but for Matter/Thread.
 *
 * Reuses the exact same `device.homekit` tags every integration client
 * already sets (see homekit-bridge.js) rather than inventing a parallel
 * `device.matter` tagging scheme — adding Matter support to an existing
 * integration therefore takes zero changes to that integration's own file.
 *
 * Scope (v1): switch-rw, light-rw (on/off + brightness, no colour yet),
 * contact, motion, occupancy, temperature, humidity, lux, cover-rw /
 * somfy-cover (lift position only, no tilt). Not yet mapped: lock-rw,
 * thermostat, fan-rw, leak, smoke, co, battery(-level), tank, door-rw,
 * mower-rw, spa, light colour/colour-temp — some of these (door locks
 * especially) have Matter cluster conformance rules (mandatory
 * lockType/operatingMode bit semantics, feature-gated enum values) that
 * need real hardware to validate rather than guessing; they're deferred
 * rather than shipped half-verified.
 *
 * Untested against a real Matter controller/phone — verified so far only
 * via matter.js's own commissioning flow scripted locally (see the "Matter
 * bridge" section in README.md for how to test this against Apple Home).
 */
require('./matter-storage');
const path = require('path');
const crypto = require('crypto');
const { Endpoint, ServerNode, VendorId } = require('@matter/main');
const { AggregatorEndpoint } = require('@matter/main/endpoints/aggregator');
const { BridgedDeviceBasicInformationServer } = require('@matter/main/behaviors/bridged-device-basic-information');
const { OnOffServer } = require('@matter/main/behaviors/on-off');
const { OccupancySensingServer } = require('@matter/main/behaviors/occupancy-sensing');
const { WindowCoveringServer } = require('@matter/main/behaviors/window-covering');
const { WindowCovering, OccupancySensing } = require('@matter/main/clusters');
const { OnOffPlugInUnitDevice } = require('@matter/main/devices/on-off-plug-in-unit');
const { OnOffLightDevice } = require('@matter/main/devices/on-off-light');
const { DimmableLightDevice } = require('@matter/main/devices/dimmable-light');
const { ContactSensorDevice } = require('@matter/main/devices/contact-sensor');
const { OccupancySensorDevice } = require('@matter/main/devices/occupancy-sensor');
const { TemperatureSensorDevice } = require('@matter/main/devices/temperature-sensor');
const { HumiditySensorDevice } = require('@matter/main/devices/humidity-sensor');
const { LightSensorDevice } = require('@matter/main/devices/light-sensor');
const { WindowCoveringDevice } = require('@matter/main/devices/window-covering');
const platformStatus = require('./platform-status');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v ?? lo));
// Some device keys are long (e.g. SmartThings' `smartthings/<uuid>`), and
// bridgedDeviceBasicInformation.serialNumber has a Matter spec length
// constraint that a raw "<device.key>-<suffix>" blows past — confirmed live
// against a real registry (every SmartThings-backed device failed to add
// with "String length of N is not within bounds"). A short stable hash
// keeps both the serial number and the endpoint id well under any limit
// while staying deterministic across restarts (endpoint ids must be stable
// for matter.js to restore the same fabric bindings on reboot).
const epId = (device, suffix) => `lsh-${crypto.createHash('sha1').update(`${device.key}:${suffix}`).digest('hex').slice(0, 12)}`;
// nodeLabel/productName/productLabel are all capped at 32 chars by the
// Matter spec — confirmed live against a real device label ("Mercedes-EQ G
// 580 (car simulator)", 33 chars) that failed with the same "String length
// of N is not within bounds" error the long serial numbers above hit.
const truncLabel = (s) => String(s).slice(0, 32);

// Matter's manual pairing code is an unbroken digit string (matter.js itself
// never formats it — confirmed by grepping the actual encoder in
// @matter/types' PairingCodeSchema.ts, which just concatenates digit chunks
// with no separators). The 4-3-4 grouping printed on real device boxes and
// used by Apple/Google/CSA reference apps is a pure display convention on
// top of that raw string: for the common 11-digit code (no vendor/product
// id — 1 version digit + 5-digit chunk + 4-digit chunk + 1 checksum digit),
// it's just the raw digits split at fixed positions 4 and 7. The rarer
// 21-digit form (vendor/product id included) has no similarly-fixed
// convention worth guessing at, so it's left unformatted.
function formatManualPairingCode(code) {
  const digits = String(code || '');
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
}

// matter.js's own top-level error on a failed ServerNode.create()/add() is a
// generic "Behaviors have errors" — the actually useful detail (e.g.
// "discriminator is required") is nested several levels down through
// .errors[0]/.cause. Flatten it into the message so a plain
// `.catch(err => console.error(err.message))` upstream (server.js) still
// shows something actionable instead of just "Behaviors have errors".
function describeError(err) {
  const parts = [];
  let cur = err;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.message && !parts.includes(cur.message)) parts.push(cur.message);
    cur = cur.errors ? cur.errors[0] : cur.cause;
  }
  return parts.join(' — ');
}

// ── OnOff (switch-rw, and the on/off half of light-rw) ──────────────────────
// Matter's On/Off commands arrive here as behavior method overrides; we call
// the real device's write capability and let super.on()/off() update the
// cluster's own onOff attribute so subscribers (Apple Home etc.) see the change.
function onOffServerFor(write) {
  return class extends OnOffServer {
    async on()  { await write('on');  await super.on();  }
    async off() { await write('off'); await super.off(); }
  };
}

function addSwitchEndpoints(aggregator, device, store) {
  const switches = device.sensors.filter((s) => s.homekit === 'switch-rw');
  if (!switches.length || !device._writeCapability) return;
  switches.forEach((s) => {
    const storePath = `${device.key}/${s.path}`;
    const write = (cmd) => device._writeCapability(s.capabilityId, cmd);
    const name = switches.length > 1 ? `${device.label} ${s.label || s.path}` : device.label;
    const ep = new Endpoint(OnOffPlugInUnitDevice.with(BridgedDeviceBasicInformationServer, onOffServerFor(write)), {
      id: epId(device, s.path),
      bridgedDeviceBasicInformation: { nodeLabel: truncLabel(name), productName: truncLabel(name), productLabel: truncLabel(name), serialNumber: epId(device, s.path), reachable: true },
      onOff: { onOff: store.get(storePath) === 1 },
    });
    aggregator.add(ep).catch((err) => console.error(`[Matter] Failed to add ${name}: ${describeError(err)}`));
    store.on('change', ({ key, value }) => {
      if (key === storePath) ep.set({ onOff: { onOff: value === 1 } }).catch(() => {});
    });
  });
}

// ── Light (light-rw): on/off + optional brightness. No colour in v1. ───────
// Matter's LevelControl range is 1-254 (not 0-100) per the spec's CurrentLevel
// attribute; LSH's `level` sensor is a plain 0-100 percent, so both directions
// convert.
const levelToPct = (level) => Math.round(((clamp(level, 1, 254) - 1) / 253) * 100);
const pctToLevel = (pct)   => Math.round(1 + (clamp(pct, 0, 100) / 100) * 253);

function levelControlServerFor(write) {
  const { LevelControlServer } = require('@matter/main/behaviors/level-control');
  return class extends LevelControlServer {
    async moveToLevel({ level }) {
      await write('setLevel', [levelToPct(level)]);
      await super.moveToLevel({ level });
    }
    async moveToLevelWithOnOff({ level }) {
      await write('setLevel', [levelToPct(level)]);
      await super.moveToLevelWithOnOff({ level });
    }
  };
}

function addLightEndpoint(aggregator, device, store) {
  if (!device.homekit.includes('light-rw') || !device._writeCapability) return;
  const swPath    = `${device.key}/switch`;
  const levelPath = `${device.key}/level`;
  const hasLevel  = device.sensors.some((s) => s.path === 'level');
  const write = (cmd, args) => device._writeCapability(hasLevel && cmd === 'setLevel' ? 'switchLevel' : 'switch', cmd, args);

  const behaviors = hasLevel
    ? [BridgedDeviceBasicInformationServer, onOffServerFor(write), levelControlServerFor(write)]
    : [BridgedDeviceBasicInformationServer, onOffServerFor(write)];
  const BaseDevice = hasLevel ? DimmableLightDevice : OnOffLightDevice;

  const initial = {
    bridgedDeviceBasicInformation: { nodeLabel: truncLabel(device.label), productName: truncLabel(device.label), productLabel: truncLabel(device.label), serialNumber: epId(device, 'light'), reachable: true },
    onOff: { onOff: store.get(swPath) === 1 },
  };
  if (hasLevel) initial.levelControl = { currentLevel: pctToLevel(clamp(store.get(levelPath), 0, 100)) };

  const ep = new Endpoint(BaseDevice.with(...behaviors), { id: epId(device, 'light'), ...initial });
  aggregator.add(ep).catch((err) => console.error(`[Matter] Failed to add ${device.label}: ${describeError(err)}`));

  store.on('change', ({ key, value }) => {
    if (key === swPath) ep.set({ onOff: { onOff: value === 1 } }).catch(() => {});
    if (hasLevel && key === levelPath) ep.set({ levelControl: { currentLevel: pctToLevel(clamp(value, 0, 100)) } }).catch(() => {});
  });
}

// ── Contact sensor ───────────────────────────────────────────────────────
// LSH convention (see homekit-bridge.js's addContactService): raw store
// value 1 = open/not-detected. Matter's BooleanState.stateValue is the
// opposite polarity for a Contact Sensor device type: "FALSE=open or no
// contact, TRUE=closed or contact" (Matter spec §1.7.5.1) — hence the
// inversion below, not a copy-paste bug.
function addContactEndpoint(aggregator, device, store) {
  const s = device.sensors.find((s) => s.homekit === 'contact');
  if (!s) return;
  const storePath = `${device.key}/${s.path}`;
  const name = `${device.label} Contact`;
  const ep = new Endpoint(ContactSensorDevice.with(BridgedDeviceBasicInformationServer), {
    id: epId(device, 'contact'),
    bridgedDeviceBasicInformation: { nodeLabel: truncLabel(name), productName: truncLabel(name), productLabel: truncLabel(name), serialNumber: epId(device, 'contact'), reachable: true },
    booleanState: { stateValue: store.get(storePath) !== 1 },
  });
  aggregator.add(ep).catch((err) => console.error(`[Matter] Failed to add ${name}: ${describeError(err)}`));
  store.on('change', ({ key, value }) => {
    if (key === storePath) ep.set({ booleanState: { stateValue: value !== 1 } }).catch(() => {});
  });
}

// ── Motion / occupancy (both map to Matter's OccupancySensor — Matter has
// no separate PIR-motion device type) ───────────────────────────────────
function addOccupancyEndpoint(aggregator, device, store, tag, label) {
  const s = device.sensors.find((s) => s.homekit === tag);
  if (!s) return;
  const storePath = `${device.key}/${s.path}`;
  const name = `${device.label} ${label}`;
  const PirOccupancySensingServer = OccupancySensingServer.with(OccupancySensing.Feature.PassiveInfrared);
  const ep = new Endpoint(OccupancySensorDevice.with(BridgedDeviceBasicInformationServer, PirOccupancySensingServer), {
    id: epId(device, tag),
    bridgedDeviceBasicInformation: { nodeLabel: truncLabel(name), productName: truncLabel(name), productLabel: truncLabel(name), serialNumber: epId(device, tag), reachable: true },
    occupancySensing: {
      occupancy: { occupied: store.get(storePath) === 1 },
      occupancySensorType: 0, // Matter enum 0 = PIR
      occupancySensorTypeBitmap: { pir: true },
    },
  });
  aggregator.add(ep).catch((err) => console.error(`[Matter] Failed to add ${name}: ${describeError(err)}`));
  store.on('change', ({ key, value }) => {
    if (key === storePath) ep.set({ occupancySensing: { occupancy: { occupied: value === 1 } } }).catch(() => {});
  });
}

// ── Temperature / humidity / illuminance ────────────────────────────────
function addTemperatureEndpoint(aggregator, device, store) {
  const s = device.sensors.find((s) => s.homekit === 'temperature');
  if (!s) return;
  const storePath = `${device.key}/${s.path}`;
  const name = `${device.label} Temperature`;
  // Matter's TemperatureMeasurement.measuredValue is in centi-°C (°C * 100).
  const toMatter = (c) => (Number.isFinite(c) ? Math.round(clamp(c, -100, 100) * 100) : null);
  const ep = new Endpoint(TemperatureSensorDevice.with(BridgedDeviceBasicInformationServer), {
    id: epId(device, 'temperature'),
    bridgedDeviceBasicInformation: { nodeLabel: truncLabel(name), productName: truncLabel(name), productLabel: truncLabel(name), serialNumber: epId(device, 'temperature'), reachable: true },
    temperatureMeasurement: { measuredValue: toMatter(store.get(storePath)) },
  });
  aggregator.add(ep).catch((err) => console.error(`[Matter] Failed to add ${name}: ${describeError(err)}`));
  store.on('change', ({ key, value }) => {
    if (key === storePath) ep.set({ temperatureMeasurement: { measuredValue: toMatter(value) } }).catch(() => {});
  });
}

function addHumidityEndpoint(aggregator, device, store) {
  const s = device.sensors.find((s) => s.homekit === 'humidity');
  if (!s) return;
  const storePath = `${device.key}/${s.path}`;
  const name = `${device.label} Humidity`;
  // Matter's RelativeHumidityMeasurement.measuredValue is in centi-percent (% * 100).
  const toMatter = (pct) => (Number.isFinite(pct) ? Math.round(clamp(pct, 0, 100) * 100) : null);
  const ep = new Endpoint(HumiditySensorDevice.with(BridgedDeviceBasicInformationServer), {
    id: epId(device, 'humidity'),
    bridgedDeviceBasicInformation: { nodeLabel: truncLabel(name), productName: truncLabel(name), productLabel: truncLabel(name), serialNumber: epId(device, 'humidity'), reachable: true },
    relativeHumidityMeasurement: { measuredValue: toMatter(store.get(storePath)) },
  });
  aggregator.add(ep).catch((err) => console.error(`[Matter] Failed to add ${name}: ${describeError(err)}`));
  store.on('change', ({ key, value }) => {
    if (key === storePath) ep.set({ relativeHumidityMeasurement: { measuredValue: toMatter(value) } }).catch(() => {});
  });
}

function addLuxEndpoint(aggregator, device, store) {
  const s = device.sensors.find((s) => s.path === 'illuminance');
  if (!s) return;
  const storePath = `${device.key}/${s.path}`;
  const name = `${device.label} Light`;
  // Matter's IlluminanceMeasurement.measuredValue is 10000 * log10(lux) + 1.
  const toMatter = (lux) => (Number.isFinite(lux) && lux > 0 ? Math.round(10000 * Math.log10(lux) + 1) : 0);
  const ep = new Endpoint(LightSensorDevice.with(BridgedDeviceBasicInformationServer), {
    id: epId(device, 'lux'),
    bridgedDeviceBasicInformation: { nodeLabel: truncLabel(name), productName: truncLabel(name), productLabel: truncLabel(name), serialNumber: epId(device, 'lux'), reachable: true },
    illuminanceMeasurement: { measuredValue: toMatter(store.get(storePath)) },
  });
  aggregator.add(ep).catch((err) => console.error(`[Matter] Failed to add ${name}: ${describeError(err)}`));
  store.on('change', ({ key, value }) => {
    if (key === storePath) ep.set({ illuminanceMeasurement: { measuredValue: toMatter(value) } }).catch(() => {});
  });
}

// ── Window covering (cover-rw, somfy-cover) — lift position only, no tilt.
// LSH's `level` sensor is "% open" (0=closed,100=open), matching HomeKit's
// CurrentPosition convention directly. Matter inverts this: its
// currentPositionLiftPercent100ths is 0 at fully OPEN and 10000 (100.00%) at
// fully CLOSED (confirmed via WindowCoveringServer.upOrOpen(), which is
// documented to drive the target position to 0%) — so conversion inverts the
// percentage, not just rescales it.
function addCoverEndpoint(aggregator, device, store) {
  const hasTag = device.homekit.includes('cover-rw') || device.homekit.includes('somfy-cover');
  if (!hasTag || !device._writeCapability) return;
  const levelSensor = device.sensors.find((s) => s.path === 'level');
  if (!levelSensor || !levelSensor.controllable) return;
  const levelPath = `${device.key}/${levelSensor.path}`;
  const name = `${device.label} Cover`;

  const toMatter = (openPct) => Math.round((100 - clamp(openPct, 0, 100)) * 100);
  const toOpenPct = (matterPct100ths) => clamp(100 - matterPct100ths / 100, 0, 100);
  const write = (cmd, args) => device._writeCapability(levelSensor.capabilityId, levelSensor.writeCmd || 'setLevel', args ?? []);

  const LiftOnlyWindowCovering = WindowCoveringServer.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift);
  class CoverServer extends LiftOnlyWindowCovering {
    async handleMovement(_type, _reversed, _direction, targetPercent100ths) {
      if (targetPercent100ths == null) return;
      await write('setLevel', [toOpenPct(targetPercent100ths)]);
      // Real position confirmation arrives via the store 'change' listener
      // below once the device reports back — do not update state here.
    }
  }

  const initialPct100ths = toMatter(clamp(store.get(levelPath), 0, 100));
  const ep = new Endpoint(WindowCoveringDevice.with(BridgedDeviceBasicInformationServer, CoverServer), {
    id: epId(device, 'cover'),
    bridgedDeviceBasicInformation: { nodeLabel: truncLabel(name), productName: truncLabel(name), productLabel: truncLabel(name), serialNumber: epId(device, 'cover'), reachable: true },
    windowCovering: {
      type: 0, // Rollershade — the only Type value valid for Lift-without-Tilt
      configStatus: {}, mode: {},
      currentPositionLiftPercent100ths: initialPct100ths,
      targetPositionLiftPercent100ths: initialPct100ths,
    },
  });
  aggregator.add(ep).catch((err) => console.error(`[Matter] Failed to add ${name}: ${describeError(err)}`));
  store.on('change', ({ key, value }) => {
    if (key !== levelPath) return;
    const pct100ths = toMatter(clamp(value, 0, 100));
    ep.set({ windowCovering: { currentPositionLiftPercent100ths: pct100ths, targetPositionLiftPercent100ths: pct100ths } }).catch(() => {});
  });
}

function buildDevices(aggregator, sensorRegistry, store) {
  for (const device of sensorRegistry.getDevices()) {
    if (!device.homekit || !device.homekit.length) continue;
    const tags = new Set(device.homekit);
    if (tags.has('switch-rw'))                            addSwitchEndpoints(aggregator, device, store);
    if (tags.has('light-rw'))                              addLightEndpoint(aggregator, device, store);
    if (tags.has('contact'))                               addContactEndpoint(aggregator, device, store);
    if (tags.has('motion'))                                addOccupancyEndpoint(aggregator, device, store, 'motion', 'Motion');
    if (tags.has('occupancy'))                             addOccupancyEndpoint(aggregator, device, store, 'occupancy', 'Presence');
    if (tags.has('temperature'))                           addTemperatureEndpoint(aggregator, device, store);
    if (tags.has('humidity'))                              addHumidityEndpoint(aggregator, device, store);
    if (tags.has('lux'))                                   addLuxEndpoint(aggregator, device, store);
    if (tags.has('cover-rw') || tags.has('somfy-cover'))   addCoverEndpoint(aggregator, device, store);
  }
}

class MatterBridge {
  constructor(config, store, sensorRegistry) {
    this.config = config.matter?.bridge || {};
    this.store = store;
    this.sensorRegistry = sensorRegistry;
    this.server = null;
  }

  async start() {
    try {
      await this._start();
    } catch (err) {
      throw new Error(describeError(err));
    }
  }

  async _start() {
    const cfg = this.config;
    this.server = await ServerNode.create({
      id: 'bridge',
      network: { port: cfg.port || 5540 },
      // Unlike a bare `new CommissioningController()`, ServerNode.create()
      // does NOT invent a passcode/discriminator when one is omitted — it
      // throws ("discriminator is required" / "Invalid passcode undefined")
      // rather than auto-generating, confirmed the hard way against a real
      // config with only `passcode` set. Fall back to the same values
      // matter.js's own examples use as their development default.
      commissioning: {
        passcode: cfg.passcode ? Number(cfg.passcode) : 20202021,
        discriminator: cfg.discriminator ? Number(cfg.discriminator) : 3840,
      },
      productDescription: { name: 'LSH', deviceType: AggregatorEndpoint.deviceType },
      basicInformation: {
        vendorName: 'LSH', vendorId: VendorId(0xfff1),
        nodeLabel: 'LSH Bridge', productName: 'LSH Bridge', productLabel: 'Bridge', productId: 0x8000,
        serialNumber: 'lsh-matter-bridge-sn', uniqueId: 'lsh-matter-bridge-id',
      },
    });

    this.aggregator = new Endpoint(AggregatorEndpoint, { id: 'aggregator' });
    await this.server.add(this.aggregator);

    buildDevices(this.aggregator, this.sensorRegistry, this.store);
    // Devices registered after bridge startup (an integration that connects
    // late, e.g. cloud clients waiting on OAuth) still get bridged — the
    // registry emits this event for every new device, so just re-run for
    // whichever one just appeared. Endpoint ids are unique per device+tag so
    // re-running buildDevices for the whole registry would try to re-add
    // already-bridged endpoints; only handle the newly discovered one.
    this.sensorRegistry.on('device-discovered', (device) => {
      buildDevices(this.aggregator, { getDevices: () => [device] }, this.store);
    });

    await this.server.start();
    platformStatus.set('matter-bridge', true);

    if (!this.server.lifecycle.isCommissioned) {
      const { qrPairingCode, manualPairingCode } = this.server.state.commissioning.pairingCodes;
      this.pairingCodes = { qrPairingCode, manualPairingCode };
      console.log(`[Matter] Bridge not yet commissioned — manual pairing code: ${manualPairingCode}`);
      console.log(`[Matter] QR data: ${qrPairingCode} (see GET /api/matter/bridge/setup for the dashboard QR code)`);
    } else {
      console.log('[Matter] Bridge started — already commissioned, waiting for controllers to connect');
    }

    this.server.lifecycle.commissioned.on(() => console.log('[Matter] Bridge commissioned successfully'));
    this.server.lifecycle.decommissioned.on(() => console.log('[Matter] Bridge fully decommissioned (all fabrics removed)'));
  }

  getSetupInfo() {
    if (!this.server) return { isCommissioned: false };
    if (this.server.lifecycle.isCommissioned) return { isCommissioned: true };
    const { qrPairingCode, manualPairingCode } = this.server.state.commissioning.pairingCodes;
    return { isCommissioned: false, manualPairingCode, manualPairingCodeFormatted: formatManualPairingCode(manualPairingCode), qrPairingCode };
  }

  async stop() {
    if (this.server) await this.server.close();
    platformStatus.set('matter-bridge', false);
    console.log('[Matter] Bridge stopped');
  }
}

module.exports = MatterBridge;
