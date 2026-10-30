'use strict';

// Module-process adapter for src/ptz-waypoints.js (built by a factory,
// PtzWaypoints.fromConfig(config, store, registry), started synchronously).
const path = require('path');
const PtzWaypoints = require(path.join(__dirname, '..', '..', 'src', 'ptz-waypoints'));

class PtzWaypointsModule {
  constructor(config, store, sensorRegistry) {
    this.waypoints = PtzWaypoints.fromConfig(config, store, sensorRegistry);
  }
  start() { this.waypoints.start(); }
  stop() { this.waypoints.stop?.(); }
}

module.exports = PtzWaypointsModule;
