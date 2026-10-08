'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAdvertisement, readFields, RECORDS, toValues } = require('../src/lsh-ble');

// Real captured advertisements + keys + expected readings from the
// keshavdv/victron-ble Python library's test suite (independent of the
// esphome-victron_ble C++ code this decoder was ported from).
const adv = (hex, key) => parseAdvertisement(Buffer.from(hex, 'hex'), key);

test('battery monitor (SmartShunt): decrypt + decode', () => {
  const r = adv('100289a302b040af925d09a4d89aa0128bdef48c6298a9', 'aff4d0995b7d1e176c0c33ecb9e70dcd');
  assert.equal(r.kind, 'battery_monitor');
  assert.equal(r.productId, 0xa389);
  assert.equal(r.values.STATE_OF_CHARGE, 50);
  assert.equal(r.values.BATTERY_VOLTAGE, 12.53);
  assert.equal(r.values.BATTERY_CURRENT, 0);
  assert.equal(r.values.CONSUMED_AH, -50);
  assert.equal(r.values.TIME_TO_GO, null, '0xFFFF = not available');
  assert.equal(r.values.ALARM_REASON_TEXT, 'No alarm');
  assert.ok(!('AUX_VOLTAGE' in r.values || 'MID_VOLTAGE' in r.values || 'TEMPERATURE' in r.values), 'aux disabled');
});

test('battery monitor aux field: starter voltage / mid-point / temperature', () => {
  const layout = RECORDS[0x02][1];
  const dec = (hex) => toValues('battery_monitor', readFields(Buffer.from(hex, 'hex'), layout));
  assert.equal(dec('ffffe6040000feff000000000080feac').AUX_VOLTAGE, -0.02);
  assert.equal(dec('ffffe6040000feff010000000080fe0c').MID_VOLTAGE, 655.34);
  assert.equal(dec('ffffe6040000ffff020000000080fede').TEMPERATURE, null, '0xFFFF = not available');
});

test('solar charger (BlueSolar MPPT 75/15)', () => {
  const r = adv('100242a0016207adceb37b605d7e0ee21b24df5c', 'adeccb947395801a4dd45a2eaa44bf17');
  assert.equal(r.kind, 'solar_charger');
  assert.equal(r.values.DEVICE_STATE_TEXT, 'Absorption');
  assert.equal(r.values.BATTERY_VOLTAGE, 13.88);
  assert.equal(r.values.BATTERY_CURRENT, 1.4);
  assert.equal(r.values.YIELD_TODAY, 0.03); // kWh (the Python lib reports 30 Wh)
  assert.equal(r.values.PV_POWER, 19);
  assert.equal(r.values.LOAD_CURRENT, 0);
  assert.equal(r.values.CHARGER_ERROR_TEXT, 'No error');
});

test('DC/DC converter (Orion Smart)', () => {
  const r = adv('1000c0a304121d64ca8d442b90bbdf6a8cba', '64ba49f1a8562e45197a8e1fe50d7658');
  assert.equal(r.kind, 'dcdc_converter');
  assert.equal(r.values.DEVICE_STATE_TEXT, 'Off');
  assert.equal(r.values.INPUT_VOLTAGE, 13.15);
  assert.equal(r.values.OFF_REASON_TEXT, 'Engine shutdown detection');
});

test('Multi RS', () => {
  const r = adv('100043a40bf4e434af0e46c3b8eb68e08e616993f70c', '346c410e8c824dd723c0f5b13b9eabc8');
  assert.equal(r.kind, 'multi_rs');
  assert.equal(r.values.DEVICE_STATE_TEXT, 'Inverting');
  assert.equal(r.values.CHARGER_ERROR_TEXT, 'No error');
  assert.equal(r.values.BATTERY_CURRENT, -12.8);
  assert.equal(r.values.BATTERY_VOLTAGE, 51.71);
  assert.equal(r.values.ACTIVE_AC_IN_TEXT, 'Not connected');
  assert.equal(r.values.ACTIVE_AC_IN_POWER, 0);
  assert.equal(r.values.AC_OUT_POWER, 722);
  assert.equal(r.values.PV_POWER, 0);
  assert.equal(r.values.YIELD_TODAY, 5.32);
});

test('VE.Bus (MultiPlus)', () => {
  const r = adv('100380270c1252dad26f0b8eb39162074d140df410', 'da3f5fa2860cb1cf86ba7a6d1d16b9dd');
  assert.equal(r.kind, 've_bus');
  assert.equal(r.values.DEVICE_STATE_TEXT, 'Float');
  assert.equal(r.values.BATTERY_VOLTAGE, 14.45);
  assert.equal(r.values.BATTERY_CURRENT, 23.2);
  assert.equal(r.values.ACTIVE_AC_IN_TEXT, 'AC in 1');
  assert.equal(r.values.ACTIVE_AC_IN_POWER, 1459);
  assert.equal(r.values.AC_OUT_POWER, 1046);
  assert.equal(r.values.TEMPERATURE, 32);
  assert.equal(r.values.STATE_OF_CHARGE, null);
  assert.equal(r.values.ALARM_ACTIVE, 0);
});

test('AC charger (Blue Smart IP22)', () => {
  const r = adv('100030a308f926c1b5170a0d2280335bf12d5ed083', 'c129cf8f75c3fe5a1655b481e205fb7d');
  assert.equal(r.kind, 'ac_charger');
  assert.equal(r.values.DEVICE_STATE_TEXT, 'Storage');
  assert.equal(r.values.BATTERY_VOLTAGE, 13.49);
  assert.equal(r.values.BATTERY_CURRENT, 0.4);
  assert.equal(r.values.AC_CURRENT, null);
  assert.equal(r.values.BATTERY_CURRENT_2, null);
  assert.equal(r.values.TEMPERATURE, 21);
});

test('Smart BatteryProtect', () => {
  const r = adv('1080b0a3093523fadedea38b1af8bcbde91ca8b6dbb60e', 'fac570d66380b797a5b7543758be00e4');
  assert.equal(r.kind, 'smart_battery_protect');
  assert.equal(r.values.INPUT_VOLTAGE, 13.07);
  assert.equal(r.values.OUTPUT_VOLTAGE, 13.07);
  assert.equal(r.values.OUTPUT_STATE_TEXT, 'On');
  assert.equal(r.values.ALARM_REASON_TEXT, 'No alarm');
  assert.equal(r.values.ERROR_CODE_TEXT, 'No error');
});

test('DC energy meter', () => {
  const r = adv('100289a30d787fafde83ccec982199fd815286', 'aff4d0995b7d1e176c0c33ecb9e70dcd');
  assert.equal(r.kind, 'dc_energy_meter');
  assert.equal(r.values.BATTERY_VOLTAGE, 12.52);
  assert.equal(r.values.BATTERY_CURRENT, 0);
  assert.equal(r.values.AUX_VOLTAGE, -0.01);
});

test('Smart Lithium (decrypted record)', () => {
  const buf = Buffer.from('\x00\x00\x00\x06\x00\x00\xc7\xe3\xf1\xf8\xff\xff\xff,5\xb5\xfa\xb4x\x01\x0f\xd2I\xd2\xae_iV\xe1\xf8\xa9e', 'latin1');
  const v = toValues('smart_lithium', readFields(buf, RECORDS[0x05][1]));
  assert.deepEqual([v.CELL1, v.CELL2, v.CELL3, v.CELL4, v.CELL5], [3.31, 3.31, 3.31, 3.31, null]);
  assert.equal(v.BATTERY_VOLTAGE, 13.24);
  assert.equal(v.TEMPERATURE, 13);
  assert.equal(v.BALANCER_TEXT, 'Imbalance');
});

test('Lynx Smart BMS (decrypted record)', () => {
  const buf = Buffer.from('\x00@8\x8b\n\xfa\xff\x95\x15U\x14\x8c\xcf\x02\x00\xff\xb3\xea\xf1t\xd6\xfczHT\xb8\xec\x00\x86\t\xe9\xca', 'latin1');
  const v = toValues('lynx_bms', readFields(buf, RECORDS[0x0a][1]));
  assert.equal(v.TIME_TO_GO, 14400);
  assert.equal(v.BATTERY_VOLTAGE, 26.99);
  assert.equal(v.BATTERY_CURRENT, -0.6);
  assert.equal(v.STATE_OF_CHARGE, 99.5);
  assert.equal(v.CONSUMED_AH, -4.4);
  assert.equal(v.TEMPERATURE, null);
});

test('rejects a wrong key and malformed input without throwing', () => {
  assert.match(adv('100289a302b040af925d09a4d89aa0128bdef48c6298a9', '00f4d0995b7d1e176c0c33ecb9e70dcd').error, /bindkey mismatch/);
  assert.ok(adv('1002', 'aff4d0995b7d1e176c0c33ecb9e70dcd').error);
  assert.ok(adv('100289a3ee b040af925d09a4d89aa0128bdef48c6298a9'.replace(' ', ''), 'aff4d0995b7d1e176c0c33ecb9e70dcd').error);
});

test('client: decoded adverts become an LSH device and feed the energy dashboard', () => {
  const DataStore = require('../src/data-store');
  const SensorRegistry = require('../src/sensor-registry');
  const LshBleClient = require('../src/lsh-ble-client');
  const store = new DataStore();
  const registry = new SensorRegistry(store, 'en');
  const client = new LshBleClient({ lshBle: { devices: [
    { name: 'Shunt', mac: 'aa:bb:cc:dd:ee:01', bindkey: 'aff4d0995b7d1e176c0c33ecb9e70dcd' },
    { name: 'MPPT', mac: 'AA:BB:CC:DD:EE:02', bindkey: 'adeccb947395801a4dd45a2eaa44bf17' },
  ] } }, store, registry);

  assert.equal(client.handleAdvertisement('AA:BB:CC:DD:EE:01', Buffer.from('100289a302b040af925d09a4d89aa0128bdef48c6298a9', 'hex')), true);
  assert.equal(client.handleAdvertisement('AA:BB:CC:DD:EE:01', Buffer.from('100289a302b040af925d09a4d89aa0128bdef48c6298a9', 'hex')), false, 'same counter = same reading, skipped');
  assert.equal(client.handleAdvertisement('AA:BB:CC:DD:EE:02', Buffer.from('100242a0016207adceb37b605d7e0ee21b24df5c', 'hex')), true);

  const shunt = registry.getDevices().find((d) => d.key === 'lshble/shunt');
  assert.ok(shunt, 'device registered on first advert');
  assert.ok(shunt.sensors.some((s) => s.path === 'state_of_charge'));
  assert.equal(store.get('lshble/shunt/state_of_charge'), 50);
  assert.equal(store.get('lshble/mppt/pv_power'), 19);
  assert.equal(store.get('lshble/mppt/device_state_text'), 'Absorption');

  // Energy dashboard keys (no GX source writing them)
  assert.equal(store.get('system/0/Dc/Battery/Soc'), 50);
  assert.equal(store.get('system/0/Dc/Battery/Voltage'), 12.53);
  assert.equal(store.get('system/0/Dc/Pv/Power'), 19);
  assert.equal(store.get('system/0/PvChargerAggregated/Yield/User'), 0.03);

  // Unknown MAC and wrong key are ignored, not thrown
  assert.equal(client.handleAdvertisement('11:22:33:44:55:66', Buffer.alloc(20)), false);
  const bad = new LshBleClient({ lshBle: { devices: [{ name: 'X', mac: 'AA:BB:CC:DD:EE:09', bindkey: '00'.repeat(16) }] } }, store, registry);
  assert.equal(bad.handleAdvertisement('AA:BB:CC:DD:EE:09', Buffer.from('100289a302b040af925d09a4d89aa0128bdef48c6298a9', 'hex')), false);
  assert.match(bad.getStatus().devices[0].error, /bindkey mismatch/);
});

test('inspect decoders: iBeacon, Eddystone-URL, RuuviTag, Victron header, address kinds', () => {
  const { decodeManufacturer, decodeServiceData, addressKind } = require('../src/lsh-ble-inspect');
  const ib = decodeManufacturer(0x004c, Buffer.from('0215' + 'e2c56db5dffb48d2b060d0f5a71096e0' + '0001' + '0002' + 'c5', 'hex'))[0];
  assert.equal(ib.format, 'iBeacon');
  assert.equal(ib.fields.UUID, 'e2c56db5-dffb-48d2-b060-d0f5a71096e0');
  assert.equal(ib.fields.Major, 1);
  assert.equal(ib.fields['Measured power'], '-59 dBm @ 1 m');
  const url = decodeServiceData('0000feaa-0000-1000-8000-00805f9b34fb', Buffer.from('10ee03676f6f676c6507', 'hex'))[0];
  assert.equal(url.fields.URL, 'https://google.com');
  // Ruuvi RAWv2 reference vector (docs.ruuvi.com dataformat 5, "valid data")
  const ru = decodeManufacturer(0x0499, Buffer.from('0512FC5394C37C0004FFFC040CAC364200CDCBB8334C884F', 'hex'))[0];
  assert.equal(ru.fields.Temperature, '24.30 °C');
  assert.equal(ru.fields.Humidity, '53.49 %');
  assert.equal(ru.fields.Pressure, '1000.44 hPa');
  assert.equal(ru.fields.Battery, '2.977 V');
  assert.equal(ru.fields['TX power'], '4 dBm');
  const vic = decodeManufacturer(0x02e1, Buffer.from('100289a302b040af925d09a4d89aa0128bdef48c6298a9', 'hex'), 'aff4d0995b7d1e176c0c33ecb9e70dcd')[0];
  assert.equal(vic.fields.Model, 'SmartShunt 500A/50mV');
  assert.equal(vic.fields['state of charge'], 50);
  assert.equal(addressKind('C1:00:00:00:00:00'), 'static random');
  assert.match(addressKind('5E:00:00:00:00:00'), /resolvable/);
});

test('lsh-lan: identify() and private-MAC vendor detection', () => {
  const { identify, vendorOf, localNetworks } = require('../src/lsh-lan');
  const base = { ports: [], mdns: null, ssdp: null, http: {}, vendor: null };
  assert.equal(identify({ ...base, http: { shelly: { model: 'SNSW-001P16EU' } } }).integration, 'shelly');
  assert.equal(identify({ ...base, ports: [6053] }).kind, 'esphome');
  assert.equal(identify({ ...base, mdns: { services: [{ type: '_googlecast._tcp' }] } }).integration, 'googlehome');
  assert.equal(identify({ ...base, ports: [1883] }).integration, 'mqtt');
  assert.equal(identify({ ...base, http: { web: { server: 'Loxone 14.5', title: '' } }, ports: [80] }).kind, 'loxone');
  assert.equal(identify(base).kind, 'unknown');
  assert.equal(vendorOf('DA:A1:19:00:00:01'), 'Private / randomised MAC');
  assert.equal(vendorOf(null), null);
  assert.ok(Array.isArray(localNetworks()));
});

test('lsh-lan: Bonjour instance names are cleaned up', () => {
  const { cleanInstance, identify } = require('../src/lsh-lan');
  assert.equal(cleanInstance('7035606331A2\\064Salon Apple TV'), 'Salon Apple TV');
  assert.equal(cleanInstance('70-35-60-63.1 Kuchnia'), 'Kuchnia');
  assert.equal(cleanInstance('\\197\\129azienka'), 'Łazienka');
  assert.equal(cleanInstance('70-35-60-63.1 Łazienka Bartek'), 'Łazienka Bartek');
  const base = { ports: [], mdns: null, ssdp: null, http: {}, vendor: null };
  assert.equal(identify({ ...base, ports: [8123], mdns: { services: [{ type: '_hap._tcp', name: 'Dom' }] } }).kind, 'homeassistant');
  assert.equal(identify({ ...base, mdns: { hostname: 'Miele-001', services: [{ type: '_mieleathome._tcp', name: 'Miele G7360' }] } }).integration, 'miele');
});

test('lsh-lan: routers and mesh nodes are network equipment', () => {
  const { identify } = require('../src/lsh-lan');
  const base = { ports: [80, 443], mdns: null, ssdp: null, http: {}, vendor: null };
  assert.equal(identify({ ...base, gateway: true }).label, 'Router / gateway');
  assert.equal(identify({ ...base, vendor: 'Belkin International Inc.', hostname: 'Linksys21610' }).kind, 'network');
  assert.equal(identify({ ...base, hostname: 'tl-wr802n.home' }).kind, 'network');
});
