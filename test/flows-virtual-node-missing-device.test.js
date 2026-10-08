'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Round 1 fix (6d565bf) — a Virtual node whose configured deviceKey no longer
// matched any known device used to get silently reassigned to an arbitrary
// other device on save, wiring the flow to the wrong physical device with no
// warning. The editor's node catalogue (flowTypes.js, pure data + functions)
// is tested behaviorally here.
const load = () => import(pathToFileURL(path.join(__dirname, '..', 'react-dashboard', 'src', 'components', 'pages', 'flowTypes.js')).href);
const ctx = {
  scenes: [], pagingRooms: [],
  virtualDevices: [
    { key: 'virtual/a', label: 'A', valueType: 'boolean' },
    { key: 'virtual/b', label: 'B', valueType: 'text' },
  ],
};

test('flows: a virtual node whose device was deleted elsewhere keeps its key and is flagged', async () => {
  const { TYPES, withDefaults } = await load();
  const node = { type: 'virtual', config: { deviceKey: 'virtual/gone', value: 'x' } };
  const cfg = withDefaults(node, ctx);
  assert.equal(cfg.deviceKey, 'virtual/gone', 'a stale deviceKey must never be replaced by another device');
  const fields = TYPES.virtual.fields(cfg, ctx);
  const picker = fields.find((f) => f.key === 'deviceKey');
  assert.match(picker.options[0][1], /not found/, 'the missing device must be visibly flagged');
});

test('flows: the auto-default only fires for an empty deviceKey', async () => {
  const { withDefaults } = await load();
  assert.equal(withDefaults({ type: 'virtual', config: {} }, ctx).deviceKey, 'virtual/a');
  assert.equal(withDefaults({ type: 'virtual', config: { deviceKey: 'virtual/b' } }, ctx).deviceKey, 'virtual/b');
});
