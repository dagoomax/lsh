'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real Safari (unlike Chromium) renders native form controls — checkboxes,
// scrollbars — with the OS-default light appearance unless the page
// explicitly declares `color-scheme`. That fix landed in style.css and
// flows.html, then had to land a second time for settings.html because it
// carries its own separate inline copy of the same token block and the
// first pass missed it. One test per surface so a future edit to any of
// them can't silently drop the declaration again.
const root = path.join(__dirname, '..');
const targets = [
  path.join(root, 'public', 'style.css'),
  path.join(root, 'public', 'flows.html'),
  path.join(root, 'public', 'settings.html'),
  path.join(root, 'react-dashboard', 'src', 'styles', 'global.css'),
];

for (const file of targets) {
  test(`color-scheme: ${path.relative(root, file)} declares a dark color-scheme`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /color-scheme:\s*dark/, `${file} must declare color-scheme: dark for native controls to render correctly in Safari`);
  });
}
