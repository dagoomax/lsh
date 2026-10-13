/**
 * Generates the HomeKit setup URI used in QR codes.
 *
 * Format:  X-HM://{9-char base36 payload}{4-char setupID}
 *
 * Payload bits (HAP spec §5.7.3, same as hap-nodejs Accessory.setupURI):
 *   bits 38-31  category   (8 bits)  — BRIDGE = 2
 *   bits 30-27  flags      (4 bits)  — bit 28 = IP support
 *   bits 26-0   setup code (27 bits) — 8-digit PIN without dashes
 * (The category used to sit one bit too high, so iOS read BRIDGE (2) as
 * GARAGE_DOOR_OPENER (4) and showed the bridge as a garage door when pairing.)
 */
function generateSetupUri(pin, setupID, category = 2) {
  const setupCode = parseInt(pin.replace(/-/g, ''), 10);

  if (isNaN(setupCode)) throw new Error('Invalid PIN: ' + pin);

  const FLAG_IP = 1n << 28n; // HAP over IP
  const value = (BigInt(category) << 31n) | FLAG_IP | BigInt(setupCode);
  const encoded = value.toString(36).toUpperCase().padStart(9, '0');

  return `X-HM://${encoded}${setupID}`;
}

/**
 * Generate a random 4-character uppercase alphanumeric setup ID.
 */
function generateSetupID() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

module.exports = { generateSetupUri, generateSetupID };
