'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// public/flows.js is a browser-only script built around live DOM helpers
// (selectDynamic, refreshNode, etc.) with no module boundary to import
// against, so this is a structural regression test on the source rather
// than a behavioral one against a real DOM.
function virtualNodeBlock() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'flows.js'), 'utf8');
  const start = src.indexOf('virtual: {');
  const end = src.indexOf('relay: {', start); // next node-type entry
  assert.ok(start !== -1 && end !== -1 && end > start, 'could not locate the virtual node-type block in flows.js');
  return src.slice(start, end);
}

test("flows.js: a virtual node whose device was deleted elsewhere is flagged, not silently rewired", () => {
  // Round 1 fix (6d565bf) — a Virtual node whose configured deviceKey no
  // longer matched any known device used to get silently reassigned to an
  // arbitrary other device on save, which could wire a flow's automation to
  // the wrong physical device with no warning.
  const block = virtualNodeBlock();

  assert.match(block, /\(not found\)/, 'a missing device must be visibly flagged in the UI');
  assert.match(
    block,
    /const missing = !VIRTUAL_DEVICES\.some/,
    'missing-device detection must still exist'
  );
});

test('flows.js: the auto-default only fires for an empty deviceKey, never as a fallback for a stale one', () => {
  const block = virtualNodeBlock();

  // The only place a device gets auto-assigned must be gated on "no
  // deviceKey configured yet" — reusing that same assignment as a fallback
  // for "deviceKey configured but not found" is exactly the regression this
  // fix closed.
  assert.match(
    block,
    /if \(!n\.config\.deviceKey\) n\.config\.deviceKey = VIRTUAL_DEVICES\[0\]\.key;/,
    'auto-defaulting must be conditioned on an empty deviceKey'
  );
});
