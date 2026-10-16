'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.LSH_WIRING_DOCS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-wdocs-')), 'docs.json');
const docs = require('../src/wiring-docs');

test('installation documentation: written as the wiring progresses, then printable', () => {
  const d = docs.create({ title: 'Salon — roleta', room: 'Salon', device: 'fibaro-fgr223', deviceName: 'FIBARO Roller Shutter 3', scenario: 'momentary', scenarioTitle: 'Momentary switch', startText: 'Installation started' });
  assert.equal(d.progress.status, 'in progress');

  for (let i = 0; i < 3; i++) docs.addEvent(d.id, { type: 'step', text: `Wire ${i + 1}/4`, data: { index: i, total: 4 } });
  docs.addEvent(d.id, { type: 'step', text: 'again', data: { index: 1, total: 4 } }); // logged once only
  let cur = docs.get(d.id);
  assert.equal(cur.events.filter((e) => e.type === 'step').length, 3);
  assert.equal(cur.progress.wired, false);
  docs.addEvent(d.id, { type: 'step', text: 'Wire 4/4', data: { index: 3, total: 4 } });
  assert.equal(docs.get(d.id).progress.status, 'wired');

  docs.addEvent(d.id, { type: 'trip', text: 'Breaker tripped: short' });
  assert.equal(docs.get(d.id).progress.tested, false);
  docs.addEvent(d.id, { type: 'test', text: 'Power on: no fault' });
  assert.equal(docs.get(d.id).progress.status, 'tested');

  docs.addEvent(d.id, { type: 'checklist', text: '1 of 2', data: { items: [{ text: 'Screwdriver', done: true }, { text: 'WAGO 221', done: false }] } });
  docs.addEvent(d.id, { type: 'checklist', text: '2 of 2', data: { items: [{ text: 'Screwdriver', done: true }, { text: 'WAGO 221', done: true }] } });
  assert.equal(docs.get(d.id).events.filter((e) => e.type === 'checklist').length, 1, 'the checklist is a state');

  docs.addEvent(d.id, { type: 'pair', text: 'Paired', data: { realId: 'zwave:c0ffee00:12' } });
  assert.equal(docs.get(d.id).progress.status, 'done');
  assert.throws(() => docs.addEvent(d.id, { type: 'hack' }), /Unknown event/);

  // the diagram: the emulator's SVG, nothing active kept
  const upd = docs.update(d.id, { notes: 'Box behind the sofa', diagram: '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><a href="javascript:x()"><rect width="5" height="5"/></a></svg>' });
  const full = docs.list().find((x) => x.id === d.id);
  assert.ok(!/onload|<script|javascript:/i.test(full.diagram));
  assert.ok(/<rect/.test(full.diagram));
  assert.equal(upd.notes, 'Box behind the sofa');
  assert.equal(docs.sanitizeSvg('<div>not svg</div>'), null);

  const html = docs.renderHtml([full], { title: 'Salon', lang: 'pl', labels: { status_done: 'gotowa', paired: 'Sparowano' } });
  for (const s of ['Salon — roleta', 'FIBARO Roller Shutter 3', 'Momentary switch', 'gotowa', 'zwave:c0ffee00:12', 'Box behind the sofa', '☑ WAGO 221', 'Breaker tripped: short', '<rect']) assert.ok(html.includes(s), s);
  assert.ok(!/<script/i.test(html));

  // a second installation → a contents list
  docs.create({ title: 'Kuchnia — światło', device: 'x' });
  const all = docs.renderHtml(docs.list(), { title: 'Dom' });
  assert.match(all, /href="#d-/);
  assert.ok(docs.remove(d.id));
  assert.equal(docs.get(d.id), null);
});
