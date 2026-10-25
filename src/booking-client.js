'use strict';

// Booking.com — reservations of your properties from the Extranet's calendar
// export link (Rates & Availability → Sync calendars → Export calendar).
// Same engine as Airbnb (src/airbnb-client.js): one device per property
// (booking/<slug>) whose states change at your check-in / check-out times.
//
// Booking exports every unavailable night as "CLOSED - Not available": a
// reservation and a date you closed yourself look the same, and there's no
// reservation code or guest data. Closed periods count as stays unless the
// property sets closedAsStays: false.
//
// config.booking = { listings: [{ name, ical, checkIn: '15:00', checkOut: '11:00',
//                                 prepareHours: 3, closedAsStays: true }], pollMinutes: 30 }

const AirbnbClient = require('./airbnb-client');

class BookingClient extends AirbnbClient {
  constructor(config, store, sensorRegistry) {
    super(config, store, sensorRegistry, AirbnbClient.PROVIDERS.booking);
  }
}

module.exports = BookingClient;
