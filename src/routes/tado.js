'use strict';

// tado° sign-in (src/tado-client.js) — the OAuth device-code flow: Start
// returns a tado link + code to confirm there; LSH keeps asking tado in the
// background, saves the tokens to persist/tado-tokens.json, turns
// config.tado on and starts the client.
//
//   GET  /tado/auth           signed in?, the sign-in in progress
//   POST /tado/auth/start     new sign-in → { userCode, url, expiresAt }
//   POST /tado/auth/logout    forget the tokens, stop tado

const { readConfigFile } = require('./helpers');
const { writeConfigFile } = require('../config-file-cache');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;
  const tado = () => require('../tado-client');
  const apply = (config) => require('./integration-settings').apply(ctx, 'tado', config);
  let flow = null; // { userCode, url, expiresAt, state: pending|done|error, error }

  const authBase = () => readConfigFile().tado?.authBase;

  async function waitForConfirm(f, deviceCode, interval) {
    let wait = Math.max(1, interval);
    while (flow === f && Date.now() < f.expiresAt) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      if (flow !== f) return;
      try {
        const r = await tado().pollDeviceAuth(deviceCode, { authBase: authBase() });
        if (r === 'pending') continue;
        if (r === 'slow_down') { wait += 5; continue }
        const current = readConfigFile();
        const config = { ...current, tado: { ...(current.tado || {}), enabled: true } };
        writeConfigFile(config);
        f.state = 'done';
        console.log('[tado] Signed in');
        await apply(config).catch((err) => console.error(`[tado] Start failed: ${err.message}`));
        return;
      } catch (err) {
        f.state = 'error'; f.error = err.message;
        return;
      }
    }
    if (flow === f && f.state === 'pending') { f.state = 'error'; f.error = 'The code expired — start the sign-in again' }
  }

  router.get('/tado/auth', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const t = tado().loadTokens();
    const { userCode, url, expiresAt, state, error } = flow || {};
    res.json({ success: true, data: { signedIn: !!t?.refreshToken, since: t?.savedAt || null, flow: flow ? { userCode, url, expiresAt, state, error } : null } });
  });

  router.post('/tado/auth/start', requireAdmin, async (req, res) => {
    try {
      const a = await tado().startDeviceAuth({ authBase: authBase() });
      const f = { userCode: a.userCode, url: a.url, expiresAt: Date.now() + a.expiresIn * 1000, state: 'pending' };
      flow = f;
      waitForConfirm(f, a.deviceCode, a.interval);
      res.json({ success: true, data: { userCode: f.userCode, url: f.url, expiresAt: f.expiresAt } });
    } catch (err) { res.status(502).json({ success: false, error: err.message }) }
  });

  router.post('/tado/auth/logout', requireAdmin, async (req, res) => {
    flow = null;
    tado().clearTokens();
    try {
      const current = readConfigFile();
      const config = { ...current, tado: { ...(current.tado || {}), enabled: false } };
      writeConfigFile(config);
      await apply(config);
      res.json({ success: true, message: 'Signed out of tado.' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }) }
  });
};
