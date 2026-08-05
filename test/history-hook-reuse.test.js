'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Round 2 fix (02ae0a9) — DeviceModal's Chart and EnergyFlow's sparklines
// each carried their own copy of the same "fetch now, poll on an interval,
// discard results after unmount" effect. Consolidated into a shared
// useHistoryPoints() hook in historyChart.js. Structural: this is about
// which module owns the effect, which a rendered-output test wouldn't
// distinguish from a reintroduced duplicate.
const root = path.join(__dirname, '..', 'react-dashboard', 'src');

test('historyChart.js exports the shared useHistoryPoints hook', () => {
  const src = fs.readFileSync(path.join(root, 'historyChart.js'), 'utf8');
  assert.match(src, /export function useHistoryPoints\(/);
});

test('DeviceModal.jsx consumes the shared hook instead of its own polling effect', () => {
  const src = fs.readFileSync(path.join(root, 'components', 'DeviceModal.jsx'), 'utf8');
  assert.match(src, /import \{[^}]*useHistoryPoints[^}]*\} from '\.\.\/historyChart'/);
  assert.match(src, /useHistoryPoints\(/);
  assert.doesNotMatch(
    src,
    /setInterval\(\(\) => fetchHistory/,
    'DeviceModal must not carry its own duplicate history-polling effect'
  );
});

test("EnergyFlow.jsx's useHistory wraps the shared hook instead of duplicating it", () => {
  const src = fs.readFileSync(path.join(root, 'components', 'EnergyFlow.jsx'), 'utf8');
  assert.match(src, /import \{[^}]*useHistoryPoints[^}]*\} from '\.\.\/historyChart'/);
  assert.match(src, /useHistoryPoints\(/);
  assert.doesNotMatch(
    src,
    /const iv = setInterval\(load, 60000\)/,
    'EnergyFlow must not carry its own duplicate history-polling effect'
  );
});
