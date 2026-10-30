'use strict';

// HTTP Digest / Basic auth for camera CGI APIs (Dahua, …). Same scheme as
// axis-client.js: try the request, answer a 401 challenge once.
//
// target = { host, port?, https?, username, password }

const http   = require('http');
const https  = require('https');
const crypto = require('crypto');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function parseAuthHeader(h) {
  const out = {};
  const scheme = /^\s*(\w+)/.exec(h || '');
  out._scheme = scheme ? scheme[1].toLowerCase() : '';
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let m;
  while ((m = re.exec(h || ''))) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

function digestAuthHeader(t, method, uri, chal) {
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';
  const qop = chal.qop ? (chal.qop.split(',').map((s) => s.trim()).includes('auth') ? 'auth' : chal.qop.split(',')[0].trim()) : null;
  const ha1 = md5(`${t.username || ''}:${chal.realm || ''}:${t.password || ''}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${chal.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${chal.nonce}:${ha2}`);
  let h = `Digest username="${t.username || ''}", realm="${chal.realm || ''}", nonce="${chal.nonce || ''}", uri="${uri}", response="${response}"`;
  if (chal.opaque) h += `, opaque="${chal.opaque}"`;
  if (chal.algorithm) h += `, algorithm=${chal.algorithm}`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

const basicAuthHeader = (t) => 'Basic ' + Buffer.from(`${t.username || ''}:${t.password || ''}`).toString('base64');

function authFor(t, method, uri, wwwAuthenticate) {
  const chal = parseAuthHeader(wwwAuthenticate);
  return chal._scheme === 'basic' ? basicAuthHeader(t) : digestAuthHeader(t, method, uri, chal);
}

// Opens a request and hands back the response stream (body not read).
function open(t, uri, { method = 'GET', authorization, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const proto = t.https ? https : http;
    const headers = authorization ? { Authorization: authorization } : {};
    const req = proto.request({
      hostname: t.host, port: Number(t.port) || (t.https ? 443 : 80), path: uri, method,
      rejectUnauthorized: false, timeout, headers,
    }, resolve);
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout talking to ${t.host}`)));
    req.end();
  });
}

const readAll = (res) => new Promise((resolve, reject) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => resolve(Buffer.concat(chunks)));
  res.on('error', reject);
});

// Authenticated response stream — for long-lived streams (event attach).
async function stream(t, uri, opts = {}) {
  let res = await open(t, uri, opts);
  if (res.statusCode === 401) {
    res.resume();
    res = await open(t, uri, { ...opts, authorization: authFor(t, opts.method || 'GET', uri, res.headers['www-authenticate']) });
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    res.resume();
    throw new Error(res.statusCode === 401 ? 'Login rejected (check username / password)' : `HTTP ${res.statusCode}`);
  }
  return res;
}

// Whole response: { status, headers, buffer }; throws on non-2xx.
async function request(t, uri, opts = {}) {
  const res = await stream(t, uri, opts);
  return { status: res.statusCode, headers: res.headers, buffer: await readAll(res) };
}

module.exports = { request, stream, parseAuthHeader, digestAuthHeader };
