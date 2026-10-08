'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// DeviceModal.jsx is JSX with no module boundary suited to direct import
// here — structural checks on the source guard the fix shape. (The classic
// dashboard's public/app.js had the same fix; it was removed with the
// classic frontend.)
test("DeviceModal.jsx: has a dedicated TextControl for the 'text' sensor type", () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'react-dashboard', 'src', 'components', 'DeviceModal.jsx'),
    'utf8'
  );
  assert.match(src, /function TextControl\(/);
  assert.match(src, /s\.type === 'text'/);
});
