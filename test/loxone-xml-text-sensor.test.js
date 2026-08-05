'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildInputsXml, buildOutputsXml } = require('../src/loxone-xml');

// Round 1 fix (6d565bf), loxone-xml.js part — a free-text sensor has no
// honest representation in Loxone's numeric/boolean virtual I/O, so it must
// be excluded from the generated templates rather than mapped onto a broken
// numeric control.
const device = {
  key: 'virtual/note', label: 'Note', instance: 0,
  sensors: [
    { path: 'notetext', name: 'Note', type: 'text', controllable: true },
    { path: 'level', name: 'Level', type: 'range', controllable: true, min: 0, max: 100 },
  ],
};

test('loxone-xml: text sensors are excluded from the Virtual Input template', () => {
  const xml = buildInputsXml([device], { host: '1.2.3.4', token: 'tok' }).join('\n');
  assert.doesNotMatch(xml, /"path":"notetext"/, 'a text sensor must not appear in the numeric polling template');
});

test('loxone-xml: text sensors are excluded from the Virtual Output template', () => {
  const xml = buildOutputsXml([device], { host: '1.2.3.4', token: 'tok' }).join('\n');
  assert.doesNotMatch(xml, /sensor=notetext/, 'a text sensor must not get a digital/numeric output command');
});

test('loxone-xml: a controllable non-text sensor is still included', () => {
  const xml = buildOutputsXml([device], { host: '1.2.3.4', token: 'tok' }).join('\n');
  assert.match(xml, /sensor=level/, 'other controllable sensors must be unaffected by the text exclusion');
});
