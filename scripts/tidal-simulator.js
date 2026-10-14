#!/usr/bin/env node
'use strict';

// Minimal TIDAL API stand-in (shapes from the official OpenAPI spec,
// tidal-music.github.io/tidal-api-reference) for testing src/tidal-client.js:
// token endpoint (client credentials with Basic auth, authorization code with
// PKCE, refresh), /users/me, /searchResults, /albums, /tracks, /playlists,
// /artists (filter[id] + include, JSON:API) and the user's collection items.
//
//   node scripts/tidal-simulator.js [port=8904]
// then config.tidal = { clientId: 'sim-client', clientSecret: 'sim-secret',
//   apiBase: 'http://127.0.0.1:8904/v2', authBase: 'http://127.0.0.1:8904/oauth2', loginBase: 'http://127.0.0.1:8904' }

const http = require('http');
const crypto = require('crypto');

const art = (id, w) => ({ id: `art-${id}`, type: 'artworks', attributes: { mediaType: 'IMAGE', files: [640, 320, 160].map((x) => ({ href: `https://img.example/${id}/${x}.jpg`, meta: { width: x, height: x } })) } });
const links = (kind, id) => [{ href: `https://tidal.com/browse/${kind}/${id}`, meta: { type: 'TIDAL_SHARING' } }, { href: `https://listen.tidal.com/${kind}/${id}?play=true`, meta: { type: 'TIDAL_AUTOPLAY_WEB' } }];
const DB = {
  artists: { 1: { name: 'Daft Punk' }, 2: { name: 'Pharrell Williams' } },
  albums: { 10: { title: 'Random Access Memories', artists: [1], art: 'ram' }, 11: { title: 'Discovery', artists: [1], art: 'disc' } },
  tracks: { 100: { title: 'Get Lucky', artists: [1, 2], album: 10 }, 101: { title: 'One More Time', artists: [1], album: 11 } },
  playlists: { 'p-1': { name: 'Friday Mix', items: 25, art: 'fri' }, 'p-2': { name: 'Polish Jazz', items: 41, art: 'pj' } },
};

function resource(type, id) {
  const r = DB[type][id];
  if (!r) return null;
  const kind = type.slice(0, -1);
  if (type === 'artists') return { id: String(id), type, attributes: { name: r.name, externalLinks: links('artist', id) }, relationships: { profileArt: { data: [] } } };
  if (type === 'albums') return { id: String(id), type, attributes: { title: r.title, numberOfItems: 13, externalLinks: links(kind, id) }, relationships: { artists: { data: r.artists.map((a) => ({ id: String(a), type: 'artists' })) }, coverArt: { data: [{ id: `art-${r.art}`, type: 'artworks' }] } } };
  if (type === 'tracks') return { id: String(id), type, attributes: { title: r.title, duration: 'PT6M9S', externalLinks: links(kind, id) }, relationships: { artists: { data: r.artists.map((a) => ({ id: String(a), type: 'artists' })) }, albums: { data: [{ id: String(r.album), type: 'albums' }] } } };
  return { id: String(id), type, attributes: { name: r.name, numberOfItems: r.items, externalLinks: links(kind, id) }, relationships: { coverArt: { data: [{ id: `art-${r.art}`, type: 'artworks' }] } } };
}
function included(list, include) {
  const out = new Map();
  for (const r of list) for (const rel of include) for (const x of r.relationships?.[rel]?.data || []) {
    const inc = x.type === 'artworks' ? art(x.id.slice(4)) : resource(x.type, x.id);
    if (inc) out.set(`${inc.type}:${inc.id}`, inc);
  }
  return [...out.values()];
}

function startSimulator({ port = 8904, clientId = 'sim-client', clientSecret = 'sim-secret' } = {}) {
  const calls = [];
  const codes = new Map(); // code → { challenge, redirect }
  const tokens = new Set();
  const userTokens = new Set();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: u.pathname, query: u.search, auth: req.headers.authorization || '' });
      const json = (code, obj, type = 'application/vnd.api+json') => { res.writeHead(code, { 'Content-Type': type }); res.end(JSON.stringify(obj)) };
      if (u.pathname === '/authorize') { // pretend the user approved
        const code = crypto.randomBytes(8).toString('hex');
        codes.set(code, { challenge: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri') });
        res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}` });
        return res.end();
      }
      if (u.pathname === '/oauth2/token' && req.method === 'POST') {
        const f = new URLSearchParams(body);
        const issue = (user) => { const t = crypto.randomBytes(12).toString('hex'); tokens.add(t); if (user) userTokens.add(t); return json(200, { access_token: t, token_type: 'Bearer', expires_in: 3600, ...(user ? { refresh_token: `r-${t}`, scope: 'user.read collection.read playlists.read search.read' } : {}) }, 'application/json') };
        if (f.get('grant_type') === 'client_credentials') {
          if (req.headers.authorization !== `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`) return json(401, { error: 'invalid_client' }, 'application/json');
          return issue(false);
        }
        if (f.get('grant_type') === 'authorization_code') {
          const c = codes.get(f.get('code'));
          const ok = c && c.redirect === f.get('redirect_uri') && crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') === c.challenge;
          codes.delete(f.get('code'));
          return ok ? issue(true) : json(400, { error: 'invalid_grant' }, 'application/json');
        }
        if (f.get('grant_type') === 'refresh_token') return String(f.get('refresh_token')).startsWith('r-') ? issue(true) : json(400, { error: 'invalid_grant' }, 'application/json');
        return json(400, { error: 'unsupported_grant_type' }, 'application/json');
      }
      const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!tokens.has(tok)) return json(401, { errors: [{ status: '401', detail: 'Unauthorized' }] });
      const p = u.pathname.replace(/^\/v2/, '');
      if (p === '/users/me') return userTokens.has(tok) ? json(200, { data: { id: 'u-42', type: 'users', attributes: { username: 'gumax', country: 'PL' } } }) : json(403, { errors: [{ detail: 'Requires user' }] });
      if (p === '/searchResults') {
        const q = (u.searchParams.get('filter[query]') || '').toLowerCase();
        const hit = (type, f) => Object.keys(DB[type]).filter((id) => f(DB[type][id]).toLowerCase().includes(q)).map((id) => ({ id, type }));
        return json(200, { data: [{ id: q, type: 'searchResults', relationships: {
          tracks: { data: hit('tracks', (r) => r.title + ' ' + r.artists.map((a) => DB.artists[a].name).join(' ')) },
          albums: { data: hit('albums', (r) => r.title + ' ' + r.artists.map((a) => DB.artists[a].name).join(' ')) },
          playlists: { data: hit('playlists', (r) => r.name) }, artists: { data: hit('artists', (r) => r.name) },
        } }] });
      }
      const m = /^\/(albums|tracks|playlists|artists)$/.exec(p);
      if (m) {
        const ids = u.searchParams.getAll('filter[id]');
        if (ids.length > 20) return json(400, { errors: [{ detail: 'too many ids' }] });
        const data = ids.map((id) => resource(m[1], id)).filter(Boolean);
        return json(200, { data, included: included(data, u.searchParams.getAll('include')) });
      }
      const coll = /^\/userCollection(Playlists|Albums)\/me\/relationships\/items$/.exec(p);
      if (coll) {
        if (!userTokens.has(tok)) return json(403, { errors: [{ detail: 'Requires user' }] });
        return json(200, { data: coll[1] === 'Playlists' ? [{ id: 'p-2', type: 'playlists' }, { id: 'p-1', type: 'playlists' }] : [{ id: '11', type: 'albums' }] });
      }
      json(404, { errors: [{ detail: 'not found' }] });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ port: server.address().port, base, calls, clientId, clientSecret, close: () => new Promise((r) => server.close(r)) });
  }));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8904;
  startSimulator({ port }).then((s) => console.log(`TIDAL API simulator on ${s.base} (client ${s.clientId} / ${s.clientSecret})`));
}

module.exports = { startSimulator };
