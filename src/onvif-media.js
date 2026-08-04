'use strict';

// ONVIF media-service stream/snapshot URI lookup — the piece that's actually
// missing for "point LSH at a camera's ONVIF credentials and it just works":
// GetStreamUri / GetSnapshotUri, so a camera with just
// onvif:{host,port,username,password} doesn't also need a manually-typed
// RTSP/snapshot url. Shares SOAP/auth plumbing and the media-profile lookup
// with onvif-ptz.js (see onvif-soap.js).
//
// cfg = { host, port: 80, username, password, profileToken?, mediaPath? }

const { soapRequest, getProfileToken } = require('./onvif-soap');

const MEDIA_PATHS = ['/onvif/media_service', '/onvif/device_service', '/onvif/Media'];

async function mediaRequest(cfg, bodyXml) {
  const paths = cfg.mediaPath ? [cfg.mediaPath] : MEDIA_PATHS;
  let lastErr;
  for (const path of paths) {
    try { return await soapRequest(cfg, path, bodyXml); }
    catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('ONVIF media request failed');
}

async function getStreamUri(cfg) {
  const token = await getProfileToken(cfg);
  const res = await mediaRequest(cfg,
    `<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">` +
    `<StreamSetup>` +
    `<Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>` +
    `<Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport>` +
    `</StreamSetup>` +
    `<ProfileToken>${token}</ProfileToken></GetStreamUri>`);
  const uri = res.match(/<(?:\w+:)?Uri>([^<]+)</)?.[1];
  if (!uri) throw new Error('ONVIF GetStreamUri response had no Uri');
  return decodeXmlEntities(uri);
}

async function getSnapshotUri(cfg) {
  const token = await getProfileToken(cfg);
  const res = await mediaRequest(cfg,
    `<GetSnapshotUri xmlns="http://www.onvif.org/ver10/media/wsdl">` +
    `<ProfileToken>${token}</ProfileToken></GetSnapshotUri>`);
  const uri = res.match(/<(?:\w+:)?Uri>([^<]+)</)?.[1];
  if (!uri) throw new Error('ONVIF GetSnapshotUri response had no Uri');
  return decodeXmlEntities(uri);
}

// Snapshot/stream URIs sometimes carry embedded credentials or query params
// that come back XML-entity-encoded (&amp; etc).
function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
           .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Convenience: both URIs in one call, for the Settings "fetch" button —
// snapshot is optional on many cameras, so its failure doesn't fail the whole
// probe as long as the stream URI came back.
async function probe(cfg) {
  const streamUri = await getStreamUri(cfg);
  let snapshotUri = null;
  try { snapshotUri = await getSnapshotUri(cfg); } catch { /* not every camera supports it */ }
  return { streamUri, snapshotUri };
}

module.exports = { getStreamUri, getSnapshotUri, probe };
