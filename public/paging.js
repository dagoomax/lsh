'use strict';

/**
 * Room-to-room paging (intercom) — classic dashboard client. Mirrors
 * react-dashboard/src/hooks/usePaging.js: every endpoint is a browser (this
 * dashboard tab, or a Wall Dashboard tablet), so audio is plain
 * MediaRecorder chunks relayed browser-to-browser over the page's existing
 * Socket.IO connection (src/paging.js on the backend) and played back by
 * appending them into a MediaSource buffer — no SIP protocol or server-side
 * media pipeline like the softphone above.
 *
 * "myRoom" is this device's identity — which configured room it physically
 * sits in — persisted in localStorage under the same key the React
 * dashboard uses, so a device keeps its identity if the user switches UIs.
 * A device with no myRoom set can still see room status and bridge two
 * OTHER rooms together, it just isn't a live participant itself.
 */

const PAGING_ROOM_KEY   = 'lsh-paging-room';
const PAGING_AUDIO_MIME = 'audio/webm;codecs=opus';

let pagingRooms  = [];
let pagingMyRoom = localStorage.getItem(PAGING_ROOM_KEY) || '';
let pagingActive = null; // { pageId, from, to, fromLabel, toLabel } | null

let _pagingRecorder   = null;
let _pagingStream     = null;
let _pagingAudioEl    = null;
let _pagingSource     = null; // MediaSource
let _pagingSourceBuf  = null; // SourceBuffer
let _pagingQueue      = [];

function pt(key, fallback) {
  const v = window.t ? window.t('paging.' + key) : null;
  return v && v !== 'paging.' + key ? v : fallback;
}

function _pagingRoomText(r) {
  return r.label && r.label !== r.id ? `${r.id} (${r.label})` : r.id;
}

function _pagingSetError(msg) {
  const el = document.getElementById('paging-error');
  if (el) el.textContent = msg || '';
}

// ── Audio plumbing ──────────────────────────────────────────────────────────

function _pagingStopAudio() {
  if (_pagingRecorder) { try { _pagingRecorder.stop(); } catch { /* already stopped */ } _pagingRecorder = null; }
  if (_pagingStream) { _pagingStream.getTracks().forEach((t) => t.stop()); _pagingStream = null; }
  if (_pagingAudioEl) { try { _pagingAudioEl.pause(); } catch { /* ignore */ } _pagingAudioEl = null; }
  _pagingSource = null;
  _pagingSourceBuf = null;
  _pagingQueue = [];
}

function _pagingStartPlayback() {
  try {
    const ms = new MediaSource();
    const el = new Audio();
    el.autoplay = true;
    el.src = URL.createObjectURL(ms);
    _pagingAudioEl = el;
    _pagingSource = ms;
    ms.addEventListener('sourceopen', () => {
      try {
        const sb = ms.addSourceBuffer(PAGING_AUDIO_MIME);
        sb.addEventListener('updateend', () => {
          if (_pagingQueue.length && !sb.updating) sb.appendBuffer(_pagingQueue.shift());
        });
        _pagingSourceBuf = sb;
      } catch (err) { console.warn('[Paging] Playback unsupported:', err.message); }
    });
    el.play().catch(() => {}); // may need a user gesture on some browsers
  } catch (err) { console.warn('[Paging] Playback setup failed:', err.message); }
}

async function _pagingStartMic(pageId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _pagingStream = stream;
    const rec = new MediaRecorder(stream, { mimeType: PAGING_AUDIO_MIME });
    rec.ondataavailable = async (e) => {
      if (!e.data || !e.data.size) return;
      const buf = await e.data.arrayBuffer();
      socket.emit('paging:audio', { pageId, chunk: buf });
    };
    rec.start(250);
    _pagingRecorder = rec;
  } catch (err) {
    console.warn('[Paging] Mic access failed:', err.message);
    _pagingSetError(pt('mic_denied', 'Microphone access denied'));
  }
}

// ── Actions ──────────────────────────────────────────────────────────────

function pagingSetMyRoom(roomId) {
  if (roomId) localStorage.setItem(PAGING_ROOM_KEY, roomId);
  else localStorage.removeItem(PAGING_ROOM_KEY);
  pagingMyRoom = roomId || '';
  if (roomId) {
    socket.emit('paging:register', roomId, (res) => {
      if (!res?.success) _pagingSetError(res?.error || pt('register_failed', 'Could not register room'));
    });
  }
  _pagingRenderPanel();
}

function pagingStart(from, to) {
  _pagingSetError('');
  socket.emit('paging:start', { from, to }, (res) => {
    if (!res?.success) _pagingSetError(res?.error || pt('start_failed', 'Could not start page'));
  });
  _pagingClosePanel();
}

function pagingEndCall() {
  if (pagingActive) socket.emit('paging:end', { pageId: pagingActive.pageId });
  _pagingStopAudio();
  pagingActive = null;
  _pagingRenderCallModal();
}

function _pagingClosePanel() {
  const panel = document.getElementById('paging-panel');
  if (panel) panel.style.display = 'none';
}

// ── Rendering ────────────────────────────────────────────────────────────

function _pagingRenderStatus() {
  const wrap = document.getElementById('paging-status');
  if (wrap) wrap.style.display = pagingRooms.length ? '' : 'none';
  const dot = document.getElementById('paging-status-dot');
  if (dot) dot.className = 'paging-status-dot' + (pagingMyRoom ? ' paging-dot-green' : '');
}

function _pagingRenderPanel() {
  const select = document.getElementById('paging-room-select');
  if (!select) return;

  const wasFocused = document.activeElement === select;
  select.innerHTML = `<option value="">${esc(pt('not_a_room', 'Not a fixed room'))}</option>` +
    pagingRooms.map((r) => `<option value="${esc(r.id)}"${r.id === pagingMyRoom ? ' selected' : ''}>${esc(_pagingRoomText(r))}</option>`).join('');
  if (wasFocused) select.focus();

  const listWrap   = document.getElementById('paging-room-list');
  const bridgeWrap = document.getElementById('paging-bridge');
  const buttonsEl  = document.getElementById('paging-room-buttons');

  if (pagingMyRoom) {
    listWrap.style.display = '';
    bridgeWrap.style.display = 'none';
    const others = pagingRooms.filter((r) => r.id !== pagingMyRoom);
    buttonsEl.innerHTML = others.map((r) => `
      <button class="paging-room-btn" data-room="${esc(r.id)}" ${r.online ? '' : 'disabled'}>
        <span class="paging-room-dot${r.online ? ' online' : ''}"></span>
        <span>${esc(_pagingRoomText(r))}${!r.online ? ` — ${esc(pt('offline', 'offline'))}` : ''}</span>
      </button>`).join('');
    buttonsEl.querySelectorAll('.paging-room-btn').forEach((btn) => {
      btn.addEventListener('click', () => pagingStart(pagingMyRoom, btn.dataset.room));
    });
  } else {
    listWrap.style.display = 'none';
    bridgeWrap.style.display = '';
    _pagingRenderBridgeSelects();
  }
}

function _pagingRenderBridgeSelects() {
  const fromSel = document.getElementById('paging-bridge-from');
  const toSel   = document.getElementById('paging-bridge-to');
  if (!fromSel || !toSel) return;

  const opts = (placeholder, selected) => `<option value="">${esc(placeholder)}</option>` +
    pagingRooms.map((r) => `<option value="${esc(r.id)}"${r.id === selected ? ' selected' : ''}${r.online ? '' : ' disabled'}>${esc(_pagingRoomText(r))}${!r.online ? ` — ${esc(pt('offline', 'offline'))}` : ''}</option>`).join('');

  const from = fromSel.value, to = toSel.value;
  fromSel.innerHTML = opts(pt('from', 'From…'), from);
  toSel.innerHTML   = opts(pt('to', 'To…'), to);
  fromSel.value = from; toSel.value = to;

  _pagingUpdateBridgeStartState();
}

function _pagingUpdateBridgeStartState() {
  const fromSel = document.getElementById('paging-bridge-from');
  const toSel   = document.getElementById('paging-bridge-to');
  const btn     = document.getElementById('paging-bridge-start');
  if (!fromSel || !toSel || !btn) return;
  btn.disabled = !fromSel.value || !toSel.value || fromSel.value === toSel.value;
}

function _pagingRenderCallModal() {
  const modal = document.getElementById('paging-call-modal');
  if (!modal) return;

  if (!pagingActive) { modal.style.display = 'none'; return; }

  const iAmParticipant = pagingActive.from === pagingMyRoom || pagingActive.to === pagingMyRoom;
  document.getElementById('paging-call-state').textContent = iAmParticipant
    ? pt('in_progress', 'Paging')
    : pt('bridged', 'Bridged call');
  document.getElementById('paging-call-rooms').textContent = `${pagingActive.fromLabel} ↔ ${pagingActive.toLabel}`;
  document.getElementById('paging-call-hint').style.display = iAmParticipant ? 'none' : '';
  modal.style.display = 'flex';
}

// ── Wiring ───────────────────────────────────────────────────────────────

document.getElementById('paging-toggle-btn')?.addEventListener('click', () => {
  const panel = document.getElementById('paging-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
});

document.addEventListener('click', (e) => {
  const panel = document.getElementById('paging-panel');
  if (!panel || panel.style.display === 'none') return;
  if (panel.contains(e.target) || e.target.closest('#paging-status')) return;
  panel.style.display = 'none';
});

document.getElementById('paging-room-select')?.addEventListener('change', (e) => pagingSetMyRoom(e.target.value));
document.getElementById('paging-bridge-from')?.addEventListener('change', _pagingUpdateBridgeStartState);
document.getElementById('paging-bridge-to')?.addEventListener('change', _pagingUpdateBridgeStartState);
document.getElementById('paging-bridge-start')?.addEventListener('click', () => {
  const from = document.getElementById('paging-bridge-from').value;
  const to   = document.getElementById('paging-bridge-to').value;
  if (from && to && from !== to) pagingStart(from, to);
});
document.getElementById('paging-btn-end')?.addEventListener('click', pagingEndCall);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pagingActive) pagingEndCall();
});

socket.on('paging-rooms', (status) => {
  pagingRooms = status || [];
  _pagingRenderStatus();
  _pagingRenderPanel();
});

socket.on('paging:incoming', (session) => {
  _pagingSetError('');
  pagingActive = session;
  _pagingRenderCallModal();
  const mine = session.from === pagingMyRoom || session.to === pagingMyRoom;
  if (mine) { _pagingStartPlayback(); _pagingStartMic(session.pageId); }
});

socket.on('paging:audio', ({ pageId, chunk }) => {
  if (!pagingActive || pageId !== pagingActive.pageId) return;
  const sb = _pagingSourceBuf;
  const data = chunk instanceof ArrayBuffer ? chunk : chunk?.buffer;
  if (!data) return;
  if (sb && !sb.updating && !_pagingQueue.length) sb.appendBuffer(data);
  else _pagingQueue.push(data);
});

socket.on('paging:ended', () => {
  _pagingStopAudio();
  pagingActive = null;
  _pagingRenderCallModal();
});

socket.on('connect', () => {
  if (pagingMyRoom) socket.emit('paging:register', pagingMyRoom, (res) => {
    if (!res?.success) _pagingSetError(res?.error || pt('register_failed', 'Could not register room'));
  });
});

fetch('/api/paging/rooms', { credentials: 'same-origin' })
  .then((r) => r.json())
  .then((j) => { pagingRooms = j?.data || []; _pagingRenderStatus(); _pagingRenderPanel(); })
  .catch(() => {});
