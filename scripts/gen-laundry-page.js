#!/usr/bin/env node
// Copies the guest laundry page core-go/laundry_page.html (embedded by the Go
// core) into src/laundry-page.js for the Node server. Run it after editing the
// page; test/laundry.test.js fails if the two differ.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'core-go', 'laundry_page.html'), 'utf8');
const out = `'use strict';\n\n// Generated from core-go/laundry_page.html by scripts/gen-laundry-page.js — edit that file.\nmodule.exports = ${JSON.stringify(html)};\n`;
fs.writeFileSync(path.join(root, 'src', 'laundry-page.js'), out);
