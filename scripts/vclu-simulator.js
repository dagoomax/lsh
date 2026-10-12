#!/usr/bin/env node
'use strict';

// Minimal vCLU stand-in for testing src/vclu-client.js: the MCP endpoint
// POST /mcp (stateless streamable HTTP, JSON-RPC) with vCLU's tools
// vclu_devices, vclu_device_get, vclu_device_set, vclu_device_execute,
// vclu_scenes, vclu_scene_execute. Bot token "simbot" (Bearer). Tool results
// are JSON text content, like vCLU's toolJSON(); device shapes follow
// pkg/mcp/types.go and value ranges ExposedObjects.lua (dimmer 0..1, cover
// 0..100). `sse: true` answers as a one-event SSE stream instead of JSON.
//
//   node scripts/vclu-simulator.js [port=8891]
// then config.vclu = { host: '127.0.0.1:8891', token: 'simbot' }

const http = require('http');

function startSimulator({ port = 8891, sse = false } = {}) {
  const calls = [];
  const sim = { sse, executed: [] };
  const devices = [
    { path: 'CLU220000592.DOU4992', type: 'light', name: 'Wiatrołap światło', state: 0, readonly: false, methods: ['switchOn', 'switchOff', 'toggle', 'getValue'], area: 'Wiatrołap' },
    { path: 'CLU220000592.DIM1201', type: 'dimmer', name: 'Salon kinkiety', state: 0.5, readonly: false, methods: ['setBrightness', 'getBrightness', 'switchOn', 'switchOff'], area: 'Salon' },
    { path: 'CLU220000592.DOU5048', type: 'switch', name: 'Gniazdko taras', state: 1, readonly: false, methods: ['toggle', 'switchOn', 'switchOff'], area: 'Taras' },
    { path: 'CLU220000592.ROL0301', type: 'cover', name: 'Roleta salon', state: 100, readonly: false, methods: ['stop', 'execute'], area: 'Salon' },
    { path: 'satel.zone.2', type: 'motion', name: 'Ruch wiatrołap', state: 0, readonly: true, methods: [], area: 'Wiatrołap' },
    { path: 'plugin:weather.temp', type: 'temperature', name: 'Temperatura zewn.', state: 7.4, readonly: true, methods: [] },
    { path: 'CLU220000592.DOU6000', type: 'switch', name: 'Pompa (tylko odczyt)', state: 0, readonly: true, methods: ['toggle'] },
    { path: 'vclu:frontlock', type: 'lock', name: 'Drzwi wejściowe', state: 1, readonly: false, methods: [], area: 'Wiatrołap' },
  ];
  const scenes = [{ path: 'scene:film', name: 'Film' }, { path: 'scene:dobranoc', name: 'Dobranoc' }];
  const find = (p) => devices.find((d) => d.path === p);

  function callTool(name, a = {}) {
    switch (name) {
      case 'vclu_devices': return { devices: a.type ? devices.filter((d) => d.type === a.type) : devices };
      case 'vclu_device_get': { const d = find(a.path); if (!d) throw new Error(`device not found: ${a.path}`); return d }
      case 'vclu_device_set': {
        const d = find(a.path);
        if (!d) throw new Error(`device not found: ${a.path}`);
        if (d.readonly) throw new Error(`device is readonly: ${a.path}`);
        d.state = Number(a.value);
        return { ok: true, new_state: d.state };
      }
      case 'vclu_device_execute': {
        const d = find(a.path);
        if (!d) throw new Error(`device not found: ${a.path}`);
        if (!d.methods.includes(a.method)) throw new Error(`method not found: ${a.method}`);
        sim.executed.push([a.path, a.method, a.args || []]);
        if (a.method === 'switchOn') d.state = d.type === 'dimmer' ? 1 : 1;
        if (a.method === 'switchOff') d.state = 0;
        if (a.method === 'setBrightness') d.state = Number(a.args?.[0]) / 100;
        return { ok: true, result: null };
      }
      case 'vclu_scenes': return { scenes };
      case 'vclu_scene_execute': {
        if (!scenes.some((s) => s.path === a.path)) throw new Error(`scene not found: ${a.path}`);
        sim.executed.push([a.path, 'scene', []]); return { ok: true };
      }
      default: throw Object.assign(new Error(`unknown tool ${name}`), { rpc: -32602 });
    }
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      if (req.url !== '/mcp' || req.method !== 'POST') { res.writeHead(404); return res.end() }
      if (req.headers.authorization !== 'Bearer simbot') { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Unauthorized') }
      let msg; try { msg = JSON.parse(body) } catch { res.writeHead(400); return res.end() }
      calls.push(msg);
      let reply;
      if (msg.method === 'initialize') reply = { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'vclu-sim', version: '1' } } };
      else if (msg.method === 'tools/call') {
        try {
          reply = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(callTool(msg.params?.name, msg.params?.arguments)) }] } };
        } catch (err) {
          reply = err.rpc ? { jsonrpc: '2.0', id: msg.id, error: { code: err.rpc, message: err.message } }
            : { jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: err.message }] } };
        }
      } else reply = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
      if (sim.sse) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`) }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(Object.assign(sim, {
    port: server.address().port, calls, devices, close: () => new Promise((r) => server.close(r)),
  }))));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8891;
  startSimulator({ port }).then((s) => console.log(`vCLU simulator on http://127.0.0.1:${s.port}/mcp (token "simbot")`));
}

module.exports = { startSimulator };
