#!/usr/bin/env node
'use strict';

// LG webOS TV stand-in for testing src/lgwebos-client.js: the SSAP WebSocket
// (register with an on-screen prompt the test "accepts", then client-key
// reuse), the requests and subscriptions the client uses, and the
// pointer-input socket for remote buttons. Plain ws:// (like port 3000).
//
//   node scripts/lgwebos-simulator.js [port=3000]
// then config.lgwebos = { tvs: [{ host: '127.0.0.1', port: 3000, secure: false, name: 'Sim TV' }] }

const http = require('http');
const WebSocket = require('ws');

function startSimulator({ port = 3000, autoAccept = true } = {}) {
  const sim = {
    keys: new Set(), calls: [], buttons: [], toasts: [],
    state: { volume: 12, muted: false, app: 'com.webos.app.livetv', power: 'Active', channel: { channelNumber: '1', channelName: 'TVP1' } },
    pending: null, // a register waiting for "accept"
  };
  const apps = [{ id: 'netflix', title: 'Netflix' }, { id: 'youtube.leanback.v4', title: 'YouTube' }, { id: 'com.webos.app.livetv', title: 'Live TV' }];
  const inputs = [{ id: 'HDMI_1', label: 'HDMI 1', appId: 'com.webos.app.hdmi1' }, { id: 'HDMI_2', label: 'PlayStation', appId: 'com.webos.app.hdmi2' }];
  const subs = new Set(); // { ws, id, uri }
  const server = http.createServer();
  const wss = new WebSocket.Server({ noServer: true });
  const pointer = new WebSocket.Server({ noServer: true });
  server.on('upgrade', (req, sock, head) => {
    if (req.url.startsWith('/pointer')) return pointer.handleUpgrade(req, sock, head, (ws) => pointer.emit('connection', ws));
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws));
  });
  pointer.on('connection', (ws) => ws.on('message', (m) => {
    const name = /name:(\w+)/.exec(String(m))?.[1];
    if (name) sim.buttons.push(name);
  }));

  const emit = (uri) => {
    for (const s of subs) {
      if (s.uri !== uri || s.ws.readyState !== WebSocket.OPEN) continue;
      s.ws.send(JSON.stringify({ type: 'response', id: s.id, payload: payloadFor(uri) }));
    }
  };
  const payloadFor = (uri) => {
    const st = sim.state;
    if (uri === 'ssap://audio/getVolume') return { returnValue: true, volumeStatus: { volume: st.volume, muteStatus: st.muted } };
    if (uri === 'ssap://com.webos.applicationManager/getForegroundAppInfo') return { returnValue: true, appId: st.app };
    if (uri === 'ssap://com.webos.service.tvpower/power/getPowerState') return { returnValue: true, state: st.power };
    return { returnValue: true };
  };

  wss.on('connection', (ws) => {
    ws.on('close', () => { for (const s of [...subs]) if (s.ws === ws) subs.delete(s) });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      const reply = (type, payload, extra = {}) => ws.send(JSON.stringify({ type, id: m.id, payload, ...extra }));
      if (m.type === 'register') {
        sim.calls.push({ type: 'register', signed: !!m.payload?.manifest?.signed, key: m.payload['client-key'] });
        if (m.payload['client-key'] && sim.keys.has(m.payload['client-key'])) return reply('registered', { 'client-key': m.payload['client-key'] });
        reply('response', { pairingType: 'PROMPT', returnValue: true });
        const accept = () => { const key = `key-${Math.random().toString(36).slice(2)}`; sim.keys.add(key); reply('registered', { 'client-key': key }) };
        if (autoAccept) setTimeout(accept, 50); else sim.pending = { accept, refuse: () => reply('error', {}, { error: '403 cancelled' }) };
        return;
      }
      if (m.type === 'subscribe') { subs.add({ ws, id: m.id, uri: m.uri }); return reply('response', payloadFor(m.uri)) }
      const uri = String(m.uri || '').replace('ssap://', '');
      const p = m.payload || {};
      sim.calls.push({ uri, payload: p });
      const st = sim.state;
      switch (uri) {
        case 'audio/getVolume': return reply('response', payloadFor(m.uri));
        case 'audio/setVolume': st.volume = p.volume; reply('response', { returnValue: true }); return emit('ssap://audio/getVolume');
        case 'audio/volumeUp': st.volume = Math.min(100, st.volume + 1); reply('response', { returnValue: true }); return emit('ssap://audio/getVolume');
        case 'audio/volumeDown': st.volume = Math.max(0, st.volume - 1); reply('response', { returnValue: true }); return emit('ssap://audio/getVolume');
        case 'audio/setMute': st.muted = !!p.mute; reply('response', { returnValue: true }); return emit('ssap://audio/getVolume');
        case 'com.webos.applicationManager/listLaunchPoints': return reply('response', { returnValue: true, launchPoints: apps });
        case 'tv/getExternalInputList': return reply('response', { returnValue: true, devices: inputs });
        case 'com.webos.applicationManager/getForegroundAppInfo': return reply('response', payloadFor(m.uri));
        case 'system.launcher/launch': st.app = p.id; reply('response', { returnValue: true }); return emit('ssap://com.webos.applicationManager/getForegroundAppInfo');
        case 'tv/switchInput': st.app = (inputs.find((d) => d.id === p.inputId) || {}).appId; reply('response', { returnValue: true }); return emit('ssap://com.webos.applicationManager/getForegroundAppInfo');
        case 'tv/getCurrentChannel': return reply('response', { returnValue: true, ...st.channel });
        case 'system.notifications/createToast': sim.toasts.push(p.message); return reply('response', { returnValue: true, toastId: '1' });
        case 'com.webos.service.connectionmanager/getinfo': return reply('response', { returnValue: true, wiredInfo: { macAddress: 'a8:23:fe:00:11:22' } });
        case 'com.webos.service.networkinput/getPointerInputSocket': return reply('response', { returnValue: true, socketPath: `ws://127.0.0.1:${server.address().port}/pointer/abc` });
        case 'system/turnOff': reply('response', { returnValue: true }); st.power = 'Active Standby'; return setTimeout(() => ws.close(), 20);
        case 'tv/channelUp': case 'tv/channelDown': case 'media.controls/play': case 'media.controls/pause': case 'media.controls/stop':
          return reply('response', { returnValue: true });
        default: return reply('error', {}, { error: `404 no such service or method (${uri})` });
      }
    });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    sim.port = server.address().port;
    sim.close = () => new Promise((r) => { for (const c of wss.clients) c.terminate(); for (const c of pointer.clients) c.terminate(); server.close(() => r()) });
    sim.disconnectAll = () => { for (const c of wss.clients) c.terminate() };
    resolve(sim);
  }));
}

module.exports = { startSimulator };

if (require.main === module) {
  startSimulator({ port: Number(process.argv[2]) || 3000 }).then((s) => console.log(`LG webOS simulator on ws://127.0.0.1:${s.port}`));
}
