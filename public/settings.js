let currentRelays = [];
let currentCameras = [];
let qrInstance = null;

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const { data } = await res.json();

    if (!data) return;

    // MQTT
    setVal('mqtt-host', data.mqtt?.host || '');
    setVal('mqtt-port', data.mqtt?.port || 1883);
    setVal('mqtt-portal', data.mqtt?.portalId || '');

    // VRM
    setVal('vrm-api-token', data.vrm?.apiToken || '');
    setVal('vrm-email', data.vrm?.email || '');
    setVal('vrm-password', data.vrm?.password || '');
    setVal('vrm-id', data.vrm?.installationId || '');

    // SolarEdge
    setVal('se-site-id', data.solaredge?.siteId || '');
    setVal('se-api-key', data.solaredge?.apiKey || '');

    // SmartThings
    setVal('st-token', data.smartthings?.token || '');
    setVal('st-device-ids', (data.smartthings?.deviceIds || []).join(', '));

    // Satel
    setVal('satel-host', data.satel?.host || '');
    setVal('satel-port', data.satel?.port || 7094);
    setVal('satel-code', data.satel?.armCode || '');
    setVal('satel-zone-count', data.satel?.zoneCount || 32);
    setVal('satel-partitions', (data.satel?.partitions || [1]).join(', '));
    renderNamesList('satel-zone-names-list', data.satel?.zoneNames || {}, 1, 128, 'Zone');
    renderNamesList('satel-partition-names-list', data.satel?.partitionNames || {}, 1, 32, 'Partition');

    // UniFi Protect
    setVal('unifi-host', data.unifi?.host || '');
    setVal('unifi-apikey', data.unifi?.apiKey || '');
    setVal('unifi-user', data.unifi?.username || '');
    setVal('unifi-pass', data.unifi?.password || '');

    // Loxone
    setVal('loxone-host', data.loxone?.host || '');
    setVal('loxone-port', data.loxone?.port || 80);
    setVal('loxone-user', data.loxone?.username || 'admin');
    setVal('loxone-pass', data.loxone?.password || '');

    // Dirigera
    setVal('dirigera-host',  data.dirigera?.host  || '');
    setVal('dirigera-token', data.dirigera?.token ? '••••••••' : '');

    // Tradfri
    setVal('tradfri-host',     data.tradfri?.host     || '');
    setVal('tradfri-code',     '');
    setVal('tradfri-identity', data.tradfri?.identity || '');
    setVal('tradfri-psk',      data.tradfri?.psk ? '••••••••' : '');

    // BoneIO
    setVal('boneio-host', data.boneio?.host || '');
    setVal('boneio-port', data.boneio?.port || 1883);

    // Shelly
    renderShellyList(data.shelly?.devices || []);

    // Cameras — fetched separately so settings API doesn't need to include them
    await loadCameras();

    // Relays
    currentRelays = data.relays || [];
    renderRelaysList(currentRelays);

    // HomeKit
    setVal('hk-pin', data.homekit?.pin || '031-45-154');
    setVal('hk-port', data.homekit?.port || 47128);
    setVal('hk-username', data.homekit?.username || 'CC:22:3D:E3:CE:F6');
    updatePinDisplay(data.homekit?.pin);

    // Server
    setVal('server-port', data.server?.port || 3000);

    // QR code — fetch URI from backend (has the correct setupID)
    await refreshQrCode();
  } catch (err) {
    showSaveMsg('Failed to load settings: ' + err.message, 'err');
  }
}

// ── QR Code ────────────────────────────────────────────────────────────────

async function refreshQrCode() {
  const loadingEl = document.getElementById('qr-loading');
  const containerEl = document.getElementById('homekit-qrcode');

  loadingEl.style.display = 'block';
  containerEl.innerHTML = '';
  if (qrInstance) { qrInstance = null; }

  try {
    const res = await fetch('/api/homekit/setup-uri');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    const { uri, pin, setupID } = json.data;

    updatePinDisplay(pin);

    const setupIdEl = document.getElementById('qr-setup-id');
    if (setupIdEl) setupIdEl.textContent = `Setup ID: ${setupID}`;

    loadingEl.style.display = 'none';

    qrInstance = new QRCode(containerEl, {
      text: uri,
      width: 180,
      height: 180,
      colorDark: '#e6edf3',
      colorLight: '#161b22',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (err) {
    loadingEl.textContent = 'QR error: ' + err.message;
  }
}

// Regenerate QR when PIN field changes (debounced)
let pinDebounce = null;
document.getElementById('hk-pin').addEventListener('input', (e) => {
  updatePinDisplay(e.target.value);
  // QR will refresh properly only after save (setupID may change)
  clearTimeout(pinDebounce);
  pinDebounce = setTimeout(() => refreshQrCode(), 600);
});

// ── Relay list ─────────────────────────────────────────────────────────────

function renderRelaysList(relays) {
  const list = document.getElementById('relays-settings-list');
  list.innerHTML = `
    <div class="relay-row-header">
      <span>Index</span><span>Name</span><span></span>
    </div>
  `;

  relays.forEach((relay, i) => {
    const row = document.createElement('div');
    row.className = 'relay-row';
    row.innerHTML = `
      <input type="number" min="0" max="10" value="${relay.index}" data-relay-idx="${i}" data-field="index">
      <input type="text" placeholder="Relay name" value="${escapeVal(relay.name)}" data-relay-idx="${i}" data-field="name">
      <button class="btn-remove" data-remove="${i}" title="Remove">✕</button>
    `;
    list.appendChild(row);

    row.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => syncRelaysFromDOM());
    });
    row.querySelector('.btn-remove').addEventListener('click', () => {
      currentRelays.splice(i, 1);
      renderRelaysList(currentRelays);
    });
  });
}

function syncRelaysFromDOM() {
  const rows = document.querySelectorAll('.relay-row input[data-relay-idx]');
  const map = {};
  rows.forEach((input) => {
    const i = input.dataset.relayIdx;
    if (!map[i]) map[i] = {};
    map[i][input.dataset.field] = input.dataset.field === 'index'
      ? parseInt(input.value)
      : input.value;
  });
  currentRelays = Object.values(map);
}

document.getElementById('btn-add-relay').addEventListener('click', () => {
  syncRelaysFromDOM();
  const nextIndex = currentRelays.length;
  currentRelays.push({ index: nextIndex, name: `Relay ${nextIndex + 1}` });
  renderRelaysList(currentRelays);
});

// ── Save ───────────────────────────────────────────────────────────────────

document.getElementById('btn-save').addEventListener('click', async () => {
  syncRelaysFromDOM();
  const btn = document.getElementById('btn-save');
  btn.disabled = true;

  const pin = getVal('hk-pin');

  const payload = {
    mqtt: {
      host: getVal('mqtt-host'),
      port: parseInt(getVal('mqtt-port')) || 1883,
      portalId: getVal('mqtt-portal'),
    },
    vrm: {
      apiToken: getVal('vrm-api-token'),
      email: getVal('vrm-email'),
      password: getVal('vrm-password'),
      installationId: getVal('vrm-id'),
    },
    relays: currentRelays,
    homekit: {
      pin,
      port: parseInt(getVal('hk-port')) || 47128,
      username: getVal('hk-username'),
    },
    server: {
      port: parseInt(getVal('server-port')) || 3000,
    },
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.success) {
      showSaveMsg('✓ ' + json.message, 'ok');
      // Refresh QR after save so new setupID is reflected
      await refreshQrCode();
    } else {
      showSaveMsg('Error: ' + json.error, 'err');
    }
  } catch (err) {
    showSaveMsg('Save failed: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

// ── VRM test + save ────────────────────────────────────────────────────────

document.getElementById('btn-test-vrm').addEventListener('click', async () => {
  const resultEl = document.getElementById('vrm-test-result');
  const apiToken = getVal('vrm-api-token');
  const email    = getVal('vrm-email');
  const password = getVal('vrm-password');
  const id       = getVal('vrm-id');

  if (!apiToken && (!email || !password)) {
    resultEl.textContent = 'Enter an API token, or email and password';
    resultEl.className = 'test-result err';
    return;
  }

  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';

  try {
    const res = await fetch('/api/settings/test-vrm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiToken, email, password, installationId: id }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-test-vrm-live').addEventListener('click', async () => {
  const resultEl  = document.getElementById('vrm-test-result');
  const livePanel = document.getElementById('vrm-live-panel');
  const apiToken  = getVal('vrm-api-token');
  const email     = getVal('vrm-email');
  const password  = getVal('vrm-password');
  const id        = getVal('vrm-id');

  if (!apiToken && (!email || !password)) {
    resultEl.textContent = 'Enter an API token, or email and password';
    resultEl.className = 'test-result err';
    return;
  }
  if (!id) {
    resultEl.textContent = 'Enter an Installation ID first';
    resultEl.className = 'test-result err';
    return;
  }

  resultEl.textContent = 'Fetching live data from VRM…';
  resultEl.className = 'test-result loading';
  livePanel.style.display = 'none';

  try {
    const res = await fetch('/api/settings/test-vrm-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiToken, email, password, installationId: id }),
    });
    const json = await res.json();

    if (!json.success) {
      resultEl.textContent = '✗ ' + json.error;
      resultEl.className = 'test-result err';
      return;
    }

    const d = json.data;
    resultEl.textContent = '✓ Live data received';
    resultEl.className = 'test-result ok';

    // Populate panel
    document.getElementById('vrm-inst-name').textContent = d.installationName || id;
    setLive('vl-soc',         d.soc,         'soc');
    setLive('vl-voltage',     d.voltage,     'voltage');
    setLive('vl-solar',       d.solar,       'power');
    setLive('vl-grid',        d.grid,        'power');
    setLive('vl-consumption', d.consumption, 'power');
    setLive('vl-state',       d.state,       'text');

    if (d.timestamp) {
      const ts = new Date(d.timestamp * 1000);
      document.getElementById('vrm-live-ts').textContent =
        `Data timestamp: ${ts.toLocaleString()}`;
    }

    livePanel.style.display = '';
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

function setLive(id, value, type) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value === null || value === undefined) { el.textContent = '--'; return; }
  switch (type) {
    case 'soc':     el.textContent = `${Number(value).toFixed(1)} %`; break;
    case 'voltage': el.textContent = `${Number(value).toFixed(2)} V`; break;
    case 'power': {
      const w = Math.abs(Number(value));
      el.textContent = w >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
      break;
    }
    default: el.textContent = String(value);
  }
}

document.getElementById('btn-save-vrm').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-vrm');
  const resultEl = document.getElementById('vrm-test-result');
  btn.disabled   = true;

  try {
    const res = await fetch('/api/settings/vrm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiToken:       getVal('vrm-api-token'),
        email:          getVal('vrm-email'),
        password:       getVal('vrm-password'),
        installationId: getVal('vrm-id'),
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally {
    btn.disabled = false;
  }
});

// ── Backup & Restore ───────────────────────────────────────────────────────

let _importedConfig = null;

document.getElementById('import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    let cfg;
    try {
      cfg = JSON.parse(ev.target.result);
    } catch {
      alert('Invalid JSON file — could not parse.');
      e.target.value = '';
      return;
    }

    _importedConfig = cfg;

    // Populate filename
    document.getElementById('import-filename').textContent = file.name;

    // Populate preview fields
    document.getElementById('ip-mqtt-host').textContent  = cfg.mqtt?.host        || '—';
    document.getElementById('ip-vrm-email').textContent  = cfg.vrm?.email        || '—';
    document.getElementById('ip-vrm-id').textContent     = cfg.vrm?.installationId || '—';
    document.getElementById('ip-relays').textContent     = Array.isArray(cfg.relays)
      ? cfg.relays.map((r) => r.name || `Relay ${r.index}`).join(', ') || '(none)'
      : '—';
    document.getElementById('ip-hk-pin').textContent    = cfg.homekit?.pin      || '—';
    document.getElementById('ip-server-port').textContent = cfg.server?.port    || '—';

    // Reset result message
    const resultEl = document.getElementById('import-result');
    resultEl.textContent = '';
    resultEl.className   = 'test-result';

    document.getElementById('import-preview').style.display = '';
  };
  reader.readAsText(file);
});

document.getElementById('btn-import-cancel').addEventListener('click', () => {
  _importedConfig = null;
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-file-input').value = '';
});

document.getElementById('btn-import-confirm').addEventListener('click', async () => {
  if (!_importedConfig) return;

  const btn      = document.getElementById('btn-import-confirm');
  const resultEl = document.getElementById('import-result');
  btn.disabled   = true;
  resultEl.textContent = 'Restoring…';
  resultEl.className   = 'test-result loading';

  try {
    const res = await fetch('/api/settings/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_importedConfig),
    });
    const json = await res.json();

    if (json.success) {
      resultEl.textContent = '✓ ' + json.message;
      resultEl.className   = 'test-result ok';
      // Reload all settings fields from the restored config
      await loadSettings();
      // Hide preview after 3 s
      setTimeout(() => {
        document.getElementById('import-preview').style.display = 'none';
        document.getElementById('import-file-input').value = '';
        _importedConfig = null;
      }, 3000);
    } else {
      resultEl.textContent = '✗ ' + json.error;
      resultEl.className   = 'test-result err';
    }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className   = 'test-result err';
  } finally {
    btn.disabled = false;
  }
});

// ── SmartThings test + save ────────────────────────────────────────────────

document.getElementById('btn-test-smartthings').addEventListener('click', async () => {
  const resultEl = document.getElementById('st-test-result');
  const token = getVal('st-token');
  if (!token) {
    resultEl.textContent = 'Enter a token first';
    resultEl.className = 'test-result err';
    return;
  }
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';
  try {
    const res = await fetch('/api/settings/test-smartthings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-smartthings').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-smartthings');
  const resultEl = document.getElementById('st-test-result');
  btn.disabled = true;
  try {
    const rawIds = getVal('st-device-ids');
    const deviceIds = rawIds ? rawIds.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const res = await fetch('/api/settings/smartthings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getVal('st-token'), deviceIds }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally {
    btn.disabled = false;
  }
});

// ── Satel ──────────────────────────────────────────────────────────────────

// ── Satel zone / partition name helpers ────────────────────────────────────

function renderNamesList(containerId, namesObj, minNum, maxNum, label) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const entries = Object.entries(namesObj).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!entries.length) {
    container.innerHTML = `<p class="hint names-empty">No ${label.toLowerCase()} names configured.</p>`;
    return;
  }

  entries.forEach(([num, name]) => {
    container.appendChild(makeNameRow(containerId, num, name, minNum, maxNum, label));
  });
}

function makeNameRow(containerId, num, name, minNum, maxNum, label) {
  const row = document.createElement('div');
  row.className = 'names-row';
  row.innerHTML = `
    <input type="number" class="names-num" min="${minNum}" max="${maxNum}" placeholder="#" value="${escapeVal(String(num))}">
    <input type="text"   class="names-val" placeholder="${label} name" value="${escapeVal(name)}">
    <button class="btn btn-remove names-remove" title="Remove">✕</button>`;
  row.querySelector('.names-remove').addEventListener('click', () => row.remove());
  return row;
}

function collectNamesList(containerId) {
  const result = {};
  document.querySelectorAll(`#${containerId} .names-row`).forEach(row => {
    const num  = parseInt(row.querySelector('.names-num').value.trim());
    const name = row.querySelector('.names-val').value.trim();
    if (num && name) result[num] = name;
  });
  return result;
}

document.getElementById('btn-add-zone-name').addEventListener('click', () => {
  const container = document.getElementById('satel-zone-names-list');
  const empty = container.querySelector('.names-empty');
  if (empty) empty.remove();
  container.appendChild(makeNameRow('satel-zone-names-list', '', '', 1, 128, 'Zone'));
});

document.getElementById('btn-add-partition-name').addEventListener('click', () => {
  const container = document.getElementById('satel-partition-names-list');
  const empty = container.querySelector('.names-empty');
  if (empty) empty.remove();
  container.appendChild(makeNameRow('satel-partition-names-list', '', '', 1, 32, 'Partition'));
});

document.getElementById('btn-test-satel').addEventListener('click', async () => {
  const resultEl = document.getElementById('satel-test-result');
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result';
  try {
    const res = await fetch('/api/settings/test-satel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: getVal('satel-host'), port: getVal('satel-port') }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-satel').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-satel');
  const resultEl = document.getElementById('satel-test-result');
  btn.disabled = true;
  try {
    const res = await fetch('/api/settings/satel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:           getVal('satel-host'),
        port:           getVal('satel-port'),
        armCode:        getVal('satel-code'),
        zoneCount:      getVal('satel-zone-count'),
        partitions:     getVal('satel-partitions'),
        zoneNames:      collectNamesList('satel-zone-names-list'),
        partitionNames: collectNamesList('satel-partition-names-list'),
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── UniFi Protect ──────────────────────────────────────────────────────────

document.getElementById('btn-test-unifi').addEventListener('click', async () => {
  const resultEl = document.getElementById('unifi-test-result');
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result';
  try {
    const res = await fetch('/api/settings/test-unifi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: getVal('unifi-host'), username: getVal('unifi-user'),
        password: getVal('unifi-pass'), apiKey: getVal('unifi-apikey'),
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-unifi').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-unifi');
  const resultEl = document.getElementById('unifi-test-result');
  btn.disabled = true;
  try {
    const res = await fetch('/api/settings/unifi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: getVal('unifi-host'), username: getVal('unifi-user'),
        password: getVal('unifi-pass'), apiKey: getVal('unifi-apikey'),
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── Aeotec 360 Camera ──────────────────────────────────────────────────────

function aeotecUrls() {
  const ip   = getVal('aeotec-ip');
  const user = getVal('aeotec-user') || 'admin';
  const pass = document.getElementById('aeotec-pass').value;
  const cred = pass ? `${user}:${pass}@` : `${user}@`;
  return {
    rtsp:     `rtsp://${cred}${ip}:554/stream1`,
    rtspSub:  `rtsp://${cred}${ip}:554/stream2`,
    snapshot: `http://${cred}${ip}/snapshot.jpg`,
  };
}

function aeotecUpdatePreview() {
  const ip = getVal('aeotec-ip');
  const urlBox = document.getElementById('aeotec-urls');
  if (!ip) { urlBox.style.display = 'none'; return; }
  urlBox.style.display = '';
  const u = aeotecUrls();
  document.getElementById('aeotec-rtsp').textContent     = u.rtsp;
  document.getElementById('aeotec-rtsp-sub').textContent = u.rtspSub;
  document.getElementById('aeotec-snapshot').textContent = u.snapshot;
}

['aeotec-ip', 'aeotec-user', 'aeotec-pass'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', aeotecUpdatePreview);
});

document.getElementById('btn-test-aeotec').addEventListener('click', async () => {
  const resultEl = document.getElementById('aeotec-result');
  const ip   = getVal('aeotec-ip');
  const user = getVal('aeotec-user') || 'admin';
  const pass = document.getElementById('aeotec-pass').value;
  if (!ip) { resultEl.textContent = 'Enter an IP address first'; resultEl.className = 'test-result err'; return; }
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';
  try {
    const res = await fetch('/api/settings/test-aeotec', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, username: user, password: pass }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-add-aeotec').addEventListener('click', async () => {
  const resultEl = document.getElementById('aeotec-result');
  const ip   = getVal('aeotec-ip');
  const name = getVal('aeotec-name') || `Aeotec ${ip}`;
  if (!ip) { resultEl.textContent = 'Enter an IP address first'; resultEl.className = 'test-result err'; return; }
  const u = aeotecUrls();

  // Reload current cameras, add Aeotec entry, save
  try {
    const res = await fetch('/api/cameras');
    const { data } = await res.json();
    const existing = (data || []).filter((c) => !c._smartthings); // exclude auto-discovered ST cameras
    // Remove any existing entry with same IP to avoid duplicates
    const filtered = existing.filter((c) => !c.url?.includes(ip) && !c.snapshotUrl?.includes(ip));
    filtered.push({ name, url: u.rtsp, snapshotUrl: u.snapshot, mjpegUrl: '', webrtcUrl: '' });

    const saveRes = await fetch('/api/settings/cameras', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filtered),
    });
    const saveJson = await saveRes.json();
    if (saveJson.success) {
      resultEl.textContent = `✓ "${name}" added to Cameras — scroll down to see it`;
      resultEl.className = 'test-result ok';
      await loadCameras(); // refresh the cameras list below
    } else {
      resultEl.textContent = '✗ ' + saveJson.error;
      resultEl.className = 'test-result err';
    }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

// ── Cameras ────────────────────────────────────────────────────────────────

async function loadCameras() {
  try {
    const res = await fetch('/api/cameras');
    const { data } = await res.json();
    currentCameras = data || [];
    renderCameraList(currentCameras);
  } catch { /* ignore */ }
}

function renderCameraList(cameras) {
  const container = document.getElementById('cameras-settings-list');
  container.innerHTML = '';

  if (cameras.length === 0) {
    container.innerHTML = '<p class="hint" style="margin-bottom:12px">No cameras configured yet.</p>';
    return;
  }

  cameras.forEach((cam, i) => {
    const row = document.createElement('div');
    row.className = 'camera-settings-row';
    row.dataset.index = i;
    row.innerHTML = `
      <div class="camera-settings-fields">
        <input type="text" class="cam-name"     placeholder="Camera name"                       value="${escapeVal(cam.name)}">
        <input type="text" class="cam-url"      placeholder="rtsp://… (RTSP stream)"            value="${escapeVal(cam.url || '')}">
        <input type="text" class="cam-snapshot" placeholder="http://…/snapshot.jpg (optional)" value="${escapeVal(cam.snapshotUrl || '')}">
        <input type="text" class="cam-mjpeg"    placeholder="http://…/mjpeg (MJPEG stream)"     value="${escapeVal(cam.mjpegUrl || '')}">
        <input type="text" class="cam-webrtc"   placeholder="http://…/whep (WebRTC / WHEP endpoint — e.g. go2rtc)" value="${escapeVal(cam.webrtcUrl || '')}" style="grid-column:1/-1">
      </div>
      <button class="btn btn-remove cam-remove" title="Remove">✕</button>`;
    row.querySelector('.cam-remove').addEventListener('click', () => {
      currentCameras.splice(i, 1);
      renderCameraList(currentCameras);
    });
    container.appendChild(row);
  });
}

function collectCameras() {
  return Array.from(document.querySelectorAll('.camera-settings-row')).map((row) => ({
    name:        row.querySelector('.cam-name').value.trim(),
    url:         row.querySelector('.cam-url').value.trim(),
    snapshotUrl: row.querySelector('.cam-snapshot').value.trim(),
    mjpegUrl:    row.querySelector('.cam-mjpeg').value.trim(),
    webrtcUrl:   row.querySelector('.cam-webrtc').value.trim(),
  }));
}

document.getElementById('btn-add-camera').addEventListener('click', () => {
  currentCameras = collectCameras();
  currentCameras.push({ name: '', url: '', snapshotUrl: '', mjpegUrl: '', webrtcUrl: '' });
  renderCameraList(currentCameras);
  const rows = document.querySelectorAll('.camera-settings-row');
  rows[rows.length - 1]?.querySelector('.cam-name')?.focus();
});

document.getElementById('btn-save-cameras').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-cameras');
  const resultEl = document.getElementById('cameras-save-result');
  btn.disabled = true;
  try {
    const cameras = collectCameras();
    const res = await fetch('/api/settings/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cameras),
    });
    const json = await res.json();
    if (json.success) {
      currentCameras = cameras;
      resultEl.textContent = '✓ ' + json.message;
      resultEl.className = 'test-result ok';
    } else {
      resultEl.textContent = '✗ ' + json.error;
      resultEl.className = 'test-result err';
    }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally {
    btn.disabled = false;
  }
});

// ── SolarEdge test + save ──────────────────────────────────────────────────

document.getElementById('btn-test-solaredge').addEventListener('click', async () => {
  const resultEl = document.getElementById('se-test-result');
  const siteId = getVal('se-site-id');
  const apiKey = getVal('se-api-key');

  if (!siteId || !apiKey) {
    resultEl.textContent = 'Enter Site ID and API key first';
    resultEl.className = 'test-result err';
    return;
  }

  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';

  try {
    const res = await fetch('/api/settings/test-solaredge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, apiKey }),
    });
    const json = await res.json();
    if (json.success) {
      const pw = json.data?.currentPower != null ? ` — ${json.data.currentPower} W` : '';
      resultEl.textContent = '✓ ' + json.message + pw;
      resultEl.className = 'test-result ok';
    } else {
      resultEl.textContent = '✗ ' + json.error;
      resultEl.className = 'test-result err';
    }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-solaredge').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-solaredge');
  const resultEl = document.getElementById('se-test-result');
  btn.disabled = true;
  try {
    const res = await fetch('/api/settings/solaredge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: getVal('se-site-id'), apiKey: getVal('se-api-key') }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally {
    btn.disabled = false;
  }
});

// ── MQTT test ──────────────────────────────────────────────────────────────

document.getElementById('btn-test-mqtt').addEventListener('click', async () => {
  const resultEl = document.getElementById('mqtt-test-result');
  const host = getVal('mqtt-host');
  const port = getVal('mqtt-port');

  if (!host) {
    resultEl.textContent = 'Enter a host first';
    resultEl.className = 'test-result err';
    return;
  }

  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';

  try {
    const res = await fetch('/api/settings/test-mqtt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: parseInt(port) || 1883 }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function updatePinDisplay(pin) {
  const el = document.getElementById('hk-pin-big');
  if (el) el.textContent = pin || '--';
}

function showSaveMsg(msg, type) {
  const el = document.getElementById('save-message');
  el.textContent = msg;
  el.className = 'save-message ' + type;
  setTimeout(() => {
    el.textContent = '';
    el.className = 'save-message';
  }, 5000);
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function escapeVal(str) {
  return String(str).replace(/"/g, '&quot;');
}

// ── Loxone ─────────────────────────────────────────────────────────────────

document.getElementById('btn-test-loxone').addEventListener('click', async () => {
  const resultEl = document.getElementById('loxone-test-result');
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result';
  try {
    const res = await fetch('/api/settings/test-loxone', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: getVal('loxone-host'), port: getVal('loxone-port'),
        username: getVal('loxone-user'), password: getVal('loxone-pass'),
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-loxone').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-loxone');
  const resultEl = document.getElementById('loxone-test-result');
  btn.disabled   = true;
  try {
    const res = await fetch('/api/settings/loxone', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: getVal('loxone-host'), port: getVal('loxone-port'),
        username: getVal('loxone-user'), password: getVal('loxone-pass'),
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── IKEA Dirigera ──────────────────────────────────────────────────────────

document.getElementById('btn-test-dirigera').addEventListener('click', async () => {
  const resultEl = document.getElementById('dirigera-test-result');
  const host  = getVal('dirigera-host');
  const token = getVal('dirigera-token');
  if (!host || !token || token.includes('•')) {
    resultEl.textContent = 'Enter host and token first';
    resultEl.className = 'test-result err';
    return;
  }
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';
  try {
    const res = await fetch('/api/settings/test-dirigera', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, token }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-dirigera').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-dirigera');
  const resultEl = document.getElementById('dirigera-test-result');
  btn.disabled   = true;
  const token = getVal('dirigera-token');
  try {
    const res = await fetch('/api/settings/dirigera', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:  getVal('dirigera-host'),
        token: token.includes('•') ? null : token,
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── IKEA Tradfri ───────────────────────────────────────────────────────────

document.getElementById('btn-save-tradfri').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-tradfri');
  const resultEl = document.getElementById('tradfri-save-result');
  btn.disabled   = true;
  const psk = getVal('tradfri-psk');
  try {
    const res = await fetch('/api/settings/tradfri', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:         getVal('tradfri-host'),
        securityCode: getVal('tradfri-code') || null,
        identity:     getVal('tradfri-identity') || null,
        psk:          (psk && !psk.includes('•')) ? psk : null,
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── BoneIO ─────────────────────────────────────────────────────────────────

document.getElementById('btn-test-boneio').addEventListener('click', async () => {
  const resultEl = document.getElementById('boneio-test-result');
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result';
  try {
    const res = await fetch('/api/settings/test-boneio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: getVal('boneio-host'), port: getVal('boneio-port') }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-boneio').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-boneio');
  const resultEl = document.getElementById('boneio-test-result');
  btn.disabled   = true;
  try {
    const res = await fetch('/api/settings/boneio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: getVal('boneio-host'), port: getVal('boneio-port') }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── Shelly ─────────────────────────────────────────────────────────────────

let currentShellyDevices = [];

function renderShellyList(devices) {
  currentShellyDevices = devices;
  const container = document.getElementById('shelly-devices-list');
  container.innerHTML = '';

  if (!devices.length) {
    container.innerHTML = '<p class="hint" style="margin-bottom:12px">No Shelly devices configured yet.</p>';
    return;
  }

  devices.forEach((dev, i) => {
    const row = document.createElement('div');
    row.className = 'shelly-row';
    row.dataset.index = i;
    row.innerHTML = `
      <div class="shelly-row-fields">
        <input type="text"     class="shelly-host" placeholder="192.168.1.50"    value="${escapeVal(dev.host || '')}">
        <input type="text"     class="shelly-name" placeholder="Name (optional)" value="${escapeVal(dev.name || '')}">
        <input type="text"     class="shelly-user" placeholder="User (optional)" value="${escapeVal(dev.username || '')}">
        <input type="password" class="shelly-pass" placeholder="Pass (optional)" value="${escapeVal(dev.password ? '••••••••' : '')}">
      </div>
      <button class="btn btn-remove shelly-remove" title="Remove">✕</button>`;
    row.querySelector('.shelly-remove').addEventListener('click', () => {
      currentShellyDevices = collectShellyDevices();
      currentShellyDevices.splice(i, 1);
      renderShellyList(currentShellyDevices);
    });
    // Test button per row
    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-secondary shelly-test-one';
    testBtn.textContent = 'Test';
    testBtn.style.marginTop = '4px';
    testBtn.addEventListener('click', async () => {
      const host = row.querySelector('.shelly-host').value.trim();
      const user = row.querySelector('.shelly-user').value.trim();
      const pass = row.querySelector('.shelly-pass').value;
      if (!host) return;
      testBtn.disabled = true;
      testBtn.textContent = '…';
      try {
        const r = await fetch('/api/settings/test-shelly', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, username: user, password: pass }),
        });
        const json = await r.json();
        testBtn.textContent = json.success ? '✓' : '✗';
        testBtn.title = json.message || json.error || '';
        setTimeout(() => { testBtn.textContent = 'Test'; testBtn.title = ''; }, 3000);
      } catch (err) {
        testBtn.textContent = '✗';
        testBtn.title = err.message;
        setTimeout(() => { testBtn.textContent = 'Test'; testBtn.title = ''; }, 3000);
      } finally { testBtn.disabled = false; }
    });
    row.querySelector('.shelly-row-fields').after(testBtn);
    container.appendChild(row);
  });
}

function collectShellyDevices() {
  return Array.from(document.querySelectorAll('.shelly-row')).map(row => ({
    host:     row.querySelector('.shelly-host').value.trim(),
    name:     row.querySelector('.shelly-name').value.trim(),
    username: row.querySelector('.shelly-user').value.trim(),
    password: row.querySelector('.shelly-pass').value,
  })).filter(d => d.host);
}

document.getElementById('btn-add-shelly').addEventListener('click', () => {
  currentShellyDevices = collectShellyDevices();
  currentShellyDevices.push({ host: '', name: '', username: '', password: '' });
  renderShellyList(currentShellyDevices);
  const rows = document.querySelectorAll('.shelly-row');
  rows[rows.length - 1]?.querySelector('.shelly-host')?.focus();
});

document.getElementById('btn-save-shelly').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-shelly');
  const resultEl = document.getElementById('shelly-save-result');
  btn.disabled   = true;
  try {
    const devices = collectShellyDevices();
    const res = await fetch('/api/settings/shelly', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(devices),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
    if (json.success) { currentShellyDevices = devices; renderShellyList(devices); }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── Restart ────────────────────────────────────────────────────────────────

document.getElementById('btn-reset-config').addEventListener('click', async () => {
  if (!confirm('This will erase ALL configuration (credentials, hosts, devices).\nThe page will reload after. Are you sure?')) return;
  try {
    const r    = await fetch('/api/admin/reset-config', { method: 'POST' });
    const json = await r.json();
    if (json.success) {
      showSaveMsg('Config erased — reloading…', 'ok');
      setTimeout(() => location.reload(), 1200);
    } else {
      showSaveMsg('Error: ' + json.error, 'err');
    }
  } catch (err) {
    showSaveMsg('Reset failed: ' + err.message, 'err');
  }
});

document.getElementById('btn-restart').addEventListener('click', async () => {
  if (!confirm('Restart the server now? The page will reconnect automatically.')) return;

  const overlay    = document.getElementById('restart-overlay');
  const titleEl    = document.getElementById('restart-title');
  const countdown  = document.getElementById('restart-countdown');
  const subEl      = document.getElementById('restart-sub');

  overlay.style.display = 'flex';
  titleEl.textContent   = 'Restarting…';

  try {
    await fetch('/api/admin/restart', { method: 'POST' });
  } catch (_) { /* expected — server closes connection */ }

  // Poll until the server is back, showing a countdown
  let secs = 15;
  countdown.textContent = secs;

  const tick = setInterval(() => {
    secs--;
    countdown.textContent = Math.max(0, secs);
  }, 1000);

  const poll = setInterval(async () => {
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      if (r.ok) {
        clearInterval(tick);
        clearInterval(poll);
        titleEl.textContent = 'Back online';
        subEl.innerHTML = 'Server restarted successfully. Reloading…';
        setTimeout(() => location.reload(), 800);
      }
    } catch (_) { /* still down */ }
  }, 1500);

  // Safety: force reload after 60s regardless
  setTimeout(() => location.reload(), 60000);
});

// Init
loadSettings();
