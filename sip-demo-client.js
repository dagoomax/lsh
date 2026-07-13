#!/usr/bin/env node
'use strict';

/**
 * SIP Demo Client — send raw SIP INVITE to test LSH doorbell
 *
 * Usage:
 *   node sip-demo-client.js [lsh-host] [lsh-port] [extension]
 *
 * Example:
 *   node sip-demo-client.js 192.168.1.229 5060 doorbell
 */

const dgram = require('dgram');
const os = require('os');

function localIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

const lshHost = process.argv[2] || '192.168.1.229';
const lshPort = parseInt(process.argv[3] || '5060');
const extension = process.argv[4] || 'doorbell';
const localIp = localIPv4();
const localPort = 15060; // use a specific local port for responses
const callId = `demo-${Date.now()}@${localIp}`;
const tag = `tag-${Date.now()}`;

console.log(`[Demo] Calling LSH SIP server at ${lshHost}:${lshPort}`);
console.log(`[Demo] Local address: ${localIp}:${localPort}`);
console.log(`[Demo] Extension: ${extension}\n`);

// Create SIP INVITE with correct local port
const invite = `INVITE sip:${extension}@${lshHost}:${lshPort} SIP/2.0
Via: SIP/2.0/UDP ${localIp}:${localPort};branch=z9hG4bK${Date.now()}
Max-Forwards: 70
To: <sip:${extension}@${lshHost}>
From: Demo Client <sip:demo@${localIp}>;tag=${tag}
Call-ID: ${callId}
CSeq: 1 INVITE
Contact: <sip:demo@${localIp}:${localPort}>
User-Agent: LSH-Demo-Client/1.0
Content-Type: application/sdp
Content-Length: 0

`;

const client = dgram.createSocket('udp4');
let responseReceived = false;

client.on('message', (msg, rinfo) => {
  const response = msg.toString();
  const lines = response.split('\r\n');
  const status = lines[0];
  console.log(`[Response] ${status}`);

  if (status.includes('180')) {
    console.log('  → 📞 Ringing!\n');
    responseReceived = true;
  } else if (status.includes('200')) {
    console.log('  → ✅ Answered!\n');
    console.log('Call established. Hanging up in 2 seconds...\n');
    responseReceived = true;
  } else if (status.includes('487')) {
    console.log('  → Request terminated\n');
    responseReceived = true;
  } else if (status.includes('100')) {
    console.log('  → Trying...');
  }
});

client.on('error', (err) => {
  console.error('[Error]', err.message);
  process.exit(1);
});

// Bind to local port first
client.bind(localPort, localIp, () => {
  console.log('[Demo] Sending INVITE...\n');

  client.send(Buffer.from(invite), lshPort, lshHost, (err) => {
    if (err) {
      console.error('[Error] Failed to send:', err.message);
      client.close();
      process.exit(1);
    }
    console.log(`[Demo] INVITE sent to sip:${extension}@${lshHost}:${lshPort}\n`);

    // Auto-hangup after 5 seconds
    setTimeout(() => {
      if (!responseReceived) {
        console.log('[Demo] No response (timeout)');
      }
      console.log('[Demo] Closing connection');
      client.close();
      process.exit(0);
    }, 5000);
  });
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n[Demo] Interrupted');
  client.close();
  process.exit(0);
});
