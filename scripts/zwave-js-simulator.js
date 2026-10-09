#!/usr/bin/env node
'use strict';

// Minimal Z-Wave JS Server stand-in for testing src/zwave-js-client.js and
// the wiring emulator's Pair & save: version handshake, set_api_schema,
// start_listening, node.set_value / node.get_state, and controller inclusion
// (S2 with security-class grant + DSK PIN, or insecure) / exclusion. A
// "device" presses its button by itself shortly after inclusion starts.
//
//   node scripts/zwave-js-simulator.js [port=3000]
//
// From tests: const sim = await startSimulator({ port: 0 }).
// The joining device is a FIBARO-like single switch; its DSK PIN is 12345.

const WebSocket = require('ws');

const HOME_ID = 0xe1a2b3c4;
const PIN = '12345';
const DSK = '12345-23456-34567-45678-56789-01234-12345-23456';

function switchNode(nodeId, name) {
  return {
    nodeId, name, isControllerNode: false, status: 4, ready: true,
    manufacturerId: 0x010f, productType: 0x0403, productId: 0x1000, firmwareVersion: '5.1',
    deviceConfig: { manufacturer: 'Fibargroup', label: 'FGS213', description: 'Single Switch 2' },
    highestSecurityClass: 1, dsk: DSK,
    values: [
      { commandClass: 37, endpoint: 0, property: 'currentValue', propertyName: 'currentValue', value: false, metadata: { type: 'boolean', readable: true, writeable: false, label: 'Current value' } },
      { commandClass: 37, endpoint: 0, property: 'targetValue', propertyName: 'targetValue', value: false, metadata: { type: 'boolean', readable: true, writeable: true, label: 'Target value' } },
    ],
  };
}

function startSimulator({ port = 3000, pressAfterMs = 150, pin = PIN } = {}) {
  const nodes = new Map([[1, { nodeId: 1, isControllerNode: true, values: [] }], [2, switchNode(2, 'Hall light')]]);
  let nextId = 3, mode = null, pending = null;
  const calls = [];
  const wss = new WebSocket.Server({ port, host: '127.0.0.1' });

  wss.on('connection', (ws) => {
    const send = (m) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
    const event = (e) => send({ type: 'event', event: { source: 'controller', ...e } });
    const result = (messageId, r = {}, success = true) => send({ type: 'result', messageId, success, ...(success ? { result: r } : { errorCode: r }) });
    send({ type: 'version', driverVersion: '14.0.0', serverVersion: '1.40.0', homeId: HOME_ID, minSchemaVersion: 0, maxSchemaVersion: 40 });

    const join = (secure) => {
      const n = switchNode(nextId++, '');
      if (!secure) n.highestSecurityClass = -1;
      nodes.set(n.nodeId, n);
      mode = null;
      event({ event: 'inclusion stopped' });
      event({ event: 'node added', node: { nodeId: n.nodeId, status: 0, ready: false }, result: { lowSecurity: !secure } });
      setTimeout(() => send({ type: 'event', event: { source: 'node', event: 'interview completed', nodeId: n.nodeId } }), 50);
    };

    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw) } catch { return }
      calls.push(m);
      const id = m.messageId;
      switch (m.command) {
        case 'set_api_schema': return result(id);
        case 'start_listening': return result(id, { state: { controller: { homeId: HOME_ID }, nodes: [...nodes.values()] } });
        case 'node.get_state': { const n = nodes.get(m.nodeId); return n ? result(id, { state: n }) : result(id, 'node_not_found', false) }
        case 'node.set_value': return result(id, { success: true });
        case 'controller.begin_inclusion': {
          if (mode) return result(id, { success: false });
          mode = 'include';
          const secure = (m.options?.strategy ?? 0) !== 2;
          result(id, { success: true });
          event({ event: 'inclusion started', secure });
          pending = setTimeout(() => {
            if (!secure) return join(false);
            event({ event: 'grant security classes', requested: { securityClasses: [1, 2], clientSideAuth: false } });
          }, pressAfterMs);
          return;
        }
        case 'controller.grant_security_classes':
          result(id);
          return setTimeout(() => event({ event: 'validate dsk and enter pin', dsk: `-----${DSK.slice(5)}` }), 20);
        case 'controller.validate_dsk_and_enter_pin':
          result(id);
          if (m.pin === pin) return setTimeout(() => join(true), 20);
          mode = null;
          return event({ event: 'inclusion failed' });
        case 'controller.stop_inclusion':
          clearTimeout(pending); mode = null; result(id, { success: true });
          return event({ event: 'inclusion stopped' });
        case 'controller.begin_exclusion': {
          mode = 'exclude'; result(id, { success: true });
          event({ event: 'exclusion started' });
          pending = setTimeout(() => {
            const last = [...nodes.keys()].filter((k) => k !== 1).pop();
            if (last) { nodes.delete(last); event({ event: 'node removed', node: { nodeId: last }, reason: 0 }) }
            mode = null; event({ event: 'exclusion stopped' });
          }, pressAfterMs);
          return;
        }
        case 'controller.stop_exclusion':
          clearTimeout(pending); mode = null; result(id, { success: true });
          return event({ event: 'exclusion stopped' });
        default: return result(id, 'unknown_command', false);
      }
    });
  });

  return new Promise((resolve) => wss.on('listening', () => resolve({
    port: wss.address().port, nodes, calls, homeId: HOME_ID, pin,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); clearTimeout(pending); wss.close(() => r()) }),
  })));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 3000;
  startSimulator({ port, pressAfterMs: 3000 }).then((s) => console.log(`Z-Wave JS simulator on ws://127.0.0.1:${s.port} — joining device's DSK PIN: ${s.pin}`));
}

module.exports = { startSimulator };
