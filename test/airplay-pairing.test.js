'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.LSH_AIRPLAY_PAIRINGS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-ap-')), 'pairings.json');
const AirplayClient = require('../src/airplay-client');
const pairing = require('../src/airplay-pairing');
const { startSimulator } = require('../scripts/airplay-pin-simulator');
const hasFfmpeg = spawnSync('which', ['ffmpeg']).status === 0;

test('Apple TV PIN: pair once (wrong PIN rejected), then verify with the saved pairing — no PIN', { skip: !hasFfmpeg && 'needs ffmpeg', timeout: 60000 }, async () => {
  const sim = await startSimulator({ port: 0, pin: '4821' });
  const client = new AirplayClient({ airplay: { speakers: [{ id: 'tv', name: 'Salon TV', host: '127.0.0.1', port: sim.port }] } });
  client._lookupFlags = async () => 1 << 9; // one-time pairing required, like an Apple TV
  try {
    // Not paired: playback explains what to do instead of hanging
    const clip = path.join(os.tmpdir(), 'lsh-ap-test.wav');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', clip]);
    await assert.rejects(client.play('tv', clip), /asks for a PIN — pair it once/);
    assert.equal((await client.access('tv')).pin, true);

    // Wrong PIN
    let st = await client.startPairing('tv');
    assert.equal(st.phase, 'pin');
    assert.equal(sim.stats.pinStarts, 1);
    st = await client.submitPin('tv', '1111');
    assert.equal(st.phase, 'failed');
    assert.equal(pairing.get('tv'), null);

    // Right PIN → saved
    st = await client.startPairing('tv');
    assert.equal(st.phase, 'pin');
    st = await client.submitPin('tv', '4821');
    assert.equal(st.phase, 'paired', JSON.stringify(st));
    const saved = pairing.get('tv');
    assert.ok(saved?.pairingId && saved.privateKey.length === 64);
    assert.equal(sim.stats.setups, 1);
    assert.equal((fs.statSync(process.env.LSH_AIRPLAY_PAIRINGS).mode & 0o777).toString(8), '600');
    assert.equal(client.getSpeakers()[0].paired, true);

    // Next session: straight to pair-verify with the saved identity, accepted
    const pinStarts = sim.stats.pinStarts, setups = sim.stats.setups, ok = sim.stats.verifiedOk;
    await client.play('tv', clip); // the fake TV accepts the session (it ignores the audio)
    assert.equal(sim.stats.pinStarts, pinStarts, 'no PIN asked');
    assert.equal(sim.stats.setups, setups, 'no new pair-setup');
    assert.equal(sim.stats.verifiedOk, ok + 1, 'saved pairing verified');

    // Pairing removed on the TV → explained
    sim.forget();
    await assert.rejects(client.play('tv', clip), /didn't accept LSH's saved pairing/);
    assert.equal(sim.stats.verifyRejected, 1);

    assert.equal(client.unpair('tv'), true);
    assert.equal(pairing.get('tv'), null);
  } finally { await sim.close() }
});

// The AirPlay library keeps its UDP timing/control sockets open after stop()
after(() => setTimeout(() => process.exit(0), 200));
