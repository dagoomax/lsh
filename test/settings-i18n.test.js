'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

// Settings text is translated through the phrase book in
// react-dashboard/src/i18n/settings (English → pl, de, fr, es, it, uk).

test('settings phrase book: every entry has all six languages and the same placeholders', async () => {
  const { BOOK, SAME, LANGS } = await import('../react-dashboard/src/i18n/settings/index.js');
  assert.deepEqual(LANGS, ['pl', 'de', 'fr', 'es', 'it', 'uk']);
  const ph = (s) => [...new Set(s.match(/\{\w+\}/g) || [])].sort().join();
  for (const [en, t] of Object.entries(BOOK)) {
    assert.ok(Array.isArray(t) && t.length === LANGS.length, `"${en}": needs ${LANGS.length} translations`);
    t.forEach((x, i) => {
      assert.ok(typeof x === 'string' && x.trim(), `"${en}": ${LANGS[i]} is empty`);
      assert.equal(ph(x), ph(en), `"${en}": ${LANGS[i]} placeholders differ`);
    });
    assert.ok(!SAME.includes(en), `"${en}" is both translated and listed in SAME`);
  }
});

test('trn() picks the plural form of the language', async () => {
  let lang = 'pl';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => lang, setItem: () => {} } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent() {} } });
  globalThis.Event = globalThis.Event || class { constructor(t) { this.type = t } };
  const i18n = await import('../react-dashboard/src/i18n.js');
  await i18n.loadPhrases();
  const k = '{n} device in range|{n} devices in range';
  assert.deepEqual([1, 3, 5, 22].map((n) => i18n.trn(k, n)), ['1 urządzenie w zasięgu', '3 urządzenia w zasięgu', '5 urządzeń w zasięgu', '22 urządzenia w zasięgu']);
  lang = 'de';
  await i18n.loadPhrases();
  assert.deepEqual([1, 2].map((n) => i18n.trn(k, n)), ['1 Gerät in Reichweite', '2 Geräte in Reichweite']);
  lang = 'en';
  assert.deepEqual([1, 2].map((n) => i18n.trn(k, n)), ['1 device in range', '2 devices in range']);
  assert.equal(i18n.tr('Watching {mac} for 8 s…', { mac: false }), 'Watching  for 8 s…', 'false renders as nothing, like React');
});

test('settings phrase book covers every phrase used in Settings', (t) => {
  // the extractor parses the Settings sources with @babel/parser from the
  // React app's dev dependencies — skip where those aren't installed (e.g. prod)
  try { for (const m of ['@babel/parser', '@babel/traverse']) require.resolve(m, { paths: [path.join(__dirname, '../react-dashboard')] }) } catch { return t.skip('react-dashboard dev dependencies not installed') }
  try {
    execFileSync(process.execPath, [path.join(__dirname, '../react-dashboard/scripts/settings-phrases.mjs'), 'check'], { stdio: 'pipe' });
  } catch (err) {
    assert.fail(`untranslated Settings text — run: node react-dashboard/scripts/settings-phrases.mjs missing\n${String(err.stderr || err.message)}`);
  }
});
