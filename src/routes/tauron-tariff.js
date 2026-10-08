'use strict';

// TAURON dynamic tariff (PSE RCE index) — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── TAURON dynamic tariff (PSE RCE index) ──────────────────

  router.post('/settings/test-tauron-tariff', requireAdmin, async (req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const r = await fetch(`https://api.raporty.pse.pl/api/rce-pln?$filter=business_date eq '${today}'`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return res.json({ success: false, error: `PSE returned HTTP ${r.status}` });
      const data = await r.json();
      const rows = data.value || [];
      if (!rows.length) return res.json({ success: false, error: 'PSE returned no rows for today — try again shortly' });
      const last = rows[rows.length - 1];
      res.json({ success: true, message: `Reachable — ${rows.length} quarter-hour rows for today, latest RCE ${last.rce_pln} PLN/MWh` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/tauron-tariff', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { enabled, markupPlnKwh, vatRate } = req.body;
    const currency = String(req.body?.currency || current.tauronTariff?.currency || 'PLN').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ success: false, error: 'Currency must be a 3-letter ISO code (e.g. PLN, EUR)' });
    const updated = {
      ...current,
      tauronTariff: {
        enabled: !!enabled,
        markupPlnKwh: markupPlnKwh != null && markupPlnKwh !== '' ? Number(markupPlnKwh) : (current.tauronTariff?.markupPlnKwh ?? 0),
        vatRate: vatRate != null && vatRate !== '' ? Number(vatRate) : (current.tauronTariff?.vatRate ?? 0.23),
        currency,
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'Tauron tariff settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
