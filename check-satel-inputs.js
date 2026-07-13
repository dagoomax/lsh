#!/usr/bin/env node
'use strict';

/**
 * Check all Satel INTEGRA system inputs
 * Connects directly to the panel and queries input states
 */

const net = require('net');

const HOST = process.argv[2] || '192.168.1.179';
const PORT = parseInt(process.argv[3] || '7096');

console.log(`[Satel] Connecting to ${HOST}:${PORT}...\n`);

function crc16(data) {
  let crc = 0x147A;
  for (const b of data) {
    crc = ((crc << 1) & 0xFFFF) | (crc >> 15);
    crc ^= 0xFFFF;
    crc = (crc + (crc >> 8) + b) & 0xFFFF;
  }
  return crc;
}

function escapeFE(buf) {
  const out = [];
  for (const b of buf) {
    out.push(b);
    if (b === 0xFE) out.push(0xFD);
  }
  return Buffer.from(out);
}

function buildFrame(payload) {
  const c = crc16(payload);
  const full = Buffer.concat([payload, Buffer.from([c >> 8, c & 0xFF])]);
  return Buffer.concat([Buffer.from([0xFE, 0xFE]), escapeFE(full), Buffer.from([0xFE, 0x0D])]);
}

function unescapeFE(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0xFE && i + 1 < buf.length && buf[i + 1] === 0xFD) {
      out.push(0xFE);
      i++;
    } else {
      out.push(buf[i]);
    }
  }
  return Buffer.from(out);
}

function getBit(data, num) {
  if (!data) return false;
  const b = Math.floor((num - 1) / 8);
  const bit = (num - 1) % 8;
  return data[b] != null && !!(data[b] & (1 << bit));
}

const socket = net.createConnection(PORT, HOST);
let rxBuf = Buffer.alloc(0);
let inputData = null;
const CMD_INPUTS_STATE = 0x15;

socket.setTimeout(5000);

socket.on('data', (chunk) => {
  rxBuf = Buffer.concat([rxBuf, chunk]);

  let i = 0;
  while (i < rxBuf.length - 1) {
    if (rxBuf[i] !== 0xFE || rxBuf[i + 1] !== 0xFE) {
      i++;
      continue;
    }

    let j = i + 2;
    while (j < rxBuf.length - 1) {
      if (rxBuf[j] === 0xFE && rxBuf[j + 1] === 0x0D) break;
      if (rxBuf[j] === 0xFE && j + 1 < rxBuf.length) j += 2;
      else j++;
    }

    if (j >= rxBuf.length - 1) break;

    const raw = unescapeFE(rxBuf.slice(i + 2, j));
    if (raw.length >= 3) {
      const payload = raw.slice(0, -2);
      const recv = (raw[raw.length - 2] << 8) | raw[raw.length - 1];

      if (crc16(payload) === recv && payload[0] === CMD_INPUTS_STATE) {
        inputData = payload.slice(1);
        console.log('[Satel] Received input states\n');
        displayInputs();
        socket.destroy();
      }
    }
    i = j + 2;
  }
  rxBuf = rxBuf.slice(i);
});

socket.on('connect', () => {
  console.log('[Satel] Connected\n');
  const frame = buildFrame(Buffer.from([CMD_INPUTS_STATE]));
  socket.write(frame);
  console.log('[Satel] Querying all inputs...\n');
});

socket.on('error', (err) => {
  console.error(`[Error] ${err.message}`);
  process.exit(1);
});

socket.on('timeout', () => {
  console.error('[Error] Connection timeout');
  socket.destroy();
  process.exit(1);
});

function displayInputs() {
  if (!inputData) {
    console.log('No input data received');
    return;
  }

  const labels = {
    1: 'Zone 1 Fault',
    2: 'Zone 2 Fault',
    3: 'Zone 3 Fault',
    4: 'Zone 4 Fault',
    5: 'Zone 5 Fault',
    6: 'Zone 6 Fault',
    7: 'Zone 7 Fault',
    8: 'Battery Status',
    9: 'AC Power',
    10: 'Tamper Alert',
    11: 'Watchdog',
    12: 'GSM Module',
    13: 'Temperature Sensor',
    14: 'Ethernet Connection',
    15: 'GPS Status',
    16: 'System Alarm',
  };

  console.log('═══════════════════════════════════════════════════════════');
  console.log('SATEL INTEGRA SYSTEM INPUTS STATUS');
  console.log('═══════════════════════════════════════════════════════════\n');

  let activeCount = 0;
  let inactiveCount = 0;

  for (let n = 1; n <= 128; n++) {
    const state = getBit(inputData, n) ? 1 : 0;
    const label = labels[n] || `Input ${n}`;
    const status = state ? '✓ ACTIVE' : '✗ Inactive';
    const statusColor = state ? '\x1b[32m' : '\x1b[90m'; // Green or Gray

    console.log(`${statusColor}  Input ${String(n).padStart(3)}:${'\x1b[0m'} ${label.padEnd(30)} ${status}`);

    if (state) activeCount++;
    else if (n <= 16) inactiveCount++; // Only count documented inputs as inactive
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`Total Monitored: ${activeCount} active\n`);

  console.log('Key Inputs (8, 9, 12, 13):');
  console.log(`  8  - Battery:   ${getBit(inputData, 8) ? '✓ OK' : '✗ LOW'}`);
  console.log(`  9  - AC Mains:  ${getBit(inputData, 9) ? '✓ OK' : '✗ FAIL'}`);
  console.log(`  12 - GSM:       ${getBit(inputData, 12) ? '✓ CONNECTED' : '✗ DISCONNECTED'}`);
  console.log(`  13 - Temp:      ${getBit(inputData, 13) ? '✓ NORMAL' : '✗ HIGH'}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}
