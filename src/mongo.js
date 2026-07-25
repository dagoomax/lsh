'use strict';

// Optional MongoDB connection. Gated on config.mongo.uri — when absent the app
// runs exactly as before (gzipped-JSON persistence). Kept deliberately small:
// a lazily-required driver + a single shared client, so a missing package or an
// unreachable server degrades to a warning and the gzip fallback, never a crash.

let _client = null;
let _db     = null;

async function connectMongo(cfg) {
  if (!cfg || !cfg.uri) return null;
  if (_db) return _db;

  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch {
    console.warn('[Mongo] "mongodb" package not installed — run `npm install`; falling back to file persistence');
    return null;
  }

  try {
    _client = new MongoClient(cfg.uri, { serverSelectionTimeoutMS: cfg.timeoutMs || 5000 });
    await _client.connect();
    _db = _client.db(cfg.db || 'lsh');
    // fail fast if the server is actually unreachable
    await _db.command({ ping: 1 });
    console.log(`[Mongo] Connected — database "${cfg.db || 'lsh'}"`);
    return _db;
  } catch (err) {
    console.error(`[Mongo] Connection failed: ${err.message} — falling back to file persistence`);
    try { await _client?.close(); } catch {}
    _client = null;
    _db = null;
    return null;
  }
}

function getDb() {
  return _db;
}

async function closeMongo() {
  if (_client) {
    try { await _client.close(); } catch {}
    _client = null;
    _db = null;
  }
}

module.exports = { connectMongo, getDb, closeMongo };
