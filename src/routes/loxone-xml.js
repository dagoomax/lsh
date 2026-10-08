'use strict';

// Loxone Config XML templates — split out of src/api-routes.js; registered in order by createApiRoutes().

module.exports = function register(router, ctx) {
  const { auth, sensorRegistry } = ctx;

  // ── Loxone Config XML templates ───────────────────────────
  // Ready-to-import Virtual Output / Virtual HTTP Input templates.
  // ?device=<key> or ?type=<integration> filters; ?host= overrides the LSH
  // address embedded in the XML; ?token= is embedded into command URLs.
  const loxoneXmlHandler = (kind) => (req, res) => {
    if (!sensorRegistry) return res.status(503).json({ success: false, error: 'Registry unavailable' });
    const { buildInputsXml, buildOutputsXml } = require('../loxone-xml');

    let devices = sensorRegistry.getDevices();
    if (req.query.device) devices = devices.filter((d) => d.key === req.query.device);
    if (req.query.type) {
      const types = new Set(String(req.query.type).split(',').map((t) => t.trim()).filter(Boolean));
      // vicare-client.js was merged into vitodens-client.js (same Viessmann
      // brand, same registered type) — ?type=vicare still works for anyone
      // with an old bookmark/export.
      if (types.has('vicare')) types.add('vitodens');
      devices = devices.filter((d) => types.has(d.type));
    }
    // ?named=1 — skip devices with generic fallback labels (e.g. unnamed Satel
    // zones "Zone 33"); devices without the flag are always kept
    if (req.query.named === '1' || req.query.named === 'true') {
      devices = devices.filter((d) => d.named !== false);
    }
    if (!devices.length)  return res.status(404).json({ success: false, error: 'No matching devices' });

    // ?tokenId= resolves an API token server-side (used by the Settings UI,
    // where token values are never exposed to the browser)
    let embedToken = req.query.token;
    if (!embedToken && req.query.tokenId && auth) embedToken = auth.getApiTokenValue(req.query.tokenId);

    const opts = {
      host:      req.query.host || req.get('host'),
      token:     embedToken || 'YOUR_API_TOKEN',
      pollingMs: Math.max(1000, Number(req.query.polling) || 5000),
    };
    // Both builders return an array of XML documents, auto-split so no single
    // Virtual Input/Output exceeds Loxone Config's per-block command limit.
    const parts = kind === 'inputs' ? buildInputsXml(devices, opts) : buildOutputsXml(devices, opts);
    if (!parts.length) {
      return res.status(404).json({
        success: false,
        error: kind === 'outputs'
          ? 'Matching devices have no controllable sensors — use inputs.xml for read-only devices'
          : 'Matching devices have no readable sensors',
      });
    }
    const base = ['lsh-loxone', kind, req.query.type || (req.query.device || '').replace(/\//g, '-')]
      .filter(Boolean).join('-');
    if (parts.length === 1) {
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${base}.xml"`);
      return res.send(parts[0]);
    }
    // Multiple blocks → bundle as a ZIP of individually-importable files.
    const { zipStore } = require('../zip');
    const files = parts.map((xml, i) => ({ name: `${base}-${i + 1}.xml`, data: xml }));
    const zip = zipStore(files);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${base}.zip"`);
    res.send(zip);
  };
  router.get('/loxone/inputs.xml',  loxoneXmlHandler('inputs'));
  router.get('/loxone/outputs.xml', loxoneXmlHandler('outputs'));
  // Friendly fixed alias for the SIP doorbell's one controllable action
  // (open door) — equivalent to outputs.xml?type=sip, just a stable URL.
  router.get('/loxone/sipout.xml', (req, res) => {
    req.query.type = 'sip';
    return loxoneXmlHandler('outputs')(req, res);
  });
};
