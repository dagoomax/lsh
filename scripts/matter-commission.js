#!/usr/bin/env node
/**
 * One-time interactive commissioning of a Matter device onto LSH's own
 * Matter controller fabric (src/matter-client.js).
 *
 * Matter's multi-fabric/multi-admin model means a device already paired to
 * Apple Home, Google Home, etc. can also be commissioned onto LSH — each
 * ecosystem gets its own independent fabric on the device, none of them
 * exclusive. A Thread device works the same way here: as long as it has
 * already joined a Thread mesh via its own Border Router (Apple TV/HomePod
 * mini, a Google/eero one, …), it's reachable over IP like any Wi-Fi/
 * Ethernet Matter device — this script/LSH's controller never needs to talk
 * Thread radio directly.
 *
 * You need the device's pairing code — either the 11-digit manual code
 * printed on the device/box, or the numeric payload from its QR code (the
 * "MT:..." string, or just re-type the 11 digits if that's all you have).
 *
 * Usage:
 *   node scripts/matter-commission.js <pairing-code>
 *   node scripts/matter-commission.js            (prompts interactively)
 *
 * Saves commissioning state under persist/matter/controller/ — from then on
 * src/matter-client.js reconnects to this device automatically on every LSH
 * start, no need to re-run this script unless the device is factory-reset.
 */
const readline = require('readline');
require('../src/matter-storage');
const { Environment, Logger, LogLevel } = require('@matter/main');
Logger.level = LogLevel.INFO; // this script wants to see what's happening, unlike the quieter server-embedded default
const { CommissioningController } = require('@project-chip/matter.js');
const { GeneralCommissioning } = require('@matter/main/clusters');
const { ManualPairingCodeCodec } = require('@matter/main/types');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

async function main() {
  let code = process.argv[2];
  if (!code) code = await prompt('Enter the device\'s 11-digit manual pairing code (or paste its QR data starting "MT:"): ');
  if (!code) { console.error('No pairing code given.'); process.exit(1); }

  let passcode, longDiscriminator, shortDiscriminator;
  if (/^MT:/i.test(code)) {
    // QR data carries the discriminator+passcode more precisely than the
    // manual code alone (which only has a short discriminator); matter.js's
    // own examples decode this via the manual-code path when a manual code
    // is given, so keep this script simple and just ask for the manual code
    // instead if a QR string was pasted — most devices print both anyway.
    console.error('QR data pasted — please re-run with the 11-digit manual pairing code instead (printed under the QR code on the device/box).');
    process.exit(1);
  } else {
    const decoded = ManualPairingCodeCodec.decode(code.replace(/[\s-]/g, ''));
    passcode = decoded.passcode;
    shortDiscriminator = decoded.shortDiscriminator;
  }

  const controller = new CommissioningController({
    environment: { environment: Environment.default, id: 'controller' },
    autoConnect: false,
    adminFabricLabel: 'LSH',
  });
  await controller.start();

  console.log('Discovering and commissioning device on the local network…');
  const nodeId = await controller.commissionNode({
    commissioning: {
      regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
      regulatoryCountryCode: 'XX',
    },
    discovery: {
      identifierData: shortDiscriminator !== undefined ? { shortDiscriminator } : {},
      discoveryCapabilities: { ble: false }, // on-IP commissioning only — see README.md's Matter section for why
    },
    passcode,
  });

  console.log(`\nCommissioned successfully — node ID ${nodeId}.`);
  console.log('Restart LSH (or start it if it isn\'t running) to pick up the new device.');

  await controller.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Commissioning failed:', err.message);
  console.error('Common causes: wrong/expired pairing code, device not in pairing mode, or it needs BLE commissioning (this script only supports devices already reachable on the local IP network — see the "Matter controller" section of README.md).');
  process.exit(1);
});
