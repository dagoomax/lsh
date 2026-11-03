#!/usr/bin/env node
'use strict';

// Auto-sync: watch LSH for Tuya air-conditioners and keep the Grenton vCLU
// bridge in step with no manual steps. Every INTERVAL it re-runs syncOnce; when
// the set of ACs changed it rewrites config.grenton and restarts ONLY the
// grenton module (POST /api/modules/processes/grenton-client/restart) — the Go
// module host re-reads config.json on restart, so the new AC's grenton/AC_<id>_*
// devices appear without restarting the whole core.
//   node scripts/grenton-klima-autosync.js [intervalSec] [vcluPort]   (default 15, 8098)

const http = require('http');
const path = require('path');
const { syncOnce } = require('./grenton-klima-sync');

const INTERVAL = (Number(process.argv[2]) || 15) * 1000;
const PORT = Number(process.argv[3]) || 8098;
const TOKEN = require(path.join(__dirname, '..', 'persist', 'api-tokens.json'))[0].token;

const restartGrenton = () => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: 3001, method: 'POST',
    path: '/api/modules/processes/grenton-client/restart', headers: { Authorization: 'Bearer ' + TOKEN } },
    (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', () => resolve(0));
  req.end();
});

async function tick() {
  try {
    const { acs, devices, changed } = await syncOnce({ port: PORT, tok: TOKEN });
    if (changed) {
      const code = await restartGrenton();
      console.log(`[autosync] ${new Date().toISOString()} ACs changed -> ${acs.length} AC(s), ${devices.length} device(s); grenton module restart HTTP ${code}`);
    }
  } catch (err) {
    console.log(`[autosync] ${new Date().toISOString()} error: ${err.message}`);
  }
}

console.log(`Grenton klima auto-sync — every ${INTERVAL / 1000}s, vCLU :${PORT}`);
tick();
setInterval(tick, INTERVAL);
