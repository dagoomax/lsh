'use strict';

// Modules that are tools, not integrations: never started at boot, never
// auto-installed — installed from their Settings page the first time they're
// used (POST /api/modules/:id/install). scripts/gen-modules-manifest.js
// packages each entry (+ everything it requires) into modules.json.
module.exports = [
  // Settings → System → LAN scan
  { id: 'lsh-lan', entry: 'src/lsh-lan.js' },
  // Settings → System → CAN bus scan (SocketCAN via candump, SLCAN via serialport)
  { id: 'lsh-can', entry: 'src/lsh-can-scan.js' },
];
