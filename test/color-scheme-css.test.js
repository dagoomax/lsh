'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real Safari (unlike Chromium) renders native form controls — checkboxes,
// scrollbars — with the OS-default light appearance unless the page
// explicitly declares `color-scheme`. It once had to be fixed separately in
// each classic page's own copy of the token block; the React dashboard (the
// only frontend now) declares it once, in global.css.
const root = path.join(__dirname, '..');
const targets = [
  path.join(root, 'react-dashboard', 'src', 'styles', 'global.css'),
];

for (const file of targets) {
  test(`color-scheme: ${path.relative(root, file)} declares a dark color-scheme`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /color-scheme:\s*dark/, `${file} must declare color-scheme: dark for native controls to render correctly in Safari`);
  });
}
