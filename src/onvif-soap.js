'use strict';

// Shared ONVIF SOAP 1.2 plumbing — WS-UsernameToken (PasswordDigest) auth and
// the request/response envelope handling used by both onvif-ptz.js (PTZ) and
// onvif-media.js (stream/snapshot URIs). No dependencies.

const http   = require('http');
const crypto = require('crypto');

const profileCache = new Map(); // host:port → profile token

function securityHeader(username, password) {
  if (!username) return '';
  const nonce   = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const digest  = crypto.createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created + password)]))
    .digest('base64');
  return `<s:Header><Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">` +
    `<UsernameToken>` +
    `<Username>${username}</Username>` +
    `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>` +
    `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>` +
    `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>` +
    `</UsernameToken></Security></s:Header>`;
}

function soapRequest(cfg, path, bodyXml) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">` +
    securityHeader(cfg.username, cfg.password || '') +
    `<s:Body>${bodyXml}</s:Body></s:Envelope>`;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: cfg.host,
      port:     cfg.port || 80,
      path,
      method:   'POST',
      timeout:  6000,
      headers:  {
        'Content-Type':   'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(xml),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400 || /:(Fault|fault)>/.test(data)) {
          const reason = data.match(/<[^>]*Text[^>]*>([^<]+)</)?.[1] || `HTTP ${res.statusCode}`;
          return reject(new Error(`ONVIF ${reason}`));
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ONVIF timeout')); });
    req.end(xml);
  });
}

async function getProfileToken(cfg) {
  if (cfg.profileToken) return cfg.profileToken;
  const cacheKey = `${cfg.host}:${cfg.port || 80}`;
  if (profileCache.has(cacheKey)) return profileCache.get(cacheKey);

  const body  = `<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>`;
  const paths = [cfg.mediaPath || '/onvif/media_service', '/onvif/device_service', '/onvif/Media'];
  let lastErr;
  for (const path of paths) {
    try {
      const res   = await soapRequest(cfg, path, body);
      const token = res.match(/Profiles[^>]*\stoken="([^"]+)"/)?.[1];
      if (token) { profileCache.set(cacheKey, token); return token; }
      lastErr = new Error('No media profiles in ONVIF response');
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('ONVIF GetProfiles failed');
}

module.exports = { soapRequest, securityHeader, getProfileToken };
