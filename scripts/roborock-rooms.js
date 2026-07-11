#!/usr/bin/env node
'use strict';

/*
 * Room number extractor — lists each Roborock device's cleanable rooms
 * (segment id → name) using the cached cloud session.
 *
 *   node scripts/roborock-rooms.js
 *
 * Use the segment ids with the "Clean <room>" buttons on the dashboard, or:
 *   POST /api/roborock/:duid/clean-room  { "segments": [16, 17] }
 */

const RC = require('../src/roborock-cloud-client');

(async () => {
  const cfg = { roborock: { cloud: { email: process.env.ROBOROCK_EMAIL || undefined } } };
  const c = new RC(cfg, { update: () => {} }, { registerDevice: () => {} });
  await c.start();
  for (const d of c.listDevices()) {
    const rooms = c.getRooms(d.duid);
    console.log(`\n${d.name}  [${d.model}]  ${d.duid}`);
    if (!rooms.length) { console.log('   (no rooms — device may not have a saved map)'); continue; }
    for (const r of rooms) console.log(`   ${String(r.segmentId).padStart(3)}  ${r.name}`);
  }
  c.stop();
  process.exit(0);
})().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
