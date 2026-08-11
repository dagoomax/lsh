'use strict';

// Minimal ONVIF PTZ control — ContinuousMove / Stop only, no dependencies.
// Speaks SOAP 1.2 with WS-UsernameToken (PasswordDigest) auth, which is what
// KENIK / TVT / XiongMai DVRs and most generic IP cameras expect. The media
// profile token is discovered once via GetProfiles and cached per host (see
// onvif-soap.js, shared with onvif-media.js).
//
// cfg = { host, port: 80, username, password, profileToken?, ptzPath?, mediaPath? }

const { soapRequest, getProfileToken, getVideoSourceToken } = require('./onvif-soap');

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

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// ── Presets — standard ONVIF PTZ operations (GetPresets/SetPreset/
// GotoPreset/RemovePreset), unlike Reolink/Axis which need vendor-specific
// CGI calls (see reolink-client.js / axis-client.js).
async function listPresets(cfg) {
  const token = await getProfileToken(cfg);
  const path  = cfg.ptzPath || '/onvif/ptz_service';
  const res = await soapRequest(cfg, path,
    `<GetPresets xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>${token}</ProfileToken></GetPresets>`);
  const out = [];
  const re = /<[^:>]*:?Preset[^>]*\stoken="([^"]+)"[^>]*>([\s\S]*?)<\/[^:>]*:?Preset>/g;
  let m;
  while ((m = re.exec(res))) {
    const name = m[2].match(/<[^:>]*:?Name>([^<]*)</)?.[1];
    out.push({ id: m[1], name: name || `Preset ${m[1]}` });
  }
  return out;
}

// No PresetToken in the request → device assigns a new one and creating
// (rather than overwriting) is guaranteed.
async function setPreset(cfg, name) {
  const token = await getProfileToken(cfg);
  const path  = cfg.ptzPath || '/onvif/ptz_service';
  const res = await soapRequest(cfg, path,
    `<SetPreset xmlns="http://www.onvif.org/ver20/ptz/wsdl">` +
    `<ProfileToken>${token}</ProfileToken>` +
    `<PresetName>${escapeXml(name || 'Preset')}</PresetName>` +
    `</SetPreset>`);
  const id = res.match(/<[^:>]*:?PresetToken>([^<]+)</)?.[1];
  return { id, name: name || 'Preset' };
}

async function gotoPreset(cfg, id) {
  const token = await getProfileToken(cfg);
  const path  = cfg.ptzPath || '/onvif/ptz_service';
  await soapRequest(cfg, path,
    `<GotoPreset xmlns="http://www.onvif.org/ver20/ptz/wsdl">` +
    `<ProfileToken>${token}</ProfileToken>` +
    `<PresetToken>${escapeXml(id)}</PresetToken>` +
    `</GotoPreset>`);
}

async function removePreset(cfg, id) {
  const token = await getProfileToken(cfg);
  const path  = cfg.ptzPath || '/onvif/ptz_service';
  await soapRequest(cfg, path,
    `<RemovePreset xmlns="http://www.onvif.org/ver20/ptz/wsdl">` +
    `<ProfileToken>${token}</ProfileToken>` +
    `<PresetToken>${escapeXml(id)}</PresetToken>` +
    `</RemovePreset>`);
}

module.exports = { ptz, listPresets, setPreset, gotoPreset, removePreset };
