'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const AirbnbClient = require('../src/airbnb-client');
const { parseIcs, computeState, listingIds } = AirbnbClient;

const ICS = fs.readFileSync(path.join(__dirname, 'fixtures', 'airbnb.ics'), 'utf8');
const L = { checkIn: '15:00', checkOut: '11:00', prepareHours: 3 };
const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);

test('parses Airbnb export: folded lines, codes, phone digits, blocked dates', () => {
  const ev = parseIcs(ICS);
  assert.equal(ev.length, 3);
  assert.equal(ev[0].code, 'HMABCDEFGH');
  assert.equal(ev[0].phone4, '1234');
  assert.deepEqual(ev[0].start.date, [2026, 10, 27]);
  assert.equal(ev[0].blocked, false);
  assert.equal(ev[2].blocked, true);
});

test('parses Booking-style blocks and date-time events', () => {
  const ev = parseIcs([
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261203', 'SUMMARY:CLOSED - Not available', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20261205T140000Z', 'DTEND:20261207T090000Z', 'SUMMARY:Booked\\, thanks', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\n'));
  assert.equal(ev[0].blocked, true);
  assert.equal(ev[1].summary, 'Booked, thanks');
  assert.equal(ev[1].start.at.toISOString(), '2026-12-05T14:00:00.000Z');
});

test('states follow check-in / check-out times', () => {
  const ev = parseIcs(ICS);
  let s = computeState(ev, L, at(2026, 10, 27, 10));
  assert.equal(s.occupied, false);
  assert.equal(s.prepare, false);
  assert.equal(s.checkInToday, true);
  assert.equal(s.nextGuest, 'HMABCDEFGH · …1234');
  assert.equal(s.daysToNext, 0);

  s = computeState(ev, L, at(2026, 10, 27, 12, 30)); // 2.5 h before arrival
  assert.equal(s.prepare, true);
  assert.equal(s.occupied, false);

  s = computeState(ev, L, at(2026, 10, 28, 9));
  assert.equal(s.occupied, true);
  assert.equal(s.guest, 'HMABCDEFGH · …1234');
  assert.equal(s.checkInToday, false);

  s = computeState(ev, L, at(2026, 10, 30, 10)); // turnover: one leaves 11:00, next arrives 15:00
  assert.equal(s.turnover, true);
  assert.equal(s.occupied, true);
  s = computeState(ev, L, at(2026, 10, 30, 12));
  assert.equal(s.occupied, false);
  assert.equal(s.prepare, true);
  assert.equal(s.nextGuest, 'HMZZZZ9999 · …5678');

  s = computeState(ev, L, at(2026, 11, 3, 12)); // only a blocked period left
  assert.equal(s.occupied, false);
  assert.equal(s.nextCheckIn, '—');
  assert.equal(s.daysToNext, null);
  assert.equal(s.reservations.length, 0);

  s = computeState(ev, L, at(2026, 10, 25, 12));
  assert.equal(s.nights30, 6);
  assert.equal(s.occupancy30, 20);
  assert.equal(s.daysToNext, 2);
  assert.deepEqual(computeState([], L, at(2026, 10, 25)).reservations, []);
});

test('listing ids are stable slugs', () => {
  assert.deepEqual(listingIds([{ name: 'Mieszkanie Łódź' }, { name: '' }, { name: 'Mieszkanie Łódź' }]),
    ['mieszkanie-lodz', 'listing-2', 'mieszkanie-lodz-3']);
});

test('runs in its own process: device, states, keeps the last calendar when the link fails', async () => {
  const DataStore = require('../src/data-store');
  const SensorRegistry = require('../src/sensor-registry');
  const ModuleHost = require('../src/module-host');
  const platformStatus = require('../src/platform-status');
  let fail = false;
  const srv = http.createServer((req, res) => {
    if (fail) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end(ICS);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const config = { airbnb: { listings: [{ name: 'Test flat', ical: `http://127.0.0.1:${srv.address().port}/x.ics`, ...L }] } };
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const host = new ModuleHost(config, store, registry);
  const it = require('../src/integrations').find((x) => x.file === 'airbnb-client');
  const until = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('timed out');
  };
  try {
    host.add(it);
    await until(() => registry.devices.get('airbnb/test-flat') && store.get('airbnb/test-flat/occupied') !== null);
    assert.equal(platformStatus.getAll().airbnb, true);
    assert.equal(typeof store.get('airbnb/test-flat/nights30'), 'number');
    fail = true;
    await host.get('airbnb-client').restart('test');
    await until(() => platformStatus.getAll().airbnb === false);
    assert.equal(typeof store.get('airbnb/test-flat/nights30'), 'number');
  } finally {
    await host.stopAll();
    srv.close();
  }
});

test('saving settings starts, restarts and stops the module process', async () => {
  const DataStore = require('../src/data-store');
  const SensorRegistry = require('../src/sensor-registry');
  const ModuleHost = require('../src/module-host');
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end(ICS); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const listing = (name) => ({ name, ical: `http://127.0.0.1:${srv.address().port}/x.ics`, ...L });
  let current = { airbnb: { listings: [] } };
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const host = new ModuleHost(current, store, registry, { loadConfig: () => current });
  const it = require('../src/integrations').find((x) => x.file === 'airbnb-client');
  const until = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('timed out');
  };
  try {
    assert.equal(await host.apply(it), null); // nothing configured → nothing started
    current = { airbnb: { listings: [listing('First')] } };
    await host.apply(it);
    await until(() => registry.devices.get('airbnb/first'));
    const pid = host.get('airbnb-client').child.pid;
    current = { airbnb: { listings: [listing('First'), listing('Second')] } };
    await host.apply(it);
    await until(() => registry.devices.get('airbnb/second'));
    assert.notEqual(host.get('airbnb-client').child.pid, pid);
    current = { airbnb: { listings: [] } };
    const info = await host.apply(it);
    assert.equal(info.state, 'stopped');
  } finally {
    await host.stopAll();
    srv.close();
  }
});

const BOOKING_ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//booking.com//Booking.com Calendar//EN',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261027', 'DTEND;VALUE=DATE:20261029', 'UID:abc1@booking.com', 'SUMMARY:CLOSED - Not available', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261104', 'UID:abc2@booking.com', 'SUMMARY:CLOSED - Not available', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('Booking.com: closed periods are stays for Booking links, blocks for others', () => {
  const { sourceOf, closedAsStays } = AirbnbClient;
  assert.equal(sourceOf('https://ical.booking.com/v1/export?t=x'), 'booking');
  assert.equal(sourceOf('https://admin.booking.com/hotel/hoteladmin/ical.html?t=x'), 'booking');
  assert.equal(sourceOf('https://www.airbnb.pl/calendar/ical/1.ics?s=x'), 'airbnb');
  assert.equal(sourceOf('https://www.vrbo.com/icalendar/x.ics'), 'vrbo');
  assert.equal(closedAsStays({ ical: 'https://ical.booking.com/v1/export?t=x' }), true);
  assert.equal(closedAsStays({ ical: 'https://ical.booking.com/v1/export?t=x', closedAsStays: false }), false);

  const ev = parseIcs(BOOKING_ICS);
  const booking = { ...L, ical: 'https://ical.booking.com/v1/export?t=x' };
  let s = computeState(ev, booking, at(2026, 10, 28, 9));
  assert.equal(s.occupied, true);
  assert.equal(s.guest, 'Booking.com');
  assert.equal(s.nights30, 5 - 1); // from the 28th: one night left of the first stay + 3
  s = computeState(ev, { ...booking, closedAsStays: false }, at(2026, 10, 28, 9));
  assert.equal(s.occupied, false);
  // an Airbnb listing carrying the same closed periods treats them as blocks
  assert.equal(computeState(ev, { ...L, ical: 'https://www.airbnb.com/calendar/ical/1.ics' }, at(2026, 10, 28, 9)).occupied, false);
});

test('Booking.com module runs in its own process with its own devices', async () => {
  const DataStore = require('../src/data-store');
  const SensorRegistry = require('../src/sensor-registry');
  const ModuleHost = require('../src/module-host');
  const platformStatus = require('../src/platform-status');
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end(BOOKING_ICS); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const config = { booking: { listings: [{ name: 'Apartament', ical: `http://127.0.0.1:${srv.address().port}/e`, closedAsStays: true, ...L }] } };
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const host = new ModuleHost(config, store, registry);
  const it = require('../src/integrations').find((x) => x.file === 'booking-client');
  const end = Date.now() + 8000;
  try {
    host.add(it);
    while (Date.now() < end && store.get('booking/apartament/reservations') === null) await new Promise((r) => setTimeout(r, 50));
    const d = registry.devices.get('booking/apartament');
    assert.equal(d.type, 'booking');
    assert.equal(platformStatus.getAll().booking, true);
    assert.ok(Array.isArray(store.get('booking/apartament/reservations')));
  } finally {
    await host.stopAll();
    srv.close();
  }
});
