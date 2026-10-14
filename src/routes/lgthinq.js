'use strict';

// LG ThinQ settings — Personal Access Token + account country (src/lgthinq-client.js).
// The token is kept in persist/lgthinq-tokens.json (never sent back to the browser).
const fs   = require('fs');
const path = require('path');
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

const TOKENS_FILE = path.join(__dirname, '..', '..', 'persist', 'lgthinq-tokens.json');
const readToken = () => { try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')).access_token || '' } catch { return '' } };

module.exports = function register(router, ctx) {
  const { requireAdmin, clients, store, sensorRegistry } = ctx;

  router.get('/settings/lgthinq', requireAdmin, (req, res) => {
    const c = clients.lgthinq;
    res.json({ success: true, data: {
      country: readConfigFile().lgthinq?.country || '',
      countries: require('../lgthinq-client').countries(),
      hasToken: !!readToken(),
      devices: c ? [...c.devices.values()].map((d) => ({ key: d.key, label: d.label, type: d.type, sensors: d.props.length })) : [],
    } });
  });

  // Checks the token against LG with that country, then saves and (re)starts the client
  router.post('/settings/lgthinq', requireAdmin, async (req, res) => {
    const LGThinQClient = require('../lgthinq-client');
    const tokenIn = String(req.body?.token || '').trim();
    const token = tokenIn && !tokenIn.includes('•') ? tokenIn : readToken();
    const country = String(req.body?.country || '').trim().toUpperCase();
    if (!token) return res.status(400).json({ success: false, error: 'Paste a Personal Access Token from connect-pat.lgthinq.com' });
    if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ success: false, error: 'Pick your LG account’s country' });
    let list;
    try {
      const probe = new LGThinQClient({ lgthinq: { token, country } }, store, sensorRegistry);
      list = (await probe.call('GET', '/devices', null, country)) || [];
    } catch (err) { return res.json({ success: false, error: err.message }) }

    fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify({ access_token: token }, null, 2), { mode: 0o600 });
    const cur = readConfigFile();
    const lgthinq = { ...(cur.lgthinq || {}), country };
    delete lgthinq.lang; delete lgthinq.username; delete lgthinq.password; delete lgthinq.token;
    writeConfigFile({ ...cur, lgthinq });

    try {
      clients.lgthinq?.stop();
      const c = new LGThinQClient({ ...cur, lgthinq }, store, sensorRegistry);
      clients.lgthinq = c;
      c.start().catch((err) => console.error(`[LGThinQ] Start failed: ${err.message}`));
    } catch (err) { console.error(`[LGThinQ] Restart failed: ${err.message}`) }
    const names = list.map((d) => d.deviceInfo?.alias || d.deviceInfo?.modelName).filter(Boolean);
    res.json({ success: true, message: names.length ? `Connected — ${names.length} appliance(s): ${names.join(', ')}` : 'Connected — no appliances on this account yet' });
  });

  router.post('/settings/lgthinq/disconnect', requireAdmin, (req, res) => {
    try { fs.unlinkSync(TOKENS_FILE) } catch { /* already gone */ }
    clients.lgthinq?.stop();
    delete clients.lgthinq;
    res.json({ success: true, message: 'Disconnected — restart LSH to remove the appliances' });
  });
};
