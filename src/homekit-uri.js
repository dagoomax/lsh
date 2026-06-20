/**
 * Generates the HomeKit setup URI used in QR codes.
 *
 * Format:  X-HM://{9-char base36 payload}{4-char setupID}
 *
 * Payload bits (HAP spec §5.7.3):
 *   bits 44-40  category   (5 bits)  — BRIDGE = 2
 *   bits 39-36  flags      (4 bits)  — bit 38 = IP support
 *   bits 35-0   setup code (27 bits) — 8-digit PIN without dashes
 */
function generateSetupUri(pin, setupID, category = 2) {
  const setupCode = parseInt(pin.replace(/-/g, ''), 10);

  if (isNaN(setupCode)) throw new Error('Invalid PIN: ' + pin);

  const FLAG_IP = 1 << 28; // HAP over IP

  // Low 32 bits: setup code | IP flag
  const valueLow = (setupCode | FLAG_IP) >>> 0;
  // High 32 bits: category
  const valueHigh = category >>> 0;

  // Combine into 64-bit BigInt, encode as uppercase base36, pad to 9 chars
  const bigVal = (BigInt(valueHigh) << 32n) | BigInt(valueLow);
  const encoded = bigVal.toString(36).toUpperCase().padStart(9, '0');

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
