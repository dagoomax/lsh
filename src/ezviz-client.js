'use strict';

// EZVIZ (Hikvision's consumer range) — cameras, battery cameras, doorbells,
// base stations / NVRs, peephole cameras, smart plugs and the rest of an
// account's devices, through the EZVIZ cloud API the EZVIZ app uses. The calls
// follow the open-source pyEzviz library (Apache 2.0) that Home Assistant's
// EZVIZ integration is built on; EZVIZ doesn't document this API.
//
// One LSH device per EZVIZ device, ezviz/<serial>, with what that device has:
//   online, battery (%), motion (an alarm in the last minute — HomeKit motion),
//   lastEvent / lastEventPicture (time + kind, the alarm's picture URL),
//   motionDetection (arm / disarm alarms), privacy (lens covered), sleep,
//   statusLight, alarmLight, infrared, siren, switch (a smart plug's power),
//   up / down / left / right (PTZ cameras), localIp, model, firmware.
// Live video goes through LSH's own camera pipeline: each camera's local RTSP
// stream (rtsp://admin:<verification code>@<ip>:554/…; the code is on the
// device's sticker) can be added to the camera list from Settings → EZVIZ,
// which brings snapshots, the Cameras view, recording and HomeKit video.
//
// config.ezviz = { username, password, region?: 'eu' (apiieu.ezvizlife.com) |
//   'us' | 'sa' | 'as' | full host, pollInterval?: 30 (s), codes?: { serial: code } }
// The session (not the password) is kept in persist/ezviz-session.json.
// Tested against scripts/ezviz-simulator.js, not yet a real EZVIZ account.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PollingClient = require('./polling-client');

const SESSION_FILE = process.env.LSH_EZVIZ_SESSION || path.join(__dirname, '..', 'persist', 'ezviz-session.json');
const FEATURE_CODE = '1fc28fa018178a1cd1c091b13b2f9f02';
const HEADERS = {
  featureCode: FEATURE_CODE, clientType: '3', osVersion: '', clientVersion: '', netType: 'WIFI', customno: '1000001',
  ssid: '', clientNo: 'web_site', appId: 'ys7', language: 'en_GB', lang: 'en', 'User-Agent': 'okhttp/3.12.1',
};
const PAGE_FILTER = 'CLOUD, TIME_PLAN, CONNECTION, SWITCH,STATUS, WIFI, NODISTURB, KMS,P2P, TIME_PLAN, CHANNEL, VTM, DETECTOR,FEATURE, CUSTOM_TAG, UPGRADE, VIDEO_QUALITY,QOS, PRODUCTS_INFO, SIM_CARD, MULTI_UPGRADE_EXT,FEATURE_INFO';
const CAMERA_CATEGORIES = ['IPC', 'BatteryCamera', 'BDoorBell', 'XVR', 'CatEye', 'COMMON'];
const KIND = { IPC: 'camera', BatteryCamera: 'battery camera', BDoorBell: 'doorbell', XVR: 'base station', CatEye: 'peephole camera', COMMON: 'camera', Socket: 'smart plug' };
// SWITCH types (pyEzviz DeviceSwitchType)
// `switch` = a smart plug's power (the name the dashboard's on/off tile control uses)
const SW = { statusLight: 3, privacy: 7, infrared: 10, switch: 14, sleep: 21, alarmLight: 303 };
const SW_LABEL = { statusLight: 'Status light', privacy: 'Privacy', infrared: 'Infrared', switch: 'Power', sleep: 'Sleep', alarmLight: 'Alarm light' };
const MOTION_WINDOW_MS = 60 * 1000;

const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');
const apiHost = (region) => {
  const r = String(region || 'eu').trim();
  return r.includes('.') ? r : `apii${r}.ezvizlife.com`;
};

function loadSession() { try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) } catch { return null } }
function saveSession(s) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(`${SESSION_FILE}.tmp`, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(`${SESSION_FILE}.tmp`, SESSION_FILE);
}

class EzvizClient extends PollingClient {
  constructor(config, store, sensorRegistry) {
    super({ statusKey: 'ezviz', logTag: 'EZVIZ' });
    this.cfg = config.ezviz || {};
    this.store = store;
    this.registry = sensorRegistry;
    this.session = loadSession();
    this.host = this.session?.apiHost || apiHost(this.cfg.region);
    this.devices = new Map(); // serial → { key, info, device }
    this.error = null;
    this.mfaPending = false;
  }

  async start() {
    if (!this.cfg.username) return;
    await this.startPolling(Math.max(15, Number(this.cfg.pollInterval) || 30) * 1000);
  }

  stop() { this.stopPolling() }

  // ── HTTP ────────────────────────────────────────────────────────────────
  async http(method, p, { form, query, auth = true } = {}) {
    const url = new URL(`https://${this.host}${p}`);
    if (this.cfg.apiBase) url.href = `${this.cfg.apiBase.replace(/\/$/, '')}${p}`; // tests: the simulator
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const headers = { ...HEADERS, ...(auth && this.session?.sessionId ? { sessionId: this.session.sessionId } : {}) };
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(url, { method, headers, body: form ? new URLSearchParams(form).toString() : undefined, signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text) } catch { /* not JSON */ }
    if (res.status === 401) { const e = new Error('EZVIZ session expired'); e.expired = true; throw e }
    if (!res.ok || !j) throw new Error(`EZVIZ HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
    return j;
  }

  // calls that need a session: sign in / refresh once when it's stale
  async call(method, p, opts = {}, retried = false) {
    if (!this.session?.sessionId) await this.login();
    try {
      const j = await this.http(method, p, opts);
      const code = j.meta?.code ?? (j.resultCode != null ? (String(j.resultCode) === '0' ? 200 : Number(j.resultCode)) : 200);
      if ((code === 401 || code === -1) && !retried) { await this.refreshOrLogin(); return this.call(method, p, opts, true) }
      if (code !== 200) throw new Error(`EZVIZ: ${j.meta?.message || j.resultDes || `code ${code}`}`);
      return j;
    } catch (err) {
      if (err.expired && !retried) { await this.refreshOrLogin(); return this.call(method, p, opts, true) }
      throw err;
    }
  }

  async login(smsCode) {
    const form = { account: this.cfg.username, password: md5(this.cfg.password || ''), featureCode: FEATURE_CODE, msgType: smsCode ? '3' : '0', bizType: smsCode ? 'TERMINAL_BIND' : '', cuName: Buffer.from('LSH').toString('base64'), smsCode: smsCode || '' };
    for (let hop = 0; hop < 3; hop++) {
      const j = await this.http('POST', '/v3/users/login/v5', { form, auth: false });
      const code = j.meta?.code;
      if (code === 200) {
        this.host = j.loginArea?.apiDomain || this.host;
        this.session = { sessionId: String(j.loginSession.sessionId), rfSessionId: String(j.loginSession.rfSessionId), apiHost: this.host, username: j.loginUser?.username || this.cfg.username };
        saveSession(this.session);
        this.mfaPending = false;
        this.error = null;
        return this.session;
      }
      if (code === 1100 && j.loginArea?.apiDomain) { this.host = j.loginArea.apiDomain; continue } // another region
      if (code === 6002) {
        await this.http('POST', '/v3/sms/nologin/checkcode', { form: { from: this.cfg.username, bizType: 'TERMINAL_BIND' }, auth: false }).catch(() => {});
        this.mfaPending = true;
        throw new Error('EZVIZ sent a verification code to your e-mail / phone — enter it in Settings → EZVIZ');
      }
      throw new Error({ 1012: 'The verification code is wrong', 1013: 'EZVIZ doesn’t know that user name', 1014: 'Wrong EZVIZ password', 1015: 'The EZVIZ account is locked' }[code] || `EZVIZ sign-in failed (${code}${j.meta?.message ? `: ${j.meta.message}` : ''})`);
    }
    throw new Error('EZVIZ kept redirecting between regions');
  }

  async refreshOrLogin() {
    if (this.session?.rfSessionId) {
      try {
        const j = await this.http('PUT', '/v3/apigateway/login', { form: { refreshSessionId: this.session.rfSessionId, featureCode: FEATURE_CODE }, auth: false });
        if (j.meta?.code === 200 && j.sessionInfo?.sessionId) {
          this.session = { ...this.session, sessionId: String(j.sessionInfo.sessionId), rfSessionId: String(j.sessionInfo.refreshSessionId || this.session.rfSessionId) };
          saveSession(this.session);
          return;
        }
      } catch { /* sign in again */ }
    }
    this.session = null;
    await this.login();
  }

  // ── polling ─────────────────────────────────────────────────────────────
  async _pollImpl() {
    try {
      const pages = await this.call('GET', '/v3/userdevices/v1/resources/pagelist', { query: { filter: PAGE_FILTER } });
      for (const info of pages.deviceInfos || []) this.apply(info, pages);
      // the latest alarm of each camera-like device (motion + picture)
      await Promise.all([...this.devices.values()].filter((d) => d.camera).map((d) => this.pollAlarm(d).catch(() => {})));
      this.error = null;
    } catch (err) { this.error = err.message; throw err }
  }

  apply(info, pages) {
    const serial = info.deviceSerial;
    const status = pages.STATUS?.[serial] || {};
    let optionals = status.optionals || {};
    if (typeof optionals === 'string') { try { optionals = JSON.parse(optionals) } catch { optionals = {} } }
    const switches = Object.fromEntries((pages.SWITCH?.[serial] || []).map((s) => [s.type, !!s.enable]));
    let supportExt = info.supportExt || {};
    if (typeof supportExt === 'string') { try { supportExt = JSON.parse(supportExt) } catch { supportExt = {} } }
    const conn = pages.CONNECTION?.[serial] || {};
    const wifi = pages.WIFI?.[serial] || {};
    const ip = [wifi.address, conn.localIp].find((x) => x && x !== '0.0.0.0') || '';
    const d = this.devices.get(serial) || this.register(serial, info, { switches, supportExt, optionals });
    d.info = { ...info, localIp: ip, rtspPort: Number(conn.localRtspPort) || 554 };
    const set = (k, v) => { if (v !== undefined && v !== null) this.store.update(`${d.key}/${k}`, v) };
    set('online', info.status === 1 ? 1 : 0);
    if (optionals.powerRemaining != null) set('battery', Number(optionals.powerRemaining));
    if (d.paths.has('motionDetection')) set('motionDetection', status.globalStatus ? 1 : 0);
    for (const [k, t] of Object.entries(SW)) if (d.paths.has(k)) set(k, switches[t] ? 1 : 0);
    set('localIp', ip);
    set('firmware', info.version || '');
  }

  register(serial, info, { switches, supportExt, optionals }) {
    const key = `ezviz/${serial}`;
    const camera = CAMERA_CATEGORIES.includes(info.deviceCategory);
    const toggle = (path, label, cap = path) => ({ path, label, format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: cap });
    const trig = (path, label) => ({ path, label, type: 'trigger', controllable: true, writeOn: 'trigger', writeOff: null, capabilityId: path });
    const sensors = [{ path: 'online', label: 'Online', type: 'boolean', format: 'on-off' }];
    if (optionals.powerRemaining != null) sensors.push({ path: 'battery', label: 'Battery', type: 'number', unit: '%', homekit: 'battery-level' });
    if (camera) {
      sensors.push(
        { path: 'motion', label: 'Motion', type: 'boolean', format: 'on-off', homekit: 'motion' },
        { path: 'lastEvent', label: 'Last event', type: 'label' },
        { path: 'lastEventPicture', label: 'Last event picture', type: 'label' },
        toggle('motionDetection', 'Motion detection'),
        { ...toggle('siren', 'Siren'), hint: 'sounds the camera’s siren' },
      );
      if (String(supportExt['154']) === '1') sensors.push(trig('up', 'Up'), trig('down', 'Down'), trig('left', 'Left'), trig('right', 'Right'));
    }
    for (const [k, t] of Object.entries(SW)) if (t in switches) sensors.push(k === 'switch' ? { ...toggle(k, SW_LABEL[k]), homekit: 'switch-rw' } : toggle(k, SW_LABEL[k]));
    sensors.push({ path: 'localIp', label: 'Local address', type: 'label' }, { path: 'firmware', label: 'Firmware', type: 'label' });
    for (const s of sensors) s.ref = `${key}/${s.path}`; // Loxone: each device reads its own values
    const homekit = [...new Set(sensors.map((s) => (s.homekit === 'battery-level' ? 'battery-level' : s.homekit)).filter(Boolean))];
    const device = {
      key, label: info.name || serial, type: 'ezviz', kind: KIND[info.deviceCategory] || String(info.deviceCategory || 'device').toLowerCase(),
      model: info.deviceType || info.deviceSubCategory || '', icon: camera ? '📷' : '🔌', homekit, sensors,
      _writeCapability: (cap, cmd, args) => this.command(serial, cap, cmd, args),
    };
    this.registry.registerDevice(device);
    const d = { key, serial, camera, device, paths: new Set(sensors.map((s) => s.path)), info };
    this.devices.set(serial, d);
    return d;
  }

  async pollAlarm(d) {
    const j = await this.call('GET', '/v3/alarms/v2/advanced', { query: { deviceSerials: d.serial, queryType: -1, limit: 1, stype: -1 } });
    const a = j.alarms?.[0];
    if (!a) return;
    const at = Number(a.alarmStartTime) || parseAlarmTime(a.alarmStartTimeStr);
    this.store.update(`${d.key}/motion`, at && Date.now() - at < MOTION_WINDOW_MS ? 1 : 0);
    this.store.update(`${d.key}/lastEvent`, [a.alarmStartTimeStr, a.sampleName].filter(Boolean).join(' · '));
    if (a.picUrl) this.store.update(`${d.key}/lastEventPicture`, a.picUrl);
  }

  // ── commands ────────────────────────────────────────────────────────────
  async command(serial, cap, cmd) {
    const on = cmd === 'on' || cmd === 'true' || cmd === 1;
    const d = this.devices.get(serial);
    if (cap in SW) {
      await this.call('PUT', `/v3/devices/${serial}/0/${on ? 1 : 0}/${SW[cap]}/switchStatus`);
    } else if (cap === 'motionDetection') {
      await this.call('PUT', `/v3/devices/${serial}/1/changeDefenceStatusReq`, { form: { type: 'Global', status: on ? 1 : 0, actor: 'V' } });
    } else if (cap === 'siren') {
      await this.call('PUT', `/v3/devices/${serial}/0/sendAlarm`, { form: { enable: on ? 2 : 1 } }); // 2 = sound, 1 = silence
    } else if (['up', 'down', 'left', 'right'].includes(cap)) {
      for (const action of ['START', 'STOP']) {
        await this.call('PUT', `/v3/devices/${serial}/ptzControl`, { form: { command: cap.toUpperCase(), action, channelNo: '1', speed: 5, uuid: crypto.randomUUID(), serial } });
      }
      return;
    } else throw new Error(`Unknown EZVIZ command ${cap}`);
    if (d) this.store.update(`${d.key}/${cap}`, on ? 1 : 0);
  }

  // ── for Settings / the camera list ──────────────────────────────────────
  status() {
    return {
      configured: !!this.cfg.username, signedIn: !!this.session?.sessionId, mfaPending: this.mfaPending, error: this.error,
      devices: [...this.devices.values()].map((d) => ({
        serial: d.serial, name: d.device.label, kind: d.device.kind, model: d.device.model, camera: d.camera,
        online: this.store.get(`${d.key}/online`) === 1, localIp: d.info.localIp || '', hasCode: !!this.cfg.codes?.[d.serial],
      })),
    };
  }

  // local RTSP of a camera: user admin, the verification code from the sticker
  rtspUrl(serial, stream = 'main') {
    const d = this.devices.get(serial);
    const code = this.cfg.codes?.[serial];
    if (!d || !d.camera || !d.info.localIp || !code) return null;
    // Hikvision-style path, which EZVIZ cameras answer; config.ezviz.rtspPath overrides (e.g. '/H.264')
    const p = this.cfg.rtspPath || (stream === 'sub' ? '/h264/ch1/sub/av_stream' : '/h264/ch1/main/av_stream');
    return `rtsp://admin:${encodeURIComponent(code)}@${d.info.localIp}:${d.info.rtspPort || 554}${p}`;
  }
}

// "Today 12:03:04" / "2026-10-14 12:03:04" → ms
function parseAlarmTime(s) {
  if (!s) return 0;
  const today = new Date();
  const iso = String(s).replace('Today', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`).replace(' ', 'T');
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

module.exports = EzvizClient;
module.exports.apiHost = apiHost;
module.exports.parseAlarmTime = parseAlarmTime;
