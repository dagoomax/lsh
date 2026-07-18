'use strict';

// Minimal ONVIF PTZ control — ContinuousMove / Stop only, no dependencies.
// Speaks SOAP 1.2 with WS-UsernameToken (PasswordDigest) auth, which is what
// KENIK / TVT / XiongMai DVRs and most generic IP cameras expect. The media
// profile token is discovered once via GetProfiles and cached per host.
//
// cfg = { host, port: 80, username, password, profileToken?, ptzPath?, mediaPath? }

const http   = require('http');
const crypto = require('crypto');

const profileCache = new Map();   // host:port → profile token

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

// op: left | right | up | down | zoomin | zoomout | stop; speed 0..1
async function ptz(cfg, op, speed = 0.5) {
  const s     = Math.min(1, Math.max(0.05, Number(speed) || 0.5));
  const token = await getProfileToken(cfg);
  const path  = cfg.ptzPath || '/onvif/ptz_service';

  if (op === 'stop') {
    return soapRequest(cfg, path,
      `<Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl">` +
      `<ProfileToken>${token}</ProfileToken><PanTilt>true</PanTilt><Zoom>true</Zoom></Stop>`);
  }

  const v = {
    left:    { x: -s, y: 0, z: 0 },
    right:   { x: s,  y: 0, z: 0 },
    up:      { x: 0,  y: s, z: 0 },
    down:    { x: 0,  y: -s, z: 0 },
    zoomin:  { x: 0,  y: 0, z: s },
    zoomout: { x: 0,  y: 0, z: -s },
  }[op];
  if (!v) throw new Error(`Unknown PTZ op: ${op}`);

  return soapRequest(cfg, path,
    `<ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">` +
    `<ProfileToken>${token}</ProfileToken>` +
    `<Velocity>` +
    `<PanTilt x="${v.x}" y="${v.y}" xmlns="http://www.onvif.org/ver10/schema"/>` +
    `<Zoom x="${v.z}" xmlns="http://www.onvif.org/ver10/schema"/>` +
    `</Velocity></ContinuousMove>`);
}

module.exports = { ptz };
