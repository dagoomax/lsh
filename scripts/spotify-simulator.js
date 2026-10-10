#!/usr/bin/env node
'use strict';

// Minimal Spotify stand-in (accounts + Web API on one HTTP server) for testing
// src/spotify-client.js: /authorize (auto-approves, redirects back with a
// code), /api/token (PKCE code + refresh, verifies the S256 challenge),
// /v1/me, /v1/me/player (+ play / pause / next / previous / volume / shuffle /
// transfer / devices), /v1/me/playlists, /v1/search.
//
//   node scripts/spotify-simulator.js [port=8889]
// then config.spotify.apiBase = 'http://127.0.0.1:8889/v1',
//      config.spotify.accountsBase = 'http://127.0.0.1:8889'.

const http = require('http');
const crypto = require('crypto');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function startSimulator({ port = 8889, premium = true } = {}) {
  const codes = new Map(); // code → { challenge, redirectUri, clientId }
  const access = new Set(), refresh = new Set();
  const calls = [];
  const sim = { premium, expireNext: false };
  const TRACKS = [
    { name: 'Song One', uri: 'spotify:track:1111111111111111111111', duration_ms: 200000, artists: [{ name: 'Artist A' }], album: { name: 'Album X', images: [{ url: 'https://i.scdn.co/image/x' }] } },
    { name: 'Song Two', uri: 'spotify:track:2222222222222222222222', duration_ms: 180000, artists: [{ name: 'Artist B' }, { name: 'Artist C' }], album: { name: 'Album Y', images: [] } },
  ];
  const devices = [
    { id: 'dev-phone', name: 'Pixel', type: 'Smartphone', is_active: false, volume_percent: 60, is_restricted: false },
    { id: 'dev-kitchen', name: 'Kitchen speaker', type: 'Speaker', is_active: false, volume_percent: 35, is_restricted: false },
  ];
  const st = { active: null, playing: false, idx: 0, shuffle: false, repeat: 'off', progress: 0 };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      calls.push({ method: req.method, path: u.pathname + u.search, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) };
      const none = () => { res.writeHead(204); res.end() };
      const err = (code, message, reason) => json(code, { error: { status: code, message, ...(reason ? { reason } : {}) } });

      if (u.pathname === '/authorize') {
        const q = u.searchParams;
        if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return json(400, { error: 'invalid_request' });
        const code = b64url(crypto.randomBytes(12));
        codes.set(code, { challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), clientId: q.get('client_id') });
        res.writeHead(302, { Location: `${q.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(q.get('state'))}` });
        return res.end();
      }
      if (u.pathname === '/api/token') {
        const f = new URLSearchParams(body);
        const issue = () => { const a = b64url(crypto.randomBytes(16)), r = b64url(crypto.randomBytes(16)); access.add(a); refresh.add(r); return json(200, { access_token: a, token_type: 'Bearer', expires_in: 3600, refresh_token: r, scope: 'user-read-playback-state user-modify-playback-state' }) };
        if (f.get('grant_type') === 'authorization_code') {
          const c = codes.get(f.get('code'));
          if (!c || c.redirectUri !== f.get('redirect_uri') || c.clientId !== f.get('client_id')) return json(400, { error: 'invalid_grant', error_description: 'Invalid authorization code' });
          if (b64url(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest()) !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'code_verifier was incorrect' });
          codes.delete(f.get('code'));
          return issue();
        }
        if (f.get('grant_type') === 'refresh_token') {
          if (!refresh.has(f.get('refresh_token'))) return json(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' });
          refresh.delete(f.get('refresh_token'));
          return issue();
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      if (!u.pathname.startsWith('/v1/')) return err(404, 'Not found');
      const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (sim.expireNext) { sim.expireNext = false; access.delete(tok) }
      if (!access.has(tok)) return err(401, 'The access token expired');
      const p = u.pathname.slice(3), q = u.searchParams, b = body ? JSON.parse(body) : {};
      const control = () => { if (!sim.premium) { err(403, 'Player command failed: Premium required', 'PREMIUM_REQUIRED'); return false } return true };
      const needActive = (devId) => {
        if (devId) { st.active = devId; devices.forEach((d) => { d.is_active = d.id === devId }) }
        if (!st.active) { err(404, 'Player command failed: No active device found', 'NO_ACTIVE_DEVICE'); return false }
        return true;
      };
      const dev = () => devices.find((d) => d.id === st.active);

      if (p === '/me') return json(200, { id: 'lshuser', display_name: 'LSH User', product: sim.premium ? 'premium' : 'free' });
      if (p === '/me/player' && req.method === 'GET') {
        if (!st.active) return none();
        return json(200, { device: dev(), is_playing: st.playing, shuffle_state: st.shuffle, repeat_state: st.repeat, progress_ms: st.progress, item: TRACKS[st.idx], currently_playing_type: 'track' });
      }
      if (p === '/me/player' && req.method === 'PUT') { if (!control()) return; needActive(b.device_ids?.[0]); st.playing = b.play !== false ? true : st.playing; return none() }
      if (p === '/me/player/devices') return json(200, { devices });
      if (p === '/me/player/play') {
        if (!control() || !needActive(q.get('device_id'))) return;
        if (b.uris) st.idx = Math.max(0, TRACKS.findIndex((t) => t.uri === b.uris[0]));
        if (b.context_uri) st.idx = 0;
        st.playing = true; return none();
      }
      if (p === '/me/player/pause') { if (!control() || !needActive()) return; st.playing = false; return none() }
      if (p === '/me/player/next') { if (!control() || !needActive()) return; st.idx = (st.idx + 1) % TRACKS.length; return none() }
      if (p === '/me/player/previous') { if (!control() || !needActive()) return; st.idx = (st.idx + TRACKS.length - 1) % TRACKS.length; return none() }
      if (p === '/me/player/volume') { if (!control() || !needActive()) return; dev().volume_percent = Number(q.get('volume_percent')); return none() }
      if (p === '/me/player/shuffle') { if (!control() || !needActive()) return; st.shuffle = q.get('state') === 'true'; return none() }
      if (p === '/me/playlists') return json(200, { items: [{ uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', name: 'Today’s Top Hits', images: [{ url: 'https://i.scdn.co/image/p' }], tracks: { total: 50 }, owner: { display_name: 'Spotify' } }, null] });
      if (p === '/search') return json(200, { tracks: { items: TRACKS }, playlists: { items: [null] }, albums: { items: [] }, artists: { items: [{ name: 'Artist A', uri: 'spotify:artist:3333333333333333333333', images: [] }] } });
      return err(404, 'Service not found');
    });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(Object.assign(sim, {
    port: server.address().port, calls, state: st, devices,
    close: () => new Promise((r) => server.close(() => r())),
  }))));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8889;
  startSimulator({ port }).then((s) => console.log(`Spotify simulator on http://127.0.0.1:${s.port} (apiBase …/v1, accountsBase …)`));
}

module.exports = { startSimulator };
