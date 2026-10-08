'use strict';

// MongoDB — split out of src/api-routes.js; registered in order by createApiRoutes().
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── MongoDB ────────────────────────────────────────────────────────────

  router.post('/settings/mongo', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { uri, db } = req.body;
    // masked (dots) means "keep the stored URI"; empty means disable Mongo
    const keepUri = (uri && !uri.includes('•')) ? uri.trim() : (current.mongo?.uri || '');
    try {
      const next = { ...current };
      if (keepUri) next.mongo = { ...current.mongo, uri: keepUri, db: (db || current.mongo?.db || 'lsh').trim() };
      else delete next.mongo;
      writeConfigFile(next);
      res.json({ success: true, message: 'MongoDB settings saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-mongo', requireAdmin, async (req, res) => {
    let { uri, db } = req.body;
    if (!uri || uri.includes('•')) uri = readConfigFile().mongo?.uri || '';
    if (!uri) return res.status(400).json({ success: false, error: 'Connection URI is required' });

    let MongoClient;
    try { ({ MongoClient } = require('mongodb')); }
    catch { return res.json({ success: false, error: 'mongodb package not installed — run npm install' }); }

    const client = new MongoClient(uri.trim(), { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      await client.db((db || 'lsh').trim()).command({ ping: 1 });
      res.json({ success: true, message: `Connected to "${(db || 'lsh').trim()}"` });
    } catch (err) {
      res.json({ success: false, error: err.message });
    } finally {
      try { await client.close(); } catch {}
    }
  });
};
