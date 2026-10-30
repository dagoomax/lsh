'use strict';

// Helper for the Go core: prints the effective config (config.js, with its
// env-var overrides), the integrations from src/integrations.js whose `when`
// matches it — those are plain JS predicates, so Node evaluates them — and
// the Victron device catalog (src/device-definitions.js, data only).

const path = require('path');
const fs = require('fs');
const root = process.argv[2] || path.join(__dirname, '..', '..');
const config = require(path.join(root, 'config'))();
let integrations = require(path.join(root, 'src', 'integrations')).map((it) => {
  let on = false;
  try { on = !!it.when(config); } catch { /* bad config section → off */ }
  const installed = fs.existsSync(path.join(root, 'src', `${it.file}.js`));
  return { file: it.file, label: it.label, expose: it.expose || null, on, installed };
});
// Integrations server.js starts inline. For the Go core they run as module
// processes too (unchanged files, or a small adapter in core-go/node/ when
// the wiring isn't a (config, store, registry) client) — the conditions are
// server.js's own. `automation: true` = the client takes the automation
// engine as its 4th constructor argument.
const INLINE = [
  { file: 'loxone-client', label: 'Loxone', when: (c) => c.loxone?.host },
  { file: 'smartthings-client', label: 'SmartThings', when: (c) => c.smartthings?.token || (c.smartthings?.clientId && c.smartthings?.clientSecret) },
  { file: 'openweather-client', label: 'OpenWeather', when: (c) => c.openweather?.apiKey },
  { file: 'system-metrics-client', label: 'SystemMetrics', when: (c) => c.systemMetrics !== false },
  { file: 'virtual-client', label: 'Virtual', when: (c) => c.virtual?.devices?.length },
  { file: '../core-go/node/lan-monitor', label: 'LanMonitor', automation: true, when: (c) => c.lshLan?.enabled },
  { file: 'object-detection', label: 'ObjectDetection', automation: true, when: (c) => c.objectDetection?.cameras?.length },
  { file: 'camera-recorder', label: 'Recorder', when: (c) => (c.cameras || []).some((x) => x?.record && x.url) },
  { file: '../core-go/node/ptz-waypoints', label: 'Waypoints', when: (c) => (c.cameras || []).some((x) => x && x.waypoints !== false && (x.tuyaPtz || x.onvif?.host)) },
  { file: '../core-go/node/media', label: 'Media', when: (c) => c.airplay?.enabled || c.googlehome?.devices?.length },
  { file: 'tauron-tariff-client', label: 'TauronTariff', when: (c) => c.tauronTariff?.enabled },
  { file: 'somfy-client', label: 'Somfy', when: (c) => (c.somfy?.mode === 'cloud' && c.somfy?.email && c.somfy?.password) || (c.somfy?.host && (c.somfy?.token || (c.somfy?.email && c.somfy?.password))) },
  { file: 'arduino-client', label: 'Arduino', when: (c) => c.arduino?.devices?.length },
];
const inline = (it) => {
  let on = false;
  try { on = !!it.when(config); } catch { /* bad config section → off */ }
  const installed = fs.existsSync(path.join(root, 'src', `${it.file}.js`));
  return { file: it.file, label: it.label, expose: null, on, installed, inline: true, automation: !!it.automation };
};
// LSH's own MQTT broker first, as in server.js: Arduino, flows and others connect to it
integrations = [inline({ file: 'mqtt-broker', label: 'MqttBroker', when: (c) => c.mqttBroker?.enabled }), ...integrations, ...INLINE.map(inline)];
// The media module runs the Google Home client inside it (radio needs it).
if (integrations.find((it) => it.label === 'Media')?.on) {
  const gh = integrations.find((it) => it.file === 'googlehome-client');
  if (gh) gh.on = false;
}

const { DEVICE_TYPES } = require(path.join(root, 'src', 'device-definitions'));
process.stdout.write(JSON.stringify({ config, integrations, deviceTypes: DEVICE_TYPES }));
