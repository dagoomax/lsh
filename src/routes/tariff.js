'use strict';

// Electricity tariff (peak/off-peak pricing shown on the Home Plan's — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Electricity tariff (peak/off-peak pricing shown on the Home Plan's
  // power-flow overlay) ──────────────────────────────────────────────
  // Resolves which configured window covers `now`, and which one is next —
  // windows may wrap midnight (start > end, e.g. 23:00-16:00).
  function resolveTariff(windows, now = new Date()) {
    if (!Array.isArray(windows) || !windows.length) return { current: null, next: null };
    const mins = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
      return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
    };
    let current = null;
    let next = null;
    let bestUntilStart = Infinity;
    for (const w of windows) {
      const start = toMin(w.start);
      const end = toMin(w.end);
      if (start == null || end == null) continue;
      const inWindow = start <= end ? (mins >= start && mins < end) : (mins >= start || mins < end);
      if (inWindow) current = w;
      const untilStart = start > mins ? start - mins : start + 1440 - mins;
      if (untilStart > 0 && untilStart < bestUntilStart) { bestUntilStart = untilStart; next = w; }
    }
    return { current, next, nextInMinutes: next ? bestUntilStart : null };
  }

  router.get('/tariff', (req, res) => {
    const cfg = readConfigFile().tariff || {};
    const { current, next, nextInMinutes } = resolveTariff(cfg.windows);
    res.json({ success: true, data: { currency: cfg.currency || '£', current, next, nextInMinutes } });
  });

  router.post('/settings/tariff', requireAdmin, (req, res) => {
    const currency = String(req.body?.currency || '£').trim().slice(0, 4);
    const windows = (Array.isArray(req.body?.windows) ? req.body.windows : [])
      .map((w) => ({
        label: String(w.label || '').trim().slice(0, 30),
        price: Math.max(0, Number(w.price) || 0),
        start: /^\d{1,2}:\d{2}$/.test(w.start) ? w.start : '00:00',
        end: /^\d{1,2}:\d{2}$/.test(w.end) ? w.end : '00:00',
      }))
      .filter((w) => w.label);
    try {
      const cfg = readConfigFile();
      cfg.tariff = { currency, windows };
      writeConfigFile(cfg);
      res.json({ success: true, message: `Saved ${windows.length} tariff window(s)` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
