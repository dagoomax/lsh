const http         = require('http');
const https        = require('https');
const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');
require('./src/logger').install(); // must be first — patches console before any other module logs
const loadConfig      = require('./config');
const auth            = require('./src/auth');
const acme            = require('./src/acme');
const DataStore       = require('./src/data-store');
const ConnectionManager = require('./src/connection-manager');
const RelayController   = require('./src/relay-controller');
const SensorRegistry    = require('./src/sensor-registry');
const createApiRoutes   = require('./src/api-routes');
const setupWebSocket    = require('./src/websocket');

function tryRequire(mod, hint) {
  try { return require(mod); }
  catch { console.warn(`[Server] Optional module unavailable: ${mod}${hint ? ' — ' + hint : ''}`); return null; }
}

async function main() {
  const config          = loadConfig();
  const store           = new DataStore();
  const connectionMgr   = new ConnectionManager(config, store);
  const relayController = new RelayController(config, store);
  const sensorRegistry  = new SensorRegistry(store);

  // Start optional integrations before wiring API routes so unifiProtect is available
  let satelClient = null;
  if (config.satel?.host) {
    const SatelClient = tryRequire('./src/satel-client');
    if (SatelClient) {
      satelClient = new SatelClient(config, store, sensorRegistry);
      satelClient.start().catch((err) => console.error(`[Satel] Start failed: ${err.message}`));
    }
  }

  let unifiProtect = null;
  if (config.unifi?.host) {
    const UnifiProtectClient = tryRequire('./src/unifi-protect-client');
    if (UnifiProtectClient) {
      unifiProtect = new UnifiProtectClient(config, store, sensorRegistry);
      unifiProtect.start().catch((err) => console.error(`[UniFi Protect] Start failed: ${err.message}`));
    }
  }

  let mqttExplorer = null;
  if (config.mqtt?.host) {
    const MqttExplorer = tryRequire('./src/mqtt-explorer');
    if (MqttExplorer) mqttExplorer = new MqttExplorer(config);
  }

  // ── Determine HTTPS mode ─────────────────────────────────────────────────
  const leEnabled     = !!(config.server?.letsEncrypt?.enabled);
  const httpsEnabled  = !!(config.server?.https?.enabled);
  const isSecure      = leEnabled || httpsEnabled;

  // ── Express app ──────────────────────────────────────────────────────────
  const app = express();
  app.use(cookieParser());
  app.use(auth.middleware(isSecure));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/api', createApiRoutes(store, relayController, sensorRegistry, connectionMgr,
    { unifiProtect, mqttExplorer, auth, isSecure }));

  // ── Build HTTP/HTTPS server ───────────────────────────────────────────────
  let mainServer;
  let mainPort;

  if (leEnabled) {
    // Let's Encrypt: obtain cert first, then start HTTPS + redirect
    let certs = null;
    try {
      certs = await acme.acquireCert(config);
    } catch (err) {
      console.error(`[ACME] Certificate acquisition failed: ${err.message} — falling back to HTTP`);
    }
    if (certs) {
      mainServer = https.createServer({ cert: certs.cert, key: certs.key }, app);
      mainPort   = config.server?.letsEncrypt?.port || 443;
      acme.startRedirectServer(mainPort);
      acme.scheduleRenewal(config, (renewed) => {
        mainServer.setSecureContext({ cert: renewed.cert, key: renewed.key });
        console.log('[ACME] Certificate renewed and hot-reloaded');
      });
    } else {
      mainServer = http.createServer(app);
      mainPort   = config.server?.port || 3001;
    }
  } else if (httpsEnabled) {
    // Manual cert files
    const httpsServer = acme.createHttpsServerFromConfig(app, config);
    if (httpsServer) {
      mainServer = httpsServer;
      mainPort   = config.server?.https?.port || 3443;
      // Optional HTTP redirect on the plain port
      const plainPort = config.server?.port;
      if (plainPort && plainPort !== mainPort) {
        const redirect = http.createServer((req, res) => {
          const host = (req.headers.host || '').split(':')[0];
          const dest = mainPort === 443
            ? `https://${host}${req.url}`
            : `https://${host}:${mainPort}${req.url}`;
          res.writeHead(301, { Location: dest }).end();
        });
        redirect.listen(plainPort, () =>
          console.log(`[Server] HTTP redirect on :${plainPort} → HTTPS :${mainPort}`)
        );
      }
    } else {
      console.warn('[Server] HTTPS configured but could not create HTTPS server — falling back to HTTP');
      mainServer = http.createServer(app);
      mainPort   = config.server?.port || 3001;
    }
  } else {
    mainServer = http.createServer(app);
    mainPort   = config.server?.port || 3001;
  }

  const io = setupWebSocket(mainServer, store, sensorRegistry, connectionMgr, auth);

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

  // Start SolarEdge client if configured
  if (config.solaredge?.siteId && config.solaredge?.apiKey) {
    const SolarEdgeClient = tryRequire('./src/solaredge-client');
    if (SolarEdgeClient) {
      const solarEdge = new SolarEdgeClient(config, store);
      solarEdge.start().catch((err) => console.error(`[SolarEdge] Start failed: ${err.message}`));
    }
  }

  // Start SmartThings client if configured
  if (config.smartthings?.token) {
    const SmartThingsClient = tryRequire('./src/smartthings-client');
    if (SmartThingsClient) {
      const smartThings = new SmartThingsClient(config, store, sensorRegistry);
      smartThings.start().catch((err) => console.error(`[SmartThings] Start failed: ${err.message}`));
    }
  }

  // Start BoneIO client if configured
  if (config.boneio) {
    const BoneIOClient = tryRequire('./src/boneio-client');
    if (BoneIOClient) {
      const boneio = new BoneIOClient(config, store, sensorRegistry);
      boneio.start();
    }
  }

  // Start Dirigera (IKEA) client if configured
  if (config.dirigera?.host && config.dirigera?.token) {
    const DirigeraClient = tryRequire('./src/dirigera-client');
    if (DirigeraClient) {
      const dirigera = new DirigeraClient(config, store, sensorRegistry);
      dirigera.start().catch((err) => console.error(`[Dirigera] Start failed: ${err.message}`));
    }
  }

  // Start Tradfri (IKEA) client if configured
  if (config.tradfri?.host) {
    const TradfriClient = tryRequire('./src/tradfri-client', 'npm install node-tradfri-client');
    if (TradfriClient) {
      const tradfri = new TradfriClient(config, store, sensorRegistry);
      tradfri.start().catch((err) => console.error(`[Tradfri] Start failed: ${err.message}`));
    }
  }

  // Start Shelly client if devices are configured
  if (config.shelly?.devices?.length) {
    const ShellyClient = tryRequire('./src/shelly-client');
    if (ShellyClient) {
      const shelly = new ShellyClient(config, store, sensorRegistry);
      shelly.start().catch((err) => console.error(`[Shelly] Start failed: ${err.message}`));
    }
  }

  // Start Loxone client if configured
  let loxoneClient = null;
  if (config.loxone?.host) {
    const LoxoneClient = tryRequire('./src/loxone-client');
    if (LoxoneClient) {
      loxoneClient = new LoxoneClient(config, store, sensorRegistry);
      loxoneClient.start().catch((err) => console.error(`[Loxone] Start failed: ${err.message}`));
    }
  }

  const startHomekitBridge = tryRequire('./src/homekit-bridge');
  if (startHomekitBridge) {
    try {
      startHomekitBridge(config, store, relayController, sensorRegistry, { unifiProtect, loxoneClient });
    } catch (err) {
      console.error(`[HomeKit] Start failed: ${err.message}`);
    }
  }

  const protocol = (mainServer instanceof https.Server) ? 'https' : 'http';
  mainServer.listen(mainPort, () => {
    console.log(`[Server] ${protocol}://localhost:${mainPort}`);
    if (!auth.hasUsers()) {
      console.log('[Server] No users configured — visit /setup.html to create your admin account');
    }
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
