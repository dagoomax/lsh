/**
 * Matter controller — connects to Matter devices that have already been
 * commissioned onto LSH's own fabric (a separate admin alongside Apple
 * Home/Google Home/etc. — Matter's multi-fabric model lets the same physical
 * device belong to several ecosystems at once) and exposes them as normal
 * LSH devices, same as any other src/*-client.js integration.
 *
 * Commissioning a new device is a one-time, interactive action (needs the
 * device's pairing code) and lives in scripts/matter-commission.js, not
 * here — this client only connects to nodes that script has already
 * commissioned. Thread devices need no special handling beyond that: once
 * joined to an existing Thread mesh (via its own Border Router — Apple
 * TV/HomePod mini, etc.) a Thread device is just a regular Matter node
 * reachable over IP, discovered the same way as a Wi-Fi/Ethernet one.
 *
 * Scope (v1): mirrors matter-bridge.js's supported clusters — on/off,
 * level control (brightness), boolean state (contact), occupancy sensing,
 * temperature/humidity/illuminance measurement, window covering (lift only).
 * A commissioned device exposing other clusters (locks, thermostats, color
 * lights, …) is still registered, just without sensors for those clusters —
 * see matter-bridge.js's header comment for why those are deferred.
 *
 * Untested against a real third-party Matter device — verified so far only
 * via a loopback test against LSH's own matter-bridge.js (commission the
 * bridge like any other Matter device, confirm read+write both work).
 */
require('./matter-storage');
const { Environment } = require('@matter/main');
const { CommissioningController } = require('@project-chip/matter.js');
const { OnOffClient } = require('@matter/main/behaviors/on-off');
const { LevelControlClient } = require('@matter/main/behaviors/level-control');
const { BooleanStateClient } = require('@matter/main/behaviors/boolean-state');
const { OccupancySensingClient } = require('@matter/main/behaviors/occupancy-sensing');
const { TemperatureMeasurementClient } = require('@matter/main/behaviors/temperature-measurement');
const { RelativeHumidityMeasurementClient } = require('@matter/main/behaviors/relative-humidity-measurement');
const { IlluminanceMeasurementClient } = require('@matter/main/behaviors/illuminance-measurement');
const { WindowCoveringClient } = require('@matter/main/behaviors/window-covering');
const { BasicInformationClient } = require('@matter/main/behaviors/basic-information');
const { OnOff, LevelControl, BooleanState, OccupancySensing, TemperatureMeasurement, RelativeHumidityMeasurement, IlluminanceMeasurement, WindowCovering } = require('@matter/main/clusters');
const platformStatus = require('./platform-status');

// node.events.attributeChanged (not a per-endpoint event — confirmed via the
// loopback test; a part has no .events.attributeChanged of its own) reports
// numeric cluster ids, not the friendly names used elsewhere in this file.
const CLUSTER_ID = {
  onOff: OnOff.Cluster.id,
  levelControl: LevelControl.Cluster.id,
  booleanState: BooleanState.Cluster.id,
  occupancySensing: OccupancySensing.Cluster.id,
  temperatureMeasurement: TemperatureMeasurement.Cluster.id,
  relativeHumidityMeasurement: RelativeHumidityMeasurement.Cluster.id,
  illuminanceMeasurement: IlluminanceMeasurement.Cluster.id,
  windowCovering: WindowCovering.Cluster.id,
};

// Unlike a ServerNode endpoint's .state (which reads back `undefined` for a
// behavior that isn't present), a remote ClientNode part's .stateOf() throws
// for an absent behavior — confirmed via a local loopback commission test
// (matter-bridge.js's aggregator endpoint has no OnOff cluster, and
// part.stateOf(OnOffClient) threw rather than returning undefined there).
function safeStateOf(part, Client) {
  try { return part?.stateOf(Client); } catch { return undefined; }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v ?? lo));
const levelToPct = (level) => Math.round(((clamp(level, 1, 254) - 1) / 253) * 100);
const pctToLevel = (pct)   => Math.round(1 + (clamp(pct, 0, 100) / 100) * 253);
// See matter-bridge.js's addCoverEndpoint comment: Matter's lift percent is
// inverted relative to LSH's "% open" convention (0 = fully open in Matter).
const matterLiftToOpenPct = (pct100ths) => clamp(100 - pct100ths / 100, 0, 100);
const openPctToMatterLift = (openPct)   => Math.round((100 - clamp(openPct, 0, 100)) * 100);

class MatterClient {
  constructor(config, store, sensorRegistry) {
    this.config = config.matter?.controller || {};
    this.store = store;
    this.sensorRegistry = sensorRegistry;
    this.nodes = new Map(); // nodeId -> ClientNode
    this.deviceKeysByEndpoint = new Map(); // "nodeId-endpointNumber" -> LSH device key
  }

  async start() {
    this.controller = new CommissioningController({
      environment: { environment: Environment.default, id: 'controller' },
      autoConnect: false,
      adminFabricLabel: 'LSH',
    });
    await this.controller.start();

    const nodeIds = this.controller.getCommissionedNodes();
    if (!nodeIds.length) {
      console.log('[Matter] Controller has no commissioned devices yet — run: node scripts/matter-commission.js');
      platformStatus.set('matter-controller', true);
      return;
    }
    for (const nodeId of nodeIds) {
      try { await this._connectNode(nodeId); }
      catch (err) { console.error(`[Matter] Failed to connect node ${nodeId}: ${err.message}`); }
    }
    platformStatus.set('matter-controller', true);
  }

  async _connectNode(nodeId) {
    const node = await this.controller.getNode(nodeId);
    this.nodes.set(String(nodeId), node);

    node.events.stateChanged.on((state) => {
      console.log(`[Matter] Node ${nodeId} ${state}`);
      platformStatus.set('matter-controller', true);
    });
    // Deprecated since matter.js 0.17 (slated for removal in 0.18, which was
    // still alpha-only as of this writing) but the only working attribute
    // subscription API on this version — revisit when 0.18 stabilizes.
    node.events.attributeChanged.on(({ path, value }) => this._onAttributeChanged(nodeId, path, value));

    if (!node.isConnected) node.connect();
    if (!node.initialized) await node.events.initialized;

    const rootInfo = safeStateOf(node.parts.get(0), BasicInformationClient);
    const nodeLabel = rootInfo?.nodeLabel || rootInfo?.productName || `Matter Device ${nodeId}`;

    // node.parts only lists the root's direct children — a bridge's actual
    // devices sit one level deeper (root -> aggregator -> device), same
    // structure matter-bridge.js itself builds, so this walks the whole tree
    // rather than assuming a flat list.
    const visit = (part) => {
      if (part.number !== 0) this._registerEndpoint(nodeId, part, nodeLabel);
      for (const child of part.parts.values()) visit(child);
    };
    for (const part of node.parts.values()) visit(part);
  }

  _registerEndpoint(nodeId, part, nodeLabel) {
    const deviceKey = `matter/${nodeId}-${part.number}`;
    const sensors = [];
    const device = {
      key: deviceKey, type: 'matter', label: nodeLabel, icon: '🧩', color: 'purple', sensors,
      _writeCapability: (capabilityId, command, args = []) => this._writeCommand(part, capabilityId, command, args),
    };

    const onOff = safeStateOf(part, OnOffClient);
    if (onOff !== undefined) {
      sensors.push({ path: 'switch', name: 'Switch', label: 'Switch', controllable: true, capabilityId: 'onOff', writeOn: 'on', writeOff: 'off', type: 'toggle' });
      this.store.set(`${deviceKey}/switch`, onOff.onOff ? 1 : 0);
    }
    const level = safeStateOf(part, LevelControlClient);
    if (level !== undefined) {
      sensors.push({ path: 'level', name: 'Level', label: 'Level', controllable: true, capabilityId: 'level', writeCmd: 'setLevel', type: 'range', min: 0, max: 100 });
      this.store.set(`${deviceKey}/level`, level.currentLevel != null ? levelToPct(level.currentLevel) : 0);
    }
    const contact = safeStateOf(part, BooleanStateClient);
    if (contact !== undefined) {
      sensors.push({ path: 'contact', name: 'Contact', label: 'Contact', homekit: 'contact' });
      // Inverse of matter-bridge.js's addContactEndpoint: Matter true=closed,
      // LSH convention is 1=open (see that function's comment for the source).
      this.store.set(`${deviceKey}/contact`, contact.stateValue ? 0 : 1);
    }
    const occupancy = safeStateOf(part, OccupancySensingClient);
    if (occupancy !== undefined) {
      sensors.push({ path: 'occupancy', name: 'Occupancy', label: 'Occupancy', homekit: 'occupancy' });
      this.store.set(`${deviceKey}/occupancy`, occupancy.occupancy?.occupied ? 1 : 0);
    }
    const temp = safeStateOf(part, TemperatureMeasurementClient);
    if (temp !== undefined) {
      sensors.push({ path: 'temperature', name: 'Temperature', label: 'Temperature', unit: '°C' });
      this.store.set(`${deviceKey}/temperature`, temp.measuredValue != null ? temp.measuredValue / 100 : null);
    }
    const hum = safeStateOf(part, RelativeHumidityMeasurementClient);
    if (hum !== undefined) {
      sensors.push({ path: 'humidity', name: 'Humidity', label: 'Humidity', unit: '%' });
      this.store.set(`${deviceKey}/humidity`, hum.measuredValue != null ? hum.measuredValue / 100 : null);
    }
    const lux = safeStateOf(part, IlluminanceMeasurementClient);
    if (lux !== undefined) {
      sensors.push({ path: 'illuminance', name: 'Illuminance', label: 'Illuminance', unit: 'lx' });
      this.store.set(`${deviceKey}/illuminance`, lux.measuredValue != null ? Math.round(10 ** ((lux.measuredValue - 1) / 10000)) : null);
    }
    const cover = safeStateOf(part, WindowCoveringClient);
    if (cover !== undefined) {
      sensors.push({ path: 'level', name: 'Position', label: 'Position', controllable: true, capabilityId: 'cover', writeCmd: 'setLevel', type: 'range', min: 0, max: 100 });
      this.store.set(`${deviceKey}/level`, cover.currentPositionLiftPercent100ths != null ? matterLiftToOpenPct(cover.currentPositionLiftPercent100ths) : null);
    }

    if (!sensors.length) {
      console.log(`[Matter] Node ${nodeId} endpoint ${part.number} has no clusters LSH maps yet — skipped`);
      return;
    }

    this.deviceKeysByEndpoint.set(`${nodeId}-${part.number}`, deviceKey);

    this.sensorRegistry.registerDevice(device);
  }

  _onAttributeChanged(nodeId, path, value) {
    const deviceKey = this.deviceKeysByEndpoint?.get(`${nodeId}-${path.endpointId}`);
    if (!deviceKey) return;
    const clusterId = Number(path.clusterId);
    if (clusterId === CLUSTER_ID.onOff && path.attributeName === 'onOff') this.store.set(`${deviceKey}/switch`, value ? 1 : 0);
    if (clusterId === CLUSTER_ID.levelControl && path.attributeName === 'currentLevel') this.store.set(`${deviceKey}/level`, levelToPct(value));
    if (clusterId === CLUSTER_ID.booleanState && path.attributeName === 'stateValue') this.store.set(`${deviceKey}/contact`, value ? 0 : 1);
    if (clusterId === CLUSTER_ID.occupancySensing && path.attributeName === 'occupancy') this.store.set(`${deviceKey}/occupancy`, value?.occupied ? 1 : 0);
    if (clusterId === CLUSTER_ID.temperatureMeasurement && path.attributeName === 'measuredValue') this.store.set(`${deviceKey}/temperature`, value != null ? value / 100 : null);
    if (clusterId === CLUSTER_ID.relativeHumidityMeasurement && path.attributeName === 'measuredValue') this.store.set(`${deviceKey}/humidity`, value != null ? value / 100 : null);
    if (clusterId === CLUSTER_ID.illuminanceMeasurement && path.attributeName === 'measuredValue') this.store.set(`${deviceKey}/illuminance`, value != null ? Math.round(10 ** ((value - 1) / 10000)) : null);
    if (clusterId === CLUSTER_ID.windowCovering && path.attributeName === 'currentPositionLiftPercent100ths') this.store.set(`${deviceKey}/level`, matterLiftToOpenPct(value));
  }

  async _writeCommand(part, capabilityId, command, args) {
    try {
      if (capabilityId === 'onOff') {
        const cmds = part.commandsOf(OnOffClient);
        if (command === 'on') await cmds.on();
        else if (command === 'off') await cmds.off();
        else if (command === 'toggle') await cmds.toggle();
        return;
      }
      if (capabilityId === 'level') {
        await part.commandsOf(LevelControlClient).moveToLevel({ level: pctToLevel(args[0]) });
        return;
      }
      if (capabilityId === 'cover') {
        await part.commandsOf(WindowCoveringClient).goToLiftPercentage({ liftPercent100thsValue: openPctToMatterLift(args[0]) });
        return;
      }
    } catch (err) {
      console.error(`[Matter] Command ${command} on ${capabilityId} failed: ${err.message}`);
      throw err;
    }
  }

  async stop() {
    for (const node of this.nodes.values()) { try { node.close(); } catch { /* already closed */ } }
    if (this.controller) await this.controller.close();
    platformStatus.set('matter-controller', false);
    console.log('[Matter] Controller stopped');
  }
}

module.exports = MatterClient;
