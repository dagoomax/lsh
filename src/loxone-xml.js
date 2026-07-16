'use strict';

/**
 * Loxone Config XML template generator (Miniserver / Loxone Config 17.1).
 *
 * Generates ready-to-import Virtual Output / Virtual HTTP Input templates for
 * LSH devices, in the exact format proven by the hand-built templates
 * (VirtualOut driving /api/device/<key>/set, VirtualInHttp polling
 * /api/devices with a JSON substring Check ending in `"value":\v`).
 */

function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Loxone command recognition Check: the literal JSON serialization of this
// sensor's reading as it appears in /api/devices, with `\v` capturing the
// value. Contiguous and unique per sensor (readings serialize as
// { ...sensor, value } with value appended last).
function checkPattern(sensor) {
  const json = JSON.stringify({ ...sensor, value: 0 });
  return json.slice(1, -1).replace(/"value":0$/, '"value":\\v');
}

function setUrl(deviceKey, sensorPath, value, token) {
  return `/api/device/${encodeURIComponent(deviceKey)}/set` +
    `?sensor=${encodeURIComponent(sensorPath)}&value=${value}&token=${token}`;
}

// Momentary buttons (Somfy up/down/stop/my, Grenton blind commands):
// declared as toggles for the dashboard, but writeOn === writeOff means
// firing them is the whole action — stateless, pulse-only.
function isMomentary(s) {
  return s.controllable && s.type === 'toggle' && s.writeOn && s.writeOn === s.writeOff;
}

function isInputSensor(s) {
  return !s.hidden && s.type !== 'color' && s.type !== 'trigger' && !isMomentary(s);
}

function isOutputSensor(s) {
  return !s.hidden && s.controllable && s.type !== 'color';
}

/**
 * VirtualInHttp template — feedback: Miniserver polls /api/devices and
 * extracts one value per VirtualInHttpCmd.
 */
function buildInputsXml(devices, { host, token, pollingMs = 5000 } = {}) {
  const cmds = [];
  for (const device of devices) {
    for (const sensor of (device.sensors || []).filter(isInputSensor)) {
      const isRange = sensor.type === 'range' || sensor.type === 'color-temp';
      const minVal  = isRange ? (sensor.min ?? 0) : 0;
      const maxVal  = isRange ? (sensor.max ?? 100) : (sensor.type === 'boolean' ? 1 : 1000000);
      const title   = `${device.label} ${sensor.name || sensor.label || sensor.path}`;
      cmds.push(
        `\t<VirtualInHttpCmd Title="${xmlEsc(title)}" Comment="${xmlEsc(`${device.key}/${sensor.path}`)}" ` +
        `Check="${xmlEsc(checkPattern(sensor))}" ` +
        `Signed="true" Analog="true" SourceValLow="0" DestValLow="0" SourceValHigh="0" DestValHigh="0" ` +
        `DefVal="0" MinVal="${minVal}" MaxVal="${maxVal}"/>`
      );
    }
  }

  if (!cmds.length) return null;

  const title = devices.length === 1 ? `LSH ${devices[0].label}` : 'LSH Devices';
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<VirtualInHttp Title="${xmlEsc(title)} (feedback)" ` +
    `Comment="Reads device states from LSH /api/devices" ` +
    `Address="http://${xmlEsc(host)}/api/devices?token=${xmlEsc(token)}" ` +
    `PollingTime="${pollingMs}">\n${cmds.join('\n')}\n</VirtualInHttp>\n`;
}

/**
 * VirtualOut template — commands: Miniserver calls /api/device/<key>/set.
 */
function buildOutputsXml(devices, { host, token } = {}) {
  const cmds = [];
  for (const device of devices) {
    for (const sensor of (device.sensors || []).filter(isOutputSensor)) {
      const title   = `${device.label} ${sensor.name || sensor.label || sensor.path}`;
      const comment = `${device.key}/${sensor.path} [${sensor.type || 'toggle'}]`;
      const common  = `Comment="${xmlEsc(comment)}" Title="${xmlEsc(title)}" RepeatRate="0" Repeat="0"`;

      if (sensor.type === 'range' || sensor.type === 'color-temp') {
        // Analog: Loxone substitutes <v> with the analog value
        cmds.push(
          `\t<VirtualOutCmd ${common} Analog="true" MinVal="${(sensor.min ?? 0).toFixed(1)}" MaxVal="${(sensor.max ?? 100).toFixed(1)}" ` +
          `CmdOffPost="" CmdOffHTTP="" CmdOff="" CmdOnPost="" CmdOnHTTP="" ` +
          `CmdOn="${xmlEsc(setUrl(device.key, sensor.path, '<v>', token))}" ` +
          `CmdOffMethod="GET" CmdOnMethod="GET"/>`
        );
      } else if (sensor.type === 'trigger' || isMomentary(sensor)) {
        // Momentary (trigger, or toggle with writeOn === writeOff — e.g. RTS
        // up/down/stop/my): pulse fires CmdOn only; an off-edge must not
        // re-fire the same command.
        cmds.push(
          `\t<VirtualOutCmd ${common} Analog="false" ` +
          `CmdOffPost="" CmdOffHTTP="" CmdOff="" CmdOnPost="" CmdOnHTTP="" ` +
          `CmdOn="${xmlEsc(setUrl(device.key, sensor.path, '1', token))}" ` +
          `CmdOffMethod="GET" CmdOnMethod="GET"/>`
        );
      } else {
        // Digital on/off
        cmds.push(
          `\t<VirtualOutCmd ${common} Analog="false" ` +
          `CmdOffPost="" CmdOffHTTP="" CmdOff="${xmlEsc(setUrl(device.key, sensor.path, '0', token))}" ` +
          `CmdOnPost="" CmdOnHTTP="" CmdOn="${xmlEsc(setUrl(device.key, sensor.path, '1', token))}" ` +
          `CmdOffMethod="GET" CmdOnMethod="GET"/>`
        );
      }
    }
  }

  if (!cmds.length) return null;

  const title = devices.length === 1 ? `LSH ${devices[0].label}` : 'LSH Devices';
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<VirtualOut CmdSep="" CloseAfterSend="true" CmdInit="" Address="http://${xmlEsc(host)}" ` +
    `Comment="Device commands via LSH REST API" Title="${xmlEsc(title)}">\n` +
    `${cmds.join('\n')}\n</VirtualOut>\n`;
}

module.exports = { buildInputsXml, buildOutputsXml };
