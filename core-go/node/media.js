'use strict';

// Module-process adapter for the media player's speakers: src/radio-devices.js
// drives the AirPlay client (src/airplay-client.js) and the Google Home /
// Chromecast client (src/googlehome-client.js) directly, so all three live
// in this one process — the clients map is what server.js's apiClients gave
// RadioDevices.
const path = require('path');
const src = (f) => require(path.join(__dirname, '..', '..', 'src', f));

class MediaModule {
  constructor(config, store, sensorRegistry) {
    this.clients = {};
    if (config.airplay?.enabled) this.clients.airplayClient = new (src('airplay-client'))(config);
    if (config.googlehome?.devices?.length) this.clients.googlehome = new (src('googlehome-client'))(config, store, sensorRegistry);
    this.radio = new (src('radio-devices'))(config, store, sensorRegistry, this.clients);
  }
  async start() {
    if (this.clients.googlehome) await this.clients.googlehome.start().catch((err) => console.error(`[GoogleHome] Start failed: ${err.message}`));
    await this.radio.start();
  }
  stop() {
    this.radio.stop?.();
    this.clients.googlehome?.stop?.();
  }
  // for the host's /api/airplay/* routes, later
  speakers() { return this.clients.airplayClient?.getSpeakers() || []; }
}

module.exports = MediaModule;
