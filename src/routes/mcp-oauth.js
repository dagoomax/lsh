'use strict';

// OAuth 2.1 for the MCP server — for clients that can't send a static bearer
// token (ChatGPT custom connectors, claude.ai connectors). Authorization code
// + PKCE (S256 only), public clients via dynamic client registration (RFC
// 7591), protected-resource / authorization-server metadata (RFC 9728 / 8414)
// so the client discovers everything from the 401 on /api/mcp.
//
// Approval: /oauth/authorize is behind LSH's normal login (the auth
// middleware redirects to the sign-in screen); an LSH admin sees which client
// asks, picks the MCP bot it will act as, and approves. Tokens are bot-bound,
// so the bot's policy (read-only / rooms / sensitive devices) applies and
// removing / disabling the bot revokes the connector.
//
// Mounted on the app root by server.js (metadata lives under /.well-known).
// Token / registration / revocation endpoints are public by design (the auth
// middleware lets them through); they authenticate by code + PKCE / refresh
// token. Everything refuses plain http except on localhost.

const express = require('express');
const crypto = require('crypto');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PENDING_TTL_MS = 10 * 60 * 1000;

module.exports = function mountMcpOAuth(app, { bots, mcpConfig = {} }) {
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const json = express.json({ limit: '20kb' });
  const pending = new Map(); // request id → { params, userId, exp }
  const regHits = new Map(); // ip → [t] — registration is public, keep it cheap to abuse-proof

  const isLoopback = (req) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.get('host') || '');
  const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https';
  const base = (req) => (mcpConfig.publicUrl ? String(mcpConfig.publicUrl).replace(/\/+$/, '') : `${isHttps(req) ? 'https' : req.protocol}://${req.get('host')}`);
  const requireTls = (req, res) => {
    if (isHttps(req) || isLoopback(req) || mcpConfig.allowInsecureOAuth === true) return true;
    res.status(400).json({ error: 'invalid_request', error_description: 'OAuth for LSH MCP needs HTTPS — reach LSH over https:// (e.g. Tailscale Funnel or a reverse proxy) and set mcp.publicUrl' });
    return false;
  };
  const oauthError = (res, status, error, description) => res.status(status).set('Cache-Control', 'no-store').json({ error, error_description: description });

  // ── Discovery ───────────────────────────────────────────────────────────────
  const resourceMeta = (req, res) => res.json({
    resource: `${base(req)}/api/mcp`,
    authorization_servers: [base(req)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
    resource_name: 'LSH smart home',
  });
  app.get('/.well-known/oauth-protected-resource', resourceMeta);
  app.get('/.well-known/oauth-protected-resource/api/mcp', resourceMeta);

  app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/api/mcp'], (req, res) => {
    const b = base(req);
    res.json({
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      revocation_endpoint: `${b}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    });
  });

  // ── Dynamic client registration ─────────────────────────────────────────────
  app.post('/oauth/register', json, (req, res) => {
    if (!requireTls(req, res)) return;
    const ip = req.ip || '';
    const t = Date.now();
    const hits = (regHits.get(ip) || []).filter((x) => t - x < 60 * 60 * 1000);
    if (hits.length >= 20) return oauthError(res, 429, 'invalid_request', 'Too many registrations');
    hits.push(t); regHits.set(ip, hits);
    try {
      const c = bots.registerClient(req.body || {});
      res.status(201).set('Cache-Control', 'no-store').json({ ...c, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    } catch (err) { oauthError(res, 400, 'invalid_client_metadata', err.message) }
  });

  // ── Authorization (consent) ─────────────────────────────────────────────────
  // Errors before the redirect URI is validated must NOT redirect (open redirect)
  const validate = (q) => {
    const client = bots.getClient(String(q.client_id || ''));
    if (!client) return { error: 'Unknown client — remove the connector and add it again' };
    const redirectUri = String(q.redirect_uri || '');
    if (!client.redirect_uris.includes(redirectUri)) return { error: 'This redirect URI is not registered for the client' };
    if (q.response_type !== 'code') return { client, redirectUri, redirectError: 'unsupported_response_type' };
    if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(q.code_challenge || ''))) return { client, redirectUri, redirectError: 'invalid_request' };
    if (q.resource && !/\/api\/mcp\/?$/.test(String(q.resource))) return { client, redirectUri, redirectError: 'invalid_target' };
    return { client, redirectUri };
  };
  const redirectWith = (res, uri, params) => {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
    res.redirect(302, u.toString());
  };
  const realUser = (req) => req.user && req.user.role === 'admin' && req.user.id !== 'api-token';

  const page = (res, body) => res
    .set({ 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'", 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    .type('html')
    .send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to LSH</title>
<body style="font:15px/1.5 system-ui,sans-serif;background:#f4f4f6;color:#111;margin:0;display:grid;place-items:center;min-height:100vh">
<div style="background:#fff;border-radius:14px;box-shadow:0 2px 12px #0001;max-width:440px;width:calc(100% - 32px);padding:24px">${body}</div></body>`);

  app.get('/oauth/authorize', (req, res) => {
    if (!requireTls(req, res)) return;
    if (!realUser(req)) return page(res.status(403), '<h2>Admins only</h2><p>Sign in to LSH with an admin account to connect an AI assistant.</p>');
    const v = validate(req.query);
    if (v.error) return page(res.status(400), `<h2>Can’t connect</h2><p>${esc(v.error)}</p>`);
    if (v.redirectError) return redirectWith(res, v.redirectUri, { error: v.redirectError, state: req.query.state });
    const enabled = bots.list().filter((b) => b.enabled !== false);
    if (!enabled.length) return page(res, '<h2>No MCP bots yet</h2><p>Create a bot first in LSH → Settings → Security → MCP bots, then connect again.</p>');
    const id = crypto.randomBytes(24).toString('base64url');
    for (const [k, p] of pending) if (p.exp < Date.now()) pending.delete(k);
    pending.set(id, { params: { ...req.query }, userId: req.user.id, exp: Date.now() + PENDING_TTL_MS });
    const preferred = enabled.find((b) => b.client === (/chatgpt|openai/i.test(v.client.client_name) ? 'chatgpt' : /claude|anthropic/i.test(v.client.client_name) ? 'claude' : /gemini|google/i.test(v.client.client_name) ? 'gemini' : '')) || enabled[0];
    const host = (() => { try { return new URL(v.redirectUri).host } catch { return '' } })();
    page(res, `<h2 style="margin-top:0">Connect “${esc(v.client.client_name)}” to LSH?</h2>
<p>It will be able to use your smart home through MCP <b>as the bot you choose</b> — only what that bot is allowed to see and control. After approving you return to <code>${esc(host)}</code>.</p>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="request_id" value="${esc(id)}">
<label style="display:block;margin:12px 0 4px;font-weight:600">Act as bot</label>
<select name="bot_id" style="width:100%;padding:8px;font:inherit">${enabled.map((b) => `<option value="${esc(b.id)}"${b.id === preferred.id ? ' selected' : ''}>${esc(b.name)} — ${b.access === 'control' ? 'control' : 'read only'}${b.sensitive ? ', incl. locks/alarm' : ''}</option>`).join('')}</select>
<div style="display:flex;gap:8px;margin-top:18px">
<button name="decision" value="approve" style="flex:1;padding:10px;border:0;border-radius:8px;background:#111;color:#fff;font:inherit">Approve</button>
<button name="decision" value="deny" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;font:inherit">Deny</button>
</div></form>`);
  });

  app.post('/oauth/authorize', form, (req, res) => {
    if (!requireTls(req, res)) return;
    if (!realUser(req)) return page(res.status(403), '<h2>Admins only</h2>');
    // Same-origin form post only (the request id is the CSRF token as well)
    const origin = req.get('origin');
    if (origin) { try { if (new URL(origin).host !== req.get('host')) return page(res.status(403), '<h2>Blocked</h2>') } catch { return page(res.status(403), '<h2>Blocked</h2>') } }
    const p = pending.get(String(req.body.request_id || ''));
    pending.delete(String(req.body.request_id || ''));
    if (!p || p.exp < Date.now() || p.userId !== req.user.id) return page(res.status(400), '<h2>This approval expired</h2><p>Start connecting again from the AI assistant.</p>');
    const v = validate(p.params);
    if (v.error || v.redirectError) return page(res.status(400), '<h2>Can’t connect</h2>');
    if (req.body.decision !== 'approve') return redirectWith(res, v.redirectUri, { error: 'access_denied', state: p.params.state });
    const bot = bots.get(String(req.body.bot_id || ''));
    if (!bot || bot.enabled === false) return page(res.status(400), '<h2>Pick an enabled bot</h2>');
    const code = bots.createCode({ clientId: v.client.client_id, botId: bot.id, redirectUri: v.redirectUri, codeChallenge: String(p.params.code_challenge), approvedBy: req.user.username });
    console.log(`[MCP] OAuth: ${req.user.username} connected "${v.client.client_name}" as bot "${bot.name}"`);
    redirectWith(res, v.redirectUri, { code, state: p.params.state });
  });

  // ── Token / revocation ──────────────────────────────────────────────────────
  app.post('/oauth/token', form, json, (req, res) => {
    if (!requireTls(req, res)) return;
    const b = req.body || {};
    try {
      let out;
      if (b.grant_type === 'authorization_code') {
        out = bots.exchangeCode({ code: String(b.code || ''), clientId: String(b.client_id || ''), redirectUri: String(b.redirect_uri || ''), codeVerifier: String(b.code_verifier || '') });
      } else if (b.grant_type === 'refresh_token') {
        out = bots.refresh({ refreshToken: String(b.refresh_token || ''), clientId: String(b.client_id || '') });
      } else return oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
      res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).json(out);
    } catch (err) {
      oauthError(res, 400, err.oauth || 'invalid_request', err.message);
    }
  });

  app.post('/oauth/revoke', form, json, (req, res) => {
    if (!requireTls(req, res)) return;
    bots.revokeToken(String(req.body?.token || ''));
    res.status(200).set('Cache-Control', 'no-store').end();
  });
};
