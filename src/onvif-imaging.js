'use strict';

// ONVIF Imaging service — IR-cut filter (night-mode) control. Standard
// across Profile S devices, unlike PTZ presets/patrol which vary a lot by
// vendor. cfg = { host, port, username, password, imagingPath? }, same
// shape as onvif-ptz.js's cfg.

const { soapRequest, getVideoSourceToken } = require('./onvif-soap');

// mode is from the caller's perspective: 'on' = night vision / IR visible,
// 'off' = normal day color, 'auto' = let the camera decide. ONVIF's
// IrCutFilter is the physical cut filter, so its sense is inverted: ON means
// the filter is inserted (blocking IR — day mode), OFF means removed (IR
// passes through — night mode).
async function setIr(cfg, mode) {
  const IR = { on: 'OFF', off: 'ON', auto: 'AUTO' }[mode];
  if (!IR) throw new Error("mode must be 'on', 'off', or 'auto'");
  const token = await getVideoSourceToken(cfg);
  const path  = cfg.imagingPath || '/onvif/imaging_service';
  // Sent as a partial ImagingSettings — most Profile S devices (this is used
  // against cheap generic ONVIF cameras, not tested against a full stack)
  // accept updating a single field rather than requiring the whole settings
  // block echoed back.
  await soapRequest(cfg, path,
    `<SetImagingSettings xmlns="http://www.onvif.org/ver20/imaging/wsdl">` +
    `<VideoSourceToken>${token}</VideoSourceToken>` +
    `<ImagingSettings><IrCutFilter xmlns="http://www.onvif.org/ver10/schema">${IR}</IrCutFilter></ImagingSettings>` +
    `</SetImagingSettings>`);
}

async function getIr(cfg) {
  const token = await getVideoSourceToken(cfg);
  const path  = cfg.imagingPath || '/onvif/imaging_service';
  const res = await soapRequest(cfg, path,
    `<GetImagingSettings xmlns="http://www.onvif.org/ver20/imaging/wsdl">` +
    `<VideoSourceToken>${token}</VideoSourceToken>` +
    `</GetImagingSettings>`);
  const ir   = res.match(/<[^:>]*:?IrCutFilter>([^<]+)</)?.[1]?.toUpperCase();
  const mode = { ON: 'off', OFF: 'on', AUTO: 'auto' }[ir] || 'auto';
  return { mode };
}

module.exports = { getIr, setIr };
