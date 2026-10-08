'use strict';

// Satel — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── Satel ────────────────────────────────────────────────

  router.post('/settings/test-satel', requireAdmin, async (req, res) => {
    const { host, port } = req.body;
    if (!host) return res.status(400).json({ success: false, error: 'Host is required' });
    const net = require('net');
    const sock = new net.Socket();
    const p = parseInt(port) || 7094;
    const timer = setTimeout(() => { sock.destroy(); res.json({ success: false, error: 'Connection timed out' }); }, 5000);
    sock.connect(p, host, () => {
      clearTimeout(timer);
      sock.destroy();
      res.json({ success: true, message: `Connected to ${host}:${p}` });
    });
    sock.on('error', err => { clearTimeout(timer); res.json({ success: false, error: err.message }); });
  });

  router.post('/settings/satel', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { host, port, armCode, zoneCount, partitions, zoneNames, partitionNames, outputCount, outputNames } = req.body;
    const updated = {
      ...current,
      satel: {
        ...current.satel,
        host:      host || current.satel?.host || '',
        port:      parseInt(port) || 7094,
        armCode:   (armCode && !armCode.includes('•')) ? armCode : (current.satel?.armCode || ''),
        zoneCount: parseInt(zoneCount) || 32,
        partitions: Array.isArray(partitions)
          ? partitions.map(Number)
          : (partitions ? String(partitions).split(',').map(s => parseInt(s.trim())).filter(Boolean) : [1]),
        zoneNames:      (zoneNames      && typeof zoneNames      === 'object') ? zoneNames      : (current.satel?.zoneNames      || {}),
        partitionNames: (partitionNames && typeof partitionNames === 'object') ? partitionNames : (current.satel?.partitionNames || {}),
        outputCount:    parseInt(outputCount) || 0,
        outputNames:    (outputNames && typeof outputNames === 'object') ? outputNames : (current.satel?.outputNames || {}),
      },
    };
    try {
      writeConfigFile(updated);
      res.json({ success: true, message: 'Satel settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
