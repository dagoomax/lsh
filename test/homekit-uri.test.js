'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Accessory, Categories, uuid } = require('hap-nodejs');
const { generateSetupUri } = require('../src/homekit-uri');

// The QR / setup URI must carry the right category — iOS shows that icon when pairing
// (it used to say GARAGE_DOOR_OPENER for the bridge).
test('setup URI matches hap-nodejs for bridge, camera and others', () => {
  for (const [pin, category] of [['031-45-154', Categories.BRIDGE], ['123-45-678', Categories.CAMERA], ['999-88-777', Categories.LIGHTBULB], ['111-22-333', Categories.SWITCH]]) {
    const a = new Accessory('x', uuid.generate(`uri-${pin}`));
    a._accessoryInfo = { pincode: pin, category };
    a._setupID = 'HEJX';
    assert.equal(generateSetupUri(pin, 'HEJX', category), a.setupURI(), `category ${category}`);
  }
  assert.equal(generateSetupUri('031-45-154', 'HEJX'), 'X-HM://0023ISYWYHEJX', 'default = bridge');
});
