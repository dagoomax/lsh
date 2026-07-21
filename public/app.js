// ── State ──────────────────────────────────────────────────────────────────
const socket      = io();
const statusEl    = document.getElementById('connection-status');
const sourceBadge = document.getElementById('source-badge');
const relaysCon   = document.getElementById('relays-container');
const batteryBar  = document.getElementById('battery-bar');
const lastUpdate  = document.getElementById('last-update');
const devicesGrid = document.getElementById('devices-grid');
const devicesHdr  = document.getElementById('devices-header');
const roomsGrid       = document.getElementById('rooms-grid');
const customRoomsGrid = document.getElementById('custom-rooms-grid');

const knownDevices  = new Map();
const liveValues    = new Map(); // storeKey → latest value (feeds device modal)
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
  liveValues.set(key, value);
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

  // Satel input (zone) violation → "X inputs open" summary tile
  const satZone = key.match(/^satel\/zone\/(\d+)\/state$/);
  if (satZone) { satelZoneOpen.set(+satZone[1], Number(value)); updateSatelInputsTile(); }

  // Satel partition arm / alarm state → alarm control card
  const satPart = key.match(/^satel\/partition\/(\d+)\/(armed|alarm)$/);
  if (satPart) {
    (satPart[2] === 'armed' ? satelPartArmed : satelPartAlarm).set(+satPart[1], Number(value));
    updateSatelPartitions();
  }

  // Update device sensor cells
  updateDeviceSensor(key, value);
}

// ── Satel "inputs open" summary tile ───────────────────────────────────────
const satelZoneOpen = new Map(); // zone number → 0/1 (1 = violated / open)

const SATEL_ICO = {
  motion: '<svg class="chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8"/><path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8"/></svg>',
  open:   '<svg class="chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h8v18"/><path d="M14 3l6 3v15h-6"/></svg>',
  active: '<svg class="chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>',
};

// A violated input reads as "motion" (PIR zones) or "open" (window/door
// contacts), inferred from the zone's HomeKit sensor type.
function satelZoneKind(dev) {
  if (!dev) return 'active';
  const stateHk = (dev.sensors || []).find((s) => s.path === 'state')?.homekit;
  const hk = stateHk || (dev.homekit || [])[0];
  return hk === 'motion' ? 'motion' : hk === 'contact' ? 'open' : 'active';
}

function updateSatelInputsTile() {
  const card = document.getElementById('satel-inputs-card');
  if (!card) return;

  // Only surface the tile once at least one Satel zone exists
  let hasZones = false;
  for (const k of knownDevices.keys()) { if (k.startsWith('satel/zone/')) { hasZones = true; break; } }
  if (!hasZones && satelZoneOpen.size === 0) return;
  card.style.display = '';

  const openNums = [...satelZoneOpen.entries()].filter(([, v]) => v === 1).map(([n]) => n).sort((a, b) => a - b);
  const count = openNums.length;

  document.getElementById('satel-open-count').textContent = count;
  document.getElementById('satel-open-label').textContent = count === 1 ? 'input open' : 'inputs open';
  card.classList.toggle('has-open', count > 0);

  const list = document.getElementById('satel-open-list');
  if (count === 0) {
    list.innerHTML = '<span class="satel-inputs-allclosed">All inputs closed</span>';
  } else {
    list.innerHTML = openNums.map((n) => {
      const d = knownDevices.get(`satel/zone/${n}`);
      const kind = satelZoneKind(d);
      return `<span class="satel-input-chip kind-${kind}" title="${kind}">${SATEL_ICO[kind]}${esc(d ? d.label : `Zone ${n}`)}</span>`;
    }).join('');
  }
}

// ── Satel alarm partitions (arm / disarm) ───────────────────────────────────
const satelPartArmed = new Map(); // partition number → 0/1
const satelPartAlarm = new Map();

function updateSatelPartitions() {
  const card = document.getElementById('satel-alarm-card');
  const wrap = document.getElementById('satel-partitions');
  if (!card || !wrap) return;

  const parts = [...knownDevices.keys()]
    .filter((k) => k.startsWith('satel/partition/'))
    .map((k) => +k.split('/').pop())
    .sort((a, b) => a - b);
  if (!parts.length) return;
  card.style.display = '';

  wrap.innerHTML = parts.map((num) => {
    const d = knownDevices.get(`satel/partition/${num}`);
    const label = d ? d.label : `Partition ${num}`;
    const armed = satelPartArmed.get(num) === 1;
    const alarm = satelPartAlarm.get(num) === 1;
    const stateCls = alarm ? 'alarm' : armed ? 'armed' : 'disarmed';
    const stateTxt = alarm ? 'Alarm' : armed ? 'Armed' : 'Disarmed';
    return `<div class="satel-part-row">
      <div class="satel-part-info">
        <span class="satel-part-name">${esc(label)}</span>
        <span class="satel-part-state ${stateCls}">${stateTxt}</span>
      </div>
      <button class="satel-part-btn ${armed ? 'is-armed' : 'is-disarmed'}" data-num="${num}" data-armed="${armed ? 1 : 0}">
        ${armed ? 'Disarm' : 'Arm'}
      </button>
    </div>`;
  }).join('');
}

async function setPartition(num, arm, btn) {
  const name = btn.closest('.satel-part-row')?.querySelector('.satel-part-name')?.textContent || 'partition';
  if (!confirm(`${arm ? 'Arm' : 'Disarm'} "${name}"?`)) return;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = arm ? 'Arming…' : 'Disarming…';
  try {
    const res = await fetch(`/api/satel/partition/${num}/${arm ? 'arm' : 'disarm'}`, { method: 'POST' });
    if (!res.ok) throw new Error();
    // Panel pushes the new armed state → updateSatelPartitions() re-renders the row
  } catch {
    btn.textContent = prev;
    btn.disabled = false;
  }
}

document.getElementById('satel-partitions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.satel-part-btn');
  if (btn) setPartition(+btn.dataset.num, btn.dataset.armed !== '1', btn);
});

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
  if (fc) {
    fc.classList.remove('fc-active', 'fc-importing', 'fc-exporting');
    if (importing)      fc.classList.add('fc-active', 'fc-importing');
    else if (exporting) fc.classList.add('fc-active', 'fc-exporting');
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

// ── Cameras summary tile ───────────────────────────────────────────────────
function updateCamerasTile(cameras) {
  const card = document.getElementById('cameras-summary-card');
  if (!card) return;
  cameras = cameras || [];
  if (!cameras.length) { card.style.display = 'none'; return; }
  card.style.display = '';

  const total = cameras.length;
  const live = cameras.filter((c) =>
    (c.mjpegUrl && c.mjpegUrl.trim()) || (c.snapshotUrl && c.snapshotUrl.trim())).length;

  document.getElementById('cameras-count').textContent = total;
  document.getElementById('cameras-count-label').textContent = total === 1 ? 'camera' : 'cameras';
  document.getElementById('cameras-summary-sub').innerHTML =
    `<span class="satel-inputs-allclosed">${live} of ${total} with a live stream</span>`;
}

// Clicking the cameras tile scrolls to the full camera grid
document.getElementById('cameras-summary-card')?.addEventListener('click', () => {
  switchTab('energy');
  document.getElementById('cameras-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── Cameras ────────────────────────────────────────────────────────────────
function renderCameras(cameras) {
  updateCamerasTile(cameras);
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

let _modalTimer   = null;
let _modalCam     = null;
let _activePc     = null;   // active RTCPeerConnection
let _activeMicTrack = null; // mic track for the current two-way-audio session, if any

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

  const talkBtn = document.getElementById('cam-modal-talk');
  talkBtn.style.display = 'none';

  if (cam.webrtcUrl && cam.webrtcUrl.trim()) {
    video.style.display = 'block';
    info.textContent    = 'WebRTC connecting…';
    _startWebRTC(video, cam.webrtcUrl.trim(), !!cam.twoWayAudio)
      .then(({ pc, micTrack }) => {
        _activePc      = pc;
        _activeMicTrack = micTrack;
        info.textContent = 'WebRTC live';
        if (micTrack) {
          talkBtn.style.display = 'block';
          // `muted` on the <video> element is the default so one-way
          // cameras autoplay without a browser permission prompt — a real
          // two-way session needs it off so the visitor is actually audible.
          video.muted = false;
        }
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

  // PTZ pad — only for cameras exposing a ptzUrl (Reolink `ptz: true`, ONVIF)
  document.getElementById('cam-modal-ptz').style.display = cam.ptzUrl ? 'grid' : 'none';

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
  if (_activeMicTrack) { _activeMicTrack.stop(); _activeMicTrack = null; }
  const img   = document.getElementById('cam-modal-img');
  const video = document.getElementById('cam-modal-video');
  const talk  = document.getElementById('cam-modal-talk');
  if (img)  img.src         = '';
  if (video) { video.srcObject = null; video.muted = true; }
  if (talk) { talk.style.display = 'none'; talk.classList.remove('talking'); }
}

function closeCameraModal() {
  document.getElementById('cam-modal').style.display = 'none';
  _closeModalStreams();
  _modalCam = null;
}

document.getElementById('cam-modal-close').addEventListener('click', closeCameraModal);
document.querySelector('.cam-modal-backdrop').addEventListener('click', closeCameraModal);

// ── PTZ: continuous move — op on press, stop on release ─────────────────────
let _ptzActive = false;

async function _ptzSend(op) {
  if (!_modalCam?.ptzUrl) return;
  try {
    const res = await fetch(_modalCam.ptzUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      document.getElementById('cam-modal-refresh').textContent = `PTZ: ${j.error || 'HTTP ' + res.status}`;
    }
  } catch { /* transient — a stop is always sent on release */ }
}

for (const btn of document.querySelectorAll('#cam-modal-ptz [data-ptz]')) {
  const start = (e) => {
    e.preventDefault();
    _ptzActive = true;
    _ptzSend(btn.dataset.ptz);
  };
  const stop = () => {
    if (!_ptzActive) return;
    _ptzActive = false;
    _ptzSend('stop');
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}

// ── Two-way audio: hold cam-modal-talk to unmute the mic track ──────────────
(() => {
  const btn = document.getElementById('cam-modal-talk');
  if (!btn) return;
  const start = (e) => {
    e.preventDefault();
    if (!_activeMicTrack) return;
    _activeMicTrack.enabled = true;
    btn.classList.add('talking');
  };
  const stop = () => {
    if (!_activeMicTrack) return;
    _activeMicTrack.enabled = false;
    btn.classList.remove('talking');
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
})();

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

// Deep-link: ?camera=<name> auto-opens that camera's modal once the list
// loads — used by notification actions (e.g. an HA automation on a doorbell
// ring) to land straight on the Talk UI instead of the plain dashboard.
(() => {
  const want = new URLSearchParams(location.search).get('camera');
  if (!want) return;
  const t = setInterval(() => {
    const cam = _loadedCameras.find(c => c.name === want);
    if (cam) { clearInterval(t); openCameraModal(cam); }
  }, 300);
  setTimeout(() => clearInterval(t), 15000);
})();

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

async function _startWebRTC(videoEl, whepUrl, twoWay) {
  const pc = new RTCPeerConnection({
    iceServers:   [{ urls: 'stun:stun.l.google.com:19302' }],
    bundlePolicy: 'max-bundle',
  });

  pc.ontrack = e => {
    if (e.streams && e.streams[0]) videoEl.srcObject = e.streams[0];
  };

  pc.addTransceiver('video', { direction: 'recvonly' });

  // Two-way audio needs a sendrecv m-line negotiated in the initial offer —
  // WHEP is one-shot offer/answer, so adding the mic track after the fact
  // would need renegotiation most WHEP servers (go2rtc included) don't
  // support. Muted by default; the Talk button just flips `track.enabled`,
  // no renegotiation needed to start/stop talking.
  let micTrack = null;
  if (twoWay) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micTrack = micStream.getAudioTracks()[0];
      micTrack.enabled = false;
      pc.addTransceiver(micTrack, { direction: 'sendrecv' });
    } catch (err) {
      console.warn('[WebRTC] Mic access failed, falling back to receive-only audio:', err.message);
    }
  }
  if (!micTrack) {
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }

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
  return { pc, micTrack };
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
  if (rangeFormat === 'roborock-fan') return ['Quiet', 'Balanced', 'Turbo', 'Max'][v] ?? String(v);
  if (rangeFormat === 'roborock-water') return ['Off', 'Low', 'Medium', 'High'][v] ?? String(v);
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

  // Feed Satel zones into the "inputs open" summary tile
  if (device.key.startsWith('satel/zone/')) {
    const sv = device.readings?.state?.value;
    if (sv != null) satelZoneOpen.set(+device.key.split('/').pop(), Number(sv));
    setTimeout(updateSatelInputsTile, 0); // defer so knownDevices label is set first
  }

  // Feed Satel partitions into the alarm control card
  if (device.key.startsWith('satel/partition/')) {
    const num = +device.key.split('/').pop();
    const ar = device.readings?.armed?.value;
    const al = device.readings?.alarm?.value;
    if (ar != null) satelPartArmed.set(num, Number(ar));
    if (al != null) satelPartAlarm.set(num, Number(al));
    setTimeout(updateSatelPartitions, 0);
  }

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
  card.dataset.deviceType = device.type || '';
  card.dataset.deviceKey  = device.key;
  if (deviceFilter && card.dataset.deviceType !== deviceFilter) card.classList.add('device-hidden');

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
    <div class="sensor-list">${sensorRows}</div>
    ${buildRoomsPanel(device)}`;

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
// Roborock consumable life bars (rendered in the device popup).
function buildRoborockConsumables(device, readings) {
  if (device.type !== 'roborock') return '';
  const items = [
    { path: 'main_brush', name: 'Main brush' },
    { path: 'side_brush', name: 'Side brush' },
    { path: 'filter',     name: 'Filter' },
    { path: 'sensor',     name: 'Sensor' },
  ].map((c) => ({ ...c, v: readings[c.path]?.value })).filter((c) => typeof c.v === 'number');
  if (!items.length) return '';
  const color = (v) => (v > 50 ? '#3fb950' : v > 20 ? '#d29922' : '#f85149');
  return `<div class="dev-section-label">${gt('consumables', 'Consumables')}</div>` +
    items.map((c) => `
      <div class="rr-consumable">
        <span class="rr-cons-name">${esc(c.name)}</span>
        <div class="rr-cons-bar"><div class="rr-cons-fill" style="width:${c.v}%;background:${color(c.v)}"></div></div>
        <span class="rr-cons-val" style="color:${color(c.v)}">${c.v}%</span>
      </div>`).join('');
}

// Roborock multi-room clean panel (rendered for roborock devices with rooms).
function buildRoomsPanel(device) {
  if (device.type !== 'roborock' || !Array.isArray(device.rooms) || !device.rooms.length) return '';
  const duid = String(device.key).split('/')[1];
  const chips = device.rooms.map((r) => `
    <label class="rr-room-chip">
      <input type="checkbox" class="rr-room-cb" value="${r.segmentId}">
      <span>${esc(r.name)}</span>
    </label>`).join('');
  return `
    <div class="rr-rooms" data-rr-duid="${esc(duid)}">
      <div class="rr-rooms-hdr">${gt('clean_rooms', 'Clean rooms')}</div>
      <div class="rr-rooms-chips">${chips}</div>
      <button class="rr-clean-selected" disabled>${gt('clean_selected', 'Clean selected')}</button>
    </div>`;
}

function attachSensorControlHandlers(container) {
// Room-checkbox toggles enable/disable the "Clean selected" button.
container.addEventListener('change', (e) => {
  const cb = e.target.closest('.rr-room-cb');
  if (!cb) return;
  const panel = cb.closest('.rr-rooms');
  const btn = panel?.querySelector('.rr-clean-selected');
  if (btn) btn.disabled = !panel.querySelector('.rr-room-cb:checked');
});
container.addEventListener('click', async (e) => {
  const cleanBtn = e.target.closest('.rr-clean-selected');
  if (cleanBtn && !cleanBtn.disabled) {
    const panel = cleanBtn.closest('.rr-rooms');
    const duid  = panel?.dataset.rrDuid;
    const segs  = [...panel.querySelectorAll('.rr-room-cb:checked')].map((c) => Number(c.value));
    if (!segs.length) return;
    cleanBtn.disabled = true;
    const orig = cleanBtn.textContent;
    cleanBtn.textContent = '…';
    try {
      const res = await fetch(`/api/roborock/${encodeURIComponent(duid)}/clean-room`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: segs }),
      });
      cleanBtn.textContent = res.ok ? '✓' : '✗';
    } catch { cleanBtn.textContent = '✗'; }
    setTimeout(() => { cleanBtn.textContent = orig; cleanBtn.disabled = false; }, 2500);
    return;
  }
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

container.addEventListener('change', async (e) => {
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

container.addEventListener('input', (e) => {
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
}
attachSensorControlHandlers(devicesGrid);

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
  { key: 'bayrol',       label: 'Bayrol',       color: '#0072bc', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 7c3.2 4.4 6 7.6 6 11a6 6 0 01-12 0c0-3.4 2.8-6.6 6-11z" fill="#fff"/><path d="M13.5 18.5a2.5 2.5 0 002.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
  { key: 'unifi',        label: 'UniFi',        color: '#0559c9', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 9a7 7 0 010 14 7 7 0 010-14z" fill="none" stroke="#fff" stroke-width="2"/><path d="M16 13a3 3 0 010 6 3 3 0 010-6z" fill="#fff"/></svg>' },
  { key: 'unifiAccess',  label: 'UniFi Access', color: '#0559c9', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="12" y="15" width="8" height="7" rx="1.5" fill="#fff"/><path d="M13.5 15v-2.5a2.5 2.5 0 015 0V15" fill="none" stroke="#fff" stroke-width="2"/></svg>' },
  { key: 'reolink',      label: 'Reolink',      color: '#2596e6', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="16" cy="16" r="6" fill="none" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="2" fill="#fff"/><rect x="8" y="9" width="4" height="2.5" rx="1" fill="#fff"/></svg>' },
  { key: 'shelly',       label: 'Shelly',       color: '#f0a500', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M16 10v6l4 2" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="3" fill="#fff"/></svg>' },
  { key: 'mqtt-explorer',label: 'Explorer',     color: '#7c3aed', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="10" cy="10" r="2.5" fill="#fff"/><circle cx="22" cy="10" r="2.5" fill="#fff"/><circle cx="10" cy="22" r="2.5" fill="#fff"/><circle cx="22" cy="22" r="2.5" fill="#fff"/><path d="M12.5 10h7M10 12.5v7M22 12.5v7M12.5 22h7" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>' },
  { key: 'boneio',       label: 'BoneIO',       color: '#1a73e8', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><circle cx="10" cy="10" r="3" fill="#fff"/><circle cx="22" cy="10" r="3" fill="#fff"/><circle cx="10" cy="22" r="3" fill="#fff"/><circle cx="22" cy="22" r="3" fill="#fff"/><path d="M13 10h6M10 13v6M22 13v6M13 22h6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>' },
  { key: 'fibaro',       label: 'Fibaro',       color: '#e4181c', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 10h12v3H10zM10 16h8v3h-8zM10 22h5v3h-5z" fill="#fff"/></svg>' },
  { key: 'somfy',        label: 'Somfy',        color: '#f2a900', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M9 9h14v3.5H9zM9 14.5h14V18H9z" fill="#fff"/><path d="M9 20h14v1.8H9z" fill="#fff" opacity="0.85"/><circle cx="16" cy="24.5" r="1.6" fill="#fff"/></svg>' },
  { key: 'lgthinq',     label: 'LG ThinQ',    color: '#a50034', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><text x="16" y="21" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="11" fill="#fff">LG</text></svg>' },
  { key: 'zway',        label: 'Z-Way',       color: '#7d59a5', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><path d="M10 11h12l-12 10h12" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' },
  { key: 'wirenboard',  label: 'WirenBoard',  color: '#4caf50', svg: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="currentColor"/><rect x="9" y="9" width="14" height="14" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 13v6M16 13v6M20 13v6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>' },
];

const platformBar  = document.getElementById('platform-bar');
const mainTabBar   = document.getElementById('main-tab-bar');
const tabCountDevices = document.getElementById('tab-count-devices');
const tabCountRooms   = document.getElementById('tab-count-rooms');

// ── Room types ─────────────────────────────────────────────────────────────
const ROOM_TYPES = [
  { id: 'living',   label: 'Living',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v6h18v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M3 12H1v3h2M21 12h2v3h-2"/><path d="M7 16v2M17 16v2"/></svg>' },
  { id: 'bedroom',  label: 'Bedroom',  svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20v-6"/><path d="M22 20v-6"/><path d="M2 14h20"/><path d="M2 11a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4"/><path d="M6 14v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/></svg>' },
  { id: 'kitchen',  label: 'Kitchen',  svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v20M6 9H2V2"/><path d="M18 2v20M14 8a4 4 0 0 1 4-4"/></svg>' },
  { id: 'bathroom', label: 'Bath',     svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6C9 3.8 7.2 2 5 2S1 3.8 1 6v2h22V6a2 2 0 0 0-2-2H9z"/><path d="M1 8v4a4 4 0 0 0 4 4h14a4 4 0 0 0 4-4V8"/><path d="M5 16v3M19 16v3"/></svg>' },
  { id: 'office',   label: 'Office',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M2 16h20M8 20h8M12 16v4"/></svg>' },
  { id: 'dining',   label: 'Dining',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>' },
  { id: 'garage',   label: 'Garage',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3a1 1 0 0 1-1-1V9a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v7a1 1 0 0 1-1 1h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/><path d="M6 9h12l1 4H5z"/></svg>' },
  { id: 'garden',   label: 'Garden',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V12"/><path d="M12 12C12 7 7 3 3 5c4 0 7 3 9 7"/><path d="M12 12c0-5 5-9 9-7-4 0-7 3-9 7"/></svg>' },
  { id: 'laundry',  label: 'Laundry',  svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M5 6h3M18 6h1"/></svg>' },
  { id: 'kids',     label: 'Kids',     svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' },
  { id: 'hallway',  label: 'Hall',     svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="14" height="20" rx="1.5"/><circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none"/></svg>' },
  { id: 'gym',      label: 'Gym',      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14M18 5v14"/><rect x="3" y="8" width="6" height="8" rx="1"/><rect x="15" y="8" width="6" height="8" rx="1"/><path d="M9 12h6"/></svg>' },
  { id: 'cellar',   label: 'Cellar',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22h20"/><path d="M2 18h5v-4h4v-4h4v-4h5"/></svg>' },
  { id: 'terrace',  label: 'Terrace',  svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16M4 22h16"/><circle cx="12" cy="8" r="3"/><path d="M12 5V3M12 13v-2M5.4 7.4 4 6M20 6l-1.4 1.4M7 11H5M19 11h-2"/></svg>' },
  { id: 'generic',  label: 'Room',     svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
];

const ROOM_COLORS = [
  { id: 'blue',   hex: '#3b82f6' },
  { id: 'green',  hex: '#22c55e' },
  { id: 'purple', hex: '#a855f7' },
  { id: 'orange', hex: '#f97316' },
  { id: 'pink',   hex: '#ec4899' },
  { id: 'teal',   hex: '#14b8a6' },
];

let customRooms = [];
try { customRooms = JSON.parse(localStorage.getItem('lsh-custom-rooms') || '[]'); } catch {}
let editingRoomId = null;

let activeTab  = 'energy';
const roomsBuilt = new Set();

function updateTabCounts() {
  const n = knownDevices.size;
  if (tabCountDevices) tabCountDevices.textContent = n;
  if (tabCountRooms)   tabCountRooms.textContent   = customRooms.length + n;
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
  if (tabId === 'graphs') renderGraphsTab();
  else stopGraphsRefresh();
}

mainTabBar?.addEventListener('click', (e) => {
  const btn = e.target.closest('.main-tab-btn');
  if (btn && btn.dataset.tab) switchTab(btn.dataset.tab);
});

// ── Device type filter (driven by summary tiles) ────────────────────────────
let deviceFilter = null; // null = show all, else a device type e.g. 'satel'

function applyDeviceFilter(type) {
  deviceFilter = type || null;
  devicesGrid.querySelectorAll('.device-card').forEach((c) => {
    c.classList.toggle('device-hidden', !!deviceFilter && c.dataset.deviceType !== deviceFilter);
  });
  const bar = document.getElementById('devices-filter-bar');
  if (bar) {
    bar.style.display = deviceFilter ? '' : 'none';
    const name = document.getElementById('devices-filter-name');
    if (name && deviceFilter) name.textContent = deviceFilter.charAt(0).toUpperCase() + deviceFilter.slice(1);
  }
}
function clearDeviceFilter() { applyDeviceFilter(null); }

// Clicking the "inputs open" tile jumps to Devices filtered to Satel
document.getElementById('satel-inputs-card')?.addEventListener('click', () => {
  switchTab('devices');
  applyDeviceFilter('satel');
});
document.getElementById('devices-filter-clear')?.addEventListener('click', (e) => {
  e.stopPropagation();
  clearDeviceFilter();
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
  rebuildCustomRoomsGrid();
  const divider = document.getElementById('rooms-auto-divider');
  if (divider) divider.style.display = knownDevices.size > 0 ? '' : 'none';
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

// ── Custom room management ──────────────────────────────────────────────────

function buildCustomRoomCard(room) {
  const el = document.createElement('div');
  el.className = 'custom-room-card';
  el.dataset.customRoomId = room.id;

  const type  = ROOM_TYPES.find(t => t.id === room.typeId) || ROOM_TYPES[ROOM_TYPES.length - 1];
  const color = ROOM_COLORS.find(c => c.id === room.colorId) || ROOM_COLORS[0];

  let sensorRows = '';
  for (const key of (room.deviceKeys || [])) {
    const dev = knownDevices.get(key);
    if (dev) sensorRows += (dev.sensors || []).map(s => buildSensorRow(s, dev.readings || {}, key)).join('');
  }

  el.style.setProperty('--rc', color.hex);
  el.innerHTML = `
    <div class="custom-room-card-header">
      <div class="custom-room-icon" style="color:${color.hex}">${type.svg}</div>
      <div class="custom-room-info">
        <span class="custom-room-name">${esc(room.name)}</span>
        <span class="custom-room-type">${esc(type.label)}</span>
      </div>
      <button class="custom-room-edit-btn" data-room-id="${esc(room.id)}" title="Edit room">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
    </div>
    ${sensorRows
      ? `<div class="custom-room-sensors"><div class="sensor-list">${sensorRows}</div></div>`
      : `<div class="custom-room-empty">${room.deviceKeys && room.deviceKeys.length ? 'Devices loading…' : 'No devices assigned'}</div>`}`;
  return el;
}

function rebuildCustomRoomsGrid() {
  if (!customRoomsGrid) return;
  customRoomsGrid.innerHTML = '';
  for (const room of customRooms) {
    customRoomsGrid.appendChild(buildCustomRoomCard(room));
  }
  updateTabCounts();
}

function openRoomModal(roomId) {
  editingRoomId = roomId || null;
  const room = roomId ? customRooms.find(r => r.id === roomId) : null;

  document.getElementById('room-modal-title').textContent = room ? 'Edit Room' : 'New Room';
  document.getElementById('room-name-input').value = room ? room.name : '';

  const typeGrid = document.getElementById('room-type-grid');
  typeGrid.innerHTML = ROOM_TYPES.map(t => {
    const sel = room ? room.typeId === t.id : t.id === 'generic';
    return `<button class="room-type-btn${sel ? ' selected' : ''}" data-type-id="${t.id}" title="${t.label}">${t.svg}<span>${t.label}</span></button>`;
  }).join('');

  const swatches = document.getElementById('room-color-swatches');
  swatches.innerHTML = ROOM_COLORS.map(c => {
    const sel = room ? room.colorId === c.id : c.id === 'blue';
    return `<button class="room-color-btn${sel ? ' selected' : ''}" data-color-id="${c.id}" style="--rc:${c.hex}" title="${c.id}"></button>`;
  }).join('');

  const deviceList = document.getElementById('room-device-list');
  if (knownDevices.size === 0) {
    deviceList.innerHTML = '<span class="room-modal-no-devices">No devices discovered yet</span>';
  } else {
    deviceList.innerHTML = [...knownDevices.entries()].map(([key, dev]) => {
      const checked = room && room.deviceKeys && room.deviceKeys.includes(key) ? 'checked' : '';
      return `<label class="room-device-item"><input type="checkbox" class="room-device-check" value="${esc(key)}" ${checked}><span class="room-device-label">${esc(dev.label)}</span><span class="room-device-source">${esc(key.split('/')[0])}</span></label>`;
    }).join('');
  }

  document.getElementById('room-btn-delete').style.display = room ? '' : 'none';
  document.getElementById('room-modal').style.display = '';
  document.getElementById('room-name-input').focus();
}

function closeRoomModal() {
  document.getElementById('room-modal').style.display = 'none';
  editingRoomId = null;
}

function saveRoom() {
  const name = document.getElementById('room-name-input').value.trim();
  if (!name) { document.getElementById('room-name-input').focus(); return; }

  const typeBtn  = document.querySelector('#room-type-grid .room-type-btn.selected');
  const colorBtn = document.querySelector('#room-color-swatches .room-color-btn.selected');
  const checked  = [...document.querySelectorAll('#room-device-list .room-device-check:checked')];

  const typeId     = typeBtn  ? typeBtn.dataset.typeId   : 'generic';
  const colorId    = colorBtn ? colorBtn.dataset.colorId : 'blue';
  const deviceKeys = checked.map(c => c.value);

  if (editingRoomId) {
    const idx = customRooms.findIndex(r => r.id === editingRoomId);
    if (idx >= 0) customRooms[idx] = { ...customRooms[idx], name, typeId, colorId, deviceKeys };
  } else {
    customRooms.push({ id: `cr-${Date.now()}`, name, typeId, colorId, deviceKeys });
  }

  localStorage.setItem('lsh-custom-rooms', JSON.stringify(customRooms));
  closeRoomModal();
  rebuildCustomRoomsGrid();
}

function deleteRoom() {
  if (!editingRoomId) return;
  customRooms = customRooms.filter(r => r.id !== editingRoomId);
  localStorage.setItem('lsh-custom-rooms', JSON.stringify(customRooms));
  closeRoomModal();
  rebuildCustomRoomsGrid();
}

// Modal event wiring
document.getElementById('rooms-add-btn')?.addEventListener('click', () => openRoomModal(null));
document.getElementById('room-modal-close')?.addEventListener('click', closeRoomModal);
document.getElementById('room-btn-cancel')?.addEventListener('click', closeRoomModal);
document.getElementById('room-btn-save')?.addEventListener('click', saveRoom);
document.getElementById('room-btn-delete')?.addEventListener('click', deleteRoom);
document.querySelector('#room-modal .room-modal-backdrop')?.addEventListener('click', closeRoomModal);
document.getElementById('room-name-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRoom(); if (e.key === 'Escape') closeRoomModal(); });

document.getElementById('room-type-grid')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.room-type-btn');
  if (!btn) return;
  document.querySelectorAll('#room-type-grid .room-type-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
});

document.getElementById('room-color-swatches')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.room-color-btn');
  if (!btn) return;
  document.querySelectorAll('#room-color-swatches .room-color-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
});

customRoomsGrid?.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.custom-room-edit-btn');
  if (editBtn) { openRoomModal(editBtn.dataset.roomId); return; }
});

// ── Custom rooms grid sensor event delegation ───────────────────────────────
customRoomsGrid?.addEventListener('click', async (e) => {
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

customRoomsGrid?.addEventListener('change', async (e) => {
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

customRoomsGrid?.addEventListener('input', (e) => {
  const input = e.target;
  if (input.classList.contains('sensor-range')) {
    const deviceKey  = input.dataset.deviceKey;
    const sensorPath = input.dataset.sensorPath;
    const val = parseFloat(input.value);
    const dispEl = document.querySelector(`.sensor-range-val[data-sensor-key="${CSS.escape(input.dataset.sensorKey)}"]`);
    if (dispEl) dispEl.textContent = formatRangeDisplay(dispEl.dataset.rangeFormat, val);
    debounce(`range-${deviceKey}-${sensorPath}`, () => sendDeviceCommand(deviceKey, sensorPath, val));
  }
});

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

// ═══════════════════════════════════════════════════════════════════════════
// Sensor history charts
// ═══════════════════════════════════════════════════════════════════════════
const histModal  = document.getElementById('hist-modal');
const histCanvas = document.getElementById('hist-canvas');
const histTitle  = document.getElementById('hist-modal-title');
const histStats  = document.getElementById('hist-stats');
const histNoData = document.getElementById('hist-no-data');
let histPoints = [];
let histRangeH = 6; // hours, 0 = all
let histUnit   = '';

async function openHistModal(sensorKey, label, unit) {
  histTitle.textContent = label || sensorKey;
  histUnit = unit || '';
  histModal.style.display = '';
  histPoints = [];
  drawHistChart();
  try {
    const res = await fetch(`/api/history/${sensorKey}`);
    const { points } = await res.json();
    histPoints = points || [];
  } catch { /* ignore */ }
  drawHistChart();
}

function closeHistModal() { histModal.style.display = 'none'; }
document.getElementById('hist-modal-close')?.addEventListener('click', closeHistModal);
document.getElementById('hist-modal-backdrop')?.addEventListener('click', closeHistModal);
document.querySelectorAll('.hist-range-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.hist-range-btn').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  histRangeH = Number(b.dataset.range);
  drawHistChart();
}));

function drawHistChart() {
  renderChartCanvas(histCanvas, histPoints, histRangeH, histUnit, histStats, histNoData);
}

function renderChartCanvas(canvas, allPoints, rangeH, unit, statsEl, noDataEl, height = 260) {
  const wrap = canvas.parentElement;
  const dpr  = window.devicePixelRatio || 1;
  const cssW = wrap.clientWidth || 640, cssH = height;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const cutoff = rangeH ? Date.now() - rangeH * 3600_000 : 0;
  const pts = (allPoints || []).filter((p) => p[0] >= cutoff);
  if (pts.length < 2) {
    noDataEl.style.display = '';
    statsEl.textContent = '';
    return;
  }
  noDataEl.style.display = 'none';

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim() || '#58a6ff';
  const muted  = styles.getPropertyValue('--text-muted').trim() || '#8b949e';
  const border = styles.getPropertyValue('--border').trim() || '#21262d';

  const padL = 44, padR = 10, padT = 10, padB = 22;
  const W = cssW - padL - padR, H = cssH - padT - padB;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  let vMin = Infinity, vMax = -Infinity, vSum = 0;
  for (const [, v] of pts) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; vSum += v; }
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  const pad = (vMax - vMin) * 0.08;
  vMin -= pad; vMax += pad;

  const X = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * W;
  const Y = (v) => padT + (1 - (v - vMin) / (vMax - vMin)) * H;

  // grid + labels
  ctx.strokeStyle = border; ctx.fillStyle = muted;
  ctx.font = '10px system-ui, sans-serif'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = vMin + ((vMax - vMin) * i) / 4;
    const y = Y(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(v.toFixed(Math.abs(vMax - vMin) < 10 ? 1 : 0), padL - 6, y);
  }
  const fmtT = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(fmtT(t0), padL, cssH - padB + 6);
  ctx.fillText(fmtT((t0 + t1) / 2), padL + W / 2, cssH - padB + 6);
  ctx.fillText(fmtT(t1), padL + W, cssH - padB + 6);

  // area fill + line
  ctx.beginPath();
  ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
  for (const [t, v] of pts) ctx.lineTo(X(t), Y(v));
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineTo(X(t1), padT + H); ctx.lineTo(X(t0), padT + H); ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + H);
  grad.addColorStop(0, accent + '44'); grad.addColorStop(1, accent + '00');
  ctx.fillStyle = grad; ctx.fill();

  const avg = vSum / pts.length;
  const u = unit ? ` ${unit}` : '';
  statsEl.textContent = `min ${(vMin + pad).toFixed(1)}${u} · avg ${avg.toFixed(1)}${u} · max ${(vMax - pad).toFixed(1)}${u}`;
}

// Click a read-only sensor value → history chart
document.addEventListener('click', (e) => {
  const el = e.target.closest('.sensor-value[data-sensor-key]');
  if (!el) return;
  const row    = el.closest('.sensor-row');
  const label  = row?.querySelector('.sensor-label')?.textContent || '';
  const card   = el.closest('.device-card, .room-card');
  const device = card?.querySelector('.device-title, .room-title')?.textContent || '';
  const unitMatch = el.textContent.match(/[^\d.,\s-]+\s*$/);
  openHistModal(el.dataset.sensorKey, [device, label].filter(Boolean).join(' — '), unitMatch ? unitMatch[0].trim() : '');
});

// ═══════════════════════════════════════════════════════════════════════════
// Automation: scenes, rules, notifications
// ═══════════════════════════════════════════════════════════════════════════
let autoRules  = [];
let autoScenes = [];
let autoRelays = [];

const scenesGrid  = document.getElementById('scenes-grid');
const sceneStrip  = document.getElementById('scene-strip');
const rulesList   = document.getElementById('rules-list');
const notifList   = document.getElementById('notif-list');

async function loadAutomation() {
  try {
    const [r1, r2, r3, r4] = await Promise.all([
      fetch('/api/automation/rules').then((r) => r.json()),
      fetch('/api/automation/scenes').then((r) => r.json()),
      fetch('/api/automation/notifications').then((r) => r.json()),
      fetch('/api/relays').then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    autoRules  = r1.data || [];
    autoScenes = r2.data || [];
    autoRelays = r4.data || [];
    renderScenes();
    renderRules();
    renderNotifs(r3.data || []);
    updateAutoTabCount();
  } catch (err) {
    console.warn('[Automation] load failed:', err.message);
  }
}

function updateAutoTabCount() {
  const el = document.getElementById('tab-count-automation');
  if (el) el.textContent = autoRules.length + autoScenes.length;
}

const at = (k, fb) => { const v = window.t ? window.t('auto.' + k) : null; return v && v !== 'auto.' + k ? v : fb; };

// ── Scenes ──────────────────────────────────────────────────────────────────
const SCENE_ICONS = ['🎬', '🌙', '☀️', '🏠', '🛁', '🎉', '📺', '🔥', '❄️', '🔒'];

function renderScenes() {
  sceneStrip.style.display = autoScenes.length ? '' : 'none';
  sceneStrip.innerHTML = autoScenes.map((s) =>
    `<button class="scene-chip" data-scene-run="${s.id}">${s.icon || '🎬'} ${esc(s.name)}</button>`).join('');

  document.getElementById('scenes-empty').style.display = autoScenes.length ? 'none' : '';
  scenesGrid.innerHTML = autoScenes.map((s) => `
    <div class="scene-card">
      <button class="scene-run" data-scene-run="${s.id}">
        <span class="scene-icon">${s.icon || '🎬'}</span>
        <span class="scene-name">${esc(s.name)}</span>
        <span class="scene-count">${(s.actions || []).length} ${(s.actions || []).length === 1 ? at('action', 'action') : at('actions', 'actions')}</span>
      </button>
      <button class="scene-edit" data-scene-edit="${s.id}" title="Edit">✎</button>
    </div>`).join('');
}

document.addEventListener('click', async (e) => {
  const runBtn = e.target.closest('[data-scene-run]');
  if (runBtn) {
    runBtn.classList.add('scene-running');
    try { await fetch(`/api/automation/scenes/${runBtn.dataset.sceneRun}/run`, { method: 'POST' }); }
    catch { /* ignore */ }
    setTimeout(() => runBtn.classList.remove('scene-running'), 600);
    return;
  }
  const editBtn = e.target.closest('[data-scene-edit]');
  if (editBtn) openAutoModal('scene', autoScenes.find((s) => s.id === editBtn.dataset.sceneEdit));
});

// ── Rules ───────────────────────────────────────────────────────────────────
function ruleSummary(r) {
  const t = r.trigger || {};
  const cond = t.op === 'changes' ? `${t.key} changes` : `${t.key} ${t.op} ${t.value}`;
  const acts = (r.actions || []).map((a) =>
    a.type === 'notify' ? `notify "${a.message}"`
    : a.type === 'relay' ? `relay ${a.index} ${a.on ? 'on' : 'off'}`
    : a.type === 'scene' ? `scene ${(autoScenes.find((s) => s.id === a.sceneId) || {}).name || a.sceneId}`
    : `${a.deviceKey}/${a.sensor} → ${a.value}`).join(', ');
  return `When ${cond} → ${acts || '(no actions)'}`;
}

function renderRules() {
  document.getElementById('rules-empty').style.display = autoRules.length ? 'none' : '';
  rulesList.innerHTML = autoRules.map((r) => `
    <div class="rule-row${r.enabled ? '' : ' rule-disabled'}">
      <label class="toggle rule-toggle">
        <input type="checkbox" data-rule-enable="${r.id}"${r.enabled ? ' checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <div class="rule-info" data-rule-edit="${r.id}">
        <div class="rule-name">${esc(r.name)}</div>
        <div class="rule-summary">${esc(ruleSummary(r))}</div>
      </div>
      <button class="rule-del" data-rule-del="${r.id}" title="Delete">🗑</button>
    </div>`).join('');
}

rulesList?.addEventListener('click', async (e) => {
  const en = e.target.closest('[data-rule-enable]');
  if (en) {
    const rule = autoRules.find((r) => r.id === en.dataset.ruleEnable);
    if (rule) {
      rule.enabled = en.checked;
      await fetch('/api/automation/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule) });
      renderRules();
    }
    return;
  }
  const del = e.target.closest('[data-rule-del]');
  if (del) {
    if (!confirm(at('confirm_rule', 'Delete this rule?'))) return;
    await fetch(`/api/automation/rules/${del.dataset.ruleDel}`, { method: 'DELETE' });
    autoRules = autoRules.filter((r) => r.id !== del.dataset.ruleDel);
    renderRules(); updateAutoTabCount();
    return;
  }
  const edit = e.target.closest('[data-rule-edit]');
  if (edit) openAutoModal('rule', autoRules.find((r) => r.id === edit.dataset.ruleEdit));
});

document.getElementById('rule-add-btn')?.addEventListener('click', () => openAutoModal('rule', null));
document.getElementById('scene-add-btn')?.addEventListener('click', () => openAutoModal('scene', null));

// ── Notifications ───────────────────────────────────────────────────────────
function notifRowHtml(n) {
  const time = new Date(n.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<div class="notif-row notif-${n.level}">
    <span class="notif-dot"></span>
    <span class="notif-msg">${esc(n.message)}</span>
    <span class="notif-meta">${n.source ? esc(n.source) + ' · ' : ''}${time}</span>
  </div>`;
}

function renderNotifs(list) {
  document.getElementById('notif-empty').style.display = list.length ? 'none' : '';
  notifList.innerHTML = list.slice().reverse().map(notifRowHtml).join('');
}

document.getElementById('notif-clear-btn')?.addEventListener('click', async () => {
  await fetch('/api/automation/notifications', { method: 'DELETE' });
  renderNotifs([]);
});

socket.on('notification', (entry) => {
  document.getElementById('notif-empty').style.display = 'none';
  notifList.insertAdjacentHTML('afterbegin', notifRowHtml(entry));
  showToast(entry);
});

function showToast(entry) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast toast-${entry.level}`;
  el.innerHTML = `<span class="notif-dot"></span><span>${esc(entry.message)}</span>`;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  const ttl = entry.level === 'critical' ? 15000 : 6000;
  setTimeout(() => { el.classList.remove('toast-show'); setTimeout(() => el.remove(), 400); }, ttl);
  el.addEventListener('click', () => el.remove());
}

// ── Rule / Scene editor modal ───────────────────────────────────────────────
const autoModal = document.getElementById('auto-modal');
let autoEditKind = 'rule';
let autoEditObj  = null;

function deviceOptions(selectedKey, controllableOnly) {
  let opts = '<option value="">— device —</option>';
  for (const [key, dev] of knownDevices) {
    const sensors = (dev.sensors || []).filter((s) => !controllableOnly || s.controllable);
    if (!sensors.length) continue;
    opts += `<option value="${key}"${key === selectedKey ? ' selected' : ''}>${esc(dev.label || key)}</option>`;
  }
  opts += `<option value="__custom"${selectedKey === '__custom' ? ' selected' : ''}>Custom key…</option>`;
  return opts;
}

function sensorOptions(deviceKey, selectedPath, controllableOnly) {
  const dev = knownDevices.get(deviceKey);
  if (!dev) return '<option value="">—</option>';
  return (dev.sensors || [])
    .filter((s) => !controllableOnly || s.controllable)
    .map((s) => `<option value="${s.path}"${s.path === selectedPath ? ' selected' : ''}>${esc(s.name || s.path)}</option>`)
    .join('');
}

function actionRowHtml(a = {}, idx) {
  const type = a.type || 'device';
  let fields = '';
  if (type === 'device') {
    const devKey = a.deviceKey || '';
    fields = `
      <select class="auto-select" data-af="deviceKey">${deviceOptions(devKey, true)}</select>
      <select class="auto-select" data-af="sensor">${sensorOptions(devKey, a.sensor, true)}</select>
      <input class="auto-input auto-input-val" data-af="value" type="text" placeholder="on / off / 22" value="${a.value !== undefined ? esc(String(a.value)) : ''}">`;
  } else if (type === 'relay') {
    fields = `
      <select class="auto-select" data-af="index">${autoRelays.map((r) =>
        `<option value="${r.index}"${Number(a.index) === r.index ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <select class="auto-select auto-select-op" data-af="on">
        <option value="1"${a.on ? ' selected' : ''}>On</option>
        <option value="0"${a.on === false ? ' selected' : ''}>Off</option>
      </select>`;
  } else if (type === 'notify') {
    fields = `
      <select class="auto-select auto-select-op" data-af="level">
        ${['info', 'warning', 'critical'].map((l) => `<option value="${l}"${a.level === l ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <input class="auto-input" data-af="message" type="text" placeholder="Message — {value} and {key} available" value="${esc(a.message || '')}">`;
  } else if (type === 'scene') {
    fields = `<select class="auto-select" data-af="sceneId">${autoScenes.map((s) =>
      `<option value="${s.id}"${a.sceneId === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  }
  return `<div class="auto-action-row" data-action-idx="${idx}">
    <select class="auto-select auto-select-type" data-af="type">
      ${['device', 'relay', 'notify', 'scene'].map((t) => `<option value="${t}"${type === t ? ' selected' : ''}>${t}</option>`).join('')}
    </select>
    ${fields}
    <button class="auto-action-del" title="Remove">✕</button>
  </div>`;
}

function openAutoModal(kind, obj) {
  autoEditKind = kind;
  autoEditObj  = obj ? JSON.parse(JSON.stringify(obj)) : null;
  document.getElementById('auto-modal-title').textContent =
    obj ? (kind === 'rule' ? at('edit_rule', 'Edit Rule') : at('edit_scene', 'Edit Scene'))
        : (kind === 'rule' ? at('new_rule', 'New Rule') : at('new_scene', 'New Scene'));
  document.getElementById('auto-name').value = obj?.name || '';
  document.getElementById('auto-trigger-section').style.display = kind === 'rule' ? '' : 'none';
  document.getElementById('auto-btn-delete').style.display = obj ? '' : 'none';

  if (kind === 'rule') {
    const t = obj?.trigger || {};
    const key = t.key || '';
    // try to split key into known device + sensor
    let devKey = '', sensorPath = '';
    for (const [k, dev] of knownDevices) {
      if (key.startsWith(k + '/')) { devKey = k; sensorPath = key.slice(k.length + 1); break; }
    }
    const trigDev = document.getElementById('auto-trig-device');
    trigDev.innerHTML = deviceOptions(devKey || (key ? '__custom' : ''), false);
    rebuildTrigSensor(devKey, sensorPath, key);
    document.getElementById('auto-trig-op').value = t.op || '>';
    document.getElementById('auto-trig-value').value = t.value !== undefined ? t.value : '';
    document.getElementById('auto-cooldown').value = obj?.cooldownSeconds ?? 60;
  }

  const actionsEl = document.getElementById('auto-actions');
  const actions = obj?.actions?.length ? obj.actions : [{ type: kind === 'rule' ? 'notify' : 'device' }];
  actionsEl.innerHTML = actions.map((a, i) => actionRowHtml(a, i)).join('');

  autoModal.style.display = '';
}

function rebuildTrigSensor(devKey, selectedPath, customKey) {
  const trigSensor = document.getElementById('auto-trig-sensor');
  if (devKey === '__custom' || (!devKey && customKey)) {
    trigSensor.outerHTML = `<input id="auto-trig-sensor" class="auto-input" type="text" placeholder="store key e.g. smarttub/xyz/water_temp" value="${esc(customKey || '')}">`;
  } else {
    trigSensor.outerHTML = `<select id="auto-trig-sensor" class="auto-select">${sensorOptions(devKey, selectedPath, false)}</select>`;
  }
}

document.getElementById('auto-trig-device')?.addEventListener('change', (e) => {
  rebuildTrigSensor(e.target.value === '__custom' ? '__custom' : e.target.value, '', '');
});

document.getElementById('auto-add-action')?.addEventListener('click', () => {
  const actionsEl = document.getElementById('auto-actions');
  actionsEl.insertAdjacentHTML('beforeend', actionRowHtml({}, actionsEl.children.length));
});

document.getElementById('auto-actions')?.addEventListener('change', (e) => {
  const row = e.target.closest('.auto-action-row');
  if (!row) return;
  if (e.target.dataset.af === 'type') {
    row.outerHTML = actionRowHtml({ type: e.target.value }, Number(row.dataset.actionIdx));
  } else if (e.target.dataset.af === 'deviceKey') {
    const sensorSel = row.querySelector('[data-af="sensor"]');
    if (sensorSel) sensorSel.innerHTML = sensorOptions(e.target.value, '', true);
  }
});

document.getElementById('auto-actions')?.addEventListener('click', (e) => {
  if (e.target.closest('.auto-action-del')) e.target.closest('.auto-action-row').remove();
});

function collectActions() {
  const actions = [];
  document.querySelectorAll('#auto-actions .auto-action-row').forEach((row) => {
    const get = (f) => row.querySelector(`[data-af="${f}"]`)?.value;
    const type = get('type');
    if (type === 'device') {
      if (!get('deviceKey') || get('deviceKey') === '__custom') return;
      actions.push({ type, deviceKey: get('deviceKey'), sensor: get('sensor'), value: get('value') });
    } else if (type === 'relay') {
      actions.push({ type, index: Number(get('index')), on: get('on') === '1' });
    } else if (type === 'notify') {
      if (!get('message')) return;
      actions.push({ type, level: get('level'), message: get('message') });
    } else if (type === 'scene') {
      if (get('sceneId')) actions.push({ type, sceneId: get('sceneId') });
    }
  });
  return actions;
}

async function saveAutoModal() {
  const name = document.getElementById('auto-name').value.trim();
  if (!name) return alert(at('name_required', 'Name is required'));
  const actions = collectActions();

  if (autoEditKind === 'rule') {
    const trigDevEl = document.getElementById('auto-trig-device');
    const trigSenEl = document.getElementById('auto-trig-sensor');
    const key = trigDevEl.value === '__custom' || trigSenEl.tagName === 'INPUT'
      ? trigSenEl.value.trim()
      : `${trigDevEl.value}/${trigSenEl.value}`;
    if (!key || key.endsWith('/')) return alert(at('trigger_required', 'Trigger sensor is required'));
    const rule = {
      ...(autoEditObj || {}),
      name, actions,
      enabled: autoEditObj?.enabled ?? true,
      trigger: {
        key,
        op: document.getElementById('auto-trig-op').value,
        value: document.getElementById('auto-trig-value').value,
      },
      cooldownSeconds: Number(document.getElementById('auto-cooldown').value) || 0,
    };
    await fetch('/api/automation/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule) });
  } else {
    const scene = {
      ...(autoEditObj || {}),
      name, actions,
      icon: autoEditObj?.icon || SCENE_ICONS[autoScenes.length % SCENE_ICONS.length],
    };
    await fetch('/api/automation/scenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scene) });
  }
  closeAutoModal();
  loadAutomation();
}

async function deleteAutoModal() {
  if (!autoEditObj?.id) return closeAutoModal();
  if (!confirm(autoEditKind === 'rule' ? at('confirm_rule', 'Delete this rule?') : at('confirm_scene', 'Delete this scene?'))) return;
  await fetch(`/api/automation/${autoEditKind}s/${autoEditObj.id}`, { method: 'DELETE' });
  closeAutoModal();
  loadAutomation();
}

function closeAutoModal() { autoModal.style.display = 'none'; }
document.getElementById('auto-btn-save')?.addEventListener('click', saveAutoModal);
document.getElementById('auto-btn-delete')?.addEventListener('click', deleteAutoModal);
document.getElementById('auto-btn-cancel')?.addEventListener('click', closeAutoModal);
document.getElementById('auto-modal-close')?.addEventListener('click', closeAutoModal);
document.getElementById('auto-modal-backdrop')?.addEventListener('click', closeAutoModal);

loadAutomation();

// ═══════════════════════════════════════════════════════════════════════════
// Device popup — advanced controls + history graphs
// ═══════════════════════════════════════════════════════════════════════════
const devModal   = document.getElementById('dev-modal');
const devBody    = document.getElementById('dev-modal-controls');
const devChips   = document.getElementById('dev-modal-chips');
const devCanvas  = document.getElementById('dev-canvas');
const devStats   = document.getElementById('dev-stats');
const devNoData  = document.getElementById('dev-no-data');
let devKey = null, devSel = null, devRangeH = 6, devPoints = [], devTimer = null;

if (devBody) attachSensorControlHandlers(devBody);

function devReadings(device) {
  const readings = {};
  for (const s of device.sensors || []) {
    const v = liveValues.get(`${device.key}/${s.path}`);
    if (v !== undefined) readings[s.path] = { ...s, value: v };
  }
  return readings;
}

function openDevModal(deviceKey) {
  const device = knownDevices.get(deviceKey);
  if (!device || !devModal) return;
  devKey = deviceKey;

  document.getElementById('dev-modal-icon').textContent  = device.icon || '📟';
  document.getElementById('dev-modal-title').textContent = device.label || deviceKey;
  document.getElementById('dev-modal-key').textContent   = deviceKey;

  const readings = devReadings(device);
  const sensors  = (device.sensors || []).filter((s) => !s.hidden);

  // Controls — reuse the standard sensor rows (delegated handlers attached)
  const ctrl = sensors.filter((s) => s.controllable);
  devBody.innerHTML =
    (ctrl.length
      ? `<div class="dev-section-label">Controls</div>` +
        ctrl.map((s) => buildSensorRow(s, readings, deviceKey)).join('')
      : '') +
    buildRoborockConsumables(device, readings);

  // Graph chips — anything with a numeric live value
  const graphable = sensors.filter((s) => typeof liveValues.get(`${deviceKey}/${s.path}`) === 'number'
    || ['number', 'range', 'boolean', 'toggle'].includes(s.type));
  devSel = graphable.some((s) => s.path === devSel) ? devSel : graphable[0]?.path || null;

  devChips.innerHTML = graphable.length
    ? `<div class="dev-section-label">History</div><div class="dev-chip-row">` +
      graphable.map((s) => {
        const v = liveValues.get(`${deviceKey}/${s.path}`);
        const disp = typeof v === 'number' ? `${Number.isInteger(v) ? v : v.toFixed(1)}${s.unit || ''}` : '—';
        return `<button class="dev-chip${s.path === devSel ? ' active' : ''}" data-chip="${esc(s.path)}">
          ${esc(s.name || s.label || s.path)} <b>${disp}</b></button>`;
      }).join('') + '</div>'
    : '';

  document.getElementById('dev-chart-area').style.display = graphable.length ? '' : 'none';

  devModal.style.display = '';
  devPoints = [];
  drawDevChart();
  loadDevHistory();
  clearInterval(devTimer);
  devTimer = setInterval(loadDevHistory, 30000);
}

async function loadDevHistory() {
  if (!devKey || !devSel) return;
  try {
    const res = await fetch(`/api/history/${devKey}/${devSel}`);
    const { points } = await res.json();
    devPoints = points || [];
  } catch { /* ignore */ }
  drawDevChart();
}

function drawDevChart() {
  if (!devCanvas || devModal.style.display === 'none') return;
  const device = knownDevices.get(devKey);
  const sensor = device?.sensors?.find((s) => s.path === devSel);
  renderChartCanvas(devCanvas, devPoints, devRangeH, sensor?.unit || '', devStats, devNoData);
}

function closeDevModal() {
  devModal.style.display = 'none';
  clearInterval(devTimer);
  devTimer = null;
  devKey = null;
}

// Chip + range selection
devChips?.addEventListener('click', (e) => {
  const chip = e.target.closest('.dev-chip');
  if (!chip) return;
  devSel = chip.dataset.chip;
  devChips.querySelectorAll('.dev-chip').forEach((c) => c.classList.toggle('active', c === chip));
  devPoints = [];
  drawDevChart();
  loadDevHistory();
});

document.querySelectorAll('.dev-range-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.dev-range-btn').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  devRangeH = Number(b.dataset.range);
  drawDevChart();
}));

document.getElementById('dev-modal-close')?.addEventListener('click', closeDevModal);
document.getElementById('dev-modal-backdrop')?.addEventListener('click', closeDevModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && devModal?.style.display !== 'none') closeDevModal();
});

// Open from any device card header (but not the resize button)
devicesGrid.addEventListener('click', (e) => {
  if (e.target.closest('.card-size-btn')) return;
  const header = e.target.closest('.device-header');
  const card   = e.target.closest('.device-card');
  if (header && card?.dataset.deviceKey) openDevModal(card.dataset.deviceKey);
});

// Deep-link: ?device=<key> auto-opens the device popup once it registers
(() => {
  const want = new URLSearchParams(location.search).get('device');
  if (!want) return;
  const t = setInterval(() => {
    if (knownDevices.has(want)) { clearInterval(t); openDevModal(want); }
  }, 300);
  setTimeout(() => clearInterval(t), 15000);
})();

// ═══════════════════════════════════════════════════════════════════════════
// Graphs & Statistics tab
// ═══════════════════════════════════════════════════════════════════════════
const graphsGrid    = document.getElementById('graphs-grid');
const graphsStats   = document.getElementById('graphs-stats');
const graphsFilters = document.getElementById('graphs-filters');
let graphsFilter = 'all', graphsRangeH = 6, graphsTimer = null;

// Labels resolved at render time so the active language applies
const gt = (k, fb) => { const v = window.t ? window.t('graphs.' + k) : null; return v && v !== 'graphs.' + k ? v : fb; };
const GRAPH_FILTERS = [
  { id: 'all',   label: () => gt('filter_all', 'All') },
  { id: 'temp',  label: () => '🌡 ' + gt('filter_temp', 'Temperature') },
  { id: 'power', label: () => '⚡ ' + gt('filter_power', 'Power & Energy') },
  { id: 'humid', label: () => '💧 ' + gt('filter_humid', 'Humidity') },
  { id: 'other', label: () => '📈 ' + gt('filter_other', 'Other') },
];
const GRAPH_ACCENT = { temp: '#f0883e', power: '#d29922', humid: '#39d353', other: '#79c0ff' };
const GRAPH_ORDER  = { temp: 0, power: 1, humid: 2, other: 3 };

function classifySensor(s) {
  const u = (s.unit || '').toLowerCase();
  const n = s.name || s.label || s.path || '';
  if (u.includes('°') || s.homekit === 'temperature') return 'temp';
  if (['w', 'kw', 'kwh', 'wh', 'v', 'a', 'va', 'mv'].includes(u)) return 'power';
  if (u === '%' && /humid|rh/i.test(n)) return 'humid';
  if (u === '%' && /soc|battery|level/i.test(n)) return 'power';
  return 'other';
}

function collectGraphable() {
  const out = [];
  for (const [key, device] of knownDevices) {
    for (const s of device.sensors || []) {
      if (s.hidden) continue;
      const v = liveValues.get(`${key}/${s.path}`);
      if (typeof v !== 'number') continue;
      out.push({ device, sensor: s, value: v, cls: classifySensor(s) });
    }
  }
  out.sort((a, b) => (GRAPH_ORDER[a.cls] - GRAPH_ORDER[b.cls])
    || String(a.device.label).localeCompare(String(b.device.label)));
  return out;
}

// ── Roborock live map cards (shown in the Graphs tab) ──
function collectRoborockMaps() {
  const out = [];
  for (const [key, device] of knownDevices) {
    if (String(key).startsWith('roborock/')) {
      const duid = String(key).split('/')[1];
      if (duid) out.push({ duid, label: device.label || device.name || duid });
    }
  }
  return out;
}
function roborockMapUrl(duid) {
  return `/api/roborock/${encodeURIComponent(duid)}/map.png?t=${Date.now()}`;
}
function roborockMapCardHtml(m) {
  return `
    <div class="graphs-card graphs-map-card">
      <div class="graphs-card-hdr">
        <span class="graphs-card-dev">🤖 ${esc(m.label)}</span>
        <span class="graphs-card-sensor">${gt('live_map', 'Live map')}</span>
        <button class="graphs-map-refresh" data-map-refresh="${esc(m.duid)}" title="${gt('refresh', 'Refresh')}">↻</button>
      </div>
      <div class="graphs-map-wrap">
        <img class="graphs-map-img" data-map-duid="${esc(m.duid)}" src="${roborockMapUrl(m.duid)}" alt="${esc(m.label)} map">
        <div class="graphs-map-err" style="display:none">${gt('map_unavailable', 'Map unavailable')}</div>
      </div>
    </div>`;
}
function wireRoborockMapCards() {
  graphsGrid.querySelectorAll('.graphs-map-img').forEach((img) => {
    const err = img.parentElement.querySelector('.graphs-map-err');
    img.onerror = () => { img.style.display = 'none'; if (err) err.style.display = ''; };
    img.onload  = () => { img.style.display = ''; if (err) err.style.display = 'none'; };
  });
  graphsGrid.querySelectorAll('[data-map-refresh]').forEach((btn) => {
    btn.onclick = () => {
      const duid = btn.getAttribute('data-map-refresh');
      const img = graphsGrid.querySelector(`.graphs-map-img[data-map-duid="${duid}"]`);
      if (img) { btn.classList.add('spin'); img.src = roborockMapUrl(duid); img.onload && img.addEventListener('load', () => btn.classList.remove('spin'), { once: true }); }
    };
  });
}

function renderGraphsTab() {
  const graphable = collectGraphable();

  // ── Stats cards ──
  const temps = graphable.filter((g) => g.cls === 'temp').map((g) => g.value);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  let activeOn = 0;
  for (const [key, device] of knownDevices) {
    if ((device.sensors || []).some((s) => s.controllable && liveValues.get(`${key}/${s.path}`) === 1)) activeOn++;
  }
  const soc   = liveValues.get('system/0/Dc/Battery/Soc');
  const solar = liveValues.get('system/0/Dc/Pv/Power');

  const statCard = (label, value, unit, color) => `
    <div class="graphs-stat" style="--gs:${color}">
      <div class="graphs-stat-label">${label}</div>
      <div class="graphs-stat-value">${value}<span>${unit}</span></div>
    </div>`;
  graphsStats.innerHTML =
    statCard(gt('devices', 'Devices'), knownDevices.size, '', '#79c0ff') +
    statCard(gt('active', 'Active now'), activeOn, ' on', '#d29922') +
    statCard(gt('series', 'Tracked series'), graphable.length, '', '#bc8cff') +
    (avgTemp != null ? statCard(gt('avg_temp', 'Avg temperature'), avgTemp.toFixed(1), '°C', '#f0883e') : '') +
    (typeof soc   === 'number' ? statCard(gt('battery', 'Battery'), Math.round(soc), '%', '#3fb950') : '') +
    (typeof solar === 'number' ? statCard(gt('solar', 'Solar'), Math.round(solar), 'W', '#f0c000') : '');

  // ── Filter chips ──
  const counts = { all: graphable.length };
  for (const g of graphable) counts[g.cls] = (counts[g.cls] || 0) + 1;
  graphsFilters.innerHTML = GRAPH_FILTERS
    .filter((f) => f.id === 'all' || counts[f.id])
    .map((f) => `<button class="graphs-chip${graphsFilter === f.id ? ' active' : ''}" data-gfilter="${f.id}">
      ${f.label()} <span>(${counts[f.id] || counts.all})</span></button>`).join('');

  // ── Roborock live-map cards (only on the "all" filter) ──
  const roboMaps = (graphsFilter === 'all') ? collectRoborockMaps() : [];
  const mapsHtml = roboMaps.map(roborockMapCardHtml).join('');

  // ── Chart cards ──
  const shown = (graphsFilter === 'all' ? graphable : graphable.filter((g) => g.cls === graphsFilter)).slice(0, 30);
  document.getElementById('graphs-empty').style.display = (shown.length || roboMaps.length) ? 'none' : '';
  document.getElementById('tab-count-graphs').textContent = graphable.length;

  graphsGrid.innerHTML = mapsHtml + shown.map(({ device, sensor, value, cls }, i) => `
    <div class="graphs-card">
      <div class="graphs-card-hdr" data-open-dev="${esc(device.key)}">
        <span class="graphs-card-dev">${esc(device.label)}</span>
        <span class="graphs-card-sensor">${esc(sensor.name || sensor.label || sensor.path)}</span>
        <span class="graphs-card-val" style="color:${GRAPH_ACCENT[cls]}">${Number.isInteger(value) ? value : value.toFixed(1)}${esc(sensor.unit || '')}</span>
      </div>
      <div class="graphs-card-stats" id="gstat-${i}"></div>
      <div class="graphs-canvas-wrap">
        <canvas id="gcanvas-${i}"></canvas>
        <div class="hist-no-data" id="gnodata-${i}" style="display:none">${gt('collecting', 'Collecting…')}</div>
      </div>
    </div>`).join('');

  shown.forEach(({ device, sensor }, i) => loadGraphCard(device.key, sensor, i));
  wireRoborockMapCards();

  clearInterval(graphsTimer);
  graphsTimer = setInterval(() => {
    if (activeTab === 'graphs') shown.forEach(({ device, sensor }, i) => loadGraphCard(device.key, sensor, i));
  }, 30000);
}

async function loadGraphCard(deviceKey, sensor, i) {
  try {
    const res = await fetch(`/api/history/${deviceKey}/${sensor.path}`);
    const { points } = await res.json();
    const canvas = document.getElementById(`gcanvas-${i}`);
    if (!canvas) return;
    renderChartCanvas(canvas, points || [], graphsRangeH, sensor.unit || '',
      document.getElementById(`gstat-${i}`), document.getElementById(`gnodata-${i}`), 150);
  } catch { /* ignore */ }
}

function stopGraphsRefresh() {
  clearInterval(graphsTimer);
  graphsTimer = null;
}

graphsFilters?.addEventListener('click', (e) => {
  const chip = e.target.closest('.graphs-chip');
  if (!chip) return;
  graphsFilter = chip.dataset.gfilter;
  renderGraphsTab();
});

document.querySelectorAll('.graphs-range-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.graphs-range-btn').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  graphsRangeH = Number(b.dataset.range);
  renderGraphsTab();
}));

graphsGrid?.addEventListener('click', (e) => {
  const hdr = e.target.closest('[data-open-dev]');
  if (hdr) openDevModal(hdr.dataset.openDev);
});

// Deep-link: ?tab=<id> selects a main tab on load
(() => {
  const wantTab = new URLSearchParams(location.search).get('tab');
  if (wantTab && document.getElementById(`tab-pane-${wantTab}`)) {
    // devices arrive async — graphs/rooms need a beat to populate
    setTimeout(() => switchTab(wantTab), 400);
  }
})();
