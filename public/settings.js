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

    // Somfy
    setVal('somfy-host',     data.somfy?.host || '');
    setVal('somfy-port',     data.somfy?.port || 8443);
    setVal('somfy-email',    data.somfy?.email || '');
    setVal('somfy-password', data.somfy?.password ? '••••••••' : '');
    setVal('somfy-devices',  (data.somfy?.devices || []).join(', '));
    setVal('somfy-poll',     data.somfy?.pollInterval ?? 30);

    // Bayrol
    setVal('bayrol-pool-name', data.bayrol?.poolName || '');
    setVal('bayrol-email', data.bayrol?.username || '');
    setVal('bayrol-password', data.bayrol?.password ? '••••••••' : '');
    setVal('bayrol-poll', data.bayrol?.pollInterval ?? 60);

    // Dreame
    renderDreameList(data.dreame?.devices || []);

    // Homey
    const homeyMode = data.homey?.mode || 'local';
    setVal('homey-mode', homeyMode);
    setVal('homey-host', data.homey?.host || '');
    setVal('homey-id',   data.homey?.homeyId || '');
    setVal('homey-token',data.homey?.token ? '••••••••' : '');
    setVal('homey-poll', data.homey?.pollInterval ?? 10);
    document.getElementById('homey-local-fields').style.display = homeyMode === 'cloud' ? 'none' : '';
    document.getElementById('homey-cloud-fields').style.display = homeyMode === 'cloud' ? ''     : 'none';

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

    // Loxone Outbound Push
    setVal('loxone-out-host', data.loxoneOut?.host || '');
    setVal('loxone-out-port', data.loxoneOut?.port || 80);
    setVal('loxone-out-user', data.loxoneOut?.username || 'admin');
    setVal('loxone-out-pass', data.loxoneOut?.password ? '••••••••' : '');
    setVal('loxone-out-mappings', (data.loxoneOut?.mappings || []).map(m => `${m.storeKey} = ${m.virtualInput}`).join('\n'));

    // SIP
    setVal('sip-ws-url',       data.sip?.wsUrl       || '');
    setVal('sip-username',     data.sip?.username     || '');
    setVal('sip-domain',       data.sip?.domain       || '');
    setVal('sip-password',     data.sip?.password ? '••••••••' : '');
    setVal('sip-display-name', data.sip?.displayName  || '');
    setVal('sip-dtmf-unlock',  data.sip?.dtmfUnlock   || '#');
    setVal('sip-relay-index',  data.sip?.relayIndex   ?? '');

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

    // ESPHome
    renderESPHomeList(data.esphome?.devices || []);

    // Shelly
    renderShellyList(data.shelly?.devices || []);

    // LG ThinQ
    setVal('lgthinq-access-token',  data.lgthinq?.hasTokens ? '••••••••' : '');
    setVal('lgthinq-refresh-token', data.lgthinq?.hasTokens ? '••••••••' : '');
    setVal('lgthinq-user-number',   data.lgthinq?.userNumber || '');
    setVal('lgthinq-country', data.lgthinq?.country || 'EU');

    // SmartBob
    setVal('smartbob-name', data.smartbob?.name || 'SmartBob');
    setVal('smartbob-host', data.smartbob?.host || '');
    setVal('smartbob-port', data.smartbob?.port || 1883);
    setVal('smartbob-user', data.smartbob?.username || '');
    setVal('smartbob-pass', data.smartbob?.password ? '••••••••' : '');
    renderSmartBobEntities(data.smartbob?.entities || []);

    // KNX
    setVal('knx-host', data.knx?.host || '');
    setVal('knx-port', data.knx?.port || 3671);
    renderKNXGAList(data.knx?.groupAddresses || []);

    // Fibaro
    setVal('fibaro-host', data.fibaro?.host || '');
    setVal('fibaro-port', data.fibaro?.port || 80);
    setVal('fibaro-user', data.fibaro?.username || 'admin');
    setVal('fibaro-pass', data.fibaro?.password ? '••••••••' : '');

    // BroadLink
    renderBroadlinkList(data.broadlink?.devices || []);
    loadBroadlinkCodes();

    // Waveshare
    renderWaveshareList(data.waveshare?.devices || []);

    // FFmpeg RTSP proxy
    const ffrtspEnabled = !!(data.ffmpegRtsp?.enabled);
    const ffrtspEnabledEl = document.getElementById('ffrtsp-enabled');
    if (ffrtspEnabledEl) ffrtspEnabledEl.checked = ffrtspEnabled;
    setVal('ffrtsp-base-port', data.ffmpegRtsp?.basePort || 8554);
    setVal('ffrtsp-path',      data.ffmpegRtsp?.ffmpegPath || 'ffmpeg');
    if (ffrtspEnabled) loadFFmpegRTSPStreams();

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

    // HTTPS
    const https = data.server?.https || {};
    const le    = data.server?.letsEncrypt || {};
    document.getElementById('https-enabled').checked = !!https.enabled;
    document.getElementById('https-fields').style.display = https.enabled ? '' : 'none';
    setVal('https-port', https.port || 3443);
    setVal('https-cert', https.certFile || '');
    setVal('https-key',  https.keyFile  || '');
    document.getElementById('le-enabled').checked = !!le.enabled;
    document.getElementById('le-fields').style.display = le.enabled ? '' : 'none';
    setVal('le-domain',    le.domain   || '');
    setVal('le-email',     le.email    || '');
    setVal('le-port',      le.port     || 443);
    setVal('le-certs-dir', le.certsDir || './certs');
    document.getElementById('le-staging').checked = !!le.staging;

    // QR code — fetch URI from backend (has the correct setupID)
    await refreshQrCode();

    // Security: load users & tokens
    await loadSecurityLists();
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

// ── Dreame device list ────────────────────────────────────────────────────

let currentDreameDevices = [];

function renderDreameList(devices) {
  currentDreameDevices = devices;
  const container = document.getElementById('dreame-devices-list');
  container.innerHTML = '';

  if (!devices.length) {
    container.innerHTML = '<p class="hint" style="margin-bottom:12px">No Dreame devices configured yet.</p>';
    return;
  }

  devices.forEach((dev, i) => {
    const row = document.createElement('div');
    row.className = 'shelly-row';  // reuse same row layout
    row.dataset.index = i;
    row.innerHTML = `
      <div class="shelly-row-fields" style="grid-template-columns:1fr 1fr 1fr auto">
        <input type="text"     class="dreame-name"  placeholder="Name (optional)"     value="${escapeVal(dev.name  || '')}">
        <input type="text"     class="dreame-host"  placeholder="192.168.1.x"         value="${escapeVal(dev.host  || '')}">
        <input type="password" class="dreame-token" placeholder="32-char hex token"   value="${escapeVal(dev.token ? '••••••••' : '')}">
        <select class="dreame-type" style="background:var(--bg);border:1px solid var(--card-border);border-radius:8px;color:var(--text);font-size:.85rem;padding:8px 10px;outline:none">
          <option value="vacuum"   ${dev.type !== 'purifier' ? 'selected' : ''}>Robot Vacuum</option>
          <option value="purifier" ${dev.type === 'purifier' ? 'selected' : ''}>Air Purifier</option>
        </select>
      </div>
      <button class="btn btn-remove shelly-remove" title="Remove">✕</button>`;

    row.querySelector('.shelly-remove').addEventListener('click', () => {
      currentDreameDevices = collectDreameDevices();
      currentDreameDevices.splice(i, 1);
      renderDreameList(currentDreameDevices);
    });

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-secondary shelly-test-one';
    testBtn.textContent = 'Test';
    testBtn.style.marginTop = '4px';
    testBtn.addEventListener('click', async () => {
      const host  = row.querySelector('.dreame-host').value.trim();
      const token = row.querySelector('.dreame-token').value.trim();
      if (!host || !token || token.includes('•')) return;
      testBtn.disabled = true;
      testBtn.textContent = '…';
      try {
        const r = await fetch('/api/settings/test-dreame', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, token }),
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

function collectDreameDevices() {
  return Array.from(document.querySelectorAll('#dreame-devices-list .shelly-row')).map(row => ({
    name:  row.querySelector('.dreame-name').value.trim(),
    host:  row.querySelector('.dreame-host').value.trim(),
    token: row.querySelector('.dreame-token').value.trim(),
    type:  row.querySelector('.dreame-type').value,
  })).filter(d => d.host);
}

document.getElementById('btn-add-dreame').addEventListener('click', () => {
  currentDreameDevices = collectDreameDevices();
  currentDreameDevices.push({ name: '', host: '', token: '', type: 'vacuum' });
  renderDreameList(currentDreameDevices);
  const rows = document.querySelectorAll('#dreame-devices-list .shelly-row');
  rows[rows.length - 1]?.querySelector('.dreame-host')?.focus();
});

document.getElementById('btn-save-dreame').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-dreame');
  const resultEl = document.getElementById('dreame-save-result');
  btn.disabled   = true;
  try {
    const devices = collectDreameDevices();
    const res = await fetch('/api/settings/dreame', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(devices),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
    if (json.success) { currentDreameDevices = devices; renderDreameList(devices); }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── Homey test + save ─────────────────────────────────────────────────────

document.getElementById('homey-mode').addEventListener('change', (e) => {
  const cloud = e.target.value === 'cloud';
  document.getElementById('homey-local-fields').style.display = cloud ? 'none' : '';
  document.getElementById('homey-cloud-fields').style.display = cloud ? ''     : 'none';
});

document.getElementById('btn-test-homey').addEventListener('click', async () => {
  const resultEl = document.getElementById('homey-test-result');
  const mode  = getVal('homey-mode');
  const token = getVal('homey-token');
  if (!token || token.includes('•')) {
    resultEl.textContent = 'Enter a valid token first';
    resultEl.className = 'test-result err';
    return;
  }
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';
  try {
    const res = await fetch('/api/settings/test-homey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, host: getVal('homey-host'), homeyId: getVal('homey-id'), token }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-homey').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-homey');
  const resultEl = document.getElementById('homey-test-result');
  btn.disabled = true;
  try {
    const res = await fetch('/api/settings/homey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode:         getVal('homey-mode'),
        host:         getVal('homey-host'),
        homeyId:      getVal('homey-id'),
        token:        getVal('homey-token'),
        pollInterval: parseInt(getVal('homey-poll') || '10'),
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

// ── Somfy ──────────────────────────────────────────────────────────────────

document.getElementById('btn-test-somfy').addEventListener('click', async () => {
  const resultEl  = document.getElementById('somfy-test-result');
  const host      = getVal('somfy-host');
  const password  = getVal('somfy-password');
  if (!host || !getVal('somfy-email') || !password || password.includes('•')) {
    resultEl.textContent = 'Enter host, email and password first';
    resultEl.className = 'test-result err';
    return;
  }
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';
  try {
    const res  = await fetch('/api/settings/test-somfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: parseInt(getVal('somfy-port') || '8443'), email: getVal('somfy-email'), password }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-somfy').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-somfy');
  const resultEl = document.getElementById('somfy-test-result');
  btn.disabled = true;
  try {
    const res  = await fetch('/api/settings/somfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:         getVal('somfy-host'),
        port:         parseInt(getVal('somfy-port') || '8443'),
        email:        getVal('somfy-email'),
        password:     getVal('somfy-password'),
        devices:      getVal('somfy-devices').split(',').map(s => s.trim()).filter(Boolean),
        pollInterval: parseInt(getVal('somfy-poll') || '30'),
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

// ── Bayrol ─────────────────────────────────────────────────────────────────

document.getElementById('btn-test-bayrol').addEventListener('click', async () => {
  const resultEl = document.getElementById('bayrol-test-result');
  const email    = getVal('bayrol-email');
  const password = getVal('bayrol-password');
  if (!email || !password || password.includes('•')) {
    resultEl.textContent = 'Enter email and password first';
    resultEl.className = 'test-result err';
    return;
  }
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result loading';
  try {
    const res  = await fetch('/api/settings/test-bayrol', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  }
});

document.getElementById('btn-save-bayrol').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-bayrol');
  const resultEl = document.getElementById('bayrol-test-result');
  btn.disabled = true;
  try {
    const res  = await fetch('/api/settings/bayrol', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolName:     getVal('bayrol-pool-name'),
        username:     getVal('bayrol-email'),
        password:     getVal('bayrol-password'),
        pollInterval: parseInt(getVal('bayrol-poll') || '60'),
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

// ── Loxone Outbound Push ───────────────────────────────────────────────────

document.getElementById('btn-save-loxone-out').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-loxone-out');
  const resultEl = document.getElementById('loxone-out-result');
  btn.disabled   = true;
  try {
    const rawMappings = getVal('loxone-out-mappings');
    const mappings = rawMappings.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => { const [k, v] = l.split('=').map(s => s.trim()); return k && v ? { storeKey: k, virtualInput: v } : null; })
      .filter(Boolean);
    const res  = await fetch('/api/settings/loxone-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:     getVal('loxone-out-host'),
        port:     parseInt(getVal('loxone-out-port') || '80'),
        username: getVal('loxone-out-user'),
        password: getVal('loxone-out-pass'),
        mappings,
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className   = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className   = 'test-result err';
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
        <div class="cam-snapshot-row">
          <input type="text" class="cam-snapshot" placeholder="http://…/snapshot.jpg (optional)" value="${escapeVal(cam.snapshotUrl || '')}">
          <button class="btn btn-secondary btn-sm cam-scan" title="Auto-detect snapshot URL from RTSP URL">Scan</button>
        </div>
        <input type="text" class="cam-mjpeg"    placeholder="http://…/mjpeg (MJPEG stream)"     value="${escapeVal(cam.mjpegUrl || '')}">
        <input type="text" class="cam-webrtc"   placeholder="http://…/whep (WebRTC / WHEP endpoint — e.g. go2rtc)" value="${escapeVal(cam.webrtcUrl || '')}" style="grid-column:1/-1">
      </div>
      <button class="btn btn-remove cam-remove" title="Remove">✕</button>`;
    row.querySelector('.cam-remove').addEventListener('click', () => {
      currentCameras.splice(i, 1);
      renderCameraList(currentCameras);
    });
    row.querySelector('.cam-scan').addEventListener('click', async () => {
      const urlField  = row.querySelector('.cam-url');
      const snapField = row.querySelector('.cam-snapshot');
      const btn       = row.querySelector('.cam-scan');
      const rtspUrl   = urlField.value.trim();

      // Parse IP and credentials from RTSP URL
      let ip = '', username = '', password = '';
      try {
        const u = new URL(rtspUrl.replace(/^rtsps?:\/\//i, 'http://'));
        ip       = u.hostname;
        username = u.username || '';
        password = u.password || '';
      } catch { /* if URL parsing fails, leave ip empty */ }

      if (!ip) {
        alert('Enter an RTSP URL first so we can extract the camera IP.');
        return;
      }

      btn.disabled    = true;
      btn.textContent = '…';
      try {
        const r    = await fetch('/api/settings/scan-snapshot', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ip, username, password }),
        });
        const data = await r.json();
        if (data.success) {
          snapField.value = data.url;
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = 'Scan'; btn.disabled = false; }, 1500);
        } else {
          btn.textContent = '✗';
          setTimeout(() => { btn.textContent = 'Scan'; btn.disabled = false; }, 1500);
          alert('No snapshot URL found: ' + (data.error || 'unknown'));
        }
      } catch (err) {
        btn.textContent = '✗';
        setTimeout(() => { btn.textContent = 'Scan'; btn.disabled = false; }, 1500);
        alert('Scan failed: ' + err.message);
      }
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

// ── SIP ────────────────────────────────────────────────────────────────────

document.getElementById('btn-save-sip').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-sip');
  const resultEl = document.getElementById('sip-save-result');
  btn.disabled   = true;
  const password = getVal('sip-password');
  const relayRaw = getVal('sip-relay-index');
  try {
    const res = await fetch('/api/settings/sip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wsUrl:       getVal('sip-ws-url'),
        username:    getVal('sip-username'),
        domain:      getVal('sip-domain'),
        password:    password.includes('•') ? null : password,
        displayName: getVal('sip-display-name'),
        dtmfUnlock:  getVal('sip-dtmf-unlock') || '#',
        relayIndex:  relayRaw !== '' ? parseInt(relayRaw) : null,
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
    if (json.success) setVal('sip-password', '••••••••');
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

// ── Waveshare Modbus TCP ───────────────────────────────────────────────────

let currentWaveshareDevices = [];

// ── BroadLink ─────────────────────────────────────────────────────────────

let currentBroadlinkDevices = [];

function renderBroadlinkList(devices) {
  currentBroadlinkDevices = devices;
  const container = document.getElementById('broadlink-devices-list');
  container.innerHTML = '';

  if (!devices.length) {
    container.innerHTML = '<p class="hint" style="margin-bottom:12px">No BroadLink devices configured yet.</p>';
    return;
  }

  devices.forEach((dev, i) => {
    const row = document.createElement('div');
    row.className = 'shelly-row';
    row.dataset.index = i;
    row.innerHTML = `
      <div class="shelly-row-fields" style="grid-template-columns:1fr 1fr 1fr auto">
        <input type="text" class="bl-host" placeholder="192.168.1.x" value="${escapeVal(dev.host || '')}">
        <input type="text" class="bl-name" placeholder="Name" value="${escapeVal(dev.name || '')}">
        <input type="text" class="bl-mac"  placeholder="AA:BB:CC:DD:EE:FF" value="${escapeVal(dev.mac || '')}">
      </div>
      <button class="btn btn-remove bl-remove" title="Remove">✕</button>`;
    row.querySelector('.bl-remove').addEventListener('click', () => {
      currentBroadlinkDevices = collectBroadlinkDevices();
      currentBroadlinkDevices.splice(i, 1);
      renderBroadlinkList(currentBroadlinkDevices);
    });
    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-secondary';
    testBtn.textContent = 'Test';
    testBtn.style.marginTop = '4px';
    testBtn.addEventListener('click', async () => {
      const host = row.querySelector('.bl-host').value.trim();
      if (!host) return;
      testBtn.disabled = true; testBtn.textContent = '…';
      try {
        const r    = await fetch('/api/settings/test-broadlink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host }) });
        const json = await r.json();
        testBtn.textContent = json.success ? '✓' : '✗';
        testBtn.title = json.message || json.error || '';
        setTimeout(() => { testBtn.textContent = 'Test'; testBtn.title = ''; }, 3000);
      } catch (err) {
        testBtn.textContent = '✗'; testBtn.title = err.message;
        setTimeout(() => { testBtn.textContent = 'Test'; testBtn.title = ''; }, 3000);
      } finally { testBtn.disabled = false; }
    });
    row.querySelector('.shelly-row-fields').after(testBtn);
    container.appendChild(row);
  });
}

function collectBroadlinkDevices() {
  return Array.from(document.querySelectorAll('#broadlink-devices-list .shelly-row')).map(row => ({
    host: row.querySelector('.bl-host').value.trim(),
    name: row.querySelector('.bl-name').value.trim(),
    mac:  row.querySelector('.bl-mac').value.trim(),
  })).filter(d => d.host);
}

document.getElementById('btn-add-broadlink').addEventListener('click', () => {
  currentBroadlinkDevices = collectBroadlinkDevices();
  currentBroadlinkDevices.push({ host: '', name: '', mac: '' });
  renderBroadlinkList(currentBroadlinkDevices);
  const rows = document.querySelectorAll('#broadlink-devices-list .shelly-row');
  rows[rows.length - 1]?.querySelector('.bl-host')?.focus();
});

document.getElementById('btn-save-broadlink').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-broadlink');
  const resultEl = document.getElementById('broadlink-save-result');
  btn.disabled   = true;
  try {
    const devices = collectBroadlinkDevices();
    const res  = await fetch('/api/settings/broadlink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(devices) });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className   = 'test-result ' + (json.success ? 'ok' : 'err');
    if (json.success) { currentBroadlinkDevices = devices; renderBroadlinkList(devices); loadBroadlinkCodes(); }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className   = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── Code Library ─────────────────────────────────────────────────────────────

async function loadBroadlinkCodes() {
  const mgr = document.getElementById('broadlink-code-manager');
  const sec = document.getElementById('broadlink-code-sections');
  const devices = collectBroadlinkDevices().length
    ? collectBroadlinkDevices()
    : currentBroadlinkDevices;

  if (!devices.length) { mgr.style.display = 'none'; return; }
  mgr.style.display = '';

  let allCodes = {};
  try {
    const r = await fetch('/api/broadlink/codes');
    if (r.ok) allCodes = await r.json();
  } catch { /* offline */ }

  sec.innerHTML = '';
  for (const dev of devices) {
    if (!dev.host) continue;
    const codes  = allCodes[dev.host] || {};
    const label  = dev.name || dev.host;
    const block  = document.createElement('div');
    block.className = 'bl-device-block';
    block.style.cssText = 'margin-bottom:20px;padding:14px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:10px';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:0.88rem;margin-bottom:10px;color:var(--text)';
    title.textContent = label + ' — ' + dev.host;
    block.appendChild(title);

    // Existing codes list
    const codeList = document.createElement('div');
    codeList.className = 'bl-codes-list';
    codeList.style.marginBottom = '10px';

    const renderCodes = (codes) => {
      codeList.innerHTML = '';
      const entries = Object.entries(codes);
      if (!entries.length) {
        codeList.innerHTML = '<p class="hint" style="margin:4px 0 8px">No codes learned yet. Point the remote at the RM4 device and click Learn IR.</p>';
        return;
      }
      entries.forEach(([name, entry]) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--card-border)';
        row.innerHTML = `
          <span style="flex:1;font-size:0.85rem">${escapeVal(name)}</span>
          <span class="badge" style="font-size:0.65rem">${entry.type || 'ir'}</span>
          <button class="btn btn-secondary" style="padding:2px 10px;font-size:0.75rem" data-send="${escapeVal(name)}">&#9654;</button>
          <button class="btn btn-remove" style="padding:2px 8px;font-size:0.75rem" data-del="${escapeVal(name)}">✕</button>`;
        row.querySelector('[data-send]').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true; btn.textContent = '…';
          try {
            await fetch('/api/broadlink/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: dev.host, name }) });
            btn.textContent = '✓';
          } catch { btn.textContent = '✗'; }
          setTimeout(() => { btn.textContent = '▶'; btn.disabled = false; }, 1500);
        });
        row.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(`Delete code "${name}"?`)) return;
          await fetch('/api/broadlink/codes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: dev.host, name }) });
          delete codes[name];
          renderCodes(codes);
        });
        codeList.appendChild(row);
      });
    };
    renderCodes(codes);
    block.appendChild(codeList);

    // Learn form
    const form = document.createElement('div');
    form.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px';
    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.placeholder = 'Code name (e.g. TV On)';
    nameInput.style.cssText = 'flex:1;min-width:140px';

    const statusEl = document.createElement('span');
    statusEl.style.cssText = 'font-size:0.78rem;color:var(--text-muted);flex-basis:100%;min-height:1.2em';

    const makeLearnBtn = (label, endpoint) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.cssText = 'font-size:0.78rem;padding:5px 12px';
      btn.textContent = label;
      btn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        btn.disabled = true; statusEl.textContent = 'Starting…';
        try {
          const res = await fetch(`/api/broadlink/learn/${endpoint}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: dev.host, name }),
          });
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
              if (!line.trim()) continue;
              const obj = JSON.parse(line);
              if (obj.status) {
                if (obj.status === 'learning') statusEl.textContent = 'Point remote at RM4 and press button…';
                else if (obj.status === 'rf_sweep') statusEl.textContent = 'Hold RF button now (frequency sweep)…';
                else if (obj.status === 'rf_learn') statusEl.textContent = 'Frequency found! Press RF button once…';
                else if (obj.status?.startsWith('waiting:')) statusEl.textContent = `Waiting… ${obj.status.split(':')[1]}s`;
              } else if (obj.success) {
                statusEl.textContent = `✓ "${name}" saved (${obj.bytes} bytes)`;
                nameInput.value = '';
                codes[name] = { type: endpoint, data: '' };
                // Refresh from server
                try { const r = await fetch('/api/broadlink/codes'); if (r.ok) { const all = await r.json(); renderCodes(all[dev.host] || {}); } } catch {}
              } else {
                statusEl.textContent = '✗ ' + obj.error;
              }
            }
          }
        } catch (err) {
          statusEl.textContent = '✗ ' + err.message;
        } finally {
          btn.disabled = false;
          setTimeout(() => { if (statusEl.textContent.startsWith('✓') || statusEl.textContent.startsWith('✗')) statusEl.textContent = ''; }, 5000);
        }
      });
      return btn;
    };

    form.appendChild(nameInput);
    form.appendChild(makeLearnBtn('Learn IR', 'ir'));
    form.appendChild(makeLearnBtn('Learn RF', 'rf'));
    form.appendChild(statusEl);
    block.appendChild(form);
    sec.appendChild(block);
  }
}

// ── Waveshare ─────────────────────────────────────────────────────────────

function renderWaveshareList(devices) {
  currentWaveshareDevices = devices;
  const container = document.getElementById('waveshare-devices-list');
  container.innerHTML = '';

  if (!devices.length) {
    container.innerHTML = '<p class="hint" style="margin-bottom:12px">No Waveshare boards configured yet.</p>';
    return;
  }

  devices.forEach((dev, i) => {
    const row = document.createElement('div');
    row.className = 'shelly-row';
    row.dataset.index = i;
    row.innerHTML = `
      <div class="shelly-row-fields" style="grid-template-columns:1fr 1fr 80px 70px 80px auto">
        <input type="text"   class="ws-host"  placeholder="192.168.1.x"  value="${escapeVal(dev.host || '')}">
        <input type="text"   class="ws-name"  placeholder="Name"          value="${escapeVal(dev.name || '')}">
        <input type="number" class="ws-port"  placeholder="502"           value="${escapeVal(dev.port || 502)}" min="1" max="65535">
        <input type="number" class="ws-slave" placeholder="1"             value="${escapeVal(dev.slaveId || 1)}" min="1" max="247">
        <input type="number" class="ws-count" placeholder="8"             value="${escapeVal(dev.relayCount || 8)}" min="1" max="64">
      </div>
      <button class="btn btn-remove ws-remove" title="Remove">✕</button>`;
    row.querySelector('.ws-remove').addEventListener('click', () => {
      currentWaveshareDevices = collectWaveshareDevices();
      currentWaveshareDevices.splice(i, 1);
      renderWaveshareList(currentWaveshareDevices);
    });
    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-secondary';
    testBtn.textContent = 'Test';
    testBtn.style.marginTop = '4px';
    testBtn.addEventListener('click', async () => {
      const host    = row.querySelector('.ws-host').value.trim();
      const port    = row.querySelector('.ws-port').value || 502;
      const slaveId = row.querySelector('.ws-slave').value || 1;
      if (!host) return;
      testBtn.disabled = true; testBtn.textContent = '…';
      try {
        const r = await fetch('/api/settings/test-waveshare', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, port: parseInt(port), slaveId: parseInt(slaveId) }),
        });
        const json = await r.json();
        testBtn.textContent = json.success ? '✓' : '✗';
        testBtn.title = json.message || json.error || '';
        setTimeout(() => { testBtn.textContent = 'Test'; testBtn.title = ''; }, 3000);
      } catch (err) {
        testBtn.textContent = '✗'; testBtn.title = err.message;
        setTimeout(() => { testBtn.textContent = 'Test'; testBtn.title = ''; }, 3000);
      } finally { testBtn.disabled = false; }
    });
    row.querySelector('.shelly-row-fields').after(testBtn);
    container.appendChild(row);
  });
}

function collectWaveshareDevices() {
  return Array.from(document.querySelectorAll('#waveshare-devices-list .shelly-row')).map(row => ({
    host:       row.querySelector('.ws-host').value.trim(),
    name:       row.querySelector('.ws-name').value.trim(),
    port:       parseInt(row.querySelector('.ws-port').value) || 502,
    slaveId:    parseInt(row.querySelector('.ws-slave').value) || 1,
    relayCount: parseInt(row.querySelector('.ws-count').value) || 8,
  })).filter(d => d.host);
}

document.getElementById('btn-add-waveshare').addEventListener('click', () => {
  currentWaveshareDevices = collectWaveshareDevices();
  currentWaveshareDevices.push({ host: '', name: '', port: 502, slaveId: 1, relayCount: 8 });
  renderWaveshareList(currentWaveshareDevices);
  const rows = document.querySelectorAll('#waveshare-devices-list .shelly-row');
  rows[rows.length - 1]?.querySelector('.ws-host')?.focus();
});

document.getElementById('btn-save-waveshare').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-waveshare');
  const resultEl = document.getElementById('waveshare-save-result');
  btn.disabled   = true;
  try {
    const devices = collectWaveshareDevices();
    const res = await fetch('/api/settings/waveshare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(devices),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
    if (json.success) { currentWaveshareDevices = devices; renderWaveshareList(devices); }
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

// ── Security & Auth ────────────────────────────────────────────────────────

async function loadSecurityLists() {
  await Promise.all([loadUsersList(), loadTokensList()]);
}

async function loadUsersList() {
  const el = document.getElementById('users-list');
  try {
    const res  = await fetch('/api/auth/users');
    const data = await res.json();
    if (!data.success) { el.innerHTML = `<span class="token-empty">${data.error}</span>`; return; }
    if (!data.data.length) { el.innerHTML = '<span class="token-empty">No users</span>'; return; }
    el.innerHTML = data.data.map(u => `
      <div class="token-row">
        <span class="token-row-name">${escHtml(u.username)}</span>
        <span class="token-row-badge ${u.role === 'viewer' ? 'role-viewer' : ''}">${u.role}</span>
        <span class="token-row-meta">${new Date(u.createdAt).toLocaleDateString()}</span>
        <button class="token-row-del" data-id="${u.id}" title="Delete user">✕</button>
      </div>`).join('');
    el.querySelectorAll('.token-row-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete user "${btn.closest('.token-row').querySelector('.token-row-name').textContent}"?`)) return;
        const r = await fetch(`/api/auth/users/${btn.dataset.id}`, { method: 'DELETE' });
        const d = await r.json();
        document.getElementById('add-user-result').textContent = d.success ? '✓ User deleted' : '✗ ' + d.error;
        document.getElementById('add-user-result').className = 'test-result ' + (d.success ? 'ok' : 'err');
        if (d.success) loadUsersList();
      });
    });
  } catch (err) {
    el.innerHTML = `<span class="token-empty">Error: ${err.message}</span>`;
  }
}

async function loadTokensList() {
  const el = document.getElementById('tokens-list');
  try {
    const res  = await fetch('/api/auth/tokens');
    const data = await res.json();
    if (!data.success) { el.innerHTML = `<span class="token-empty">${data.error}</span>`; return; }
    if (!data.data.length) { el.innerHTML = '<span class="token-empty">No API tokens yet</span>'; return; }
    el.innerHTML = data.data.map(t => `
      <div class="token-row">
        <span class="token-row-name">${escHtml(t.name)}</span>
        <span class="token-row-meta">${new Date(t.createdAt).toLocaleDateString()}</span>
        <button class="token-row-del" data-id="${t.id}" title="Revoke token">✕</button>
      </div>`).join('');
    el.querySelectorAll('.token-row-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Revoke token "${btn.closest('.token-row').querySelector('.token-row-name').textContent}"?`)) return;
        const r = await fetch(`/api/auth/tokens/${btn.dataset.id}`, { method: 'DELETE' });
        const d = await r.json();
        document.getElementById('token-result').textContent = d.success ? '✓ Token revoked' : '✗ ' + d.error;
        document.getElementById('token-result').className = 'test-result ' + (d.success ? 'ok' : 'err');
        if (d.success) loadTokensList();
      });
    });
  } catch (err) {
    el.innerHTML = `<span class="token-empty">Error: ${err.message}</span>`;
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Change password
document.getElementById('btn-change-pw').addEventListener('click', async () => {
  const btn    = document.getElementById('btn-change-pw');
  const result = document.getElementById('change-pw-result');
  const cur    = document.getElementById('sec-current-pw').value;
  const nw     = document.getElementById('sec-new-pw').value;
  const nw2    = document.getElementById('sec-new-pw2').value;
  if (!cur || !nw) { result.textContent = '✗ Fill in all fields'; result.className = 'test-result err'; return; }
  if (nw !== nw2)  { result.textContent = '✗ Passwords do not match'; result.className = 'test-result err'; return; }
  btn.disabled = true;
  try {
    const res  = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
    });
    const data = await res.json();
    result.textContent = data.success ? '✓ ' + data.message : '✗ ' + data.error;
    result.className = 'test-result ' + (data.success ? 'ok' : 'err');
    if (data.success) {
      document.getElementById('sec-current-pw').value = '';
      document.getElementById('sec-new-pw').value = '';
      document.getElementById('sec-new-pw2').value = '';
    }
  } catch (err) {
    result.textContent = '✗ ' + err.message;
    result.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// Add user
document.getElementById('btn-add-user').addEventListener('click', async () => {
  const btn    = document.getElementById('btn-add-user');
  const result = document.getElementById('add-user-result');
  const name   = getVal('new-user-name');
  const pw     = document.getElementById('new-user-pw').value;
  const role   = getVal('new-user-role');
  if (!name || !pw) { result.textContent = '✗ Username and password required'; result.className = 'test-result err'; return; }
  btn.disabled = true;
  try {
    const res  = await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: pw, role }),
    });
    const data = await res.json();
    result.textContent = data.success ? `✓ User "${data.data.username}" created` : '✗ ' + data.error;
    result.className = 'test-result ' + (data.success ? 'ok' : 'err');
    if (data.success) {
      setVal('new-user-name', '');
      document.getElementById('new-user-pw').value = '';
      loadUsersList();
    }
  } catch (err) {
    result.textContent = '✗ ' + err.message;
    result.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// Create API token
document.getElementById('btn-create-token').addEventListener('click', async () => {
  const btn     = document.getElementById('btn-create-token');
  const result  = document.getElementById('token-result');
  const reveal  = document.getElementById('new-token-reveal');
  const tokenEl = document.getElementById('new-token-text');
  const name    = getVal('new-token-name');
  if (!name) { result.textContent = '✗ Token name required'; result.className = 'test-result err'; return; }
  btn.disabled = true;
  try {
    const res  = await fetch('/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.success) {
      result.textContent = '';
      tokenEl.textContent = data.token;
      reveal.style.display = '';
      setVal('new-token-name', '');
      loadTokensList();
    } else {
      result.textContent = '✗ ' + data.error;
      result.className = 'test-result err';
    }
  } catch (err) {
    result.textContent = '✗ ' + err.message;
    result.className = 'test-result err';
  } finally { btn.disabled = false; }
});

document.getElementById('btn-copy-token').addEventListener('click', () => {
  const text = document.getElementById('new-token-text').textContent;
  navigator.clipboard?.writeText(text).then(() => {
    document.getElementById('btn-copy-token').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('btn-copy-token').textContent = 'Copy'; }, 1500);
  });
});

// HTTPS checkbox toggles
document.getElementById('https-enabled').addEventListener('change', function () {
  document.getElementById('https-fields').style.display = this.checked ? '' : 'none';
});
document.getElementById('le-enabled').addEventListener('change', function () {
  document.getElementById('le-fields').style.display = this.checked ? '' : 'none';
});

// Save HTTPS settings
document.getElementById('btn-save-https').addEventListener('click', async () => {
  const btn    = document.getElementById('btn-save-https');
  const result = document.getElementById('https-result');
  btn.disabled = true;
  try {
    const res  = await fetch('/api/settings/https', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        httpsEnabled: document.getElementById('https-enabled').checked,
        httpsPort:    getVal('https-port'),
        certFile:     getVal('https-cert'),
        keyFile:      getVal('https-key'),
        leEnabled:    document.getElementById('le-enabled').checked,
        lePort:       getVal('le-port'),
        leDomain:     getVal('le-domain'),
        leEmail:      getVal('le-email'),
        leStaging:    document.getElementById('le-staging').checked,
        leCertsDir:   getVal('le-certs-dir'),
      }),
    });
    const data = await res.json();
    result.textContent = data.success ? '✓ ' + data.message : '✗ ' + data.error;
    result.className = 'test-result ' + (data.success ? 'ok' : 'err');
  } catch (err) {
    result.textContent = '✗ ' + err.message;
    result.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── ESPHome ───────────────────────────────────────────────────────────────

let currentESPHomeDevices = [];

function renderESPHomeList(devices) {
  currentESPHomeDevices = devices;
  const container = document.getElementById('esphome-devices-list');
  container.innerHTML = '';
  devices.forEach((dev, i) => addESPHomeRow(dev));
}

function addESPHomeRow(dev = {}) {
  const container = document.getElementById('esphome-devices-list');
  const row = document.createElement('div');
  row.className = 'shelly-row';
  row.innerHTML = `
    <div class="shelly-row-fields" style="grid-template-columns:1fr 80px 1fr 1fr auto">
      <input type="text"     class="esp-host" placeholder="192.168.1.200" value="${escapeVal(dev.host || '')}">
      <input type="number"   class="esp-port" placeholder="80" min="1" max="65535" value="${escapeVal(dev.port || 80)}">
      <input type="text"     class="esp-name" placeholder="Name (optional)" value="${escapeVal(dev.name || '')}">
      <input type="password" class="esp-pass" placeholder="Password (optional)" value="${escapeVal(dev.password ? '••••••••' : '')}">
    </div>
    <button class="btn btn-remove esp-remove" title="Remove">✕</button>`;
  row.querySelector('.esp-remove').addEventListener('click', () => { row.remove(); });

  const testBtn = document.createElement('button');
  testBtn.className = 'btn btn-secondary esp-test-one';
  testBtn.style.cssText = 'margin-top:6px;font-size:.8rem';
  testBtn.textContent = 'Test';
  testBtn.addEventListener('click', async () => {
    const host = row.querySelector('.esp-host').value.trim();
    const port = parseInt(row.querySelector('.esp-port').value) || 80;
    const pass = row.querySelector('.esp-pass').value;
    if (!host) return;
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    try {
      const r = await fetch('/api/settings/test-esphome', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, password: pass }),
      });
      const j = await r.json();
      testBtn.textContent = j.success ? '✓ ' + j.message : '✗ ' + j.error;
    } catch (e) { testBtn.textContent = '✗ ' + e.message; }
    finally { testBtn.disabled = false; setTimeout(() => { testBtn.textContent = 'Test'; }, 5000); }
  });
  row.querySelector('.shelly-row-fields').after(testBtn);
  container.appendChild(row);
}

function collectESPHomeDevices() {
  return Array.from(document.querySelectorAll('#esphome-devices-list .shelly-row')).map(row => ({
    host:     row.querySelector('.esp-host').value.trim(),
    port:     parseInt(row.querySelector('.esp-port').value) || 80,
    name:     row.querySelector('.esp-name').value.trim(),
    password: row.querySelector('.esp-pass').value,
  })).filter(d => d.host);
}

document.getElementById('btn-add-esphome').addEventListener('click', () => {
  addESPHomeRow({});
  document.querySelector('#esphome-devices-list .shelly-row:last-child .esp-host')?.focus();
});

document.getElementById('btn-save-esphome').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-esphome');
  const resultEl = document.getElementById('esphome-save-result');
  btn.disabled   = true;
  try {
    const devices = collectESPHomeDevices();
    const res = await fetch('/api/settings/esphome', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(devices),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className = 'test-result ' + (json.success ? 'ok' : 'err');
    if (json.success) renderESPHomeList(devices);
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── LG ThinQ ──────────────────────────────────────────────────────────────

document.getElementById('btn-fetch-lgthinq').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-fetch-lgthinq');
  const resultEl = document.getElementById('lgthinq-fetch-result');
  const email    = getVal('lgthinq-login-email');
  const pass     = getVal('lgthinq-login-pass');
  if (!email || !pass) {
    resultEl.textContent = '✗ Enter email and password first';
    resultEl.className = 'test-result err';
    return;
  }
  btn.disabled = true;
  resultEl.textContent = 'Fetching…';
  resultEl.className = 'test-result';
  try {
    const res = await fetch('/api/settings/lgthinq-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password: pass, country: getVal('lgthinq-country') }),
    });
    const json = await res.json();
    if (json.success) {
      if (json.access_token)  document.getElementById('lgthinq-access-token').value  = json.access_token;
      if (json.refresh_token) document.getElementById('lgthinq-refresh-token').value = json.refresh_token;
      if (json.user_number)   document.getElementById('lgthinq-user-number').value   = json.user_number;
      // Open the manual section so user can see the filled values
      const details = document.querySelector('#btn-fetch-lgthinq').closest('section').querySelector('details');
      if (details) details.open = true;
      resultEl.textContent = '✓ ' + (json.message || 'Tokens fetched — review and save');
      resultEl.className = 'test-result ok';
    } else {
      resultEl.textContent = '✗ ' + json.error;
      resultEl.className = 'test-result err';
    }
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className = 'test-result err';
  } finally { btn.disabled = false; }
});

document.getElementById('btn-save-lgthinq').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-lgthinq');
  const resultEl = document.getElementById('lgthinq-test-result');
  btn.disabled   = true;
  try {
    const res = await fetch('/api/settings/lgthinq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token:  getVal('lgthinq-access-token'),
        refresh_token: getVal('lgthinq-refresh-token'),
        user_number:   getVal('lgthinq-user-number'),
        country:       getVal('lgthinq-country'),
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

// ── Fibaro Home Center ─────────────────────────────────────────────────────

document.getElementById('btn-test-fibaro').addEventListener('click', async () => {
  const resultEl = document.getElementById('fibaro-test-result');
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result';
  try {
    const res = await fetch('/api/settings/test-fibaro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:     getVal('fibaro-host'),
        port:     getVal('fibaro-port'),
        username: getVal('fibaro-user'),
        password: getVal('fibaro-pass'),
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

document.getElementById('btn-save-fibaro').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-fibaro');
  const resultEl = document.getElementById('fibaro-test-result');
  btn.disabled   = true;
  try {
    const res = await fetch('/api/settings/fibaro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:     getVal('fibaro-host'),
        port:     getVal('fibaro-port'),
        username: getVal('fibaro-user'),
        password: getVal('fibaro-pass'),
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

// Init
loadSettings();

// ── SmartBob ──────────────────────────────────────────────────────────────

const SB_TYPES  = ['switch','light','temperature','humidity','number','boolean'];
const SB_HK     = ['','switch-rw','light-rw','temperature','humidity','motion','contact','co2-sensor'];

function renderSmartBobEntities(entities) {
  const c = document.getElementById('smartbob-entity-list');
  if (!c) return;
  c.innerHTML = entities.map(e => smartBobRow(e)).join('');
}

function smartBobRow(e = {}) {
  const typeOpts = SB_TYPES.map(t => `<option${e.type===t?' selected':''}>${t}</option>`).join('');
  const hkOpts   = SB_HK.map(h => `<option${e.homekitType===h?' selected':''}>${h}</option>`).join('');
  return `<div class="shelly-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px" data-sb-row>
    <input type="text" class="sb-name"         placeholder="Name"          value="${e.name||''}"         style="width:120px">
    <input type="text" class="sb-state-topic"  placeholder="state/topic"   value="${e.stateTopic||''}"   style="flex:1;min-width:140px" title="State topic">
    <input type="text" class="sb-cmd-topic"    placeholder="command/topic" value="${e.commandTopic||''}" style="flex:1;min-width:140px" title="Command topic (optional)">
    <select class="sb-type" style="width:100px">${typeOpts}</select>
    <input type="text" class="sb-unit"         placeholder="unit"          value="${e.unit||''}"         style="width:60px" title="Unit label (optional)">
    <select class="sb-hk" title="HomeKit type" style="width:110px">${hkOpts}</select>
    <button class="btn btn-icon" onclick="this.closest('[data-sb-row]').remove()" title="Remove">✕</button>
  </div>`;
}

function collectSmartBobEntities() {
  return Array.from(document.querySelectorAll('[data-sb-row]')).map(r => ({
    name:         r.querySelector('.sb-name').value.trim(),
    stateTopic:   r.querySelector('.sb-state-topic').value.trim(),
    commandTopic: r.querySelector('.sb-cmd-topic').value.trim() || undefined,
    type:         r.querySelector('.sb-type').value,
    unit:         r.querySelector('.sb-unit').value.trim() || undefined,
    homekitType:  r.querySelector('.sb-hk').value || undefined,
  })).filter(e => e.stateTopic);
}

document.getElementById('btn-add-smartbob-entity').addEventListener('click', () => {
  const c = document.getElementById('smartbob-entity-list');
  const d = document.createElement('div');
  d.innerHTML = smartBobRow();
  c.appendChild(d.firstElementChild);
});

document.getElementById('btn-test-smartbob').addEventListener('click', async () => {
  const btn = document.getElementById('btn-test-smartbob');
  const res2 = document.getElementById('smartbob-test-result');
  btn.disabled = true; res2.textContent = 'Testing…'; res2.className = 'test-result';
  try {
    const r    = await fetch('/api/settings/test-smartbob', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: getVal('smartbob-host'), port: parseInt(getVal('smartbob-port')) || 1883 }) });
    const json = await r.json();
    res2.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    res2.className   = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) { res2.textContent = '✗ ' + err.message; res2.className = 'test-result err'; }
  finally { btn.disabled = false; }
});

document.getElementById('btn-save-smartbob').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-smartbob');
  const res2 = document.getElementById('smartbob-test-result');
  btn.disabled = true; res2.textContent = 'Saving…'; res2.className = 'test-result';
  try {
    const r    = await fetch('/api/settings/smartbob', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:     getVal('smartbob-name'),
        host:     getVal('smartbob-host'),
        port:     parseInt(getVal('smartbob-port')) || 1883,
        username: getVal('smartbob-user'),
        password: getVal('smartbob-pass'),
        entities: collectSmartBobEntities(),
      }) });
    const json = await r.json();
    res2.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    res2.className   = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) { res2.textContent = '✗ ' + err.message; res2.className = 'test-result err'; }
  finally { btn.disabled = false; }
});

// ── KNX ───────────────────────────────────────────────────────────────────

const KNX_DPTS = ['DPT1','DPT5','DPT9','DPT14'];
const KNX_HK   = ['','Switch','TemperatureSensor','HumiditySensor','LightSensor','OccupancySensor','ContactSensor'];

function renderKNXGAList(gas) {
  const container = document.getElementById('knx-ga-list');
  if (!container) return;
  container.innerHTML = gas.map((ga, i) => knxGARow(ga, i)).join('');
}

function knxGARow(ga = {}, i = Date.now()) {
  const dptOpts  = KNX_DPTS.map(d => `<option${ga.dpt === d ? ' selected' : ''}>${d}</option>`).join('');
  const hkOpts   = KNX_HK.map(h => `<option${ga.homekitType === h ? ' selected' : ''}>${h}</option>`).join('');
  return `<div class="shelly-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px" data-knx-row>
    <input type="text"   class="knx-addr" placeholder="1/1/1"  value="${ga.address||''}" style="width:80px" title="Group Address">
    <input type="text"   class="knx-name" placeholder="Name"   value="${ga.name||''}"    style="flex:1;min-width:120px">
    <select class="knx-dpt" title="DPT type" style="width:90px">${dptOpts}</select>
    <input type="text"   class="knx-unit" placeholder="unit"   value="${ga.unit||''}"    style="width:60px" title="Unit (optional)">
    <label title="Readable" style="font-size:0.8rem;white-space:nowrap"><input type="checkbox" class="knx-read" ${ga.readable!==false?'checked':''}> R</label>
    <label title="Writable" style="font-size:0.8rem;white-space:nowrap"><input type="checkbox" class="knx-write" ${ga.writable?'checked':''}> W</label>
    <select class="knx-hk" title="HomeKit type (optional)" style="width:130px">${hkOpts}</select>
    <button class="btn btn-icon" onclick="this.closest('[data-knx-row]').remove()" title="Remove">✕</button>
  </div>`;
}

function collectKNXGAs() {
  return Array.from(document.querySelectorAll('[data-knx-row]')).map(row => ({
    address:     row.querySelector('.knx-addr').value.trim(),
    name:        row.querySelector('.knx-name').value.trim(),
    dpt:         row.querySelector('.knx-dpt').value,
    unit:        row.querySelector('.knx-unit').value.trim() || undefined,
    readable:    row.querySelector('.knx-read').checked,
    writable:    row.querySelector('.knx-write').checked,
    homekitType: row.querySelector('.knx-hk').value  || undefined,
  })).filter(ga => ga.address);
}

document.getElementById('btn-add-knx-ga').addEventListener('click', () => {
  const container = document.getElementById('knx-ga-list');
  const div = document.createElement('div');
  div.innerHTML = knxGARow();
  container.appendChild(div.firstElementChild);
});

document.getElementById('btn-test-knx').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-test-knx');
  const resultEl = document.getElementById('knx-test-result');
  btn.disabled   = true;
  resultEl.textContent = 'Testing…';
  resultEl.className   = 'test-result';
  try {
    const res  = await fetch('/api/settings/test-knx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: getVal('knx-host'), port: parseInt(getVal('knx-port')) || 3671 }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className   = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className   = 'test-result err';
  } finally { btn.disabled = false; }
});

document.getElementById('btn-save-knx').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-knx');
  const resultEl = document.getElementById('knx-test-result');
  btn.disabled   = true;
  resultEl.textContent = 'Saving…';
  resultEl.className   = 'test-result';
  try {
    const res  = await fetch('/api/settings/knx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: getVal('knx-host'), port: parseInt(getVal('knx-port')) || 3671, groupAddresses: collectKNXGAs() }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className   = 'test-result ' + (json.success ? 'ok' : 'err');
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className   = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── FFmpeg RTSP Proxy ──────────────────────────────────────────────────────

async function loadFFmpegRTSPStreams() {
  try {
    const res  = await fetch('/api/rtsp-proxy');
    const json = await res.json();
    const wrap = document.getElementById('ffrtsp-streams');
    const body = document.getElementById('ffrtsp-streams-body');
    if (!json.enabled || !json.streams?.length) { wrap.style.display = 'none'; return; }
    body.innerHTML = json.streams.map(s => `
      <tr>
        <td>${s.name}</td>
        <td><code>rtsp://&lt;host&gt;:${s.port}/${s.slug}</code></td>
        <td><span style="color:${s.active ? 'var(--ok)' : 'var(--text-muted)'}">${s.active ? '● Live' : '◌ Waiting'}</span></td>
      </tr>`).join('');
    wrap.style.display = '';
  } catch { /* ignore */ }
}

document.getElementById('btn-save-ffrtsp').addEventListener('click', async () => {
  const btn      = document.getElementById('btn-save-ffrtsp');
  const resultEl = document.getElementById('ffrtsp-save-result');
  btn.disabled   = true;
  resultEl.textContent = 'Saving…';
  resultEl.className   = 'test-result';
  try {
    const res  = await fetch('/api/settings/ffmpeg-rtsp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled:    document.getElementById('ffrtsp-enabled').checked,
        basePort:   parseInt(getVal('ffrtsp-base-port')) || 8554,
        ffmpegPath: getVal('ffrtsp-path') || 'ffmpeg',
      }),
    });
    const json = await res.json();
    resultEl.textContent = json.success ? '✓ ' + json.message : '✗ ' + json.error;
    resultEl.className   = 'test-result ' + (json.success ? 'ok' : 'err');
    if (json.success && document.getElementById('ffrtsp-enabled').checked) loadFFmpegRTSPStreams();
  } catch (err) {
    resultEl.textContent = '✗ ' + err.message;
    resultEl.className   = 'test-result err';
  } finally { btn.disabled = false; }
});

// ── Settings filter & category ─────────────────────────────────────────────

(function () {
  const sections   = Array.from(document.querySelectorAll('.settings-card'));
  const noResults  = document.getElementById('settings-no-results');
  const searchEl   = document.getElementById('settings-search');
  const clearBtn   = document.getElementById('btn-clear-search');
  const catBtns    = Array.from(document.querySelectorAll('.cat-btn'));

  let activeCat  = 'all';
  let searchTerm = '';

  function applyFilter() {
    const q = searchTerm.toLowerCase().trim();
    let visible = 0;
    sections.forEach(sec => {
      const cat   = sec.dataset.category || '';
      const title = (sec.dataset.title || '') + ' ' + (sec.textContent || '');
      const catOk  = activeCat === 'all' || cat === activeCat;
      const textOk = !q || title.toLowerCase().includes(q);
      const show   = catOk && textOk;
      sec.classList.toggle('settings-section-hidden', !show);
      if (show) visible++;
    });
    noResults.style.display = visible === 0 ? '' : 'none';
  }

  // Category buttons
  catBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      catBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCat = btn.dataset.cat;
      applyFilter();
    });
  });

  // Search input
  searchEl.addEventListener('input', () => {
    searchTerm = searchEl.value;
    clearBtn.style.display = searchTerm ? '' : 'none';
    applyFilter();
  });
  clearBtn.addEventListener('click', () => {
    searchEl.value = '';
    searchTerm     = '';
    clearBtn.style.display = 'none';
    searchEl.focus();
    applyFilter();
  });
})();
