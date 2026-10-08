'use strict';

// LG ThinQ — split out of src/api-routes.js; registered in order by createApiRoutes().
const fs   = require('fs');
const path = require('path');
const { writeConfigFile } = require('../config-file-cache');
const { readConfigFile } = require('./helpers');

module.exports = function register(router, ctx) {
  const { requireAdmin } = ctx;

  // ── LG ThinQ ─────────────────────────────────────────────────────────

  // One-time login to fetch tokens + user number (password never stored)
  router.post('/settings/lgthinq-login', requireAdmin, async (req, res) => {
    const { username, password, country = 'EU' } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Email and password required' });

    const crypto   = require('crypto');
    const https    = require('https');
    const APP_ID   = 'LGAO221A02';
    const OAUTH_ID = 'LGAO221A02';
    const OAUTH_SECRET = 'c053c2a6ddeb7ad97cb0eed0dcb31cf8';
    const REDIRECT_URI = 'lgaccount.lgsmartthinq://';
    const countryUp = country.toUpperCase();
    const EMP_HOSTS = { US: 'us.m.lgaccount.com', EU: 'eu.m.lgaccount.com', KR: 'kr.m.lgaccount.com', AU: 'au.m.lgaccount.com', CA: 'ca.m.lgaccount.com', JP: 'jp.m.lgaccount.com' };
    const empHost = EMP_HOSTS[countryUp] || 'eu.m.lgaccount.com';

    function httpsReq(method, hostname, reqPath, body, headers = {}) {
      return new Promise((resolve, reject) => {
        let payload = null;
        if (body != null) {
          payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
          if (!headers['Content-Type']) headers['Content-Type'] = typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json';
          headers['Content-Length'] = payload.length;
        }
        const req2 = https.request({ hostname, path: reqPath, method, timeout: 12000, headers }, r => {
          const chunks = [];
          r.on('data', d => chunks.push(d));
          r.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            if (r.statusCode >= 300) return reject(new Error(`HTTP ${r.statusCode}: ${text.slice(0, 300)}`));
            try { resolve(JSON.parse(text)); } catch { reject(new Error(`Non-JSON: ${text.slice(0, 200)}`)); }
          });
        });
        req2.on('error', reject);
        req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout')); });
        if (payload) req2.write(payload);
        req2.end();
      });
    }

    try {
      const state  = crypto.randomBytes(4).toString('hex');
      const b64pw  = Buffer.from(password).toString('base64');
      const pre = await httpsReq('POST', empHost, `/spx/common/oauthapps/${APP_ID}/preLogin`, {
        user_auth2: b64pw, redirect_uri: REDIRECT_URI, state, username,
        log_param: `login request / redirect_uri=${REDIRECT_URI} / user_auth2=${b64pw} / state=${state}`,
      }, { 'Content-Type': 'application/json' });

      const redir = pre.redirect_uri || pre.redirectUri || '';
      const codeMatch = redir.match(/[?&]code=([^&]+)/);
      if (!codeMatch) return res.json({ success: false, error: `Login failed — no auth code returned. Response: ${JSON.stringify(pre).slice(0, 200)}` });
      const code = decodeURIComponent(codeMatch[1]);

      const creds  = Buffer.from(`${OAUTH_ID}:${OAUTH_SECRET}`).toString('base64');
      const tokens = await httpsReq('POST', empHost, '/oauth2/token',
        `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
        { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' }
      );

      // Extract user number: may be in token response or decodable from JWT
      let userNumber = tokens.user_number || tokens.userNumber || tokens.sub || '';
      if (!userNumber && tokens.access_token && tokens.access_token.includes('.')) {
        try {
          const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64').toString());
          userNumber = payload.sub || payload.user_number || payload.userNumber || '';
        } catch {}
      }

      res.json({
        success: true,
        message: `Logged in${userNumber ? ` — user number: ${userNumber}` : ' — check token fields'}`,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        user_number:   userNumber,
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  router.post('/settings/test-lgthinq', requireAdmin, async (req, res) => {
    const { country = 'US', lang } = req.body;
    // Probe the LG gateway — no credentials needed, just verify connectivity
    const https   = require('https');
    const headers = {
      'x-api-key':        'VGhpblEyLjAgU0VSVklDRQ==',
      'x-client-id':      'LGAO221A02',
      'x-country-code':   country.toUpperCase(),
      'x-language-code':  (lang || 'en-US').replace('-', '_'),
      'x-message-id':     Math.random().toString(36).slice(2),
      'x-service-id':     'SVC202',
      'x-service-phase':  'OP',
      'x-thinq-app-ver':  '3.6.1200',
      'x-thinq-app-type': 'NUTS',
      'x-thinq-app-os':   'ANDROID',
      'Accept':           'application/json',
    };
    const req2 = https.get({
      hostname: 'aic-service.lgthinq.com',
      path: `/service/users/gateways?countryCode=${country.toUpperCase()}&langCode=${(lang||'en-US').replace('-','_')}`,
      timeout: 8000,
      headers,
    }, r => {
      const chunks = [];
      r.on('data', d => chunks.push(d));
      r.on('end', () => {
        if (r.statusCode >= 300) return res.json({ success: false, error: `LG gateway returned HTTP ${r.statusCode}` });
        try {
          const gw = JSON.parse(Buffer.concat(chunks));
          const empHost = (gw.result || gw).empPath || (gw.result || gw).empApiHost || '';
          res.json({ success: true, message: `LG gateway reachable — ${empHost || 'connected'}. Save and restart to activate.` });
        } catch {
          res.json({ success: r.statusCode < 300, message: 'LG gateway reachable' });
        }
      });
    });
    req2.on('error', err => { if (!res.headersSent) res.json({ success: false, error: err.message }); });
    req2.on('timeout', () => { req2.destroy(); if (!res.headersSent) res.json({ success: false, error: 'Connection timed out' }); });
  });

  router.post('/settings/lgthinq', requireAdmin, (req, res) => {
    const current = readConfigFile();
    const { access_token, refresh_token, user_number, country, lang } = req.body;
    try {
      const prev = current.lgthinq || {};
      const resolvedCountry = (country || prev.country || 'US').trim().toUpperCase();
      const resolvedLang    = (lang    || prev.lang    || 'en-US').trim();

      // Persist tokens to the tokens file if provided
      const tokFile = path.join(__dirname, '..', '..', 'persist', 'lgthinq-tokens.json');
      let existing = {};
      try { existing = JSON.parse(fs.readFileSync(tokFile, 'utf8')); } catch {}
      const EMP_HOSTS = { US: 'us.m.lgaccount.com', EU: 'eu.m.lgaccount.com', KR: 'kr.m.lgaccount.com', AU: 'au.m.lgaccount.com', CA: 'ca.m.lgaccount.com', JP: 'jp.m.lgaccount.com' };
      const tokData = {
        ...existing,
        ...(access_token  && !access_token.includes('•')  ? { access_token }  : {}),
        ...(refresh_token && !refresh_token.includes('•') ? { refresh_token } : {}),
        user_number: (user_number || existing.user_number || '').trim(),
        apiHost: `${resolvedCountry.toLowerCase()}.api.lge.com`,
        empHost: EMP_HOSTS[resolvedCountry] || 'm.lgaccount.com',
      };
      fs.mkdirSync(path.dirname(tokFile), { recursive: true });
      fs.writeFileSync(tokFile, JSON.stringify(tokData, null, 2), 'utf8');

      writeConfigFile({
        ...current,
        lgthinq: { country: resolvedCountry, lang: resolvedLang },
      });
      res.json({ success: true, message: 'LG ThinQ tokens saved. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
