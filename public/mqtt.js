'use strict';

/* ── State ─────────────────────────────────────────────── */
const topics  = new Map();   // topic → { value, ts, count }
const rowEls  = new Map();   // topic → DOM row element
let   selected = null;       // currently selected topic
let   filter   = '';
let   totalMsgCount = 0;
let   msgRateCounter = 0;
let   msgRateDisplay = 0;

/* ── DOM refs ───────────────────────────────────────────── */
const listEl      = document.getElementById('mqtt-topic-list');
const emptyEl     = document.getElementById('mqtt-empty');
const detailEl    = document.getElementById('mqtt-detail');
const searchEl    = document.getElementById('mqtt-search');
const statusBadge = document.getElementById('mqtt-status-badge');
const topicCount  = document.getElementById('mqtt-topic-count');
const rateEl      = document.getElementById('mqtt-rate');

/* ── Format helpers ─────────────────────────────────────── */
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function tryJson(str) {
  try { return JSON.stringify(JSON.parse(str), null, 2); }
  catch { return str; }
}

function shortAge(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

/* ── Topic list ─────────────────────────────────────────── */
function matchesFilter(topic) {
  if (!filter) return true;
  return topic.toLowerCase().includes(filter);
}

function createRow(topic) {
  const row = document.createElement('div');
  row.className = 'mqtt-row';
  row.dataset.topic = topic;
  row.innerHTML = `
    <div class="mqtt-dot" id="dot-${CSS.escape(topic)}"></div>
    <div class="mqtt-topic-path" title="${topic}">${topic}</div>
    <div class="mqtt-value-preview" id="val-${CSS.escape(topic)}"></div>
    <div class="mqtt-row-count"  id="cnt-${CSS.escape(topic)}">1</div>
  `;
  row.addEventListener('click', () => selectTopic(topic));
  return row;
}

function insertRowSorted(topic, row) {
  const existing = [...listEl.querySelectorAll('.mqtt-row')];
  const after = existing.find(r => r.dataset.topic > topic);
  if (after) listEl.insertBefore(row, after);
  else listEl.appendChild(row);
}

function upsertTopic(topic, value, ts, count, isNew) {
  topics.set(topic, { value, ts, count });
  totalMsgCount++;

  if (isNew) {
    const row = createRow(topic);
    rowEls.set(topic, row);
    insertRowSorted(topic, row);
    topicCount.textContent = topics.size + ' topics';
    emptyEl.style.display = 'none';
  }

  const row = rowEls.get(topic);
  if (!row) return;

  // Apply filter visibility
  row.style.display = matchesFilter(topic) ? '' : 'none';

  // Update value preview
  const valEl = row.querySelector('.mqtt-value-preview');
  if (valEl) valEl.textContent = value;
  const cntEl = row.querySelector('.mqtt-row-count');
  if (cntEl) cntEl.textContent = count;

  // Flash activity dot
  const dot = row.querySelector('.mqtt-dot');
  if (dot) {
    dot.classList.add('pulse');
    clearTimeout(dot._t);
    dot._t = setTimeout(() => dot.classList.remove('pulse'), 400);
  }

  // Flash row background
  row.classList.add('flash');
  clearTimeout(row._ft);
  row._ft = setTimeout(() => row.classList.remove('flash'), 300);

  // Update detail if this topic is selected
  if (selected === topic) updateDetailValue(value, ts, count);
}

function applyFilter(q) {
  filter = q.toLowerCase().trim();
  for (const [topic, row] of rowEls) {
    row.style.display = matchesFilter(topic) ? '' : 'none';
  }
}

/* ── Detail panel ───────────────────────────────────────── */
function selectTopic(topic) {
  if (selected) {
    const prev = rowEls.get(selected);
    if (prev) prev.classList.remove('active');
  }
  selected = topic;
  const row = rowEls.get(topic);
  if (row) row.classList.add('active');

  const { value, ts, count } = topics.get(topic) || {};
  renderDetail(topic, value, ts, count);
  fetchHistory(topic);
}

function renderDetail(topic, value, ts, count) {
  detailEl.innerHTML = `
    <div class="mqtt-detail-inner">
      <div class="mqtt-detail-header">
        <div class="mqtt-detail-topic">${topic}</div>
        <div class="mqtt-detail-meta" id="detail-meta">
          ${count || 0} messages · last ${ts ? fmtTime(ts) : '—'}
        </div>
      </div>
      <div class="mqtt-detail-value-box">
        <div class="mqtt-detail-value" id="detail-value">${escHtml(tryJson(value || ''))}</div>
      </div>
      <div class="mqtt-history-wrap">
        <div class="mqtt-history-header">Message history</div>
        <div id="detail-history"></div>
      </div>
      <form class="mqtt-publish-form" id="publish-form">
        <div class="mqtt-publish-fields">
          <div class="mqtt-publish-row">
            <span class="mqtt-publish-label">Topic</span>
            <input class="mqtt-publish-input" id="pub-topic" value="${escAttr(topic)}" placeholder="topic/path">
          </div>
          <div class="mqtt-publish-row">
            <span class="mqtt-publish-label">Payload</span>
            <input class="mqtt-publish-input" id="pub-payload" placeholder="value or JSON">
            <label class="mqtt-retain-label">
              <input type="checkbox" id="pub-retain"> Retain
            </label>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Publish</button>
      </form>
    </div>
  `;

  document.getElementById('publish-form').addEventListener('submit', handlePublish);
}

function updateDetailValue(value, ts, count) {
  const v = document.getElementById('detail-value');
  const m = document.getElementById('detail-meta');
  if (v) v.textContent = tryJson(value || '');
  if (m) m.textContent = `${count || 0} messages · last ${ts ? fmtTime(ts) : '—'}`;
}

function renderHistory(history) {
  const el = document.getElementById('detail-history');
  if (!el) return;
  if (!history.length) { el.innerHTML = '<div class="mqtt-empty" style="padding:12px 16px">No history</div>'; return; }
  el.innerHTML = history.slice().reverse().map(({ payload, ts }) => `
    <div class="mqtt-history-row">
      <span class="mqtt-history-ts">${fmtTime(ts)}</span>
      <span class="mqtt-history-val" title="${escAttr(payload)}">${escHtml(payload)}</span>
    </div>
  `).join('');
}

async function fetchHistory(topic) {
  try {
    const r = await fetch(`/api/mqtt-explorer/history?topic=${encodeURIComponent(topic)}`);
    const { data } = await r.json();
    renderHistory(data || []);
  } catch { /* ignore */ }
}

/* ── Publish ────────────────────────────────────────────── */
async function handlePublish(e) {
  e.preventDefault();
  const topic   = document.getElementById('pub-topic')?.value.trim();
  const payload = document.getElementById('pub-payload')?.value ?? '';
  const retain  = document.getElementById('pub-retain')?.checked ?? false;
  if (!topic) return;
  try {
    const r = await fetch('/api/mqtt-explorer/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, payload, retain }),
    });
    const json = await r.json();
    if (!json.success) alert('Publish failed: ' + json.error);
  } catch (err) {
    alert('Publish error: ' + err.message);
  }
}

/* ── Clear ──────────────────────────────────────────────── */
document.getElementById('btn-mqtt-clear').addEventListener('click', async () => {
  if (!confirm('Clear all retained topic data?')) return;
  await fetch('/api/mqtt-explorer/clear', { method: 'POST' });
});

/* ── Search ─────────────────────────────────────────────── */
searchEl.addEventListener('input', e => applyFilter(e.target.value));

/* ── Socket.IO ──────────────────────────────────────────── */
const socket = io();

socket.on('mqtt-explorer-status', ({ connected }) => {
  statusBadge.textContent = connected ? 'Connected' : 'Disconnected';
  statusBadge.className   = 'mqtt-badge ' + (connected ? 'mqtt-badge--connected' : 'mqtt-badge--disconnected');
});

socket.on('mqtt-explorer-msg', ({ topic, payload, ts, count, isNew }) => {
  msgRateCounter++;
  upsertTopic(topic, payload, ts, count, isNew);
  if (selected === topic) fetchHistory(topic);
});

socket.on('mqtt-explorer-clear', () => {
  topics.clear();
  rowEls.clear();
  selected = null;
  listEl.innerHTML = '';
  listEl.appendChild(emptyEl);
  emptyEl.style.display = '';
  detailEl.innerHTML = '<div class="mqtt-detail-placeholder"><p>Select a topic to inspect</p></div>';
  topicCount.textContent = '0 topics';
});

/* ── Message rate ticker ────────────────────────────────── */
setInterval(() => {
  msgRateDisplay = msgRateCounter;
  msgRateCounter = 0;
  rateEl.textContent = msgRateDisplay + ' msg/s';
}, 1000);

/* ── Bootstrap: load existing topics ───────────────────── */
(async () => {
  try {
    const r    = await fetch('/api/mqtt-explorer/topics');
    const json = await r.json();
    const { connected, data } = json;

    statusBadge.textContent = connected ? 'Connected' : 'Disconnected';
    statusBadge.className   = 'mqtt-badge ' + (connected ? 'mqtt-badge--connected' : 'mqtt-badge--disconnected');

    if (data?.length) {
      data.sort((a, b) => a.topic.localeCompare(b.topic));
      for (const { topic, value, ts, count } of data) {
        upsertTopic(topic, value, ts, count, true);
      }
    }
  } catch (err) {
    console.error('[MQTT Explorer] bootstrap failed:', err);
  }
})();

/* ── Helpers ────────────────────────────────────────────── */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
