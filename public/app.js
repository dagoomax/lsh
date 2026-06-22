// ── State ──────────────────────────────────────────────────────────────────
const socket      = io();
const statusEl    = document.getElementById('connection-status');
const sourceBadge = document.getElementById('source-badge');
const relaysCon   = document.getElementById('relays-container');
const batteryBar  = document.getElementById('battery-bar');
const lastUpdate  = document.getElementById('last-update');
const devicesGrid = document.getElementById('devices-grid');
const devicesHdr  = document.getElementById('devices-header');
const roomsGrid   = document.getElementById('rooms-grid');

const knownDevices  = new Map();
const cameraTimers  = new Map();
const cameraLogCache = new Map(); // camera name → [entries...]

// ── Socket events ──────────────────────────────────────────────────────────
socket.on('connect', () => {
  statusEl.textContent = window.t ? window.t('header.connected') : 'Connected';
  statusEl.className = 'connection-status connected';
  loadRelays();
  loadCameras();
});

socket.on('disconnect', () => {
  statusEl.textContent = window.t ? window.t('header.disconnected') : 'Disconnected';
  statusEl.className = 'connection-status disconnected';
  setSourceBadge(null);
});

socket.on('connect_error', (err) => {
  if (err.message === 'Unauthorized') {
    window.location.href = '/login.html';
  }
});

socket.on('connection-status', (status) => {
  setSourceBadge(status.source);
});

socket.on('snapshot', (data) => {
  for (const [key, value] of Object.entries(data)) applyValue(key, value);
  updateTimestamp();
});

socket.on('update', (data) => {
  for (const [key, value] of Object.entries(data)) applyValue(key, value);
  updateTimestamp();
});

socket.on('devices', (devices) => {
  for (const device of devices) addOrUpdateDevice(device);
});

socket.on('device-discovered', (device) => addOrUpdateDevice(device));

socket.on('platform-status', (status) => renderPlatformBar(status));

socket.on('camera-event', (entry) => {
  const list = cameraLogCache.get(entry.camera) || [];
  list.unshift(entry);
  if (list.length > 200) list.length = 200;
  cameraLogCache.set(entry.camera, list);
  // Update live if the modal is open for this camera
  if (_modalCam && _modalCam.name === entry.camera) {
    _prependCameraLogEntry(entry);
  }
});

// ── Value application ──────────────────────────────────────────────────────
function applyValue(key, value) {
  // Update static DOM bindings
  document.querySelectorAll(`[data-key="${key}"]`).forEach((el) => {
    el.textContent = fmt(value, el.dataset.format);
  });

  // Special handlers
  if (key === 'system/0/Dc/Battery/Soc') {
    updateBatteryBar(value);
    _flow.batSoc = Number(value);
    updateFlowDiagram();
  }
  if (key === 'system/0/Dc/Battery/Power') { _flow.batPower = Number(value); updateFlowDiagram(); }
  if (key === 'system/0/Dc/Battery/State') updateBatteryState(value);
  if (key.startsWith('solaredge/')) updateSolarEdge(key, value);
  if (key === 'system/0/Ac/Grid/L1/Power') { _flow.grid = Number(value); updateFlowDiagram(); }
  if (key === 'system/0/Dc/Pv/Power') { _flow.solar = Number(value); updateFlowDiagram(); }
  if (key === 'system/0/Ac/Consumption/L1/Power') { _flow.loads = Number(value); updateFlowDiagram(); }
  if (key.match(/^system\/0\/Relay\/\d+\/State$/)) {
    const idx = parseInt(key.split('/')[3]);
    updateRelayUI(idx, value === 1);
  }

  // Update device sensor cells
  updateDeviceSensor(key, value);
}

// ── Formatters ─────────────────────────────────────────────────────────────
const MPPT_STATES = {
  0:'Off', 2:'Fault', 3:'Bulk', 4:'Absorption', 5:'Float',
  6:'Storage', 7:'Equalize', 11:'External Control',
};
const VEBUS_STATES = {
  0:'Off', 1:'Low Power', 2:'Fault', 3:'Bulk', 4:'Absorption',
  5:'Float', 6:'Storage', 7:'Equalize', 8:'Passthru', 9:'Inverting',
  10:'Power Assist', 11:'Power Supply', 244:'Sustain', 252:'External Control',
  256:'Discharging', 257:'Sustain',
};
const VEBUS_MODES     = { 1:'Charger Only', 2:'Inverter Only', 3:'On', 4:'Off' };
const BATTERY_STATES  = { 0:'Idle', 1:'Charging', 2:'Discharging' };
const TANK_STATUSES   = { 0:'OK', 1:'Disconnected', 2:'Short Circuit', 3:'Reversed', 4:'Unknown' };
const FLUID_TYPES     = { 0:'Fuel', 1:'Fresh Water', 2:'Waste Water', 3:'Live Well', 4:'Oil', 5:'Black Water', 6:'Gasoline' };
const TEMP_TYPES      = { 0:'Battery', 1:'Fridge', 2:'Generic', 3:'Room', 4:'Outdoor', 5:'Water Heater' };
const DINPUT_TYPES    = { 0:'Door', 1:'Bilge Pump', 2:'Bilge Alarm', 3:'Burglar Alarm', 4:'Smoke Alarm', 5:'Fire Alarm', 6:'CO₂ Alarm', 7:'Generator', 8:'None', 9:'Pulsemeter', 10:'Tank Pump' };
const GENERATOR_STATES = { 0:'Stopped', 1:'Running', 10:'Error' };
const CHARGER_STATES  = { 0:'Off', 1:'Low Power', 2:'Fault', 3:'Bulk', 4:'Absorption', 5:'Float', 6:'Storage', 7:'Equalize' };
const MPPT_ERRORS     = { 0:'OK', 1:'Bat temp high', 2:'Bat volt high', 17:'Chgr temp high', 18:'Over-current', 20:'Bulk timeout', 26:'Terminals hot', 33:'PV volt high', 34:'PV current high', 38:'Input shutdown', 67:'BMS lost', 116:'Cal data lost', 119:'Settings lost' };

function fmt(value, format) {
  if (value === null || value === undefined) return '--';
  switch (format) {
    case 'voltage':       return `${Number(value).toFixed(2)} V`;
    case 'current':       return `${Number(value).toFixed(1)} A`;
    case 'power':
    case 'power-raw':     return fmtPower(value);
    case 'energy':        return `${Number(value).toFixed(2)} kWh`;
    case 'energy-wh': {
      const kwh = Number(value) / 1000;
      return kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${kwh.toFixed(2)} kWh`;
    }
    case 'capacity':      return `${Number(value).toFixed(1)} Ah`;
    case 'percent':       return `${Number(value).toFixed(1)} %`;
    case 'frequency':     return `${Number(value).toFixed(2)} Hz`;
    case 'temperature':   return `${Number(value).toFixed(1)} °C`;
    case 'pressure':      return `${Number(value).toFixed(0)} hPa`;
    case 'volume':        return `${Number(value).toFixed(0)} L`;
    case 'speed':         return `${(Number(value) * 3.6).toFixed(1)} km/h`;
    case 'degrees':       return `${Number(value).toFixed(1)}°`;
    case 'count':         return String(Math.round(Number(value)));
    case 'number':        return Number(value).toFixed(2);
    case 'gps-coord':     return Number(value).toFixed(6);
    case 'on-off':        return value ? 'ON' : 'OFF';
    case 'alarm':         return value === 1 ? '⚠ ALARM' : 'OK';
    case 'grid-status':   return value === 1 ? 'Connected' : 'Disconnected';
    case 'gps-fix':       return value === 1 ? 'Fix' : 'No Fix';
    case 'mppt-state':    return MPPT_STATES[value]     ?? `State ${value}`;
    case 'mppt-error':    return MPPT_ERRORS[value]     ?? `Error ${value}`;
    case 'vebus-state':   return VEBUS_STATES[value]    ?? `State ${value}`;
    case 'vebus-mode':    return VEBUS_MODES[value]     ?? `Mode ${value}`;
    case 'battery-state': return BATTERY_STATES[value]  ?? `State ${value}`;
    case 'charger-state': return CHARGER_STATES[value]  ?? `State ${value}`;
    case 'tank-status':   return TANK_STATUSES[value]   ?? `Status ${value}`;
    case 'fluid-type':    return FLUID_TYPES[value]     ?? `Type ${value}`;
    case 'temp-type':     return TEMP_TYPES[value]      ?? `Type ${value}`;
    case 'dinput-type':   return DINPUT_TYPES[value]    ?? `Type ${value}`;
    case 'generator-state': return GENERATOR_STATES[value] ?? `State ${value}`;
    case 'time':
    case 'duration': {
      if (!value || value <= 0) return '--';
      const h = Math.floor(value / 3600);
      const m = Math.floor((value % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    case 'co2':           return `${Math.round(Number(value))} ppm`;
    case 'voc':           return `${Math.round(Number(value))} µg/m³`;
    case 'pm25':          return `${Number(value).toFixed(1)} µg/m³`;
    case 'pm10':          return `${Number(value).toFixed(1)} µg/m³`;
    case 'aqi':           return `AQI ${Math.round(Number(value))}`;
    case 'led':           return value === 1 ? '●' : '○';
    case 'washer-state':  return typeof value === 'string' ? value.replace(/_/g, ' ') : String(value);
    default:              return typeof value === 'number' ? Number(value).toFixed(1) : String(value);
  }
}

function fmtPower(value) {
  const abs = Math.abs(Number(value));
  return abs >= 1000 ? `${(abs / 1000).toFixed(2)} kW` : `${Math.round(abs)} W`;
}

// ── Battery bar ────────────────────────────────────────────────────────────
function updateBatteryBar(soc) {
  if (soc == null) return;
  batteryBar.style.width = `${Math.min(100, Math.max(0, soc))}%`;
  batteryBar.classList.remove('low', 'medium');
  if (soc < 20) batteryBar.classList.add('low');
  else if (soc < 50) batteryBar.classList.add('medium');
}

// ── Battery state badge ────────────────────────────────────────────────────
function updateBatteryState(state) {
  const badge = document.getElementById('bat-state-badge');
  if (!badge) return;
  const map = { 0: ['Idle', 'idle'], 1: ['Charging', 'charging'], 2: ['Discharging', 'discharging'] };
  const [label, cls] = map[state] || ['', ''];
  badge.textContent = label;
  badge.className = `charge-badge ${cls}`;
  const stateEl = document.getElementById('fl-bat-state');
  if (stateEl) stateEl.textContent = label || 'Battery';
}

// ── SolarEdge card ────────────────────────────────────────────────────────
function updateSolarEdge(key, value) {
  const section = document.getElementById('se-section');
  if (section) section.style.display = '';

  if (key === 'solaredge/gridPower') {
    const badge = document.getElementById('se-grid-badge');
    if (badge) {
      const v = Number(value);
      if (v > 10)       { badge.textContent = 'Importing'; badge.className = 'grid-flow-badge importing'; }
      else if (v < -10) { badge.textContent = 'Exporting'; badge.className = 'grid-flow-badge exporting'; }
      else              { badge.textContent = '';           badge.className = 'grid-flow-badge'; }
    }
  }

  if (key === 'solaredge/batteryLevel' && value != null) {
    const row = document.getElementById('se-battery-row');
    if (row) row.style.display = '';
  }
}

// ── Energy flow diagram ────────────────────────────────────────────────────
const _flow = { solar: null, grid: null, batPower: null, loads: null, batSoc: null };

function _setFlowH(id, active, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('fc-active', !!active);
  if (color) el.style.setProperty('--fc-clr', color);
}

function updateFlowDiagram() {
  const { solar, grid, batPower, loads, batSoc } = _flow;

  // Solar → Battery: active when solar producing
  _setFlowH('fc-s2b', solar != null && solar > 10, 'var(--accent-solar)');

  // Battery → Loads: active when loads drawing or battery discharging
  const loadsOn = (loads != null && loads > 10) || (batPower != null && batPower < -10);
  _setFlowH('fc-b2l', loadsOn, 'var(--accent-orange)');

  // Grid ↕ Battery: importing vs exporting
  const importing = grid != null && grid > 10;
  const exporting = grid != null && grid < -10;
  const fc = document.getElementById('fc-g2b');
  const arrowEl = document.getElementById('fc-g2b-arrow');
  if (fc) {
    fc.classList.remove('fc-active', 'fc-importing', 'fc-exporting');
    if (importing) { fc.classList.add('fc-active', 'fc-importing'); if (arrowEl) arrowEl.textContent = '▲'; }
    else if (exporting) { fc.classList.add('fc-active', 'fc-exporting'); if (arrowEl) arrowEl.textContent = '▼'; }
    else { if (arrowEl) arrowEl.textContent = '▲'; }
  }

  // Grid card badge
  const gridBadge = document.getElementById('grid-flow-badge');
  if (gridBadge) {
    if (importing)      { gridBadge.textContent = 'Importing'; gridBadge.className = 'grid-flow-badge importing'; }
    else if (exporting) { gridBadge.textContent = 'Exporting'; gridBadge.className = 'grid-flow-badge exporting'; }
    else                { gridBadge.textContent = ''; gridBadge.className = 'grid-flow-badge'; }
  }

  // Grid value in flow (show absolute, label changes)
  const gridEl = document.getElementById('fl-grid');
  if (gridEl) gridEl.textContent = grid != null ? fmtPower(Math.abs(grid)) : '--';
  const gridLbl = document.getElementById('fl-grid-lbl');
  if (gridLbl) {
    if (importing) gridLbl.textContent = 'Importing';
    else if (exporting) gridLbl.textContent = 'Exporting';
    else gridLbl.textContent = 'Grid';
  }

  // Flow values
  const solEl = document.getElementById('fl-solar');
  if (solEl) solEl.textContent = solar != null ? fmtPower(solar) : '--';
  const loadsEl = document.getElementById('fl-loads');
  if (loadsEl) loadsEl.textContent = loads != null ? fmtPower(loads) : '--';

  // Battery SOC in flow
  if (batSoc != null) {
    const socEl = document.getElementById('fl-soc');
    if (socEl) socEl.textContent = `${Math.round(batSoc)}%`;
    const fill = document.getElementById('fl-bat-fill');
    if (fill) {
      fill.style.width = `${batSoc}%`;
      fill.style.background = batSoc < 20 ? 'var(--accent-red)' : batSoc < 50 ? 'var(--accent-yellow)' : 'var(--accent-battery)';
    }
    // Battery icon fill (SVG rect in flow)
    const iconFill = document.getElementById('bat-icon-fill');
    if (iconFill) {
      const w = Math.max(0, (batSoc / 100) * 18).toFixed(1);
      iconFill.setAttribute('width', w);
      iconFill.style.fill = batSoc < 20 ? 'var(--accent-red)' : batSoc < 50 ? 'var(--accent-yellow)' : 'var(--accent-battery)';
    }
    const wrap = document.getElementById('bat-icon-wrap');
    if (wrap) wrap.style.color = batSoc < 20 ? 'var(--accent-red)' : batSoc < 50 ? 'var(--accent-yellow)' : 'var(--accent-battery)';
  }

  // Live dot pulses whenever flow data is present
  const dot = document.getElementById('flow-live-dot');
  if (dot) {
    const hasData = solar != null || grid != null || loads != null;
    dot.classList.toggle('active', hasData);
  }
}

// ── Relays ─────────────────────────────────────────────────────────────────
async function loadRelays() {
  try {
    const res = await fetch('/api/relays');
    const { data } = await res.json();
    renderRelays(data);
  } catch { /* ignore */ }
}

function renderRelays(relays) {
  const relaysSection = document.getElementById('relays-section');
  if (relaysSection) relaysSection.style.display = relays.length ? '' : 'none';
  relaysCon.innerHTML = '';
  for (const relay of relays) {
    const item = document.createElement('div');
    item.className = 'relay-item';
    item.innerHTML = `
      <div>
        <div class="relay-name">${esc(relay.name)}</div>
        <div class="relay-status" id="relay-status-${relay.index}">${relay.on ? (window.t ? window.t('relay.on') : 'ON') : (window.t ? window.t('relay.off') : 'OFF')}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="relay-toggle-${relay.index}" ${relay.on ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>`;
    item.querySelector('input').addEventListener('change', (e) =>
      toggleRelay(relay.index, e.target.checked, e.target));
    relaysCon.appendChild(item);
  }
}

function updateRelayUI(index, on) {
  const cb = document.getElementById(`relay-toggle-${index}`);
  if (cb) cb.checked = on;
  const st = document.getElementById(`relay-status-${index}`);
  if (st) st.textContent = on
    ? (window.t ? window.t('relay.on') : 'ON')
    : (window.t ? window.t('relay.off') : 'OFF');
}

async function toggleRelay(index, on, checkbox) {
  checkbox.disabled = true;
  try {
    const res = await fetch(`/api/relay/${index}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on }),
    });
    if (!res.ok) { checkbox.checked = !on; }
  } catch { checkbox.checked = !on; }
  finally { checkbox.disabled = false; }
}

// ── Cameras ────────────────────────────────────────────────────────────────
async function loadCameras() {
  try {
    const res = await fetch('/api/cameras');
    const { data } = await res.json();
    renderCameras(data || []);
  } catch { /* ignore */ }
}

function renderCameras(cameras) {
  const section = document.getElementById('cameras-section');
  const grid    = document.getElementById('cameras-grid');

  // Stop MJPEG streams before wiping the grid
  grid.querySelectorAll('.camera-snapshot').forEach(img => { img.src = ''; });
  cameraTimers.forEach(t => clearInterval(t));
  cameraTimers.clear();

  if (!cameras.length) { section.style.display = 'none'; return; }

  section.style.display = '';
  grid.innerHTML = '';

  for (const cam of cameras) {
    const card     = document.createElement('div');
    card.className = 'camera-item';

    const hasMjpeg    = !!(cam.mjpegUrl    && cam.mjpegUrl.trim());
    const hasSnapshot = !!(cam.snapshotUrl && cam.snapshotUrl.trim());

    const preview = document.createElement('div');
    preview.className = 'camera-preview';

    if (hasMjpeg) {
      const img = document.createElement('img');
      img.className = 'camera-snapshot';
      img.alt = cam.name;
      img.src = cam.mjpegUrl;           // browser streams natively
      preview.appendChild(img);
    } else if (hasSnapshot) {
      const img = document.createElement('img');
      img.className = 'camera-snapshot';
      img.alt = cam.name;
      img.loading = 'lazy';
      img.src = cam.snapshotUrl;
      preview.appendChild(img);
      const refresh = () => { img.src = `${cam.snapshotUrl}?_=${Date.now()}`; };
      cameraTimers.set(cam.name, setInterval(refresh, 10000));
    } else {
      preview.innerHTML = `<div class="camera-no-snapshot">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.35"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        <span>No snapshot</span>
      </div>`;
    }

    const hasWebrtc = !!(cam.webrtcUrl && cam.webrtcUrl.trim());
    const badge = hasMjpeg  ? '<span class="cam-live-badge">LIVE</span>'
                : hasWebrtc ? '<span class="cam-live-badge cam-webrtc-badge">WebRTC</span>'
                : '';

    card.innerHTML = `<div class="camera-name">${esc(cam.name)}${badge}</div>`;
    card.appendChild(preview);
    card.insertAdjacentHTML('beforeend', `
      <div class="camera-footer">
        <span class="camera-url" title="${esc(cam.url || '')}">${esc(cam.url || '—')}</span>
      </div>`);

    card.addEventListener('click', () => openCameraModal(cam));
    grid.appendChild(card);
  }
}

// ── Camera modal ────────────────────────────────────────────────────────────

let _modalTimer = null;
let _modalCam   = null;
let _activePc   = null;   // active RTCPeerConnection

function openCameraModal(cam) {
  _modalCam = cam;
  _closeModalStreams();   // clean up any previous session

  document.getElementById('cam-modal-title').textContent = cam.name;
  document.getElementById('cam-modal-url').textContent   = cam.url || '';

  const video  = document.getElementById('cam-modal-video');
  const img    = document.getElementById('cam-modal-img');
  const noSnap = document.getElementById('cam-modal-no-snap');
  const info   = document.getElementById('cam-modal-refresh');

  // Reset all panels
  video.style.display  = 'none';
  img.style.display    = 'none';
  noSnap.style.display = 'none';
  video.srcObject      = null;
  img.src              = '';
  img.alt              = cam.name;

  if (cam.webrtcUrl && cam.webrtcUrl.trim()) {
    video.style.display = 'block';
    info.textContent    = 'WebRTC connecting…';
    _startWebRTC(video, cam.webrtcUrl.trim())
      .then(pc => {
        _activePc = pc;
        info.textContent = 'WebRTC live';
      })
      .catch(err => {
        console.error('[WebRTC]', err.message);
        info.textContent = `WebRTC failed — ${err.message}`;
        // Graceful fallback to MJPEG or snapshot
        video.style.display = 'none';
        if (cam.mjpegUrl && cam.mjpegUrl.trim()) {
          img.style.display = 'block';
          img.src           = cam.mjpegUrl;
          info.textContent  = 'Fallback: MJPEG';
        } else if (cam.snapshotUrl && cam.snapshotUrl.trim()) {
          img.style.display = 'block';
          _refreshModalSnap(cam.snapshotUrl);
          _modalTimer = setInterval(() => _refreshModalSnap(cam.snapshotUrl), 2000);
          info.textContent = 'Fallback: snapshot (2 s)';
        }
      });

  } else if (cam.mjpegUrl && cam.mjpegUrl.trim()) {
    img.style.display = 'block';
    img.src           = cam.mjpegUrl;
    info.textContent  = 'MJPEG live stream';

  } else if (cam.snapshotUrl && cam.snapshotUrl.trim()) {
    img.style.display = 'block';
    _refreshModalSnap(cam.snapshotUrl);
    info.textContent = 'Refreshing every 2 s';
    _modalTimer = setInterval(() => _refreshModalSnap(cam.snapshotUrl), 2000);

  } else {
    noSnap.style.display = 'flex';
    info.textContent     = '';
  }

  document.getElementById('cam-modal').style.display = 'flex';
  document.getElementById('cam-modal-close').focus();

  // Populate event log from cache, then fetch fresh from API
  _renderCameraLog(cameraLogCache.get(cam.name) || []);
  _loadCameraLog(cam.name);
}

function _refreshModalSnap(url) {
  const img  = document.getElementById('cam-modal-img');
  const next = new Image();
  next.onload = () => { img.src = next.src; };
  next.src = `${url}?_=${Date.now()}`;
}

function _closeModalStreams() {
  clearInterval(_modalTimer);
  _modalTimer = null;
  if (_activePc) { _activePc.close(); _activePc = null; }
  const img   = document.getElementById('cam-modal-img');
  const video = document.getElementById('cam-modal-video');
  if (img)   img.src        = '';
  if (video) video.srcObject = null;
}

function closeCameraModal() {
  document.getElementById('cam-modal').style.display = 'none';
  _closeModalStreams();
  _modalCam = null;
}

document.getElementById('cam-modal-close').addEventListener('click', closeCameraModal);
document.querySelector('.cam-modal-backdrop').addEventListener('click', closeCameraModal);

// ── Camera event log ─────────────────────────────────────────────────────────

async function _loadCameraLog(cameraName) {
  try {
    const r = await fetch(`/api/camera-log?camera=${encodeURIComponent(cameraName)}&limit=100`);
    const { data } = await r.json();
    if (!data) return;
    cameraLogCache.set(cameraName, data);
    if (_modalCam && _modalCam.name === cameraName) _renderCameraLog(data);
  } catch { /* ignore */ }
}

function _fmtLogTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const LOG_LABELS = {
  motion:            '🟡 Motion detected',
  sound:             '🔊 Sound detected',
  snapshot:          '📸 Snapshot updated',
  'capture-triggered': '▶ Capture triggered',
};

function _camLogEntryHTML(entry) {
  const label = LOG_LABELS[entry.type] || entry.type;
  const detail = entry.detail ? `<span class="cam-log-detail" title="${esc(entry.detail)}">${esc(entry.detail)}</span>` : '';
  return `<div class="cam-log-entry">
    <span class="cam-log-ts">${_fmtLogTime(entry.ts)}</span>
    <span class="cam-log-type ${entry.type}">${label}</span>
    ${detail}
  </div>`;
}

function _renderCameraLog(entries) {
  const el = document.getElementById('cam-log-entries');
  if (!el) return;
  if (!entries.length) {
    el.innerHTML = '<span class="cam-log-empty">No events yet</span>';
    return;
  }
  el.innerHTML = entries.map(_camLogEntryHTML).join('');
}

function _prependCameraLogEntry(entry) {
  const el = document.getElementById('cam-log-entries');
  if (!el) return;
  const empty = el.querySelector('.cam-log-empty');
  if (empty) empty.remove();
  el.insertAdjacentHTML('afterbegin', _camLogEntryHTML(entry));
}

document.getElementById('cam-log-refresh').addEventListener('click', () => {
  if (_modalCam) _loadCameraLog(_modalCam.name);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _modalCam) closeCameraModal();
});

// ── SIP softphone ─────────────────────────────────────────────────────────────

let _sipConfig    = null;
let _loadedCameras = [];
let _sipCamTimer  = null;

// Extend loadCameras to keep a copy for SIP camera matching
const _origLoadCameras = loadCameras;
async function loadCameras() {
  try {
    const res = await fetch('/api/cameras');
    const { data } = await res.json();
    _loadedCameras = data || [];
    renderCameras(_loadedCameras);
  } catch { /* ignore */ }
}

async function _initSip() {
  try {
    const res = await fetch('/api/settings');
    const { data } = await res.json();
    const cfg = data?.sip;
    if (!cfg?.wsUrl || !cfg?.username) return; // not configured
    _sipConfig = cfg;
    window.sipPhone.start(cfg);
  } catch { /* ignore */ }
}

// SIP event handlers
sipPhone.addEventListener('registered', () => {
  _setSipStatus('green', 'SIP registered');
});
sipPhone.addEventListener('unregistered', () => {
  _setSipStatus('yellow', 'SIP unregistered');
});
sipPhone.addEventListener('registrationFailed', (e) => {
  _setSipStatus('red', 'SIP registration failed: ' + (e.detail?.cause || ''));
});

sipPhone.addEventListener('incoming', (e) => {
  const { name, uri } = e.detail;
  window._ringtone.start();
  _showCallModal('incoming', name, uri);
});

sipPhone.addEventListener('calling', (e) => {
  _showCallModal('calling', '', e.detail?.uri || '');
});

sipPhone.addEventListener('connected', () => {
  window._ringtone.stop();
  _switchCallActions('active');
  document.getElementById('sip-call-state').textContent = 'Connected';
  document.getElementById('sip-call-icon').textContent  = '📞';
  document.getElementById('sip-call-timer').style.display = '';
});

sipPhone.addEventListener('tick', (e) => {
  const s = e.detail.seconds;
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  document.getElementById('sip-call-timer').textContent = `${m}:${ss}`;
});

sipPhone.addEventListener('muteChanged', (e) => {
  const btn = document.getElementById('sip-btn-mute');
  if (btn) btn.textContent = e.detail.muted ? '🔇 Unmute' : '🎤 Mute';
});

sipPhone.addEventListener('ended', () => {
  window._ringtone.stop();
  clearInterval(_sipCamTimer);
  _sipCamTimer = null;
  document.getElementById('sip-call-modal').style.display = 'none';
});

// Button wiring
document.getElementById('sip-btn-answer').addEventListener('click', () => sipPhone.answer());
document.getElementById('sip-btn-reject').addEventListener('click', () => sipPhone.reject());
document.getElementById('sip-btn-hangup').addEventListener('click', () => sipPhone.hangup());
document.getElementById('sip-btn-cancel').addEventListener('click', () => sipPhone.hangup());

document.getElementById('sip-btn-mute').addEventListener('click', () => sipPhone.toggleMute());

document.getElementById('sip-btn-unlock').addEventListener('click', async () => {
  if (_sipConfig?.dtmfUnlock) sipPhone.sendDtmf(_sipConfig.dtmfUnlock);
  const idx = _sipConfig?.relayIndex;
  if (idx !== undefined && idx !== null && idx !== '') {
    await fetch(`/api/relay/${idx}/state`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: true }),
    });
    setTimeout(() => fetch(`/api/relay/${idx}/state`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: false }),
    }), 2500);
    document.getElementById('sip-btn-unlock').textContent = '✓ Unlocked';
    setTimeout(() => { document.getElementById('sip-btn-unlock').textContent = '🔓 Unlock'; }, 3000);
  }
});

// Keyboard shortcuts for call modal
document.addEventListener('keydown', e => {
  if (document.getElementById('sip-call-modal').style.display === 'none') return;
  if (e.key === 'Enter' && sipPhone.state === 'incoming') sipPhone.answer();
  if (e.key === 'Escape') sipPhone.hangup();
});

// Dial modal
document.getElementById('sip-dial-btn').addEventListener('click', () => {
  document.getElementById('sip-dial-modal').style.display = 'flex';
  document.getElementById('sip-dial-input').focus();
});
document.getElementById('sip-btn-cancel-dial').addEventListener('click', () => {
  document.getElementById('sip-dial-modal').style.display = 'none';
});
document.getElementById('sip-btn-call').addEventListener('click', () => {
  const target = document.getElementById('sip-dial-input').value.trim();
  if (!target) return;
  document.getElementById('sip-dial-modal').style.display = 'none';
  document.getElementById('sip-dial-input').value = '';
  sipPhone.call(target);
});
document.getElementById('sip-dial-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('sip-btn-call').click();
  if (e.key === 'Escape') document.getElementById('sip-btn-cancel-dial').click();
});

// ── SIP helpers ───────────────────────────────────────────────────────────────

function _setSipStatus(color, title) {
  const wrap = document.getElementById('sip-status');
  const dot  = document.getElementById('sip-status-dot');
  wrap.style.display = '';
  dot.className = `sip-status-dot sip-dot-${color}`;
  wrap.title = title;
}

function _findCameraForCaller(callerUri) {
  // Extract host from sip:user@host or user@host
  const match = callerUri.match(/@([\d.a-zA-Z.-]+)/);
  if (!match) return null;
  const callerHost = match[1];
  return _loadedCameras.find(c =>
    [c.url, c.snapshotUrl, c.mjpegUrl].some(u => u && u.includes(callerHost))
  ) || null;
}

function _showCallModal(phase, name, uri) {
  const modal    = document.getElementById('sip-call-modal');
  const camWrap  = document.getElementById('sip-call-cam');
  const camImg   = document.getElementById('sip-call-cam-img');
  const nameEl   = document.getElementById('sip-call-name');
  const uriEl    = document.getElementById('sip-call-uri');
  const timerEl  = document.getElementById('sip-call-timer');
  const stateEl  = document.getElementById('sip-call-state');
  const iconEl   = document.getElementById('sip-call-icon');

  nameEl.textContent  = name || '';
  uriEl.textContent   = uri || '';
  timerEl.style.display = 'none';
  timerEl.textContent   = '0:00';
  iconEl.textContent    = phase === 'calling' ? '📱' : '📞';
  stateEl.textContent   = phase === 'incoming' ? 'Incoming Call'
                        : phase === 'calling'  ? 'Calling…'
                        : 'Connecting…';

  _switchCallActions(phase);

  // Auto-match camera by caller IP
  clearInterval(_sipCamTimer);
  const cam = _findCameraForCaller(uri);
  if (cam?.snapshotUrl) {
    camWrap.style.display = '';
    camImg.src = cam.snapshotUrl;
    _sipCamTimer = setInterval(() => { camImg.src = `${cam.snapshotUrl}?_=${Date.now()}`; }, 5000);
  } else {
    camWrap.style.display = 'none';
    camImg.src = '';
  }

  modal.style.display = 'flex';
  (phase === 'incoming'
    ? document.getElementById('sip-btn-answer')
    : document.getElementById('sip-btn-cancel')
  ).focus();
}

function _switchCallActions(phase) {
  document.getElementById('sip-actions-incoming').style.display = phase === 'incoming' ? '' : 'none';
  document.getElementById('sip-actions-active').style.display   = phase === 'active'   ? '' : 'none';
  document.getElementById('sip-actions-calling').style.display  = phase === 'calling'  ? '' : 'none';
}

// Init SIP after socket connects
socket.on('connect', () => {
  if (!_sipConfig) _initSip();
});

// ── WebRTC (WHEP) ────────────────────────────────────────────────────────────
// Implements the WebRTC HTTP Egress Protocol (WHEP, RFC 9559).
// Works with go2rtc, mediamtx, Frigate, and any WHEP-compliant server.

async function _startWebRTC(videoEl, whepUrl) {
  const pc = new RTCPeerConnection({
    iceServers:   [{ urls: 'stun:stun.l.google.com:19302' }],
    bundlePolicy: 'max-bundle',
  });

  pc.ontrack = e => {
    if (e.streams && e.streams[0]) videoEl.srcObject = e.streams[0];
  };

  // Receive-only — no camera/mic access needed
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE candidates (max 3 s to avoid stalling on restricted networks)
  await new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 3000);
  });

  // POST complete SDP offer to WHEP endpoint via server proxy
  const resp = await fetch('/api/webrtc/offer', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url: whepUrl, sdp: pc.localDescription.sdp }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }

  const { sdp, error } = await resp.json();
  if (error) throw new Error(error);

  await pc.setRemoteDescription({ type: 'answer', sdp });
  return pc;
}

// ── Color conversion utilities ────────────────────────────────────────────
// SmartThings hue: 0–100, saturation: 0–100 (not 0–360 / 0–100%)
function hsvToHex(stHue, stSat) {
  const h = stHue / 100, s = stSat / 100, v = 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r=v; g=t; b=p; break; case 1: r=q; g=v; b=p; break;
    case 2: r=p; g=v; b=t; break; case 3: r=p; g=q; b=v; break;
    case 4: r=t; g=p; b=v; break; default: r=v; g=p; b=q;
  }
  return '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function hexToHsv(hex) {
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g-b)/d % 6) / 6;
    else if (max === g) h = ((b-r)/d + 2) / 6;
    else h = ((r-g)/d + 4) / 6;
    if (h < 0) h += 1;
  }
  return { hue: Math.round(h * 100), saturation: max ? Math.round((d/max) * 100) : 0 };
}

function syncColorInput(el) {
  el.value = hsvToHex(el._hue ?? 0, el._sat ?? 100);
}

function formatRangeDisplay(rangeFormat, value) {
  const v = Math.round(value);
  if (rangeFormat === 'percent') return `${v}%`;
  if (rangeFormat === 'color-temp') return `${v}K`;
  return String(v);
}

// ── Card size ─────────────────────────────────────────────────────────────
const SIZE_ICONS = { normal: '⊞', compact: '–', expanded: '⊠' };
const SIZE_CYCLE = ['normal', 'compact', 'expanded'];

function applyCardSize(card, size) {
  card.classList.remove('compact', 'expanded');
  if (size !== 'normal') card.classList.add(size);
  const btn = card.querySelector('.card-size-btn');
  if (btn) btn.textContent = SIZE_ICONS[size] || '⊞';
}

function cycleCardSize(card, deviceKey) {
  const cur = SIZE_CYCLE.find(s => card.classList.contains(s)) || 'normal';
  const next = SIZE_CYCLE[(SIZE_CYCLE.indexOf(cur) + 1) % SIZE_CYCLE.length];
  localStorage.setItem(`card-size-${deviceKey}`, next);
  applyCardSize(card, next);
}

// ── Debounce + send command ───────────────────────────────────────────────
const debounceTimers = new Map();
function debounce(key, fn, delay = 300) {
  if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
  debounceTimers.set(key, setTimeout(() => { debounceTimers.delete(key); fn(); }, delay));
}

async function sendDeviceCommand(deviceKey, sensorPath, value) {
  try {
    const res = await fetch(`/api/device/${deviceKey}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor: sensorPath, value }),
    });
    if (!res.ok) console.warn('[Control] Command failed:', res.status);
  } catch (err) {
    console.warn('[Control] Command error:', err.message);
  }
}

// ── Device cards ───────────────────────────────────────────────────────────
function buildSensorRow(sensor, readings, deviceKey) {
  if (sensor.hidden) return '';
  const fullKey = `${deviceKey}/${sensor.path}`;
  const reading  = readings[sensor.path];

  if (sensor.controllable && (sensor.type === 'range' || sensor.type === 'color-temp')) {
    const cur  = reading?.value ?? sensor.min ?? 0;
    const disp = formatRangeDisplay(sensor.format, cur);
    return `<div class="sensor-row sensor-row-range">
      <span class="sensor-label">${esc(sensor.name)}</span>
      <div class="sensor-range-wrap">
        <input type="range" class="sensor-range"
          min="${sensor.min ?? 0}" max="${sensor.max ?? 100}" step="1" value="${cur}"
          data-sensor-key="${fullKey}" data-device-key="${deviceKey}" data-sensor-path="${sensor.path}">
        <span class="sensor-range-val" data-sensor-key="${fullKey}" data-range-format="${sensor.format}">${disp}</span>
      </div>
    </div>`;
  }

  if (sensor.controllable && sensor.type === 'color') {
    const hue = readings['hue']?.value ?? 0;
    const sat = readings['saturation']?.value ?? 100;
    return `<div class="sensor-row sensor-row-color">
      <span class="sensor-label">${esc(sensor.name)}</span>
      <input type="color" class="sensor-color" value="${hsvToHex(hue, sat)}"
        data-device-key="${deviceKey}" data-sensor-path="color"
        data-hue-key="${deviceKey}/hue" data-sat-key="${deviceKey}/saturation">
    </div>`;
  }

  if (sensor.controllable && sensor.type === 'trigger') {
    return `<div class="sensor-row sensor-row-ctrl">
      <span class="sensor-label">${esc(sensor.name)}</span>
      <button class="sensor-trigger-btn"
        data-sensor-key="${fullKey}" data-device-key="${deviceKey}" data-sensor-path="${sensor.path}">&#9654; Send</button>
    </div>`;
  }

  if (sensor.controllable) {
    const checked = reading && reading.value === 1 ? ' checked' : '';
    return `<div class="sensor-row sensor-row-ctrl">
      <span class="sensor-label">${esc(sensor.name)}</span>
      <label class="toggle">
        <input type="checkbox" class="sensor-toggle"
          data-sensor-key="${fullKey}" data-device-key="${deviceKey}" data-sensor-path="${sensor.path}"${checked}>
        <span class="toggle-slider"></span>
      </label>
    </div>`;
  }

  const value = reading ? fmt(reading.value, sensor.format) : '--';
  const alarmClass = sensor.format === 'alarm' ? ' sensor-alarm' : '';
  return `<div class="sensor-row${alarmClass}">
    <span class="sensor-label">${esc(sensor.name)}</span>
    <span class="sensor-value" data-sensor-key="${fullKey}">${value}</span>
  </div>`;
}

function addOrUpdateDevice(device) {
  if (!device || !device.key) return;

  devicesHdr.style.display = '';

  if (knownDevices.has(device.key)) {
    const readings = device.readings || {};
    for (const [sensorPath, reading] of Object.entries(readings)) {
      updateDeviceSensor(`${device.key}/${sensorPath}`, reading.value);
    }
    return;
  }

  knownDevices.set(device.key, device);

  const card = document.createElement('section');
  card.className = `device-card device-${device.color || 'blue'}`;
  card.id = `device-${device.key.replace(/\//g, '-')}`;

  const readings = device.readings || {};
  const sensorRows = (device.sensors || []).map((s) => buildSensorRow(s, readings, device.key)).join('');
  const homekitBadges = (device.homekit || []).map((hk) =>
    `<span class="hk-badge">${hkLabel(hk)}</span>`).join('');

  card.innerHTML = `
    <div class="device-header">
      <span class="device-icon">${device.icon || '📟'}</span>
      <div style="flex:1;min-width:0">
        <div class="device-title">${esc(device.label)}</div>
        <div class="device-meta">
          <span class="device-instance">${device.type}/${device.instance}</span>
          ${homekitBadges}
        </div>
      </div>
      <button class="card-size-btn" title="Resize card">${SIZE_ICONS.normal}</button>
    </div>
    <div class="sensor-list">${sensorRows}</div>`;

  devicesGrid.appendChild(card);

  const savedSize = localStorage.getItem(`card-size-${device.key}`) || 'normal';
  applyCardSize(card, savedSize);
  card.querySelector('.card-size-btn').addEventListener('click', () => cycleCardSize(card, device.key));

  updateTabCounts();

  if (activeTab === 'rooms' && !roomsBuilt.has(device.key)) {
    roomsBuilt.add(device.key);
    const emptyEl = roomsGrid?.querySelector('.rooms-empty');
    if (emptyEl) emptyEl.remove();
    roomsGrid?.appendChild(buildRoomCard(device));
  }
}

// ── Device control events (toggle, range, color) ──────────────────────────
devicesGrid.addEventListener('click', async (e) => {
  const btn = e.target.closest('.sensor-trigger-btn');
  if (!btn || btn.disabled) return;
  const deviceKey  = btn.dataset.deviceKey;
  const sensorPath = btn.dataset.sensorPath;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '…';
  try {
    const res = await fetch(`/api/device/${deviceKey}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor: sensorPath, value: true }),
    });
    btn.textContent = res.ok ? '✓' : '✗';
  } catch {
    btn.textContent = '✗';
  }
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
});

devicesGrid.addEventListener('change', async (e) => {
  const input = e.target;
  if (!input.classList.contains('sensor-toggle')) return;
  const deviceKey  = input.dataset.deviceKey;
  const sensorPath = input.dataset.sensorPath;
  const value = input.checked;
  input.disabled = true;
  try {
    const res = await fetch(`/api/device/${deviceKey}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor: sensorPath, value }),
    });
    if (!res.ok) input.checked = !value;
  } catch { input.checked = !value; }
  finally { input.disabled = false; }
});

devicesGrid.addEventListener('input', (e) => {
  const input = e.target;

  if (input.classList.contains('sensor-range')) {
    const deviceKey  = input.dataset.deviceKey;
    const sensorPath = input.dataset.sensorPath;
    const val = parseFloat(input.value);
    const dispEl = document.querySelector(`.sensor-range-val[data-sensor-key="${CSS.escape(input.dataset.sensorKey)}"]`);
    if (dispEl) dispEl.textContent = formatRangeDisplay(dispEl.dataset.rangeFormat, val);
    debounce(`range-${deviceKey}-${sensorPath}`, () => sendDeviceCommand(deviceKey, sensorPath, val));
    return;
  }

  if (input.classList.contains('sensor-color')) {
    const deviceKey  = input.dataset.deviceKey;
    const sensorPath = input.dataset.sensorPath;
    const color = hexToHsv(input.value);
    debounce(`color-${deviceKey}`, () => sendDeviceCommand(deviceKey, sensorPath, color));
  }
});

function updateDeviceSensor(fullKey, value) {
  const cells = document.querySelectorAll(`[data-sensor-key="${CSS.escape(fullKey)}"]`);
  cells.forEach((cell) => {
    if (cell.tagName === 'INPUT' && cell.type === 'checkbox') {
      if (!cell.disabled) cell.checked = value === 1;
      return;
    }
    if (cell.tagName === 'INPUT' && cell.type === 'range') {
      if (!cell.disabled) cell.value = value;
      return;
    }
    if (cell.dataset.rangeFormat) {
      cell.textContent = formatRangeDisplay(cell.dataset.rangeFormat, value);
      return;
    }
    const format = cell.dataset.format || guessFormat(fullKey);
    cell.textContent = fmt(value, format);
    if (format === 'alarm') cell.classList.toggle('alarm-active', value === 1);
  });

  // Color picker updates via hue/saturation paths
  document.querySelectorAll(`input.sensor-color[data-hue-key="${CSS.escape(fullKey)}"]`)
    .forEach(el => { el._hue = value; syncColorInput(el); });
  document.querySelectorAll(`input.sensor-color[data-sat-key="${CSS.escape(fullKey)}"]`)
    .forEach(el => { el._sat = value; syncColorInput(el); });
}

function guessFormat(key) {
  if (key.includes('/Temperature')) return 'temperature';
  if (key.includes('/Voltage') || key.endsWith('/V')) return 'voltage';
  if (key.includes('/Current') || key.endsWith('/I')) return 'current';
  if (key.includes('/Power') || key.endsWith('/P')) return 'power';
  if (key.includes('/Soc') || key.includes('/Level') || key.includes('/Humidity')) return 'percent';
  if (key.includes('/Frequency') || key.endsWith('/F')) return 'frequency';
  if (key.includes('/Yield')) return 'energy';
  return 'number';
}

function hkLabel(hk) {
  const map = {
    temperature: 'Temp', humidity: 'Humidity', battery: 'Battery',
    tank: 'Tank', contact: 'Contact', 'switch-rw': 'Switch',
    'battery-level': 'Battery', motion: 'Motion', smoke: 'Smoke',
    co: 'CO', leak: 'Leak', occupancy: 'Presence', thermostat: 'Thermostat',
    lock: 'Lock', cover: 'Cover', fan: 'Fan', lux: 'Lux',
    'air-quality': 'Air Quality', 'co2-sensor': 'CO₂',
  };
  return map[hk] || hk;
}

// ── Timestamp ──────────────────────────────────────────────────────────────
function setSourceBadge(source) {
  if (!sourceBadge) return;
  if (!source) { sourceBadge.style.display = 'none'; return; }
  sourceBadge.style.display = '';
  if (source === 'mqtt') {
    sourceBadge.textContent = 'Local MQTT';
    sourceBadge.className = 'source-badge source-mqtt';
  } else if (source === 'vrm') {
    sourceBadge.textContent = 'VRM Cloud';
    sourceBadge.className = 'source-badge source-vrm';
  } else {
    sourceBadge.style.display = 'none';
  }
}

function updateTimestamp() {
  lastUpdate.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Platform status logos ──────────────────────────────────────────────────

const PLATFORMS = [
  { key: 'victron-mqtt', label: 'MQTT',         color: '#0066cc', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M8 20l5-10 3 6 2-4 4 8" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { key: 'victron-vrm',  label: 'VRM',          color: '#0066cc', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 11h12M16 11v10M12 21h8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>' },
  { key: 'smartthings',  label: 'SmartThings',  color: '#15bfff', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="16" cy="16" r="5" fill="#fff"/><circle cx="16" cy="7"  r="2" fill="#fff"/><circle cx="16" cy="25" r="2" fill="#fff"/><circle cx="7"  cy="16" r="2" fill="#fff"/><circle cx="25" cy="16" r="2" fill="#fff"/></svg>' },
  { key: 'solaredge',    label: 'SolarEdge',    color: '#f47920', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 8v2M16 22v2M8 16H6M26 16h-2M10.3 10.3l-1.4-1.4M23.1 23.1l-1.4-1.4M10.3 21.7l-1.4 1.4M23.1 8.9l-1.4 1.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="16" r="4" fill="#fff"/></svg>' },
  { key: 'loxone',       label: 'Loxone',       color: '#69b034', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="9" y="9" width="14" height="14" rx="2" fill="#fff"/><rect x="13" y="13" width="6" height="6" rx="1" fill="currentColor"/></svg>' },
  { key: 'satel',        label: 'Satel',        color: '#e31e24', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M11 11h10v10H11z" fill="none" stroke="#fff" stroke-width="2"/><path d="M14 14h4v4h-4z" fill="#fff"/></svg>' },
  { key: 'unifi',        label: 'UniFi',        color: '#0559c9', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 9a7 7 0 010 14 7 7 0 010-14z" fill="none" stroke="#fff" stroke-width="2"/><path d="M16 13a3 3 0 010 6 3 3 0 010-6z" fill="#fff"/></svg>' },
  { key: 'shelly',       label: 'Shelly',       color: '#f0a500', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 10v6l4 2" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="3" fill="#fff"/></svg>' },
  { key: 'mqtt-explorer',label: 'Explorer',     color: '#7c3aed', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="10" cy="10" r="2.5" fill="#fff"/><circle cx="22" cy="10" r="2.5" fill="#fff"/><circle cx="10" cy="22" r="2.5" fill="#fff"/><circle cx="22" cy="22" r="2.5" fill="#fff"/><path d="M12.5 10h7M10 12.5v7M22 12.5v7M12.5 22h7" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>' },
  { key: 'boneio',       label: 'BoneIO',       color: '#1a73e8', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="10" cy="10" r="3" fill="#fff"/><circle cx="22" cy="10" r="3" fill="#fff"/><circle cx="10" cy="22" r="3" fill="#fff"/><circle cx="22" cy="22" r="3" fill="#fff"/><path d="M13 10h6M10 13v6M22 13v6M13 22h6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>' },
  { key: 'fibaro',       label: 'Fibaro',       color: '#e4181c', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 10h12v3H10zM10 16h8v3h-8zM10 22h5v3h-5z" fill="#fff"/></svg>' },
  { key: 'lgthinq',     label: 'LG ThinQ',    color: '#a50034', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><text x="16" y="21" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="11" fill="#fff">LG</text></svg>' },
];

const platformBar  = document.getElementById('platform-bar');
const mainTabBar   = document.getElementById('main-tab-bar');
const tabCountDevices = document.getElementById('tab-count-devices');
const tabCountRooms   = document.getElementById('tab-count-rooms');

let activeTab  = 'energy';
const roomsBuilt = new Set();

function updateTabCounts() {
  const n = knownDevices.size;
  if (tabCountDevices) tabCountDevices.textContent = n;
  if (tabCountRooms)   tabCountRooms.textContent   = n;
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('tab-active'));
  document.querySelectorAll('.main-tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById(`tab-pane-${tabId}`);
  const btn  = mainTabBar?.querySelector(`.main-tab-btn[data-tab="${tabId}"]`);
  if (pane) pane.classList.add('tab-active');
  if (btn)  btn.classList.add('active');
  activeTab = tabId;
  if (tabId === 'rooms') renderRoomsTab();
}

mainTabBar?.addEventListener('click', (e) => {
  const btn = e.target.closest('.main-tab-btn');
  if (btn && btn.dataset.tab) switchTab(btn.dataset.tab);
});

function buildRoomCard(device) {
  const el = document.createElement('div');
  el.className = `room-card room-${device.color || 'blue'}`;
  el.dataset.roomKey = device.key;

  const source   = device.key.split('/')[0];
  const readings = device.readings || {};
  const sensorRows = (device.sensors || []).map(s => buildSensorRow(s, readings, device.key)).join('');

  el.innerHTML = `
    <div class="room-card-header">
      <span class="room-card-icon">${device.icon || '📡'}</span>
      <span class="room-card-name">${esc(device.label)}</span>
      <span class="room-source-badge">${esc(source)}</span>
    </div>
    <div class="room-card-body">
      <div class="sensor-list">${sensorRows || '<span style="font-size:0.78rem;color:var(--text-muted)">No sensors</span>'}</div>
    </div>`;
  return el;
}

function renderRoomsTab() {
  if (!roomsGrid) return;
  for (const [key, device] of knownDevices) {
    if (!roomsBuilt.has(key)) {
      roomsBuilt.add(key);
      roomsGrid.appendChild(buildRoomCard(device));
    }
  }
  if (knownDevices.size === 0 && !roomsGrid.querySelector('.rooms-empty')) {
    roomsGrid.innerHTML = `<div class="rooms-empty"><span class="rooms-empty-icon">🏠</span>No devices discovered yet.<br>Configure an integration in Settings to get started.</div>`;
  }
}

// ── Rooms grid event delegation (mirrors devicesGrid handlers) ──────────────
roomsGrid?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.sensor-trigger-btn');
  if (!btn || btn.disabled) return;
  const deviceKey  = btn.dataset.deviceKey;
  const sensorPath = btn.dataset.sensorPath;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '…';
  try {
    const res = await fetch(`/api/device/${deviceKey}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor: sensorPath, value: true }),
    });
    btn.textContent = res.ok ? '✓' : '✗';
  } catch { btn.textContent = '✗'; }
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
});

roomsGrid?.addEventListener('change', async (e) => {
  const input = e.target;
  if (!input.classList.contains('sensor-toggle')) return;
  const deviceKey  = input.dataset.deviceKey;
  const sensorPath = input.dataset.sensorPath;
  const value = input.checked;
  input.disabled = true;
  try {
    const res = await fetch(`/api/device/${deviceKey}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor: sensorPath, value }),
    });
    if (!res.ok) input.checked = !value;
  } catch { input.checked = !value; }
  finally   { input.disabled = false; }
});

roomsGrid?.addEventListener('input', (e) => {
  const input = e.target;
  if (input.classList.contains('sensor-range')) {
    const deviceKey  = input.dataset.deviceKey;
    const sensorPath = input.dataset.sensorPath;
    const val = parseFloat(input.value);
    const dispEl = document.querySelector(`.sensor-range-val[data-sensor-key="${CSS.escape(input.dataset.sensorKey)}"]`);
    if (dispEl) dispEl.textContent = formatRangeDisplay(dispEl.dataset.rangeFormat, val);
    debounce(`range-${deviceKey}-${sensorPath}`, () => sendDeviceCommand(deviceKey, sensorPath, val));
  }
  if (input.classList.contains('sensor-color')) {
    const deviceKey  = input.dataset.deviceKey;
    const sensorPath = input.dataset.sensorPath;
    const color = hexToHsv(input.value);
    debounce(`color-${deviceKey}`, () => sendDeviceCommand(deviceKey, sensorPath, color));
  }
});

function renderPlatformBar(status) {
  if (!platformBar) return;
  const visible = PLATFORMS.filter(p => p.key in status);
  if (!visible.length) { platformBar.style.display = 'none'; return; }
  platformBar.style.display = 'flex';
  platformBar.innerHTML = visible.map(p => {
    const connected = status[p.key];
    return `
      <div class="plat-badge ${connected ? 'plat-connected' : 'plat-disconnected'}"
           style="--plat-color:${p.color}" title="${p.label}: ${connected ? 'connected' : 'disconnected'}">
        <span class="plat-icon">${p.svg}</span>
        <span class="plat-label">${p.label}</span>
      </div>`;
  }).join('');
}
