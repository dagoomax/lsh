'use strict';

// Unified agenda feed for the Wall Dashboard: Google Calendar + private — split out of src/api-routes.js; registered in order by createApiRoutes().
const privateEvents = require('../private-events');
const callLog = require('../call-log');
const motionLog = require('../motion-log');

module.exports = function register(router, ctx) {
  const { clients } = ctx;

  // ── Unified agenda feed for the Wall Dashboard: Google Calendar + private
  // events + missed calls + motion detections, merged and time-sorted ─────
  router.get('/agenda', (req, res) => {
    const events = [];
    const gc = clients.googleCalendar;
    if (gc?.isConnected()) {
      for (const ev of gc.getEvents()) events.push({ ...ev, kind: 'calendar' });
    }
    for (const ev of privateEvents.getAll()) events.push({ ...ev, kind: 'private' });
    for (const c of callLog.getRecent(10)) {
      const d = new Date(c.ts);
      events.push({ date: d.toISOString().slice(0, 10), title: `Missed call — ${c.caller}`, time: d.toTimeString().slice(0, 5), kind: 'call' });
    }
    for (const m of motionLog.getRecent(10)) {
      const d = new Date(m.ts);
      events.push({ date: d.toISOString().slice(0, 10), title: `Motion — ${m.device}`, time: d.toTimeString().slice(0, 5), kind: 'motion' });
    }
    events.sort((a, b) => `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`));
    res.json({ success: true, data: events });
  });
};
