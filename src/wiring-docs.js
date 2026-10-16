'use strict';

// Installation documentation that writes itself while the wiring emulator is
// used (Settings → System → Wiring emulator → Documentation): one record per
// installation — where (title, room), which module and diagram — and a log of
// what happened, in order:
//   start · step (a wire of the assistant done) · check (own wiring checked:
//   ok / missing / extra) · test (power on, switch used, no trip) · trip
//   (breaker tripped, why) · checklist (tools & materials ticked) · pair (the
//   real module paired, its real id) · note (typed by the installer)
// plus the diagram as built (the emulator's SVG). Exported as a printable
// as-built document, per installation or for the whole house.
// Stored in persist/wiring-docs.json (override LSH_WIRING_DOCS).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.LSH_WIRING_DOCS || path.join(__dirname, '..', 'persist', 'wiring-docs.json');
const TYPES = new Set(['start', 'step', 'check', 'test', 'trip', 'checklist', 'pair', 'note', 'photo']);
const MAX_EVENTS = 500;
const MAX_SVG = 600 * 1024;

function list() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] } }
function write(docs) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(docs, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// how far it has got, from the log
function progress(doc) {
  const ev = doc.events || [];
  const steps = new Set(ev.filter((e) => e.type === 'step').map((e) => e.data?.index));
  const total = Math.max(0, ...ev.filter((e) => e.type === 'step').map((e) => Number(e.data?.total) || 0));
  const lastCheck = [...ev].reverse().find((e) => e.type === 'check');
  const wired = (total > 0 && steps.size >= total) || !!lastCheck?.data?.ok;
  const lastPower = [...ev].reverse().find((e) => e.type === 'test' || e.type === 'trip');
  const tested = lastPower?.type === 'test';
  const paired = ev.some((e) => e.type === 'pair');
  return { steps: steps.size, total, wired, tested, paired, status: paired ? 'done' : tested ? 'tested' : wired ? 'wired' : ev.length ? 'in progress' : 'new' };
}
const withProgress = (d) => ({ ...d, progress: progress(d) });

function create(b) {
  const now = new Date().toISOString();
  const doc = {
    id: crypto.randomBytes(5).toString('hex'),
    title: clip(b.title, 100) || 'Installation', room: clip(b.room, 60),
    device: clip(b.device, 60), deviceName: clip(b.deviceName, 120), scenario: clip(b.scenario, 60), scenarioTitle: clip(b.scenarioTitle, 160),
    createdAt: now, updatedAt: now, notes: '', diagram: null, events: [],
  };
  doc.events.push({ at: now, type: 'start', text: clip(b.startText, 300) || `${doc.deviceName} · ${doc.scenarioTitle}` });
  const docs = list(); docs.push(doc); write(docs);
  return withProgress(doc);
}

function update(id, b) {
  const docs = list();
  const doc = docs.find((d) => d.id === id);
  if (!doc) return null;
  for (const [k, n] of [['title', 100], ['room', 60], ['notes', 4000]]) if (b[k] !== undefined) doc[k] = clip(b[k], n);
  if (b.diagram !== undefined) doc.diagram = b.diagram ? sanitizeSvg(String(b.diagram)) : null;
  doc.updatedAt = new Date().toISOString();
  write(docs);
  return withProgress(doc);
}

// one log entry; a step already logged (same index) isn't logged twice
function addEvent(id, b) {
  const docs = list();
  const doc = docs.find((d) => d.id === id);
  if (!doc) return null;
  const type = String(b.type || '');
  if (!TYPES.has(type)) throw new Error(`Unknown event “${type}”`);
  const data = b.data && typeof b.data === 'object' ? JSON.parse(JSON.stringify(b.data).slice(0, 20000)) : undefined;
  if (type === 'step' && doc.events.some((e) => e.type === 'step' && e.data?.index === data?.index)) return withProgress(doc);
  // a checklist replaces the previous one (it's a state, not a history)
  if (type === 'checklist') doc.events = doc.events.filter((e) => e.type !== 'checklist');
  doc.events.push({ at: new Date().toISOString(), type, text: clip(b.text, 600), ...(data ? { data } : {}) });
  if (doc.events.length > MAX_EVENTS) doc.events = doc.events.slice(-MAX_EVENTS);
  doc.updatedAt = new Date().toISOString();
  write(docs);
  return withProgress(doc);
}

function remove(id) {
  const docs = list();
  const next = docs.filter((d) => d.id !== id);
  if (next.length === docs.length) return false;
  write(next);
  return true;
}

// the emulator's own SVG, minus anything active
function sanitizeSvg(svg) {
  if (svg.length > MAX_SVG || !/^\s*<svg[\s>]/i.test(svg)) return null;
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
}

// ── the document ─────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ICON = { start: '▶', step: '🔌', check: '✓', test: '⚡', trip: '⛔', checklist: '🧰', pair: '📡', note: '✎', photo: '📷' };

function renderHtml(docs, { title = 'Installation documentation', lang = 'en', labels = {} } = {}) {
  const L = { status: 'Status', room: 'Room', module: 'Module', diagram: 'Diagram', log: 'Log', notes: 'Notes', wiring: 'Wiring as built', generated: 'Generated', wires: 'Wires', tested: 'Power test', paired: 'Paired', yes: 'yes', no: 'no', none: 'Nothing recorded yet.', toc: 'Contents', ...labels };
  const fmt = (iso) => { try { return new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso } };
  const st = { 'new': '○', 'in progress': '◐', wired: '◑', tested: '◕', done: '●' };
  const sections = docs.map((d) => {
    const p = progress(d);
    const pair = [...(d.events || [])].reverse().find((e) => e.type === 'pair');
    return `
<section class="doc" id="d-${esc(d.id)}">
  <h2>${esc(d.title)}</h2>
  <table class="facts">
    <tr><th>${esc(L.room)}</th><td>${esc(d.room || '—')}</td><th>${esc(L.status)}</th><td>${st[p.status] || ''} ${esc(L[`status_${p.status}`] || p.status)}</td></tr>
    <tr><th>${esc(L.module)}</th><td>${esc(d.deviceName)}</td><th>${esc(L.wires)}</th><td>${p.total ? `${p.steps} / ${p.total}` : '—'}</td></tr>
    <tr><th>${esc(L.diagram)}</th><td>${esc(d.scenarioTitle)}</td><th>${esc(L.tested)}</th><td>${p.tested ? `✓ ${esc(L.yes)}` : esc(L.no)}</td></tr>
    <tr><th></th><td></td><th>${esc(L.paired)}</th><td>${pair ? `✓ ${esc(pair.data?.realId || '')}` : esc(L.no)}</td></tr>
  </table>
  ${d.diagram ? `<h3>${esc(L.wiring)}</h3><figure class="svg">${d.diagram}</figure>` : ''}
  ${d.notes ? `<h3>${esc(L.notes)}</h3><p class="notes">${esc(d.notes).replace(/\n/g, '<br>')}</p>` : ''}
  <h3>${esc(L.log)}</h3>
  ${(d.events || []).length ? `<ol class="log">${d.events.map((e) => `<li class="ev ev-${esc(e.type)}"><time>${esc(fmt(e.at))}</time><span class="i">${ICON[e.type] || '•'}</span><span>${esc(e.text)}${e.type === 'checklist' && Array.isArray(e.data?.items) ? `<ul>${e.data.items.map((x) => `<li>${x.done ? '☑' : '☐'} ${esc(x.text)}</li>`).join('')}</ul>` : ''}</span></li>`).join('')}</ol>` : `<p>${esc(L.none)}</p>`}
</section>`;
  }).join('\n');
  const toc = docs.length > 1 ? `<nav><h2>${esc(L.toc)}</h2><ol>${docs.map((d) => `<li><a href="#d-${esc(d.id)}">${esc(d.title)}</a>${d.room ? ` — ${esc(d.room)}` : ''}</li>`).join('')}</ol></nav>` : '';
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif; color: #1d1d1f; max-width: 980px; margin: 24px auto; padding: 0 20px; }
  h1 { font-size: 26px; margin: 0 0 4px; } .gen { color: #6e6e73; margin: 0 0 24px; }
  h2 { font-size: 20px; margin: 0 0 10px; } h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #6e6e73; margin: 18px 0 8px; }
  .doc { border-top: 2px solid #1d1d1f; padding-top: 16px; margin-top: 28px; break-inside: avoid-page; }
  table.facts { border-collapse: collapse; width: 100%; } .facts th { text-align: left; color: #6e6e73; font-weight: 600; padding: 4px 10px 4px 0; width: 12%; } .facts td { padding: 4px 16px 4px 0; }
  figure.svg { margin: 0; border: 1px solid #d2d2d7; border-radius: 10px; padding: 8px; background: #fff; } figure.svg svg { width: 100%; height: auto; max-height: 560px; display: block; }
  ol.log { list-style: none; padding: 0; margin: 0; } .ev { display: grid; grid-template-columns: 150px 22px 1fr; gap: 6px; padding: 5px 0; border-bottom: 1px solid #f0f0f2; }
  .ev time { color: #6e6e73; font-variant-numeric: tabular-nums; } .ev-trip span:last-child { color: #c1121f; } .ev-test span:last-child, .ev-pair span:last-child { color: #1a7f37; }
  .ev ul { margin: 4px 0 0; padding-left: 18px; } .notes { white-space: normal; background: #f5f5f7; padding: 10px 12px; border-radius: 8px; }
  nav ol { padding-left: 20px; } a { color: #0060df; }
  @media print { body { margin: 0; } a { color: inherit; text-decoration: none; } }
</style></head><body>
<h1>${esc(title)}</h1><p class="gen">${esc(L.generated)} ${esc(fmt(new Date().toISOString()))}</p>
${toc}
${sections || `<p>${esc(L.none)}</p>`}
</body></html>`;
}

module.exports = { list: () => list().map(withProgress), get: (id) => { const d = list().find((x) => x.id === id); return d ? withProgress(d) : null }, create, update, addEvent, remove, renderHtml, progress, sanitizeSvg, FILE };
