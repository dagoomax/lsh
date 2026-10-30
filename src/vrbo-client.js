'use strict';

// VRBO (Expedia Group; formerly HomeAway) — reservations of your properties
// from the calendar export link (Calendar → Import/Export → Export calendar).
// Same engine as Airbnb (src/airbnb-client.js): one device per property
// (vrbo/<slug>) whose states change at your check-in / check-out times.
// Stays come as "Reserved - <guest name>", owner blocks as "Blocked".
//
// config.vrbo = { listings: [{ name, ical, checkIn: '16:00', checkOut: '10:00',
//                              prepareHours: 3 }], pollMinutes: 30 }

const AirbnbClient = require('./airbnb-client');

class VrboClient extends AirbnbClient {
  constructor(config, store, sensorRegistry) {
    super(config, store, sensorRegistry, AirbnbClient.PROVIDERS.vrbo);
  }
}

module.exports = VrboClient;
