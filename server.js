const http = require('http');
const express = require('express');
const path = require('path');
require('./src/logger').install(); // must be first — patches console before any other module logs
const loadConfig         = require('./config');
const DataStore          = require('./src/data-store');
const ConnectionManager  = require('./src/connection-manager');
const RelayController    = require('./src/relay-controller');
const SensorRegistry     = require('./src/sensor-registry');
const SolarEdgeClient      = require('./src/solaredge-client');
const SmartThingsClient    = require('./src/smartthings-client');
const SatelClient          = require('./src/satel-client');
const UnifiProtectClient   = require('./src/unifi-protect-client');
const ShellyClient         = require('./src/shelly-client');
const LoxoneClient         = require('./src/loxone-client');
const MqttExplorer         = require('./src/mqtt-explorer');
const createApiRoutes    = require('./src/api-routes');
const setupWebSocket     = require('./src/websocket');
const startHomekitBridge = require('./src/homekit-bridge');

async function main() {
  const config          = loadConfig();
  const store           = new DataStore();
  const connectionMgr   = new ConnectionManager(config, store);
  const relayController = new RelayController(config, store);
  const sensorRegistry  = new SensorRegistry(store);

  // Start optional integrations before wiring API routes so unifiProtect is available
  let satelClient = null;
  if (config.satel?.host) {
    satelClient = new SatelClient(config, store, sensorRegistry);
    satelClient.start().catch((err) => console.error(`[Satel] Start failed: ${err.message}`));
  }

  let unifiProtect = null;
  if (config.unifi?.host) {
    unifiProtect = new UnifiProtectClient(config, store, sensorRegistry);
    unifiProtect.start().catch((err) => console.error(`[UniFi Protect] Start failed: ${err.message}`));
  }

  const mqttExplorer = config.mqtt?.host ? new MqttExplorer(config) : null;

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/api', createApiRoutes(store, relayController, sensorRegistry, connectionMgr, { unifiProtect, mqttExplorer }));

  const server = http.createServer(app);
  const io = setupWebSocket(server, store, sensorRegistry, connectionMgr);

  if (mqttExplorer) {
    mqttExplorer.setIo(io);
    mqttExplorer.start();
  }

  // Wire relay controller to whichever source is currently active
  connectionMgr.on('source-changed', () => {
    relayController.setClient(connectionMgr.getActiveClient());
  });

  // Start the connection manager (handles MQTT → VRM fallback automatically)
  await connectionMgr.start();
  relayController.setClient(connectionMgr.getActiveClient());

  // Start SolarEdge client if configured (runs in parallel with Victron)
  if (config.solaredge?.siteId && config.solaredge?.apiKey) {
    const solarEdge = new SolarEdgeClient(config, store);
    solarEdge.start().catch((err) => console.error(`[SolarEdge] Start failed: ${err.message}`));
  }

  // Start SmartThings client if configured (runs in parallel with Victron)
  if (config.smartthings?.token) {
    const smartThings = new SmartThingsClient(config, store, sensorRegistry);
    smartThings.start().catch((err) => console.error(`[SmartThings] Start failed: ${err.message}`));
  }

  // Start Shelly client if devices are configured
  if (config.shelly?.devices?.length) {
    const shelly = new ShellyClient(config, store, sensorRegistry);
    shelly.start().catch((err) => console.error(`[Shelly] Start failed: ${err.message}`));
  }

  // Start Loxone client if configured
  let loxoneClient = null;
  if (config.loxone?.host) {
    loxoneClient = new LoxoneClient(config, store, sensorRegistry);
    loxoneClient.start().catch((err) => console.error(`[Loxone] Start failed: ${err.message}`));
  }

  try {
    startHomekitBridge(config, store, relayController, sensorRegistry, { unifiProtect, loxoneClient });
  } catch (err) {
    console.error(`[HomeKit] Start failed: ${err.message}`);
  }

  server.listen(config.server.port, () => {
    console.log(`[Server] http://localhost:${config.server.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
