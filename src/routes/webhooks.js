'use strict';

// Outgoing webhooks (src/webhooks.js) — what the n8n LSH Trigger node calls
// to subscribe, and Settings → n8n & webhooks.
//
//   GET    /webhooks              subscriptions (no secrets)
//   POST   /webhooks              { name, url, keys: [patterns], throttleSeconds, secret? } → includes the secret once
//   PATCH  /webhooks/:id          { enabled, name, throttleSeconds }
//   DELETE /webhooks/:id
//   POST   /webhooks/:id/test     sends a "test" event now
//   GET    /webhooks/keys?q=      device/sensor keys to pick from (for n8n's dropdowns and Settings)
//   GET    /webhooks/n8n-nodes-lsh.tgz   the n8n community nodes (integrations/n8n-nodes-lsh) as an npm package

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const WebhookHub = require('../webhooks');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin, store, sensorRegistry } = ctx;
  const hub = WebhookHub.shared(store, sensorRegistry);
  const site = () => { try { return readConfigFile().siteName || os.hostname(); } catch { return os.hostname(); } };
  hub.hubName = site();

  router.get('/webhooks', requireAdmin, (req, res) => res.json({ success: true, data: hub.list() }));

  router.post('/webhooks', requireAdmin, (req, res) => {
    try {
      hub.hubName = site();
      const s = hub.add(req.body || {});
      console.log(`[Webhooks] Added "${s.name}" → ${new URL(s.url).host} (${s.keys.length} pattern${s.keys.length === 1 ? '' : 's'})`);
      res.json({ success: true, data: { ...hub.view(s), secret: s.secret } });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });

  router.patch('/webhooks/:id', requireAdmin, (req, res) => {
    const s = hub.update(req.params.id, req.body || {});
    if (!s) return res.status(404).json({ success: false, error: 'No such webhook' });
    res.json({ success: true, data: hub.view(s) });
  });

  router.delete('/webhooks/:id', requireAdmin, (req, res) => {
    const s = hub.get(req.params.id);
    if (!hub.remove(req.params.id)) return res.status(404).json({ success: false, error: 'No such webhook' });
    console.log(`[Webhooks] Removed "${s.name}"`);
    res.json({ success: true });
  });

  router.post('/webhooks/:id/test', requireAdmin, async (req, res) => {
    const r = await hub.test(req.params.id);
    if (!r) return res.status(404).json({ success: false, error: 'No such webhook' });
    res.status(r.ok ? 200 : 502).json({ success: r.ok, data: r, error: r.error || undefined });
  });

  // npm-installable tarball: every file under package/, as `npm pack` lays it out
  router.get('/webhooks/n8n-nodes-lsh.tgz', requireAdmin, (req, res) => {
    const dir = path.join(__dirname, '..', '..', 'integrations', 'n8n-nodes-lsh');
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch {
      return res.status(404).json({ success: false, error: 'The n8n nodes are not in this install — get integrations/n8n-nodes-lsh from github.com/dagoomax/lsh' });
    }
    const files = ['package.json', ...(pkg.files || [])].flatMap((f) => walk(dir, f));
    res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="n8n-nodes-lsh-${pkg.version}.tgz"` })
      .send(zlib.gzipSync(tar(files.map((rel) => ({ name: `package/${rel}`, data: fs.readFileSync(path.join(dir, rel)) })))));
  });

  router.get('/webhooks/keys', requireAdmin, (req, res) => {
    const q = String(req.query.q || '').toLowerCase();
    const out = [];
    for (const d of sensorRegistry?.getDevices?.() || []) {
      for (const x of d.sensors || []) {
        const key = `${d.key}/${x.path}`;
        const label = `${d.label || d.key} · ${x.label || x.name || x.path}`;
        if (!q || key.toLowerCase().includes(q) || label.toLowerCase().includes(q)) out.push({ key, label, device: d.key, sensor: x.path, controllable: !!x.controllable, type: x.type || null });
        if (out.length >= 2000) break;
      }
    }
    res.json({ success: true, data: out });
  });
};

function walk(root, rel) {
  const full = path.join(root, rel);
  let st; try { st = fs.statSync(full); } catch { return []; }
  if (st.isFile()) return [rel];
  return fs.readdirSync(full).filter((n) => !n.startsWith('.') && n !== 'node_modules' && n !== 'test').flatMap((n) => walk(root, path.posix.join(rel, n)));
}

// a minimal ustar archive (files only, names under 100 bytes)
function tar(entries) {
  const blocks = [];
  for (const { name, data } of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
