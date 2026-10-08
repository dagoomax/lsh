'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.LSH_LAN_DEVICES_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-lan-')), 'lan-devices.json');
const inv = require('../src/lsh-lan-inventory');

const host = (ip, mac, extra = {}) => ({ ip, mac, name: `dev ${ip}`, ports: [80], id: { kind: 'web', label: 'Web server' }, ...extra });

test('saved LAN devices: baseline, new, ip-changed, mark known, user tags, monitor flag', () => {
  // First scan = baseline: nothing is "new"
  let r = inv.mergeScan({ hosts: [host('192.168.1.10', 'AA:00:00:00:00:01'), host('192.168.1.11', 'AA:00:00:00:00:02'), host('192.168.1.49', 'AA:00:00:00:00:99', { self: true })] });
  assert.equal(r.baseline, true);
  assert.equal(inv.list().length, 2, 'the LSH host itself is not saved');
  assert.ok(inv.list().every((d) => !d.tags.includes('new')));

  // A newcomer gets "new"; a known MAC at a new IP gets "ip-changed"
  r = inv.mergeScan({ hosts: [host('192.168.1.10', 'AA:00:00:00:00:01'), host('192.168.1.20', 'AA:00:00:00:00:02'), host('192.168.1.30', 'AA:00:00:00:00:03')] });
  assert.equal(r.newDevices.length, 1);
  assert.deepEqual(inv.get('AA:00:00:00:00:03').tags, ['new']);
  const moved = inv.get('AA:00:00:00:00:02');
  assert.equal(moved.ip, '192.168.1.20');
  assert.deepEqual(moved.ipHistory, ['192.168.1.20', '192.168.1.11']);
  assert.ok(moved.tags.includes('ip-changed'));

  // User label / tags / monitor
  inv.update('AA:00:00:00:00:03', { label: 'Kids tablet', tags: 'new, Kids , iot', monitored: true });
  const t = inv.get('AA:00:00:00:00:03');
  assert.equal(t.label, 'Kids tablet');
  assert.deepEqual(t.tags, ['new', 'kids', 'iot']);
  assert.equal(inv.monitored().length, 1);
  assert.ok(inv.allTags().includes('kids'));

  // Mark known clears system tags only
  inv.acknowledge();
  assert.deepEqual(inv.get('AA:00:00:00:00:03').tags, ['kids', 'iot']);
  assert.ok(!inv.get('AA:00:00:00:00:02').tags.includes('ip-changed'));

  // Offline is computed for monitored devices from monitor status
  const listed = inv.list((k) => (k === 'AA:00:00:00:00:03' ? { online: false } : null));
  assert.ok(listed.find((d) => d.key === 'AA:00:00:00:00:03').tags.includes('offline'));

  // Persisted to disk
  inv._reset();
  assert.equal(inv.get('AA:00:00:00:00:03').label, 'Kids tablet');
  inv.remove('AA:00:00:00:00:03');
  assert.equal(inv.get('AA:00:00:00:00:03'), null);
});
