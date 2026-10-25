'use strict';

// Airbnb / Booking / VRBO reservations — status, calendar link test and
// settings. The client (src/airbnb-client.js) runs in its own process, so
// status comes from the store and a save restarts that process.
const fs = require('fs');
const path = require('path');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const INTEGRATIONS = require('../integrations');

const STATE_KEYS = ['occupied', 'prepare', 'checkInToday', 'checkOutToday', 'turnover', 'guest', 'nextGuest',
  'nextCheckIn', 'nextCheckOut', 'daysToNext', 'nights30', 'occupancy30', 'reservations', 'lastSync'];
const TIME = /^\d{1,2}:\d{2}$/;

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, store } = ctx;
  const airbnb = () => require('../airbnb-client');

  router.get('/airbnb/status', requireAdmin, (req, res) => {
    const listings = readConfigFile().airbnb?.listings || [];
    const ids = airbnb().listingIds(listings);
    res.json({
      success: true,
      data: listings.map((l, i) => {
        const key = `airbnb/${ids[i]}`;
        const state = {};
        for (const k of STATE_KEYS) state[k] = store.get(`${key}/${k}`);
        return { name: l.name, key, ...state };
      }),
    });
  });

  // Fetch and read one calendar link without saving anything
  router.post('/airbnb/test', requireAdmin, async (req, res) => {
    const b = req.body || {};
    try {
      const { fetchIcs, parseIcs, computeState } = airbnb();
      const events = parseIcs(await fetchIcs(String(b.ical || '').trim()));
      const state = computeState(events, b, new Date(), readConfigFile().language || 'en');
      const n = events.filter((e) => !e.blocked).length;
      res.json({
        success: true,
        data: state,
        message: `${n} reservation(s), ${events.length - n} blocked period(s) · next check-in: ${state.nextCheckIn} · ${state.nights30} night(s) booked in the next 30 days`,
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/airbnb', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const listings = [];
    for (const l of Array.isArray(b.listings) ? b.listings : []) {
      const ical = String(l?.ical || '').trim();
      if (!ical) continue;
      let url;
      try { url = new URL(ical); } catch { url = null; }
      if (!url || url.protocol !== 'https:') {
        return res.status(400).json({ success: false, error: `"${String(l.name || '').trim() || 'listing'}": the calendar link must start with https://` });
      }
      const checkIn = String(l.checkIn || '').trim() || '15:00';
      const checkOut = String(l.checkOut || '').trim() || '11:00';
      if (!TIME.test(checkIn) || !TIME.test(checkOut)) {
        return res.status(400).json({ success: false, error: 'Check-in and check-out times must look like 15:00' });
      }
      const out = { name: String(l.name || '').trim(), ical, checkIn, checkOut, prepareHours: Math.min(72, Math.max(0, Number(l.prepareHours ?? 3) || 0)) };
      if (String(l.room || '').trim()) out.room = String(l.room).trim();
      listings.push(out);
    }
    const cfg = { listings, pollMinutes: Math.max(10, Number(b.pollMinutes) || 30) };
    try {
      writeConfigFile({ ...readConfigFile(), airbnb: cfg });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    const it = INTEGRATIONS.find((x) => x.file === 'airbnb-client');
    if (!clients.moduleHost) return res.json({ success: true, message: 'Saved — restart LSH to apply.' });
    try {
      // a fresh install ships core only — fetch the module before starting it
      if (listings.length && !fs.existsSync(path.join(__dirname, '..', 'airbnb-client.js'))) {
        await require('../module-manager').install(['airbnb'], readConfigFile());
      }
      const info = await clients.moduleHost.apply(it);
      res.json({ success: true, message: listings.length ? 'Saved and applied.' : 'Saved — Airbnb stopped.', data: info });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};
