'use strict';

// WS-Discovery — finds ONVIF devices on the local network without needing to
// know their IPs up front. Sends a multicast Probe and collects ProbeMatches
// for a few seconds. No dependencies (raw UDP + a couple of regexes, not a
// full SOAP/XML stack — WS-Discovery responses are simple enough not to need
// one).

const dgram    = require('dgram');
const crypto   = require('crypto');

const MULTICAST_ADDR = '239.255.255.250';
const MULTICAST_PORT = 3702;

function probeMessage() {
  const messageId = `uuid:${crypto.randomUUID()}`;
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" ` +
    `xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" ` +
    `xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ` +
    `xmlns:dn="http://www.onvif.org/ver10/network/wsdl">` +
    `<e:Header>` +
    `<w:MessageID>${messageId}</w:MessageID>` +
    `<w:To e:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>` +
    `<w:Action e:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>` +
    `</e:Header>` +
    `<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>` +
    `</e:Envelope>`;
}

// Resolves after `timeoutMs` with every distinct ONVIF device that answered.
function discover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found  = new Map(); // host → { host, port, xaddr }
    const socket = dgram.createSocket('udp4');

    socket.on('message', (msg) => {
      const text = msg.toString('utf8');
      if (!/ProbeMatch/i.test(text)) return;
      // A device can list several XAddrs (one per NIC/scope) — take the first.
      const xaddr = text.match(/<[^>]*XAddrs[^>]*>([^<]+)</)?.[1]?.trim().split(/\s+/)[0];
      if (!xaddr) return;
      try {
        const u = new URL(xaddr);
        if (!found.has(u.hostname)) {
          found.set(u.hostname, {
            host: u.hostname,
            port: u.port ? Number(u.port) : 80,
            xaddr,
          });
        }
      } catch { /* malformed XAddrs — skip */ }
    });

    socket.on('error', () => {}); // surfaced as "found nothing" — discovery is best-effort

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(4);
        const msg = Buffer.from(probeMessage());
        socket.send(msg, MULTICAST_PORT, MULTICAST_ADDR);
      } catch { /* fall through to the timeout with whatever (nothing) we have */ }
    });

    setTimeout(() => {
      try { socket.close(); } catch { /* already closed */ }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

module.exports = { discover };
