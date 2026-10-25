'use strict';

// Airbnb (and Booking.com / VRBO) — reservations of short-term rental
// listings, from each listing's calendar export link (iCal). Airbnb has no
// public host API; the export link (Calendar → Availability → Export
// calendar) is the official way out and carries, per reservation:
//
//   BEGIN:VEVENT
//   DTSTART;VALUE=DATE:20261027
//   DTEND;VALUE=DATE:20261030
//   SUMMARY:Reserved
//   UID:1418fb94e984-…@airbnb.com
//   DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/
//    details/HMABCDEFGH\nPhone Number (Last 4 Digits): 1234
//   END:VEVENT
//
// Dates the host blocked come as "Airbnb (Not available)" (Booking: "CLOSED -
// Not available") and don't count as stays. No guest names — only the
// reservation code and the phone number's last 4 digits.
//
// Each listing becomes a device (airbnb/<slug>) whose states flip at the
// host's check-in / check-out times — occupied, prepare (N hours before the
// next arrival), checkInToday, checkOutToday, turnover — so flows can heat
// before a guest arrives or run an eco scene after check-out. The calendar
// is fetched every pollMinutes; the states are recomputed every minute from
// the last good copy, so they change on time without refetching.
//
// The export link is a secret (anyone with it sees the calendar): it is
// never logged — errors name only the host.
//
// config.airbnb = { listings: [{ name, ical, checkIn: '15:00', checkOut: '11:00',
//                                prepareHours: 3 }], pollMinutes: 30 }

const PollingClient = require('./polling-client');

const DAY = 86400_000;
const BLOCKED = /not available|blocked|closed|unavailable/i;

// ── iCal ─────────────────────────────────────────────────────────────────

const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

// DTSTART/DTEND value → { date: [y, m, d], at?: Date }. A date-only value is a
// calendar day (the listing's own check-in/out time is applied later); a
// date-time is an instant — UTC with Z, otherwise local time.
function parseIcsDate(params, value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  const date = [Number(y), Number(mo), Number(d)];
  if (hh == null || /VALUE=DATE(?!-)/i.test(params)) return { date };
  const at = z
    ? new Date(Date.UTC(date[0], date[1] - 1, date[2], Number(hh), Number(mi), Number(ss || 0)))
    : new Date(date[0], date[1] - 1, date[2], Number(hh), Number(mi), Number(ss || 0));
  return { date, at };
}

function parseIcs(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') {
      if (ev?.start && ev?.end) events.push(ev);
      ev = null;
      continue;
    }
    if (!ev) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...rest] = line.slice(0, colon).split(';');
    const params = rest.join(';');
    const value = line.slice(colon + 1);
    switch (name.toUpperCase()) {
      case 'DTSTART': ev.start = parseIcsDate(params, value); break;
      case 'DTEND': ev.end = parseIcsDate(params, value); break;
      case 'SUMMARY': ev.summary = unescapeText(value); break;
      case 'UID': ev.uid = value; break;
      case 'DESCRIPTION': ev.description = unescapeText(value); break;
    }
  }
  for (const e of events) {
    const desc = e.description || '';
    e.code = /reservations\/details\/([A-Z0-9]+)/i.exec(desc)?.[1] || null;
    e.phone4 = /Last 4 Digits\)?:\s*(\d{4})/i.exec(desc)?.[1] || null;
    e.blocked = BLOCKED.test(e.summary || '');
  }
  return events;
}

async function fetchIcs(url, { timeout = 15_000 } = {}) {
  let host = '?';
  try { host = new URL(url).host; } catch { throw new Error('Not a valid calendar link'); }
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'text/calendar, */*' } });
  } catch (err) {
    throw new Error(`${host}: ${err.name === 'TimeoutError' ? 'no answer in time' : err.cause?.code || err.message}`);
  }
  if (!res.ok) throw new Error(`${host}: HTTP ${res.status}${res.status === 404 || res.status === 403 ? ' — the export link was changed or revoked' : ''}`);
  const text = await res.text();
  if (text.length > 5e6) throw new Error(`${host}: calendar too large`);
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error(`${host}: not an iCal calendar — copy the "Export calendar" link`);
  return text;
}

// ── State ────────────────────────────────────────────────────────────────

const hhmm = (s, def) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? [Number(m[1]), Number(m[2])] : def;
};
const at = (date, [h, m]) => new Date(date[0], date[1] - 1, date[2], h, m);
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// events + listing settings + clock → everything the device shows
function computeState(events, listing = {}, now = new Date(), language = 'en') {
  const cin = hhmm(listing.checkIn, [15, 0]);
  const cout = hhmm(listing.checkOut, [11, 0]);
  const prepareMs = Math.max(0, Number(listing.prepareHours ?? 3)) * 3600_000;

  const stays = events
    .filter((e) => !e.blocked)
    .map((e) => {
      const start = e.start.at || at(e.start.date, cin);
      const end = e.end.at || at(e.end.date, cout);
      const nights = Math.max(1, Math.round((midnight(end) - midnight(start)) / DAY));
      return { start, end, code: e.code, phone4: e.phone4, nights };
    })
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const t = now.getTime();
  const today = dayKey(now);
  const current = stays.find((s) => s.start <= t && t < s.end) || null;
  const next = stays.find((s) => s.start > t) || null;
  const checkInToday = stays.some((s) => dayKey(s.start) === today);
  const checkOutToday = stays.some((s) => dayKey(s.end) === today);

  // booked nights in the next 30 days (a night = the date it starts on)
  const from = midnight(now).getTime();
  const to = from + 30 * DAY;
  let nights30 = 0;
  for (const s of stays) {
    for (let d = midnight(s.start).getTime(); d < midnight(s.end).getTime(); d += DAY) {
      if (d >= from && d < to) nights30++;
    }
  }

  const fmt = (d) => d.toLocaleString(language, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const who = (s) => (s ? [s.code, s.phone4 && `…${s.phone4}`].filter(Boolean).join(' · ') || 'guest' : '');

  return {
    occupied: !!current,
    prepare: !!next && prepareMs > 0 && next.start - t <= prepareMs,
    checkInToday,
    checkOutToday,
    turnover: checkInToday && checkOutToday,
    guest: who(current),
    nextGuest: who(next),
    nextCheckIn: next ? fmt(next.start) : '—',
    nextCheckOut: current ? fmt(current.end) : next ? fmt(next.end) : '—',
    daysToNext: current ? 0 : next ? Math.round((midnight(next.start) - midnight(now)) / DAY) : null,
    nights30,
    occupancy30: Math.round((nights30 / 30) * 100),
    reservations: stays.filter((s) => s.end > t).slice(0, 10).map((s) => ({
      start: s.start.toISOString(), end: s.end.toISOString(), code: s.code, phone4: s.phone4, nights: s.nights,
    })),
  };
}

const slug = (s) => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function listingIds(listings) {
  const seen = new Set();
  return listings.map((l, i) => {
    let id = slug(l.name) || `listing-${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return id;
  });
}

// ── Client ───────────────────────────────────────────────────────────────

const SENSORS = [
  { path: 'occupied', name: 'Occupied', type: 'boolean', homekit: 'occupancy' },
  { path: 'prepare', name: 'Guest arriving soon', type: 'boolean' },
  { path: 'checkInToday', name: 'Check-in today', type: 'boolean' },
  { path: 'checkOutToday', name: 'Check-out today', type: 'boolean' },
  { path: 'turnover', name: 'Turnover day', type: 'boolean' },
  { path: 'guest', name: 'Guest', type: 'label' },
  { path: 'nextGuest', name: 'Next guest', type: 'label' },
  { path: 'nextCheckIn', name: 'Next check-in', type: 'label' },
  { path: 'nextCheckOut', name: 'Next check-out', type: 'label' },
  { path: 'daysToNext', name: 'Days to next guest', type: 'number', unit: 'd' },
  { path: 'nights30', name: 'Booked nights (30 d)', type: 'number' },
  { path: 'occupancy30', name: 'Occupancy (30 d)', type: 'number', unit: '%' },
];

class AirbnbClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'airbnb', logTag: 'Airbnb', maxBackoffMs: 2 * 3600_000 });
    this._config = config;
    this._store = store;
    this._registry = sensorRegistry;
    this._listings = [];
    this._clock = null;
  }

  async start() {
    const cfg = this._config.airbnb || {};
    const listings = (cfg.listings || []).filter((l) => l?.ical);
    if (!listings.length) return;
    const ids = listingIds(listings);
    this._listings = listings.map((l, i) => ({ ...l, id: ids[i], key: `airbnb/${ids[i]}`, events: null, last: {} }));

    for (const l of this._listings) {
      this._registry.registerDevice({
        key: l.key, label: l.name || `Airbnb ${l.id}`, type: 'airbnb', icon: '🏠', room: l.room,
        homekit: ['occupancy'],
        sensors: SENSORS.map((s) => ({ ...s })),
      });
    }

    this._clock = setInterval(() => this._publishAll(), 60_000);
    this._clock.unref?.();
    const minutes = Math.max(10, Number(cfg.pollMinutes) || 30);
    console.log(`[Airbnb] Started — ${this._listings.length} listing(s), calendar every ${minutes} min`);
    await this.startPolling(minutes * 60_000);
  }

  stop() {
    super.stop();
    clearInterval(this._clock);
    this._clock = null;
  }

  async _pollImpl() {
    const failed = [];
    await Promise.all(this._listings.map(async (l) => {
      try {
        const events = parseIcs(await fetchIcs(l.ical));
        const first = !l.events;
        l.events = events;
        this._store.update(`${l.key}/lastSync`, new Date().toISOString());
        if (first) console.log(`[Airbnb] ${l.name || l.id}: ${events.filter((e) => !e.blocked).length} reservation(s)`);
      } catch (err) {
        // the last good calendar stays in use
        failed.push(`${l.name || l.id}: ${err.message}`);
      }
    }));
    this._publishAll();
    if (failed.length) throw new Error(failed.join('; '));
  }

  _publishAll() {
    const now = new Date();
    const language = this._config.language || 'en';
    for (const l of this._listings) {
      if (!l.events) continue;
      const state = computeState(l.events, l, now, language);
      for (const [k, v] of Object.entries(state)) {
        const json = JSON.stringify(v);
        if (l.last[k] === json) continue;
        l.last[k] = json;
        this._store.update(`${l.key}/${k}`, v);
      }
    }
  }
}

module.exports = AirbnbClient;
module.exports.parseIcs = parseIcs;
module.exports.fetchIcs = fetchIcs;
module.exports.computeState = computeState;
module.exports.listingIds = listingIds;
