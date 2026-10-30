'use strict';

// Module-process adapter for src/lsh-lan-monitor.js, whose server.js wiring
// is getMonitor({ config, store, sensorRegistry, automation }).start()
// rather than a (config, store, registry) client.
const path = require('path');
const { getMonitor } = require(path.join(__dirname, '..', '..', 'src', 'lsh-lan-monitor'));

class LanMonitorModule {
  constructor(config, store, sensorRegistry, automation) {
    this.monitor = getMonitor({ config, store, sensorRegistry, automation });
  }
  start() { this.monitor.start(); }
  stop() { this.monitor.stop(); }
}

module.exports = LanMonitorModule;
