'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// public/app.js and DeviceModal.jsx are UI-layer files with no module
// boundary suited to direct import here (app.js runs top-level DOM lookups
// at load time; DeviceModal.jsx is JSX). Structural checks on the source
// guard the two fix shapes directly.
const appJsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test("app.js: buildSensorRow has a dedicated branch for the 'text' sensor type", () => {
  // Round 1 fix (6d565bf) — a virtual 'text' sensor used to fall through to
  // boolean-toggle rendering, corrupting the value on the next write.
  assert.match(appJsSrc, /sensor\.controllable && sensor\.type === 'text'/);
});

test("app.js: updateDeviceSensor updates .sensor-text inputs directly, not via the boolean-toggle path", () => {
  assert.match(appJsSrc, /cell\.tagName === 'INPUT' && cell\.classList\.contains\('sensor-text'\)/);
});

test('app.js: the sensor-text change handler is wired once and shared, not tripled', () => {
  // Round 2 fix (02ae0a9) — the same change-listener body was copy-pasted
  // across three grids (main, custom-rooms, rooms); consolidated into
  // wireSensorTextChange(container).
  const defCount = (appJsSrc.match(/function wireSensorTextChange\(container\)/g) || []).length;
  const callSites = appJsSrc.match(/^wireSensorTextChange\([a-zA-Z]+\);/gm) || [];

  assert.equal(defCount, 1, 'wireSensorTextChange must be defined exactly once');
  assert.equal(callSites.length, 3, 'all three grids (main, custom-rooms, rooms) must be wired through the shared helper');
});

test("DeviceModal.jsx: has a dedicated TextControl for the 'text' sensor type", () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'react-dashboard', 'src', 'components', 'DeviceModal.jsx'),
    'utf8'
  );
  assert.match(src, /function TextControl\(/);
  assert.match(src, /s\.type === 'text'/);
});
