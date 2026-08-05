'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server.js: VirtualClient is instantiated before the automation engine starts', () => {
  // Round 1 fix (6d565bf) — the automation engine used to begin listening
  // for triggers before VirtualClient had registered its devices, so any
  // automation firing in the first moments after boot silently failed to
  // find its target device. Structural (not behavioral) because exercising
  // this really means booting the whole composition root.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const virtualIdx    = src.indexOf('new VirtualClient(');
  const automationIdx = src.indexOf('automation.start();'); // the semicolon excludes the explanatory comment above it

  assert.ok(virtualIdx !== -1, 'server.js must construct VirtualClient');
  assert.ok(automationIdx !== -1, 'server.js must start the automation engine');
  assert.ok(virtualIdx < automationIdx, 'VirtualClient must be constructed before automation.start()');
});
