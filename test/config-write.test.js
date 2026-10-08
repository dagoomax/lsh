'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeConfigFile } = require('../src/config-file-cache');

const tmpConfig = (content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-cfg-'));
  const file = path.join(dir, 'config.json');
  if (content !== undefined) fs.writeFileSync(file, content, { mode: 0o640 });
  return file;
};

test('writeConfigFile: replaces the file and keeps the previous one as .bak', () => {
  const file = tmpConfig('{"a":1}');
  writeConfigFile({ a: 2 }, file);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).a, 2);
  assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).a, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), [], 'no temp file left behind');
});

test('writeConfigFile: keeps the existing file mode', () => {
  const file = tmpConfig('{}');
  writeConfigFile({ b: 1 }, file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});

test('writeConfigFile: a broken config.json never overwrites a good .bak', () => {
  const file = tmpConfig('{"good":true}');
  writeConfigFile({ good: true, n: 1 }, file);     // .bak = {"good":true}
  fs.writeFileSync(file, '{ broken');              // hand-edit typo
  writeConfigFile({ good: true, n: 2 }, file);
  assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).good, true);
});
