'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSvg, detectType, brandSlugs, filePath } = require('../src/lsh-lan-icons');

test('icons: SVG sanitiser strips scripts, handlers and external refs', () => {
  const evil = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script>'
    + '<image href="https://evil.example/x.png"/><a xlink:href="javascript:alert(3)"><path d="M0 0" onclick="x()"/></a>'
    + '<foreignObject><div>hi</div></foreignObject><use href="#ok"/></svg>';
  const out = sanitizeSvg(evil, '#ffffff');
  assert.doesNotMatch(out, /script|onload|onclick|evil\.example|javascript:|foreignObject/i);
  assert.match(out, /^<svg fill="#ffffff"/);
  assert.throws(() => sanitizeSvg('<html></html>'), /Not an SVG/);
});

test('icons: magic-byte detection', () => {
  assert.equal(detectType(Buffer.from('89504e470d0a1a0a0000', 'hex')), 'png');
  assert.equal(detectType(Buffer.from('ffd8ffe000', 'hex')), 'jpg');
  assert.equal(detectType(Buffer.from('00000100010010', 'hex')), 'ico');
  assert.equal(detectType(Buffer.from('<svg viewBox="0 0 1 1"></svg>')), 'svg');
  assert.equal(detectType(Buffer.from('<html>no</html>'), 'text/html'), null);
});

test('icons: brand from vendor/name; file names are safe', () => {
  assert.deepEqual(brandSlugs({ vendor: 'Apple, Inc.' }), ['apple']);
  assert.deepEqual(brandSlugs({ vendor: 'Philips Lighting BV' }), ['philipshue', 'philips']);
  assert.deepEqual(brandSlugs({ vendor: 'Belkin International Inc.', name: 'Linksys21610' }), ['linksys', 'belkin']);
  assert.deepEqual(brandSlugs({ vendor: 'Unknown Corp' }), []);
  assert.equal(filePath('../../config.json'), null);
  assert.equal(filePath('x.exe'), null);
});
