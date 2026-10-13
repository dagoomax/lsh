'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const EventEmitter = require('events');

process.env.LSH_TTS_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-tts-'));
const Announcer = require('../src/announcer');
const { splitText, parseSayVoices, inQuietHours, fill } = Announcer;
const hasFfmpeg = spawnSync('which', ['ffmpeg']).status === 0;

const fakeStore = () => Object.assign(new EventEmitter(), { values: {}, update(k, v) { this.values[k] = v; this.emit('change', { key: k, value: v }) }, set(k, v) { this.update(k, v) } });
const fakeRegistry = (extra = []) => {
  const devices = new Map(extra.map((d) => [d.key, d]));
  return {
    devices, registerDevice: (d) => devices.set(d.key, d), getDevices: () => [...devices.values()],
    async sendCommand(key, p, value) {
      const d = devices.get(key), s = d.sensors.find((x) => x.path === p);
      return s.type === 'range' ? d._writeCapability(s.capabilityId, s.writeCmd, [value]) : d._writeCapability(s.capabilityId, s.writeOn);
    },
  };
};
// Records plays; "homepod" behaves like a HomePod with restricted access
function fakePlayer() {
  const plays = [];
  return {
    plays,
    getSpeakers: () => [{ id: 'kitchen', name: 'Kitchen' }, { id: 'living', name: 'Living room' }, { id: 'homepod', name: 'HomePod' }],
    async play(id, file, opts) {
      if (id === 'homepod') throw new Error('"HomePod" requires one-time device pairing');
      plays.push({ id, file, opts, start: Date.now() });
      await new Promise((r) => setTimeout(r, 30));
      plays[plays.length - 1].end = Date.now();
    },
  };
}

test('helpers: text split for Google, macOS voices, quiet hours, templates', () => {
  const long = 'Alarm w garażu. ' + 'Bardzo długie zdanie '.repeat(20) + 'koniec!';
  const parts = splitText(long);
  assert.ok(parts.every((p) => p.length <= 190));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.trim().replace(/\s+/g, ' '));
  assert.deepEqual(parseSayVoices('Zosia               pl_PL    # Witaj\nEddy (Angielski (Wlk. Bryt.)) en_GB    # Hello\n'), [{ name: 'Zosia', locale: 'pl_PL' }, { name: 'Eddy (Angielski (Wlk. Bryt.))', locale: 'en_GB' }]);
  const at = (h, m) => new Date(2026, 9, 13, h, m);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(23, 30)), true);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(6, 59)), true);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(12, 0)), false);
  assert.equal(inQuietHours({ from: '13:00', to: '15:00' }, at(14, 0)), true);
  assert.equal(inQuietHours(undefined, at(3, 0)), false);
  assert.equal(fill('Basen ma {v} stopni, {x}', { v: 27.456 }), 'Basen ma 27.5 stopni, {x}');
});

test('announcements: Loxone message device, {v} values, rules, queue per speaker, quiet hours, HomePod error', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const synths = [];
  const synth = async (text) => {
    synths.push(text);
    const f = path.join(os.tmpdir(), `lsh-tts-test-${synths.length}.wav`);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', f]);
    return f;
  };
  const player = fakePlayer();
  const store = fakeStore();
  const loxDoor = { key: 'loxone/door', type: 'loxone', label: 'Front door', sensors: [{ path: 'open', label: 'Open' }, { path: 'alarm', label: 'Alarm' }] };
  const registry = fakeRegistry([loxDoor]);
  const a = new Announcer({ announce: {
    enabled: true, speakers: ['kitchen'], volume: 40, lang: 'pl',
    messages: [{ id: 'doorbell', label: 'Doorbell', text: 'Ktoś dzwoni do drzwi' }, { id: 'pool', text: 'Basen ma {v} stopni', speakers: ['living'], volume: 70 }],
    rules: [{ id: 'door', deviceKey: 'loxone/door', path: 'open', when: 'on', text: '{device}: otwarte' }, { id: 'al', deviceKey: 'loxone/door', path: 'alarm', when: 'equals', value: '2', text: 'Alarm!', speakers: ['kitchen', 'living'], urgent: true }],
  } }, store, registry, { player, synth });
  await a.start();
  a.waitForCommands = true; // the test waits for each spoken message

  // The device Loxone's Virtual Output export is built from
  const dev = registry.devices.get('announce/lsh');
  assert.deepEqual(dev.sensors.map((s) => [s.path, s.type || 'label']), [['speaking', 'label'], ['last', 'label'], ['msg_doorbell', 'trigger'], ['msg_pool', 'range']]);
  const { buildOutputsXml } = require('../src/loxone-xml');
  const xml = buildOutputsXml([dev], { host: 'lsh:3000', token: 'T' }).join('');
  assert.match(xml, /announce%2Flsh\/set\?sensor=msg_doorbell&amp;value=1&amp;token=T/);
  assert.match(xml, /sensor=msg_pool&amp;value=&lt;v&gt;/);

  await registry.sendCommand('announce/lsh', 'msg_doorbell', 1);
  assert.equal(player.plays.at(-1).id, 'kitchen');
  assert.deepEqual(player.plays.at(-1).opts, { volume: 40 });
  assert.equal(store.values['announce/lsh/last'], 'Ktoś dzwoni do drzwi');
  await registry.sendCommand('announce/lsh', 'msg_pool', 27.4);
  assert.equal(synths.at(-1), 'Basen ma 27.4 stopni');
  assert.deepEqual([player.plays.at(-1).id, player.plays.at(-1).opts.volume], ['living', 70]);

  // Same text again → cached clip, no new synthesis
  const n = synths.length;
  await a.say('Ktoś dzwoni do drzwi');
  assert.equal(synths.length, n);

  // Rules: rising edge only; equals with urgent to two speakers
  store.update('loxone/door/open', 0);
  store.update('loxone/door/open', 1);
  store.update('loxone/door/open', 1);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(synths.filter((t) => t === 'Front door: otwarte').length, 1);
  store.update('loxone/door/alarm', 2);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(player.plays.slice(-2).map((p) => p.id).sort(), ['kitchen', 'living']);

  // Two announcements to one speaker never overlap
  player.plays.length = 0;
  await Promise.all([a.say('Pierwszy', { speakers: ['kitchen'] }), a.say('Drugi', { speakers: ['kitchen'] })]);
  assert.ok(player.plays[1].start >= player.plays[0].end);

  // HomePod that refuses → reported, the other speaker still plays
  const e = await a.say('Test', { speakers: ['homepod', 'kitchen'] });
  assert.equal(e.status, 'partly played');
  assert.match(e.results.homepod, /pairing/);
  await assert.rejects(a.say('Test', { speakers: ['homepod'] }), /pairing/);

  // Quiet hours: skipped unless urgent
  a.cfg.quietHours = { from: '00:00', to: '23:59' };
  player.plays.length = 0;
  assert.equal((await a.say('Cicho')).status, 'skipped (quiet hours)');
  assert.equal((await a.say('Pilne', { urgent: true })).status, 'played');
  assert.equal(player.plays.length, 1);
  await assert.rejects(a.say('   '), /Nothing to say/);
  a.stop();
});

test('the real clip: chime + local speech as one 44.1 kHz stereo WAV', { skip: (!hasFfmpeg || process.platform !== 'darwin') && 'needs macOS say + ffmpeg' }, async () => {
  const a = new Announcer({ announce: { lang: 'en', engine: 'say' } }, fakeStore(), fakeRegistry(), { player: fakePlayer() });
  const file = await a.clip('Front door is open', true);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(probe.stdout);
  assert.equal(j.streams[0].sample_rate, '44100');
  assert.equal(j.streams[0].channels, 2);
  assert.ok(Number(j.format.duration) > 1.2, `duration ${j.format.duration}`);
});
