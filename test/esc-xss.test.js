'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// app.js is a browser-only script (top-level DOM lookups run at load time),
// so it can't be require()'d in Node. Pull just esc()'s source out and run
// it against a minimal document stub that reproduces the one behavior it
// depends on: textContent -> innerHTML escapes & < > (standard browser
// text-node serialization), nothing more.
function extractFunctionSource(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`could not find "${signature}" in app.js — has esc() moved or been renamed?`);
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function loadEsc() {
  const appJsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const escSrc = extractFunctionSource(appJsSrc, 'function esc(str) {');

  const fakeDocument = {
    createElement: () => {
      let text = '';
      return {
        set textContent(v) { text = String(v); },
        get innerHTML() {
          return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
      };
    },
  };
  const context = { document: fakeDocument };
  vm.createContext(context);
  vm.runInContext(escSrc, context);
  return context.esc;
}

test('esc(): plain text passes through unchanged', () => {
  const esc = loadEsc();
  assert.equal(esc('Solar Charger'), 'Solar Charger');
});

test('esc(): angle brackets and ampersands are escaped (pre-existing behavior)', () => {
  const esc = loadEsc();
  assert.equal(esc('<b>A & B</b>'), '&lt;b&gt;A &amp; B&lt;/b&gt;');
});

test('esc(): double quotes are escaped — the fixed XSS bug', () => {
  // Round 2 fix (02ae0a9) — esc() used to round-trip through
  // textContent -> innerHTML, which escapes & < > but not quotes. A label
  // like `x" onfocus="alert(1)` interpolated into value="${esc(x)}" could
  // break out of the attribute and inject a live event handler.
  const esc = loadEsc();
  const payload = 'x" onfocus="alert(1)" autofocus="';
  const escaped = esc(payload);

  assert.ok(!escaped.includes('"'), 'no raw double quote may survive escaping');
  assert.equal(escaped, 'x&quot; onfocus=&quot;alert(1)&quot; autofocus=&quot;');

  // Reconstruct the actual call-site shape and confirm the attribute can no
  // longer be broken out of.
  const html = `<input value="${escaped}">`;
  assert.equal(html.match(/"/g).length, 2, 'exactly the two real value="..." delimiters should remain');
});

test('esc(): single quotes are escaped too', () => {
  const esc = loadEsc();
  const escaped = esc(`it's a "test"`);
  assert.ok(!escaped.includes("'"), 'no raw single quote may survive escaping');
  assert.ok(!escaped.includes('"'), 'no raw double quote may survive escaping');
});
