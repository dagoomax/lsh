'use strict';

// Settings → Locations: other LSH sites managed from this one (src/locations.js).
//
// On the hub:
//   GET    /locations                    the locations (never their tokens)
//   GET    /locations/overview           live summary of each: online, version, devices, platforms
//   POST   /locations                    { name, url, insecure, token } or { …, username, password } (pairing)
//   PATCH  /locations/:id                { name, url, insecure, token? }
//   DELETE /locations/:id?revoke=1       remove; revoke = delete the hub's token on the location too
//   POST   /locations/:id/open           a one-time sign-in link to the location's dashboard
//   ALL    /locations/:id/api/*          the location's REST API, with the hub's token —
//                                        reads for every signed-in user, changes for admins
//   GET/POST /locations/site             this site's name (shown on the hubs that manage it)
//
// On every LSH (what a hub calls):
//   GET  /site/summary                   name, version, uptime, devices, platform health
//   POST /auth/handoff                   (hub token only) { username, role, hub } → one-time code
//   GET  /auth/handoff/:code             public: signs the browser in as "<user>@<hub>", → /react/
const os = require('os');
const crypto = require('crypto');
const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');
const platformStatus = require('../platform-status');
const L = require('../locations');

const VERSION = require('../../package.json').version;
// Never through the proxy: account and token management, shells
const BLOCKED = /^\/(auth\/(tokens|users|change-password|setup|handoff)|terminal|claude-code)(\/|$)/;
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'set-cookie']);
const HANDOFF_MS = 60_000;

module.exports = function register(router, ctx) {
  const { auth, clients, requireAdmin, sensorRegistry, reqIsSecure } = ctx;
  const siteName = () => String(readConfigFile().siteName || '').trim() || os.hostname();
  const find = (res, id) => {
    const loc = L.load().find((x) => x.id === id);
    if (!loc) res.status(404).json({ success: false, error: 'No such location' });
    return loc;
  };

  // ── This site ─────────────────────────────────────────────

  router.get('/site/summary', (req, res) => {
    const ps = platformStatus.getAll?.() || {};
    const down = Object.entries(ps).filter(([, v]) => !v).map(([k]) => k);
    const procs = clients.moduleHost?.list?.() || [];
    res.json({
      success: true,
      data: {
        name: siteName(), version: VERSION, uptime: Math.round(process.uptime()), node: process.version,
        host: os.hostname(), load: os.loadavg()[0], memory: { rss: process.memoryUsage().rss, free: os.freemem(), total: os.totalmem() },
        devices: sensorRegistry ? sensorRegistry.getDevices().length : 0,
        platforms: { total: Object.keys(ps).length, ok: Object.keys(ps).length - down.length, down },
        modules: procs.length ? { total: procs.length, running: procs.filter((p) => p.state === 'running').length } : undefined,
        locations: L.load().length,
        time: new Date().toISOString(),
      },
    });
  });

  router.get('/locations/site', (req, res) => res.json({ success: true, data: { name: siteName(), configured: !!readConfigFile().siteName } }));
  router.post('/locations/site', requireAdmin, (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const cfg = { ...readConfigFile() };
    if (name) cfg.siteName = name; else delete cfg.siteName;
    try { writeConfigFile(cfg); } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
    res.json({ success: true, message: 'Saved.', data: { name: siteName() } });
  });

  // ── Handoff (the location side of "Open") ─────────────────

  const handoffs = new Map(); // code → { user, hub, expires }
  router.post('/auth/handoff', (req, res) => {
    if (req.user?.id !== 'api-token') return res.status(403).json({ success: false, error: 'Only a hub’s API token can do this' });
    const hub = String(req.body?.hub || 'hub').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60) || 'hub';
    const username = String(req.body?.username || 'user').replace(/[^\p{L}\p{N} ._@-]/gu, '').slice(0, 60) || 'user';
    const role = req.body?.role === 'admin' ? 'admin' : 'viewer';
    const now = Date.now();
    for (const [k, v] of handoffs) if (v.expires < now) handoffs.delete(k);
    const code = crypto.randomBytes(24).toString('hex');
    handoffs.set(code, { user: { id: `hub:${hub}:${username}`, username: `${username}@${hub}`, role }, hub, expires: now + HANDOFF_MS });
    res.json({ success: true, data: { code, path: `/api/auth/handoff/${code}`, expiresIn: HANDOFF_MS / 1000 } });
  });

  router.get('/auth/handoff/:code', (req, res) => {
    const h = handoffs.get(String(req.params.code));
    handoffs.delete(String(req.params.code));
    if (!h || h.expires < Date.now() || !auth) return res.status(401).type('text').send('This sign-in link has expired — open the location again from your hub.');
    const token = auth.signToken(h.user, { ttl: '12h', extra: { hub: h.hub } });
    auth.setCookie(res, token, reqIsSecure?.(req));
    console.log(`[Locations] ${h.user.username} signed in from hub "${h.hub}" (${h.user.role})`);
    res.redirect('/react/');
  });

  // ── Locations (the hub side) ──────────────────────────────

  router.get('/locations', (req, res) => res.json({ success: true, data: L.load().map(L.publicView) }));

  router.get('/locations/overview', async (req, res) => {
    const list = L.load();
    const out = await Promise.all(list.map(async (l) => ({ ...L.publicView(l), summary: await L.summary(l) })));
    res.json({ success: true, data: out });
  });

  router.post('/locations', requireAdmin, async (req, res) => {
    const b = req.body || {};
    let url;
    try { url = L.normalizeUrl(b.url); } catch (err) { return res.status(400).json({ success: false, error: err.message }); }
    const list = L.load();
    if (list.some((l) => l.url === url)) return res.status(400).json({ success: false, error: 'That location is already on the list' });
    const loc = { id: L.newId(), name: String(b.name || '').trim().slice(0, 60) || new URL(url).hostname, url, insecure: !!b.insecure, addedAt: new Date().toISOString() };
    try {
      if (b.username && b.password) Object.assign(loc, await L.pair(loc, { username: String(b.username), password: String(b.password) }, siteName()));
      else if (String(b.token || '').trim()) loc.token = String(b.token).trim();
      else return res.status(400).json({ success: false, error: 'Give the location’s admin login or an API token from it' });
      const s = await L.summary(loc);
      if (s.state === 'unauthorized') return res.status(400).json({ success: false, error: s.error });
      if (s.state !== 'online') return res.status(400).json({ success: false, error: s.error || 'The location did not answer' });
      if (!b.name && s.name) loc.name = s.name;
      list.push(loc);
      L.save(list);
      console.log(`[Locations] Added "${loc.name}" (${url})${loc.tokenId ? ' — paired' : ''}`);
      res.json({ success: true, message: `Added — ${loc.name}: ${s.devices ?? '?'} device(s)`, data: L.publicView(loc) });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.patch('/locations/:id', requireAdmin, (req, res) => {
    const list = L.load();
    const loc = list.find((x) => x.id === req.params.id);
    if (!loc) return res.status(404).json({ success: false, error: 'No such location' });
    const b = req.body || {};
    try {
      if (b.url !== undefined) loc.url = L.normalizeUrl(b.url);
      if (b.name !== undefined) loc.name = String(b.name).trim().slice(0, 60) || loc.name;
      if (b.insecure !== undefined) loc.insecure = !!b.insecure;
      if (String(b.token || '').trim() && !String(b.token).includes('•')) { loc.token = String(b.token).trim(); delete loc.tokenId; }
    } catch (err) { return res.status(400).json({ success: false, error: err.message }); }
    L.save(list);
    res.json({ success: true, data: L.publicView(loc) });
  });

  router.delete('/locations/:id', requireAdmin, async (req, res) => {
    const list = L.load();
    const loc = list.find((x) => x.id === req.params.id);
    if (!loc) return res.status(404).json({ success: false, error: 'No such location' });
    let revoked = false;
    if (req.query.revoke && loc.tokenId) {
      revoked = await L.request(loc, 'DELETE', `/api/auth/tokens/${encodeURIComponent(loc.tokenId)}`).then((r) => r.status === 200).catch(() => false);
    }
    L.save(list.filter((x) => x.id !== loc.id));
    res.json({ success: true, message: revoked ? 'Removed, and its token revoked on the location.' : 'Removed.' });
  });

  // "Open": sign the user in to the location as themselves, with their role here
  router.post('/locations/:id/open', async (req, res) => {
    const loc = find(res, req.params.id); if (!loc) return;
    try {
      const r = await L.request(loc, 'POST', '/api/auth/handoff', { body: { username: req.user?.username || 'user', role: req.user?.role, hub: siteName() } });
      if (r.status === 404) return res.json({ success: true, data: { url: `${loc.url}/react/`, handoff: false } }); // older LSH: plain link
      if (r.status !== 200 || !r.data?.data?.code) return res.status(502).json({ success: false, error: r.data?.error || `HTTP ${r.status}` });
      res.json({ success: true, data: { url: `${loc.url}${r.data.data.path}`, handoff: true } });
    } catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  // The location's REST API through this hub
  router.all('/locations/:id/api/*', async (req, res) => {
    const loc = find(res, req.params.id); if (!loc) return;
    const sub = `/${req.params[0] || ''}`;
    if (BLOCKED.test(sub)) return res.status(403).json({ success: false, error: 'Not available through a hub' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    const q = new URLSearchParams(req.query);
    q.delete('token');
    const qs = q.toString();
    const hasJson = req.is('application/json') && req.body !== undefined && !(typeof req.body === 'object' && Object.keys(req.body).length === 0 && !Number(req.headers['content-length']));
    try {
      const up = await L.request(loc, req.method, `/api${sub}${qs ? `?${qs}` : ''}`, {
        body: hasJson ? JSON.stringify(req.body) : undefined, stream: true, timeout: 30_000,
        headers: { Accept: req.headers.accept || 'application/json', 'X-Forwarded-For': req.ip, 'X-LSH-Hub-User': `${req.user?.username || '?'}@${siteName()}` },
      });
      res.status(up.statusCode);
      for (const [k, v] of Object.entries(up.headers)) if (!HOP.has(k)) res.setHeader(k, v);
      up.pipe(res);
    } catch (err) {
      res.status(502).json({ success: false, error: err.message, location: loc.name });
    }
  });
};
