'use strict';

let activeTab     = 'app';
let refreshTimer  = null;

const tabsEl      = document.getElementById('logs-tabs');
const outputEl    = document.getElementById('logs-output');
const emptyEl     = document.getElementById('logs-empty');
const footerInfo  = document.getElementById('logs-footer-info');
const autoRefresh = document.getElementById('auto-refresh');
const linesSelect = document.getElementById('lines-select');

// ── Init ────────────────────────────────────────────────────────────────

async function init() {
  await loadTabs();
  await loadLog(activeTab);
  startAutoRefresh();
}

// ── Tabs ────────────────────────────────────────────────────────────────

async function loadTabs() {
  try {
    const res  = await fetch('/api/logs');
    const json = await res.json();
    const cats = json.categories || [];

    tabsEl.innerHTML = '';
    cats.forEach(cat => {
      const btn = document.createElement('button');
      btn.className   = 'log-tab' + (cat === activeTab ? ' active' : '');
      btn.textContent = cat;
      btn.addEventListener('click', () => switchTab(cat));
      tabsEl.appendChild(btn);
    });

    // If active tab no longer exists, fall back to first
    if (cats.length && !cats.includes(activeTab)) {
      activeTab = cats[0];
      updateTabActive();
    }
  } catch (err) {
    console.error('Failed to load log categories:', err);
  }
}

function switchTab(name) {
  activeTab = name;
  updateTabActive();
  loadLog(name);
}

function updateTabActive() {
  tabsEl.querySelectorAll('.log-tab').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === activeTab);
  });
}

// ── Log loading ─────────────────────────────────────────────────────────

async function loadLog(name) {
  const limit = linesSelect.value;
  try {
    const res  = await fetch(`/api/logs/${name}?lines=${limit}`);
    const json = await res.json();
    renderLines(json.lines || []);
    footerInfo.textContent = `${(json.lines || []).length} lines — last refreshed ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    outputEl.textContent = `Error loading log: ${err.message}`;
  }
}

function renderLines(lines) {
  if (!lines.length) {
    outputEl.innerHTML  = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  outputEl.innerHTML = lines.map(line => {
    // Format: 2024-01-01T12:00:00.000Z [LEVEL] message
    const m = line.match(/^(\S+) \[(INFO|ERROR|WARN)\] ([\s\S]*)$/);
    if (!m) return `<span class="log-line-info">${esc(line)}</span>`;
    const [, ts, level, msg] = m;
    const cls = level === 'ERROR' ? 'log-line-error' : level === 'WARN' ? 'log-line-warn' : 'log-line-info';
    return `<span class="${cls}"><span class="log-ts">${esc(ts)}</span><span class="log-level">[${level}]</span><span class="log-msg">${esc(msg)}</span></span>`;
  }).join('\n');

  // Scroll to bottom
  outputEl.scrollTop = outputEl.scrollHeight;
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Auto-refresh ─────────────────────────────────────────────────────────

function startAutoRefresh() {
  stopAutoRefresh();
  if (autoRefresh.checked) {
    refreshTimer = setInterval(() => loadLog(activeTab), 5000);
  }
}

function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

autoRefresh.addEventListener('change', () => {
  autoRefresh.checked ? startAutoRefresh() : stopAutoRefresh();
});

linesSelect.addEventListener('change', () => loadLog(activeTab));

// ── Toolbar buttons ──────────────────────────────────────────────────────

document.getElementById('btn-refresh').addEventListener('click', () => loadLog(activeTab));

document.getElementById('btn-download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href     = `/api/logs/${activeTab}?lines=2000`;
  a.download = `${activeTab}.log`;
  a.click();
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!confirm(`Clear the "${activeTab}" log?`)) return;
  await fetch(`/api/logs/${activeTab}`, { method: 'DELETE' });
  await loadLog(activeTab);
});

// ── Start ────────────────────────────────────────────────────────────────

init();
