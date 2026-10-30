'use strict';

// Settings → Helvar. The client (src/helvar-client.js) runs in its own
// process, so status comes from the registry and store, and a save restarts it.
//
//   GET  /helvar/status      groups and devices LSH found
//   POST /helvar/test        { host, port } — workgroup name and group count, nothing saved
//   POST /settings/helvar    { host, port, fade, pollSeconds }
const fs = require('fs');
const path = require('path');
const net = require('net');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const INTEGRATIONS = require('../integrations');

const HOST_RE = /^[\w.-]+$/;

// Ask one router a couple of queries over a short-lived connection
function ask(host, port, commands, ms = 5000) {
  return new Promise((resolve, reject) => {
    const answers = [];
    let buf = '';
    const sock = net.createConnection({ host, port });
    const done = (err) => { clearTimeout(t); sock.destroy(); err ? reject(err) : resolve(answers); };
    const t = setTimeout(() => done(answers.length ? null : new Error('No answer from the router (is it a Helvar router, port 50000?)')), ms);
    sock.setEncoding('latin1');
    sock.on('connect', () => sock.write(commands[0]));
    sock.on('error', (err) => done(err));
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('#')) >= 0) {
        const msg = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!/^[?!]/.test(msg)) continue;
        answers.push(msg.startsWith('!') ? null : msg.slice(msg.indexOf('=') + 1));
        if (answers.length === commands.length) return done();
        sock.write(commands[answers.length]);
      }
    });
  });
}

module.exports = function register(router, ctx) {
  const { clients, requireAdmin, sensorRegistry, store } = ctx;

  router.get('/helvar/status', requireAdmin, (req, res) => {
    const devs = sensorRegistry.getDevices().filter((d) => d.type === 'helvar');
    const val = (k) => store.get(k);
    res.json({
      success: true,
      data: {
        configured: !!readConfigFile().helvar?.host,
        groups: devs.filter((d) => d.key.startsWith('helvar/group-')).map((d) => ({
          key: d.key, label: d.label, level: val(`${d.key}/level`), lastScene: val(`${d.key}/lastScene`),
          scenes: Object.values(val(`${d.key}/scenes`) || {}), power: val(`${d.key}/power`),
        })),
        devices: devs.filter((d) => !d.key.startsWith('helvar/group-')).map((d) => ({
          key: d.key, label: d.label, model: d.model, level: val(`${d.key}/level`), fault: val(`${d.key}/fault`), motion: val(`${d.key}/motion`),
        })),
      },
    });
  });

  router.post('/helvar/test', requireAdmin, async (req, res) => {
    const host = String(req.body?.host || '').trim();
    const port = Number(req.body?.port) || 50000;
    if (!HOST_RE.test(host)) return res.json({ success: false, error: 'Enter the router’s IP address' });
    try {
      const [workgroup, groups] = await ask(host, port, ['>V:2,C:107#', '>V:2,C:165#']);
      const n = String(groups || '').split(',').filter((x) => x.trim()).length;
      res.json({ success: true, message: `Connected — workgroup “${workgroup || '?'}”, ${n} group(s)` });
    } catch (err) { res.json({ success: false, error: err.message }); }
  });

  router.post('/settings/helvar', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const prev = readConfigFile();
    const host = String(b.host || '').trim();
    if (host && !HOST_RE.test(host)) return res.status(400).json({ success: false, error: 'Router address like 10.254.1.1' });
    const next = { ...prev };
    if (host) {
      const cfg = { ...(prev.helvar || {}), host };
      const port = Number(b.port);
      if (port && port !== 50000) cfg.port = port; else delete cfg.port;
      const fade = Number(b.fade);
      if (Number.isFinite(fade) && b.fade !== '' && b.fade != null) cfg.fade = Math.max(0, Math.min(60, fade)); else delete cfg.fade;
      const poll = Number(b.pollSeconds);
      if (poll) cfg.pollSeconds = Math.max(10, poll); else delete cfg.pollSeconds;
      next.helvar = cfg;
    } else delete next.helvar;
    try { writeConfigFile(next); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    if (!clients.moduleHost) return res.json({ success: true, message: 'Saved — restart LSH to apply.' });
    try {
      // a fresh install ships core only — fetch the module before starting it
      if (host && !fs.existsSync(path.join(__dirname, '..', 'helvar-client.js'))) await require('../module-manager').install(['helvar'], next);
      const info = await clients.moduleHost.apply(INTEGRATIONS.find((x) => x.file === 'helvar-client'));
      res.json({ success: true, message: host ? 'Saved and applied — groups and lights appear in a few seconds.' : 'Saved — module stopped.', data: info });
    } catch (err) {
      res.json({ success: true, message: `Saved; restart LSH to apply (${err.message}).` });
    }
  });
};
