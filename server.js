const http         = require('http');
const https        = require('https');
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
require('./src/logger').install(); // must be first — patches console before any other module logs

// A single integration's async error (e.g. a listen() failure racing a port
// still in TIME_WAIT) must not take down the whole multi-integration hub —
// mirrors tryRequire's "log and keep going" philosophy for load-time errors,
// extended to runtime ones.
process.on('uncaughtException', (err) => {
  console.error(`[Server] Uncaught exception: ${err?.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[Server] Unhandled rejection: ${reason?.stack || reason}`);
});

const loadConfig      = require('./config');
const auth            = require('./src/auth');
const acme            = require('./src/acme');
const DataStore       = require('./src/data-store');
const ConnectionManager = require('./src/connection-manager');
const RelayController   = require('./src/relay-controller');
const SensorRegistry    = require('./src/sensor-registry');
const createApiRoutes   = require('./src/api-routes');
const setupWebSocket    = require('./src/websocket');
const INTEGRATIONS      = require('./src/integrations');

function tryRequire(mod, hint) {
  try { return require(mod); }
  catch { console.warn(`[Server] Optional module unavailable: ${mod}${hint ? ' — ' + hint : ''}`); return null; }
}

async function main() {
  const config          = loadConfig();
  // Fetch any configured integration whose files/npm deps aren't on disk yet
  // (a fresh install ships core only — see src/module-manager.js). Must run
  // before the tryRequire calls below so they find what it just installed.
  await require('./src/module-manager').ensureConfigured(config);
  const store           = new DataStore();
  // restore saved sensor data + history, save every 5 min and on shutdown;
  // persists to MongoDB when config.mongo.uri is set, else gzipped JSON in persist/
  await store.startPersistence(config.mongo);
  const connectionMgr   = new ConnectionManager(config, store);
  const relayController = new RelayController(config, store);
  const sensorRegistry  = new SensorRegistry(store, config.language); // server-side label translation

  // Motion-detector events → agenda feed (src/motion-log.js). Generic across
  // platforms — indexes each device's motion-ish sensors once (on discovery,
  // not on every store change) so this doesn't care which integration
  // reported it, and doesn't add per-event scan cost.
  {
    const motionLog = require('./src/motion-log');
    const MOTION_RE = /motion|presence|occupancy/i;
    const motionKeys = new Map(); // full store key -> device label
    const indexMotionSensors = (device) => {
      for (const s of device.sensors || []) {
        if (MOTION_RE.test(s.sensorType || s.path || '')) {
          motionKeys.set(`${device.key}/${s.path}`, device.label || device.key);
        }
      }
    };
    sensorRegistry.getDevices().forEach(indexMotionSensors);
    sensorRegistry.on('device-discovered', indexMotionSensors);
    const motionLastValue = new Map();
    store.on('change', ({ key, value }) => {
      const label = motionKeys.get(key);
      if (!label) return;
      const truthy = value === 1 || value === true || value === 'on';
      const wasTruthy = motionLastValue.get(key);
      motionLastValue.set(key, truthy);
      if (truthy && !wasTruthy) motionLog.push(label);
    });
  }

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

  if (config.unifiAccess?.host && config.unifiAccess?.apiKey) {
    const UnifiAccessClient = tryRequire('./src/unifi-access-client');
    if (UnifiAccessClient) {
      const unifiAccess = new UnifiAccessClient(config, store, sensorRegistry);
      unifiAccess.start().catch((err) => console.error(`[UniFi Access] Start failed: ${err.message}`));
    }
  }

  // Always construct — the client reads cameras from config.json on demand, so
  // cameras added via Settings apply live without a restart. AI object
  // detection (start()) is a no-op until there's at least one camera.
  let reolink = null;
  const ReolinkClient = tryRequire('./src/reolink-client');
  if (ReolinkClient) {
    reolink = new ReolinkClient(store, sensorRegistry);
    const n = reolink.getCameras().length;
    if (n) console.log(`[Reolink] ${n} camera(s) configured`);
    reolink.start().catch((err) => console.error(`[Reolink] AI detection start failed: ${err.message}`));
  }

  // Always construct — same live-config pattern as Reolink
  let kenik = null;
  const KenikClient = tryRequire('./src/kenik-client');
  if (KenikClient) {
    kenik = new KenikClient();
    const n = kenik.getCameras().length;
    if (n) console.log(`[KENIK] ${n} camera(s) configured`);
  }

  // MOBOTIX cameras / IP video door stations — same live-config pattern
  let mobotix = null;
  const MobotixClient = tryRequire('./src/mobotix-client');
  if (MobotixClient) {
    mobotix = new MobotixClient(store, sensorRegistry);
    const n = mobotix.getCameras().length;
    if (n) console.log(`[MOBOTIX] ${n} camera(s) configured`);
    mobotix.start().catch((err) => console.error(`[MOBOTIX] Start failed: ${err.message}`));
  }

  // Axis cameras (VAPIX) — same live-config pattern
  let axis = null;
  const AxisClient = tryRequire('./src/axis-client');
  if (AxisClient) {
    axis = new AxisClient(store, sensorRegistry);
    const n = axis.getCameras().length;
    if (n) console.log(`[Axis] ${n} camera(s) configured`);
    axis.start().catch((err) => console.error(`[Axis] Start failed: ${err.message}`));
  }

  // Yale doorbell cameras (cloud account, unlike the local cameras above).
  // Password brands (august/yale_home) need username+password; the token brand
  // (yale_global) needs an accessToken instead — accept either.
  let yale = null;
  if ((config.yale?.username && config.yale?.password) || config.yale?.accessToken) {
    const YaleClient = tryRequire('./src/yale-client');
    if (YaleClient) {
      yale = new YaleClient(config, store, sensorRegistry);
      yale.start().catch((err) => console.error(`[Yale] Start failed: ${err.message}`));
    }
  }

  // Hardware simulator manager — spawns scripts/*-simulator.js per
  // config.simulators; toggled live via /api/simulators
  let simulators = null;
  const SimulatorManager = tryRequire('./src/simulator-manager');
  if (SimulatorManager) {
    simulators = new SimulatorManager(config);
    simulators.start();
  }

  let mqttExplorer = null;
  if (config.mqtt?.host) {
    const MqttExplorer = tryRequire('./src/mqtt-explorer');
    if (MqttExplorer) mqttExplorer = new MqttExplorer(config);
  }

  // SIP doorbell intercom — pulses the configured door relay on "open door"
  let sipServer = null;
  if (config.sip?.enabled) {
    const SipServer = tryRequire('./src/sip-server', 'run: npm install sip');
    if (SipServer) {
      sipServer = new SipServer(config, {
        store,
        sensorRegistry,
        onOpenDoor: async () => {
          const idx = config.sip.doorRelay;
          if (idx == null) throw new Error('No door relay configured');
          await relayController.setState(idx, true);
          const pulse = config.sip.doorPulseMs || 3000;
          if (pulse > 0) {
            setTimeout(() => relayController.setState(idx, false).catch(() => {}), pulse);
          }
        },
      });
    }
  }

  // Room-to-room paging (intercom) — see src/paging.js. Every endpoint is a
  // browser (Wall Dashboard tablet or the regular dashboard), so unlike the
  // SIP doorbell above this needs no ffmpeg/RTP bridging, just Socket.IO.
  let pagingManager = null;
  if (config.paging?.enabled) {
    const PagingManager = tryRequire('./src/paging');
    if (PagingManager) pagingManager = new PagingManager(config);
  }

  // AirPlay speakers — see src/airplay-client.js. Plays prerecorded audio
  // (paging voice messages, an uploaded clip) out to a configured speaker
  // over RAOP/AirPlay; needs ffmpeg on PATH (already required for camera
  // RTSP elsewhere in this app).
  let airplayClient = null;
  if (config.airplay?.enabled) {
    const AirplayClient = tryRequire('./src/airplay-client');
    if (AirplayClient) airplayClient = new AirplayClient(config);
  }

  // ── Determine HTTPS mode ─────────────────────────────────────────────────
  const leEnabled     = !!(config.server?.letsEncrypt?.enabled);
  const httpsEnabled  = !!(config.server?.https?.enabled);
  const isSecure      = leEnabled || httpsEnabled;

  // ── Express app ──────────────────────────────────────────────────────────
  const app = express();
  app.use(cookieParser());

  // React dashboard — public static files (API calls are Bearer-token protected)
  // index.html must never be cached: Safari treats `no-cache` loosely and can
  // keep serving a stale app shell that references deleted (rebuilt) bundle
  // hashes → the JS 404s and the page is blank. `no-store` forbids caching it
  // outright, so the shell is always fresh; the hashed assets stay cacheable.
  const NO_STORE = 'no-store, no-cache, must-revalidate';
  const reactDist = path.join(__dirname, 'react-dashboard', 'dist');
  app.use('/react', express.static(reactDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html') || filePath.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', NO_STORE);
      }
    },
  }));
  app.get('/react/*', (req, res) =>
    res.sendFile(path.join(reactDist, 'index.html'), { headers: { 'Cache-Control': NO_STORE } }));

  // Aurora (the React dashboard) is now the primary dashboard — the classic
  // home page is replaced. Send the root (and the old index) to /react/.
  app.get(['/', '/index.html'], (req, res) => res.redirect('/react/'));
  // The classic pages are gone (React is the only frontend) — keep old
  // bookmarks and home-screen shortcuts working.
  const LEGACY_PAGES = {
    '/settings.html': '/react/settings', '/logs.html': '/react/logs', '/mqtt.html': '/react/mqtt',
    '/flows.html': '/react/flows', '/login.html': '/react/', '/setup.html': '/react/',
  };
  app.get(Object.keys(LEGACY_PAGES), (req, res) => res.redirect(301, LEGACY_PAGES[req.path]));

  app.use(auth.middleware(isSecure));
  // Furniture-picture uploads for the home plan arrive as base64 JSON and
  // need a bigger body cap; every other endpoint keeps the ~100 kb default.
  // Imported floor-plan models (GLB/OBJ) need a bigger cap still — base64
  // inflates the ~50 MB file-size limit enforced in api-routes.js by ~33%.
  const jsonBody = express.json();
  const jsonUploadBody = express.json({ limit: '6mb' });
  const jsonModelBody = express.json({ limit: '70mb' });
  app.use((req, res, next) =>
    (req.path === '/api/plan-decor/upload' ? jsonUploadBody
      : req.path === '/api/plan-model/upload' ? jsonModelBody
      : jsonBody)(req, res, next));
  // Swagger UI for the REST API (spec generated by scripts/gen-openapi.js).
  // Auth-gated like the rest of the UI. The spec is injected inline so the page
  // needs no separate (unauthenticated) fetch of /openapi.json — the reason a
  // token-authed page would otherwise hang on "loading".
  app.get('/api-docs', (req, res) => {
    const fs = require('fs');
    try {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'api-docs.html'), 'utf8');
      const spec = fs.readFileSync(path.join(__dirname, 'public', 'openapi.json'), 'utf8');
      // Escape "<" so an embedded "</script>" can't break out of the tag.
      const safe = spec.replace(/</g, '\\u003c');
      res.type('html').send(html.replace('__OPENAPI_SPEC__', safe));
    } catch (err) {
      res.status(500).send('API docs unavailable — run: npm run openapi');
    }
  });
  // User-authored CSS (Settings → Interface → Custom CSS), referenced by a
  // real <link> tag in the dashboard's <head> — public/unauthenticated so
  // it applies on the sign-in screen too, and loads before first paint
  // instead of flashing unstyled then restyled. Deliberately outside /api/:
  // auth.js's middleware never exempts /api/* paths (dynamic data there must
  // stay gated even when a path looks like a static asset), so a path like
  // /api/custom.css would 401 despite the .css extension — same reason
  // /i18n/*.json is public but /api/i18n/*.json isn't. Reads config.json
  // fresh on every request (not the startup-time `config` object) so edits
  // apply immediately, no restart needed.
  app.get('/custom.css', (req, res) => {
    const fs = require('fs');
    let customCss = '';
    try {
      customCss = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).ui?.customCss || '';
    } catch { /* config unreadable — serve empty rather than error the page load */ }
    res.set('Content-Type', 'text/css; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(customCss);
  });
  // public/: assets shared with the React app (logo, floor-plan SVGs) and the
  // Swagger UI page's files (/api-docs above).
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', NO_STORE);
    },
  }));
  let ffmpegRtsp = null;
  if (config.ffmpegRtsp?.enabled) {
    const FFmpegRTSP = tryRequire('./src/ffmpeg-rtsp');
    if (FFmpegRTSP) {
      ffmpegRtsp = new FFmpegRTSP(config);
      ffmpegRtsp.start();
    }
  }

  // Start OpenWeatherMap client if configured — instantiated here (not down
  // with the other simple polling clients) so it's ready before apiClients
  // is built just below; otherwise apiClients.openweather would capture null
  // forever (object literals copy the value at construction time, not a
  // live binding).
  let openweather = null;
  if (config.openweather?.apiKey) {
    const OpenWeatherClient = tryRequire('./src/openweather-client');
    if (OpenWeatherClient) {
      openweather = new OpenWeatherClient(config, store, sensorRegistry);
      openweather.start().catch((err) => console.error(`[OpenWeather] Start failed: ${err.message}`));
    }
  }

  // Host system metrics (CPU / memory / disk of the box LSH runs on).
  // Enabled by default; set config.systemMetrics to false to disable, or to
  // an object to tune { pollInterval, name, disks }.
  if (config.systemMetrics !== false) {
    const SystemMetricsClient = tryRequire('./src/system-metrics-client');
    if (SystemMetricsClient) {
      const systemMetrics = new SystemMetricsClient(config, store, sensorRegistry);
      systemMetrics.start().catch((err) => console.error(`[SystemMetrics] Start failed: ${err.message}`));
    }
  }

  // Loxone Weather Service emulator — standalone HTTP listener (not a
  // device client: no sensors, nothing pushed to the store), so DNS-override
  // weather.loxone.com to this host to serve Miniservers their hourly forecast.
  if (config.loxoneWeather) {
    const LoxoneWeatherServer = tryRequire('./src/loxone-weather-server');
    if (LoxoneWeatherServer) {
      const loxoneWeather = new LoxoneWeatherServer(config);
      loxoneWeather.start().catch((err) => console.error(`[LoxoneWeather] Start failed: ${err.message}`));
    }
  }

  // Start virtual devices (switches/dimmers/sensors/text/buttons with no
  // real hardware behind them) before the automation engine below — a flow's
  // action can target a virtual device the moment automation.start() begins
  // listening for store changes, so the device must already be registered.
  if (config.virtual?.devices?.length) {
    const VirtualClient = tryRequire('./src/virtual-client');
    if (VirtualClient) {
      const virtual = new VirtualClient(config, store, sensorRegistry);
      virtual.start().catch((err) => console.error(`[Virtual] Start failed: ${err.message}`));
    }
  }

  // Automation engine (rules / scenes / notifications) — io attached after WS setup
  let automation = null;
  const AutomationEngine = tryRequire('./src/automation-engine');
  if (AutomationEngine) automation = new AutomationEngine(store, sensorRegistry, relayController, config);

  // LAN device monitor (Settings → System → LAN scan → Devices): presence of
  // monitored devices + optional scheduled scans that tag new devices.
  if (config.lshLan?.enabled) {
    const lanMonitorMod = tryRequire('./src/lsh-lan-monitor');
    if (lanMonitorMod) lanMonitorMod.getMonitor({ config, store, sensorRegistry, automation }).start();
  }

  // Daily check of the Tuya cloud login behind tuya-ipc-terminal (Tuya cameras)
  if (config.tuyaIpc) {
    const TuyaIpcWatchdog = tryRequire('./src/tuya-ipc-watchdog');
    if (TuyaIpcWatchdog) {
      new TuyaIpcWatchdog(config, store, sensorRegistry, automation).start()
        .catch((err) => console.error(`[TuyaIPC] Start failed: ${err.message}`));
    }
  }

  // Local object detection (COCO-SSD) for RTSP-only cameras with no on-device
  // AI of their own — tryRequire so a missing/uninstalled tfjs on this box
  // just skips the feature instead of crashing.
  let objectDetection = null;
  if (config.objectDetection?.cameras?.length) {
    const ObjectDetectionClient = tryRequire('./src/object-detection', 'npm install @tensorflow/tfjs @tensorflow-models/coco-ssd jpeg-js');
    if (ObjectDetectionClient) {
      objectDetection = new ObjectDetectionClient(config, store, sensorRegistry, automation);
      objectDetection.start().catch((err) => console.error(`[ObjectDetection] Start failed: ${err.message}`));
    }
  }

  const apiClients = { unifiProtect, reolink, kenik, mobotix, axis, yale, simulators, mqttExplorer, auth, isSecure, ffmpegRtsp, automation, sipServer, pagingManager, openweather, objectDetection, airplayClient };
  app.use('/api', createApiRoutes(store, relayController, sensorRegistry, connectionMgr, apiClients));

  // MCP server — exposes devices/sensors as tools for an external Claude
  // (Desktop, Claude Code, claude.ai) to query/control. Opt-in: it's a
  // control-plane endpoint, so it only mounts when explicitly enabled.
  // Auth reuses the same /api/* middleware (Bearer API token) as everything
  // else — no separate credential to manage.
  if (config.mcp?.enabled) {
    const mcpServer = tryRequire('./src/mcp-server', 'npm install @modelcontextprotocol/sdk zod');
    if (mcpServer) {
      // Minimal per-IP sliding-window rate limit — MCP requests can trigger
      // expensive sensor/automation work, so cap volume to avoid resource
      // exhaustion (CWE-770) without adding a new dependency.
      const mcpRequestLog = new Map();
      const mcpRateLimit = (req, res, next) => {
        const now = Date.now();
        const windowMs = 60 * 1000;
        const maxRequests = 30;
        const timestamps = (mcpRequestLog.get(req.ip) || []).filter((t) => now - t < windowMs);
        if (timestamps.length >= maxRequests) {
          return res.status(429).json({ success: false, error: 'Too many requests — please slow down' });
        }
        timestamps.push(now);
        mcpRequestLog.set(req.ip, timestamps);
        next();
      };
      app.post('/api/mcp', mcpRateLimit, (req, res) => mcpServer.handleRequest(req, res, store, sensorRegistry, automation));
      app.get('/api/mcp', (req, res) => res.status(405).json({ success: false, error: 'Method not allowed — MCP requests use POST (Streamable HTTP transport)' }));
      app.delete('/api/mcp', (req, res) => res.status(405).json({ success: false, error: 'Method not allowed' }));
      console.log('[MCP] Server mounted at /api/mcp');
    }
  }

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

  const io = setupWebSocket(mainServer, store, sensorRegistry, connectionMgr, auth, sipServer, pagingManager);
  require('./src/terminal-server').attachTerminalNamespace(io, auth);

  if (pagingManager) pagingManager.setIo(io);

  if (automation) {
    automation.setIo(io);
    automation.setPaging(pagingManager);
    automation.start();
  }

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

  // Start SIP doorbell intercom if enabled
  if (sipServer) {
    try {
      sipServer.start();
    } catch (err) {
      console.error(`[SIP] Start failed: ${err.message}`);
    }
  }

  // Start SolarEdge client if configured
  if (config.solaredge?.siteId && config.solaredge?.apiKey) {
    const SolarEdgeClient = tryRequire('./src/solaredge-client');
    if (SolarEdgeClient) {
      const solarEdge = new SolarEdgeClient(config, store);
      solarEdge.start().catch((err) => console.error(`[SolarEdge] Start failed: ${err.message}`));
    }
  }

  // Start SmartThings client if configured
  let smartThings = null;
  if (config.smartthings?.token || (config.smartthings?.clientId && config.smartthings?.clientSecret)) {
    const SmartThingsClient = tryRequire('./src/smartthings-client');
    if (SmartThingsClient) {
      smartThings = new SmartThingsClient(config, store, sensorRegistry);
      apiClients.smartThings = smartThings;
      const smartThingsStarted = smartThings.start();
      smartThingsStarted.catch((err) => console.error(`[SmartThings] Start failed: ${err.message}`));

      // Deliver the current SmartThings bearer token to a file every 24h, so
      // it's available for pasting into tools outside LSH without having to
      // dig through persist/smartthings-oauth.json.
      if (config.smartthings.clientId && config.smartthings.clientSecret) {
        const deliverToken = async () => {
          try {
            const token = await smartThings.getToken();
            const out = path.join(__dirname, 'persist', 'smartthings-token-latest.txt');
            fs.writeFileSync(out, `${token}\ndelivered_at: ${new Date().toISOString()}\n`);
            console.log(`[SmartThings] Token delivered to ${out}`);
          } catch (err) {
            console.error(`[SmartThings] Token delivery failed: ${err.message}`);
          }
        };
        smartThingsStarted.then(deliverToken, () => {});
        setInterval(deliverToken, 24 * 60 * 60 * 1000);
      }
    }
  }

  // Integrations whose whole wiring is construct-and-start — listed in
  // src/integrations.js. Anything needing more (extra constructor args,
  // setIo, a reference held here) stays written out inline above/below.
  for (const it of INTEGRATIONS) {
    if (!it.when(config)) continue;
    const Client = tryRequire(`./src/${it.file}`, it.hint);
    if (!Client) continue;
    const client = new Client(config, store, sensorRegistry);
    if (it.expose) apiClients[it.expose] = client;
    client.start().catch((err) => console.error(`[${it.label}] Start failed: ${err.message}`));
  }

  // Start the Matter bridge if enabled — exposes LSH devices to Apple Home /
  // Google Home / Alexa / SmartThings etc. as one bridged Matter node.
  if (config.matter?.bridge?.enabled) {
    const MatterBridge = tryRequire('./src/matter-bridge');
    if (MatterBridge) {
      const matterBridge = new MatterBridge(config, store, sensorRegistry);
      matterBridge.start().catch((err) => console.error(`[Matter] Bridge start failed: ${err.message}`));
      apiClients.matterBridge = matterBridge; // exposed for GET /api/matter/bridge/setup
    }
  }

  // Start the Matter controller if enabled — connects to devices already
  // commissioned via scripts/matter-commission.js.
  if (config.matter?.controller?.enabled) {
    const MatterClient = tryRequire('./src/matter-client');
    if (MatterClient) {
      const matterClient = new MatterClient(config, store, sensorRegistry);
      matterClient.start().catch((err) => console.error(`[Matter] Controller start failed: ${err.message}`));
    }
  }



  // Start Tauron dynamic-tariff tracker if enabled — a public, no-auth PSE
  // (Polish grid operator) price index that TAURON's G14dynamic tariff
  // settles against, used for the Energy tab's electricity-cost/solar-gain
  // reading.
  if (config.tauronTariff?.enabled) {
    const TauronTariffClient = tryRequire('./src/tauron-tariff-client');
    if (TauronTariffClient) {
      const tauronTariff = new TauronTariffClient(config, store, sensorRegistry);
      apiClients.tauronTariff = tauronTariff; // exposed for GET /api/tauron-tariff/hourly
      tauronTariff.start().catch((err) => console.error(`[TauronTariff] Start failed: ${err.message}`));
    }
  }


  // Start Google Calendar client if configured (OAuth connect happens later,
  // from Settings — the client itself just needs clientId/clientSecret to
  // exist so the Settings page can offer the "Connect" link)
  if (config.googleCalendar?.clientId && config.googleCalendar?.clientSecret) {
    const GoogleCalendarClient = tryRequire('./src/google-calendar-client');
    if (GoogleCalendarClient) {
      const googleCalendar = new GoogleCalendarClient(config);
      apiClients.googleCalendar = googleCalendar;
      googleCalendar.start().catch((err) => console.error(`[GoogleCalendar] Start failed: ${err.message}`));
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













  // Start Roborock cloud client if configured (Roborock-app devices, e.g. Q Revo)
  if (config.roborock?.cloud?.email) {
    const RoborockCloudClient = tryRequire('./src/roborock-cloud-client');
    if (RoborockCloudClient) {
      const roborockCloud = new RoborockCloudClient(config, store, sensorRegistry);
      apiClients.roborockCloud = roborockCloud; // expose for /api/roborock/* (map)
      roborockCloud.start().catch((err) => console.error(`[RoborockCloud] Start failed: ${err.message}`));
    }
  }


  // Start BroadLink IR/RF client if configured
  if (config.broadlink?.devices?.length) {
    const BroadlinkClient = tryRequire('./src/broadlink-client');
    if (BroadlinkClient) {
      const broadlink = new BroadlinkClient(config, store, sensorRegistry);
      apiClients.broadlink = broadlink;
      broadlink.start().catch((err) => console.error(`[Broadlink] Start failed: ${err.message}`));
    }
  }





  // Start Ampio client if configured (MQTT broker on the M-SERV)
  if (config.ampio?.host && config.ampio?.devices?.length) {
    const AmpioClient = tryRequire('./src/ampio-client');
    if (AmpioClient) {
      const ampio = new AmpioClient(config, store, sensorRegistry);
      ampio.start();
    }
  }


  // Start Aqara client if configured (gateway LAN protocol, UDP 9898)
  if (config.aqara?.gateways?.length) {
    const AqaraClient = tryRequire('./src/aqara-client');
    if (AqaraClient) {
      const aqara = new AqaraClient(config, store, sensorRegistry);
      aqara.start();
    }
  }



  // Start Somfy client if configured (cloud: email+password; local: host + token or email/password)
  if (
    (config.somfy?.mode === 'cloud' && config.somfy?.email && config.somfy?.password) ||
    (config.somfy?.host && (config.somfy?.token || (config.somfy?.email && config.somfy?.password)))
  ) {
    const SomfyClient = tryRequire('./src/somfy-client');
    if (SomfyClient) {
      const somfy = new SomfyClient(config, store, sensorRegistry);
      somfy.start().catch((err) => console.error(`[Somfy] Start failed: ${err.message}`));
    }
  }

  // Start Loxone outbound push client if configured
  if (config.loxoneOut?.host && config.loxoneOut?.mappings?.length) {
    const LoxoneOutClient = tryRequire('./src/loxone-out-client');
    if (LoxoneOutClient) {
      const loxoneOut = new LoxoneOutClient(config, store);
      loxoneOut.start();
    }
  }

  // Start AuxAir (AC Freedom) client if configured
  if (config.auxair) {
    if (!config.auxair.email || !config.auxair.password) {
      console.warn('[AuxAir] Config present but email/password missing — client not started');
    } else {
      const AuxAirClient = tryRequire('./src/auxair-client');
      if (AuxAirClient) {
        const auxair = new AuxAirClient(config, store, sensorRegistry);
        auxair.start().catch((err) => console.error(`[AuxAir] Start failed: ${err.message}`));
      }
    }
  }







  // Start Sonos client if configured or auto-discovery enabled
  if (config.sonos) {
    const SonosClient = tryRequire('./src/sonos-client');
    if (SonosClient) {
      const sonos = new SonosClient(config, store, sensorRegistry);
      apiClients.sonos = sonos; // expose for /api/sonos/* (announce, play-url)
      sonos.start().catch((err) => console.error(`[Sonos] Start failed: ${err.message}`));
    }
  }








  // Start SmartBob MQTT client if configured
  if (config.smartbob?.entities?.length) {
    const SmartBobClient = tryRequire('./src/smartbob-client');
    if (SmartBobClient) {
      const smartbob = new SmartBobClient(config, store, sensorRegistry);
      smartbob.start();
    }
  }


  // Start Arduino MQTT client if configured
  if (config.arduino?.devices?.length) {
    const ArduinoClient = tryRequire('./src/arduino-client');
    if (ArduinoClient) {
      const arduino = new ArduinoClient(config, store, sensorRegistry);
      arduino.start();
    }
  }




  // Start Wiren Board client if configured
  if (config.wirenboard?.host) {
    const WirenBoardClient = tryRequire('./src/wirenboard-client');
    if (WirenBoardClient) {
      const wirenboard = new WirenBoardClient(config, store, sensorRegistry);
      wirenboard.start();
    }
  }



  // Push LSH values out to Fibaro global variables if configured
  if (config.fibaroOut?.host && config.fibaroOut?.mappings?.length) {
    const FibaroOutClient = tryRequire('./src/fibaro-out-client');
    if (FibaroOutClient) {
      const fibaroOut = new FibaroOutClient(config, store);
      fibaroOut.start().catch((err) => console.error(`[FibaroOut] Start failed: ${err.message}`));
    }
  }




  // Push LSH values out to the Domatiq CAN bus if configured
  if (config.domatiqOut?.host && config.domatiqOut?.mappings?.length) {
    const DomatiqOutClient = tryRequire('./src/domatiq-out-client');
    if (DomatiqOutClient) {
      const domatiqOut = new DomatiqOutClient(config, store);
      domatiqOut.start().catch((err) => console.error(`[DomatiqOut] Start failed: ${err.message}`));
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

  if (config.homekit?.enabled !== false) {
    const startHomekitBridge = tryRequire('./src/homekit-bridge', 'install hap-nodejs to enable HomeKit');
    if (startHomekitBridge) {
      try {
        startHomekitBridge(config, store, relayController, sensorRegistry, { unifiProtect, loxoneClient, automation, karcher: apiClients.karcher });
      } catch (err) {
        console.error(`[HomeKit] Start failed: ${err.message}`);
      }
    }
  }

  const protocol = (mainServer instanceof https.Server) ? 'https' : 'http';
  mainServer.listen(mainPort, () => {
    console.log(`[Server] ${protocol}://localhost:${mainPort}`);
    if (!auth.hasUsers()) {
      console.log('[Server] No users configured — open the dashboard to create your admin account');
    }
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
